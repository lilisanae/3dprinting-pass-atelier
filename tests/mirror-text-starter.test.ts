import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { placementTransform } from '../src/artwork/paths';
import { parseFontPack } from '../src/artwork/font-pack';
import { textMetrics } from '../src/artwork/text-layout';
import { resizeTextContent } from '../src/model/textEditing';
import { scaleGroupAxis, scalePlacements } from '../src/model/scaling';
import { applyPlacementPatch } from '../src/model/layerEditing';
import { createProject, validateProject } from '../src/model/project';
import { generateGeometry, inspectGeneratedModel } from '../src/geometry/engine';
import type { TemplateData } from '../src/model/types';

const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
const starter = () =>
  validateProject(
    JSON.parse(readFileSync(new URL('../src/presets/first-pass.json', import.meta.url), 'utf8')),
  );
const buffer = readFileSync(new URL('../public/assets/pass-font-core-v1.woff', import.meta.url));
const fontBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength,
) as ArrayBuffer;
const font = parseFontPack(fontBuffer);
const near = (a: number, b: number, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('reflection keeps the placement box and transformed group contours registered', () => {
  const p = { x: 12, y: 18, width: 10, height: 8, rotation: 37, mirrorY: true };
  const contours = [
    [
      [0, 0],
      [10, 3],
      [2, 8],
    ],
  ];
  const old = placementTransform(contours, p)[0];
  const mirrored = placementTransform(contours, { ...p, mirrorX: true })[0];
  const twice = placementTransform(contours, { ...p, mirrorX: false })[0];
  assert.deepEqual(old, twice);
  const [horizontal] = scaleGroupAxis([p], [0, 0], -1, 'x');
  const h = placementTransform(contours, { ...p, ...horizontal })[0];
  const center = p.x + p.width / 2;
  old.forEach((v, i) => {
    near(h[i][0], center * 2 - v[0]);
    near(h[i][1], v[1]);
  });
  const [negative] = scalePlacements([p], [0, 0], -2);
  const n = placementTransform(
    contours.map((c) => c.map(([x, y]) => [x * 2, y * 2])),
    { ...p, ...negative },
  )[0];
  old.forEach((v, i) => {
    near(n[i][0], -v[0] * 2);
    near(n[i][1], -v[1] * 2);
  });
  assert.notDeepEqual(mirrored, old);
});

test('content, multiline and empty text preserve glyph size; resizing updates saved scales', () => {
  const text = { text: 'AAA', width: 20, height: 7 };
  const initial = textMetrics(text.text, {}, font);
  const longer = resizeTextContent(text, 'AAAAAA', font);
  const metrics = textMetrics(longer.text, longer, font);
  near(longer.width / metrics.width, text.width / initial.width);
  near(longer.height / metrics.height, text.height / initial.height);
  assert.ok(longer.width > text.width);
  const multiline = resizeTextContent(longer, 'AAAAAA\nA', font);
  near(multiline.textScaleY, longer.textScaleY);
  assert.ok(multiline.height > longer.height);
  const empty = resizeTextContent(multiline, '', font);
  const restored = resizeTextContent(empty, text.text, font);
  near(restored.width, text.width);
  near(restored.height, text.height);
  const p = createProject(template);
  const item = { ...p.collections[0].items[0], kind: 'text' as const, ...longer };
  p.collections[0].items = [item];
  applyPlacementPatch(
    p,
    { kind: 'item', collectionId: p.collections[0].id, id: item.id },
    { width: item.width * 2, mirrorX: true },
  );
  near(item.textScaleX!, longer.textScaleX * 2);
  const changed = resizeTextContent(item, 'AA', font);
  near(changed.textScaleX, longer.textScaleX * 2);
  assert.equal(
    validateProject(JSON.parse(JSON.stringify(p))).collections[0].items[0].mirrorX,
    true,
  );
  assert.throws(() =>
    validateProject({
      ...p,
      template: { ...p.template, label: { ...p.template.label, mirrorX: 'yes' } },
    }),
  );
});

test('mirrored original template meshes and back artwork remain closed and exclusive', async () => {
  const project = createProject(template);
  project.template.label.mirrorX = true;
  project.template.decorations['decoration-0'].mirrorY = true;
  project.collections[2].items[0].mirrorX = true;
  const result = await generateGeometry(validateProject(project), template, fontBuffer);
  const checked = await inspectGeneratedModel(result);
  assert.ok(!result.issues.some((i) => i.severity === 'error'));
  assert.ok(checked.closed.every(Boolean));
  assert.ok(checked.overlaps.every(([, , volume]) => volume < 0.00001));
});

test(
  'optimized starter retains exact artwork and printable colored volumes',
  { skip: !process.env.PASS_STARTER_SOURCE },
  async () => {
    const originalPath = process.env.PASS_STARTER_SOURCE;
    assert.ok(originalPath);
    const original = validateProject(JSON.parse(readFileSync(originalPath, 'utf8')));
    const optimized = starter();
    const before = original.collections.flatMap((c) => c.items);
    const after = optimized.collections.flatMap((c) => c.items);
    assert.equal(after.length, before.length);
    before.forEach((item, i) => {
      for (const key of [
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'colorId',
        'regions',
        'sourceWidth',
        'sourceHeight',
        'text',
        'fontId',
        'coversLower',
        'avoidsLower',
      ] as const)
        assert.deepEqual(after[i][key], item[key]);
      assert.equal(after[i].sourceDataUrl, undefined);
    });
    const previous = await generateGeometry(original, template, fontBuffer);
    const next = await generateGeometry(optimized, template, fontBuffer);
    const totals = (model: typeof next) =>
      model.meshes.reduce(
        (sum, m) => ((sum[m.colorId] = (sum[m.colorId] ?? 0) + m.volume), sum),
        {} as Record<string, number>,
      );
    for (const [id, volume] of Object.entries(totals(previous)))
      near(totals(next)[id], volume, 0.00001);
    assert.ok(!next.issues.some((i) => i.severity === 'error'));
    const inspected = await inspectGeneratedModel(next);
    assert.ok(inspected.closed.every(Boolean));
    assert.ok(inspected.overlaps.every(([, , volume]) => volume < 0.00001));
    writeFileSync(
      '.qa/starter-model.json',
      JSON.stringify({
        palette: optimized.palette,
        meshes: next.meshes.map((m) => ({
          colorId: m.colorId,
          positions: [...m.positions],
          indices: [...m.indices],
        })),
      }),
    );
  },
);

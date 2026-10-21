import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { packFonts, packFontFamilies, parseFontPack } from '../src/artwork/font-pack';
import { fontFiles, loadProjectFontBuffer } from '../src/artwork/font-loader';
import { textMetrics, textOutline } from '../src/artwork/text-layout';
import { importTextFont, embeddedFontBuffer } from '../src/artwork/text-fonts';
import { createProject, validateProject } from '../src/model/project';
import type { TemplateData } from '../src/model/types';
import { generateGeometry, inspectGeneratedModel } from '../src/geometry/engine';

const asset = (name: string) => {
  const data = readFileSync(new URL(`../public/assets/${name}`, import.meta.url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};
const base = asset('pass-font-core-v1.woff');
const font = parseFontPack(base);
const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;

test('legacy lettering is unchanged; tracking, leading and multiline alignment adjust outlines', () => {
  const legacy = new opentype.Path();
  ['AAAA', 'A'].forEach((line, i) =>
    legacy.extend(font.getPath(line, 0, i * font.unitsPerEm * 1.2, font.unitsPerEm)),
  );
  assert.deepEqual(textOutline('AAAA\nA', {}, font).commands, legacy.commands);
  assert.ok(
    textMetrics('AAAA', { letterSpacing: 300 }, font).width > textMetrics('AAAA', {}, font).width,
  );
  assert.ok(
    textMetrics('AAAA\nA', { lineHeight: 2 }, font).height >
      textMetrics('AAAA\nA', {}, font).height,
  );
  const lineStart = font.getPath('AAAA', 0, 0, font.unitsPerEm).commands.length;
  const left = textOutline('AAAA\nA', {}, font).commands[lineStart];
  const center = textOutline('AAAA\nA', { textAlign: 'center' }, font).commands[lineStart];
  const right = textOutline('AAAA\nA', { textAlign: 'right' }, font).commands[lineStart];
  assert.ok('x' in left && 'x' in center && 'x' in right);
  assert.ok(center.x > left.x && right.x > center.x);
  assert.ok(Math.abs(right.x - left.x - 2 * (center.x - left.x)) < 1e-8);
});

test('both new built-in faces preserve mixed Chinese and Latin outlines in their small packs', () => {
  const round = (v: unknown) =>
    JSON.parse(
      JSON.stringify(v, (_, n) => (typeof n === 'number' ? Math.round(n * 1e7) / 1e7 : n)),
    );
  for (const family of ['sans-regular', 'serif-regular']) {
    const names = fontFiles('上海 AV 通行证 ffi', family);
    const packed = parseFontPack(packFonts(names.map(asset)));
    const full = parseFontPack(asset(`text-${family}-full-v1.woff`));
    assert.ok(names.every((n) => !n.includes('full')));
    assert.deepEqual(
      round(packed.getPath('上海 AV 通行证 ffi', 0, 0, 100).commands),
      round(full.getPath('上海 AV 通行证 ffi', 0, 0, 100).commands),
    );
    const registry = parseFontPack(
      packFontFamilies([
        { id: 'sans-bold', buffer: base },
        { id: family, buffer: packFonts(names.map(asset)) },
      ]),
    );
    assert.notDeepEqual(
      textOutline('AV', { fontId: family }, registry).commands,
      textOutline('AV', {}, registry).commands,
    );
  }
});

test('imported font survives a project round trip and keeps its own Latin glyphs beside Chinese fallback', async () => {
  const path = new opentype.Path();
  path.moveTo(0, 0);
  path.lineTo(300, 700);
  path.lineTo(600, 0);
  path.close();
  const face = new opentype.Font({
    familyName: 'Imported Face',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: new opentype.Path() }),
      new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 700, path }),
    ],
  });
  const imported = await importTextFont(new File([face.toArrayBuffer()], 'face.otf'));
  const project = createProject(template);
  project.fonts = [imported];
  const item = project.collections[1].items.find((i) => i.kind === 'text')!;
  Object.assign(item, {
    text: 'A通A',
    fontId: imported.id,
    letterSpacing: 120,
    lineHeight: 1.6,
    textAlign: 'right',
  });
  const restored = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.fonts, [imported]);
  const registry = parseFontPack(
    packFontFamilies([
      { id: 'sans-bold', buffer: base },
      { id: imported.id, buffer: embeddedFontBuffer(restored.fonts![0].dataUrl) },
    ]),
  );
  const selected = registry.resolveFont!(imported.id);
  assert.equal(selected.missingGlyphs!('A通A'), '通');
  const actual = selected.getPath('A通A', 0, 0, 100).commands;
  assert.deepEqual(actual.slice(0, path.commands.length), face.getPath('A', 0, 0, 100).commands);
  assert.ok(actual.length > path.commands.length * 2);
  assert.throws(() => validateProject({ ...restored, fonts: [] }), /找不到文字使用的字体/);
});

test('chosen typography reaches the physical model with closed, exclusive export meshes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(asset(String(url).split('/').at(-1)!));
  try {
    const project = createProject(template);
    for (const collection of project.collections) collection.items = [];
    const item = {
      ...createProject(template).collections[1].items.find((i) => i.kind === 'text')!,
      text: 'AV\n早苗',
      fontId: 'serif-regular',
      letterSpacing: 120,
      lineHeight: 1.6,
      textAlign: 'center' as const,
      x: 12,
      y: 25,
      width: 20,
      height: 18,
    };
    project.collections[1].items = [item];
    const buffer = await loadProjectFontBuffer(project);
    const model = await generateGeometry(project, template, buffer);
    const inspection = await inspectGeneratedModel(model);
    assert.ok(inspection.closed.every(Boolean));
    assert.ok(inspection.overlaps.every(([, , volume]) => volume < 1e-4));
    assert.ok(Math.abs(inspection.unionVolume - model.stats.volume) < 0.02);
    assert.ok(model.meshes.some((m) => m.colorId === item.colorId && m.volume > 0));
    assert.equal(buffer, await loadProjectFontBuffer(project));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

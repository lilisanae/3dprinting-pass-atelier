import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groupPlacementBounds, groupResizeFactor, scalePlacements } from '../src/model/scaling';
import { placementBounds } from '../src/model/selection';
import { createProject, newCollection, validateProject } from '../src/model/project';
import { generateGeometry, inspectGeneratedModel } from '../src/geometry/engine';
import type { TemplateData } from '../src/model/types';

const near = (a: number, b: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const placements = [
  { x: 8.23417, y: 15.65931, width: 12.58321, height: 8.12317, rotation: 37 },
  { x: 30.69132, y: 48.12834, width: 8.16219, height: 10.6132, rotation: -19 },
];
const corner = (p: (typeof placements)[number], x: number, y: number) => {
  const angle = (p.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return [
    p.x + p.width / 2 + (x - 0.5) * p.width * c - (y - 0.5) * p.height * s,
    p.y + p.height / 2 + (x - 0.5) * p.width * s + (y - 0.5) * p.height * c,
  ];
};

test('group scaling preserves every rotated corner and relative position around the chosen anchor', () => {
  const bounds = groupPlacementBounds(placements)!;
  const anchor: [number, number] = [bounds[0], bounds[1]];
  const factor = 1.3719;
  const patches = scalePlacements(placements, anchor, factor);
  placements.forEach((p, i) => {
    const result = { ...p, ...patches[i] };
    for (const x of [0, 1])
      for (const y of [0, 1]) {
        const before = corner(p, x, y),
          after = corner(result, x, y);
        after.forEach((value, axis) =>
          near(value, anchor[axis] + (before[axis] - anchor[axis]) * factor),
        );
      }
    near(result.width / result.height, p.width / p.height);
    assert.equal(result.rotation, p.rotation);
  });
  const scaledBounds = groupPlacementBounds(placements.map((p, i) => ({ ...p, ...patches[i] })))!;
  near(scaledBounds[0], bounds[0]);
  near(scaledBounds[1], bounds[1]);
  near(scaledBounds[2] - scaledBounds[0], (bounds[2] - bounds[0]) * factor);
  near(scaledBounds[3] - scaledBounds[1], (bounds[3] - bounds[1]) * factor);
});

test('silhouette registration and source dimensions survive scaling with no cumulative rounding', () => {
  const p = {
    ...placements[0],
    sourceWidth: 21.1387,
    sourceHeight: 16.9813,
    sourceDataUrl: 'data:image/png;base64,example',
  };
  const before = structuredClone(p);
  const bounds = placementBounds(p),
    anchor: [number, number] = [bounds[0], bounds[1]];
  const patches = scalePlacements([p, { ...p }], anchor, 0.61893);
  assert.deepEqual(patches[0], patches[1]);
  const scaled = { ...p, ...patches[0] };
  assert.equal(scaled.sourceWidth, p.sourceWidth);
  assert.equal(scaled.sourceHeight, p.sourceHeight);
  const [restored] = scalePlacements([scaled], anchor, 1 / 0.61893);
  for (const key of ['x', 'y', 'width', 'height'] as const) near(restored[key], p[key]);
  assert.deepEqual(p, before);
  assert.deepEqual(scalePlacements([p], anchor, 1)[0], {
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    mirrorX: false,
    mirrorY: false,
  });
});

test('diagonal scaling follows off-center pointer grabs and does not interpret sideways jitter as resizing', () => {
  const bounds: [number, number, number, number] = [5, 8, 25, 38];
  const start: [number, number] = [24.1, 38.6];
  near(groupResizeFactor(bounds, start, [34.1, 53.6]), 1.5);
  near(groupResizeFactor(bounds, start, [19.1, 31.1]), 0.75);
  near(groupResizeFactor(bounds, start, [27.1, 36.6]), 1);
  near(groupResizeFactor(bounds, start, start), 1);
});

test('dragging across the fixed corner reverses scaling and can grow again', () => {
  const bounds: [number, number, number, number] = [0, 0, 10, 20];
  assert.ok(groupResizeFactor(bounds, [10, 20], [-100, -100]) < 0);
  near(groupResizeFactor(bounds, [10, 20], [15, 30]), 1.5);
  assert.equal(groupResizeFactor(bounds, [10, 20], [1e6, 1e6]), 100);
  assert.equal(groupResizeFactor([0, 0, 0, 0], [0, 0], [5, 5]), 1);
  assert.equal(groupResizeFactor(bounds, [10, 20], [NaN, 0]), 1);
});

test('invalid factors, anchors, dimensions and overflow fail before any input is changed', () => {
  const before = structuredClone(placements);
  for (const factor of [0, NaN, Infinity])
    assert.throws(() => scalePlacements(placements, [0, 0], factor));
  assert.throws(() => scalePlacements(placements, [NaN, 0], 1));
  assert.throws(() => scalePlacements([{ ...placements[0], width: 0 }], [0, 0], 2));
  assert.throws(() => scalePlacements([{ ...placements[0], width: 1e308 }], [0, 0], 10));
  assert.deepEqual(placements, before);
});

test('empty, single and rotated placements use complete bounds, including regions outside the board', () => {
  assert.equal(groupPlacementBounds([]), null);
  const p = { ...placements[0], x: -20, y: -4, rotation: 90 };
  assert.deepEqual(groupPlacementBounds([p]), placementBounds(p));
  const together = groupPlacementBounds([p, placements[1]])!;
  assert.ok(together[0] < 0 && together[1] < 0);
  near(together[2], placementBounds(placements[1])[2]);
  near(together[3], placementBounds(placements[1])[3]);
});

test('scaled rotated lineart and silhouette roundtrip and produce closed, supported, exclusive printable parts', async () => {
  const template: TemplateData = JSON.parse(
    await readFile(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
  );
  const project = createProject(template);
  project.template.label.visible = false;
  Object.values(project.template.decorations).forEach((p) => (p.visible = false));
  const lower = newCollection('front'),
    upper = newCollection('front');
  lower.thickness = 0.35;
  const base = {
    id: 'backing',
    name: '剪影',
    kind: 'paths' as const,
    visible: true,
    x: 12,
    y: 30,
    width: 12,
    height: 18,
    rotation: 23,
    colorId: 'white',
    sourceWidth: 12,
    sourceHeight: 18,
    regions: [{ colorId: 'white', path: 'M0 0H12V18H0Z' }],
  };
  const ink = {
    ...base,
    id: 'ink',
    name: '线稿',
    colorId: 'black',
    regions: [{ colorId: 'black', path: 'M0 0H12V18H0Z M2 2V16H10V2Z' }],
  };
  const bounds = groupPlacementBounds([base, ink])!;
  const patches = scalePlacements([base, ink], [bounds[0], bounds[1]], 1.5);
  lower.items = [{ ...base, ...patches[0] }];
  upper.items = [{ ...ink, ...patches[1] }];
  project.collections = [lower, upper];
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  const font = await readFile(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
  const model = await generateGeometry(
    project,
    template,
    font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer,
  );
  const inspected = await inspectGeneratedModel(model);
  assert.ok(inspected.closed.every(Boolean));
  assert.equal(inspected.components, 1);
  assert.ok(inspected.overlaps.every(([, , volume]) => volume < 1e-4));
  assert.ok(model.meshes.some((m) => m.colorId === 'black' && m.volume > 0));
  assert.ok(model.meshes.some((m) => m.colorId === 'white' && m.volume > 0));
});

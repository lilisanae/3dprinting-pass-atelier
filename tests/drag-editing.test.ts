import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dragAxis, makeDragSnapScene, resolveDragSnap } from '../src/model/dragSnapping';
import { duplicateDragItems } from '../src/model/dragEditing';
import { makeSnapShapes } from '../src/model/snapping';
import { createProject, newShape } from '../src/model/project';
import { newCutter } from '../src/model/booleanEditing';
import type { SnapPoint, SnapShape } from '../src/model/snapping';
import type { DragEntry } from '../src/model/dragEditing';
import type { TemplateData } from '../src/model/types';

const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
function rect(key: string, x: number, y: number, width = 2, height = 2): SnapShape {
  return {
    key,
    name: key,
    selection: null,
    contours: [],
    center: [x + width / 2, y + height / 2],
    boundsContour: [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
  };
}
function near(actual: SnapPoint, expected: SnapPoint) {
  assert.ok(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-10,
    `${actual} != ${expected}`,
  );
}
const scene = (target: SnapShape) =>
  makeDragSnapScene([rect('moving', 0, 0), target], new Set(['moving']));

test('Shift waits for a direction, holds that axis and unlocks on release', () => {
  assert.equal(dragAxis([0.01, 0.02], true, null, 0.25), null);
  const x = dragAxis([3, 1], true, null, 0.25);
  assert.equal(x, 'x');
  assert.equal(dragAxis([1, 20], true, x, 0.25), 'x');
  assert.equal(dragAxis([1, 20], false, x, 0.25), null);
  assert.equal(dragAxis([1, 20], true, null, 0.25), 'y');
});

test('nearby corners/midpoints snap as points and show the matched point', () => {
  const s = scene(rect('target', 10, 10));
  const result = resolveDragSnap(s, [9.7, 9.8], 0.5);
  near(result.delta, [10, 10]);
  assert.ok(result.guides.some((g) => 'point' in g));
  assert.ok(s.target.points.some((p) => p[0] === 11 && p[1] === 10));
  // Source bottom midpoint meeting a target corner, with no center/edge pair nearby.
  const midpoint = makeDragSnapScene(
    [rect('moving', 0, 0), rect('target', 11, 12, 7, 9)],
    new Set(['moving']),
  );
  near(resolveDragSnap(midpoint, [9.8, 10.1], 0.3).delta, [10, 10]);
});

test('centerlines align one axis even when the objects are far apart on the other', () => {
  const result = resolveDragSnap(scene(rect('target', 20, 50)), [19.7, 6.3], 0.5);
  near(result.delta, [20, 6.3]);
  assert.ok(result.guides.some((g) => 'axis' in g && g.axis === 'x'));
  near(resolveDragSnap(scene(rect('target', 20, 50)), [19.7, 6.3], 0.2).delta, [19.7, 6.3]);
});

test('Ctrl bypass restores raw movement; Shift keeps the inactive axis fixed including near points', () => {
  const s = scene(rect('target', 10, 0.2));
  const bypass = resolveDragSnap(s, [9.7, 5], 0.6, 'x', true);
  near(bypass.delta, [9.7, 0]);
  assert.deepEqual(bypass.guides, []);
  near(resolveDragSnap(s, [9.7, 5], 0.6, 'x').delta, [10, 0]);
  near(resolveDragSnap(s, [9.7, 5], 0.6, 'y', true).delta, [0, 5]);
  near(resolveDragSnap(s, [9.7, 5], 0.6, null, true).delta, [9.7, 5]);
});

test('multi-selection excludes all moving targets and shares a precise group translation', () => {
  const shapes = [rect('a', 0, 0), rect('b', 10.123456, 4.654321), rect('target', 30, 50)];
  const s = makeDragSnapScene(shapes, new Set(['a', 'b']));
  assert.equal(s.target.points.length, 9);
  assert.ok(s.source.points.some((p) => p[0] === 6.061728 && p[1] === 3.3271605));
  const { delta } = resolveDragSnap(s, [29.7, 2.2], 0.5);
  const moved = shapes
    .slice(0, 2)
    .map((shape) => [shape.center[0] + delta[0], shape.center[1] + delta[1]] as SnapPoint);
  near([moved[1][0] - moved[0][0], moved[1][1] - moved[0][1]], [10.123456, 4.654321]);
  assert.equal(makeDragSnapScene(shapes, new Set(['a', 'b']), true).target.points.length, 27);
  assert.deepEqual(makeDragSnapScene(shapes.slice(0, 2), new Set(['a', 'b'])).target.points, []);
});

test('automatic references use rotated bounds without parsing artwork and exclude hidden/opposite-face objects', () => {
  const p = createProject(template);
  const item = { ...newShape(), id: 'rotated', x: 10, y: 20, width: 8, height: 4, rotation: 90 };
  p.collections = [
    {
      id: 'shown',
      name: '',
      face: 'front',
      visible: true,
      thickness: 0.6,
      items: [item, { ...newShape(), id: 'hidden-item', visible: false }],
    },
    {
      id: 'hidden',
      name: '',
      face: 'front',
      visible: false,
      thickness: 0.6,
      items: [{ ...newShape(), id: 'hidden-group-item' }],
    },
    {
      id: 'back',
      name: '',
      face: 'back',
      visible: true,
      thickness: 0.7,
      items: [{ ...newShape(), id: 'back-item' }],
    },
  ];
  const shapes = makeSnapShapes(p, template, 'front', undefined, 'bounds');
  assert.deepEqual(
    shapes.filter((s) => s.key.startsWith('item:')).map((s) => s.key),
    ['item:rotated'],
  );
  const rotated = shapes.find((s) => s.key === 'item:rotated')!;
  near(rotated.boundsContour[0], [16, 18]);
  assert.deepEqual(rotated.contours, []);
  const back = makeSnapShapes(p, template, 'back', undefined, 'bounds');
  assert.deepEqual(
    back.map((s) => s.key),
    ['base', 'item:back-item'],
  );
});

test('Alt copies related artwork in each original collection and restores originals after a mid-drag copy', () => {
  const p = createProject(template),
    target = { ...newShape(), id: 'target', x: 3.12345, y: 8, letterSpacing: 30 };
  const tool = newCutter(target);
  p.collections = [
    { id: 'a', name: '', face: 'front', visible: true, thickness: 0.6, items: [target] },
    { id: 'b', name: '', face: 'front', visible: true, thickness: 0.8, items: [tool] },
  ];
  const snapshot = structuredClone(p);
  const entries: DragEntry[] = p.collections.map((c) => ({
    s: { kind: 'item', collectionId: c.id, id: c.items[0].id },
    p: { ...c.items[0] },
  }));
  target.x += 9;
  target.y += 4;
  tool.x += 9;
  tool.y += 4;
  const copies = duplicateDragItems(p, entries);
  assert.equal(copies.length, 2);
  assert.deepEqual(
    p.collections.map((c) => c.items[0]),
    snapshot.collections.map((c) => c.items[0]),
  );
  assert.equal(p.collections[0].items[1].letterSpacing, 30);
  assert.deepEqual(p.collections[1].items[1].cutout!.targetIds, [p.collections[0].items[1].id]);
  for (let i = 0; i < copies.length; i++) {
    const selection = copies[i].s;
    assert.equal(selection?.kind === 'item' && selection.collectionId, p.collections[i].id);
    near([copies[i].p.x, copies[i].p.y], [entries[i].p.x, entries[i].p.y]);
    assert.equal(p.collections[i].thickness, snapshot.collections[i].thickness);
  }
  p.collections[1].items[1].cutout!.targetIds.length = 0;
  assert.equal(tool.cutout!.targetIds.length, 1);
  assert.equal(duplicateDragItems(p, [{ s: { kind: 'label' }, p: p.template.label }]).length, 0);
});

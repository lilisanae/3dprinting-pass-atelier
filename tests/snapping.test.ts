import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import opentype from 'opentype.js';
import { createProject, newShape } from '../src/model/project';
import {
  makeSnapShapes,
  pickSnapFeature,
  projectToFeature,
  resolveSnap,
  snapDelta,
  snapFeatures,
} from '../src/model/snapping';
import type { SnapFeature, SnapPick, SnapPoint, SnapShape } from '../src/model/snapping';
import type { DesignItem, Project, TemplateData } from '../src/model/types';

const template = JSON.parse(
  await readFile(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
function withItems(items: DesignItem[], face: 'front' | 'back' = 'front'): Project {
  const project = createProject(template);
  project.collections = [{ id: 'group', name: 'Test', face, visible: true, thickness: 0.6, items }];
  return project;
}
function near(actual: SnapPoint, expected: SnapPoint, tolerance = 1e-9) {
  assert.ok(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= tolerance,
    `${actual.join(',')} differs from ${expected.join(',')}`,
  );
}
function point(x: number, y: number): SnapFeature {
  return { id: 'point', owner: 'target', name: 'Point', kind: 'vertex', point: [x, y] };
}
function line(a: SnapPoint, b: SnapPoint, infinite = false): SnapFeature {
  return {
    id: 'line',
    owner: 'target',
    name: 'Line',
    kind: infinite ? 'centerline' : 'edge',
    a,
    b,
    infinite,
  };
}
function picked(feature: SnapFeature, position: SnapPoint): SnapPick {
  return { feature, point: projectToFeature(feature, position) };
}

test('rotated placement references retain local corners rather than axis-aligned extremes', () => {
  const rect = {
    ...newShape('white', 'rect'),
    id: 'rotated',
    x: 10,
    y: 20,
    width: 8,
    height: 4,
    rotation: 90,
  };
  const shape = makeSnapShapes(withItems([rect]), template, 'front').find(
    (s) => s.key === 'item:rotated',
  )!;
  [
    [16, 18],
    [16, 26],
    [12, 26],
    [12, 18],
  ].forEach((expected, i) => near(shape.boundsContour[i], expected as SnapPoint));
  near(shape.center, [14, 22]);
  snapFeatures([shape], 'bounds', 'vertex').forEach((feature, i) =>
    near(feature.point!, shape.contours[0][i]),
  );
  const top = snapFeatures([shape], 'bounds', 'midpoint')[0];
  near(top.point!, [16, 22]);
  const lines = snapFeatures([shape], 'outline', 'centerline');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((feature) => feature.infinite));
  near(projectToFeature(lines[0], [300, 30]), [300, 22]);
  near(projectToFeature(lines[1], [300, -40]), [14, -40]);
});

test('actual concave contours and holes remain pickable outside the base clipping area', () => {
  const item: DesignItem = {
    ...newShape(),
    id: 'concave',
    kind: 'paths',
    x: -2,
    y: 3,
    width: 10,
    height: 10,
    rotation: 0,
    sourceWidth: 10,
    sourceHeight: 10,
    regions: [{ colorId: 'white', path: 'M0 0H10V4H4V10H0Z M1 1V3H3V1Z' }],
  };
  const shape = makeSnapShapes(withItems([item]), template, 'front').find(
    (s) => s.key === 'item:concave',
  )!;
  assert.deepEqual(
    shape.contours.map((contour) => contour.length),
    [6, 4],
  );
  const outline = snapFeatures([shape], 'outline', 'vertex');
  const bounds = snapFeatures([shape], 'bounds', 'vertex');
  assert.equal(outline.length, 10);
  assert.equal(bounds.length, 4);
  near(pickSnapFeature(outline, [2.03, 7], 0.1)!.point, [2, 7]);
  near(pickSnapFeature(outline, [-1, 4], 0.01)!.point, [-1, 4]);
  assert.equal(pickSnapFeature(bounds, [2, 7], 0.1), null);
  assert.ok(
    outline.some((feature) => feature.point![0] < 0),
    'outside artwork is not silently cropped',
  );
});

test('real template boundaries omit mesh diagonals, preserve all three openings and mirror only the back base', () => {
  const project = createProject(template);
  const front = makeSnapShapes(project, template, 'front');
  const base = front.find((shape) => shape.key === 'base')!;
  assert.equal(base.contours.length, 4, 'outer perimeter, long slot and two round holes');
  assert.ok(
    base.contours.reduce((sum, contour) => sum + contour.length, 0) < 180,
    'projected triangles must not be exposed as independent outlines',
  );
  const panel = front.find((shape) => shape.key === 'panel')!;
  assert.equal(panel.contours.length, 1);
  assert.equal(panel.contours[0].length, 4);
  assert.ok(
    front
      .filter((shape) => shape.key.startsWith('decoration:'))
      .every((shape) => shape.contours.length > 0),
  );
  const originalLabel = front.find((shape) => shape.key === 'label')!;
  assert.ok(originalLabel.contours.length > 3);
  const original = originalLabel.contours[0][0];
  project.template.label.x += 2;
  project.template.label.y += 3;
  const translated = makeSnapShapes(project, template, 'front').find(
    (shape) => shape.key === 'label',
  )!;
  near(translated.contours[0][0], [original[0] + 2, original[1] + 3]);
  const backItem = {
    ...newShape('white', 'triangle'),
    id: 'back-item',
    x: 3,
    y: 20,
    width: 12,
    height: 8,
  };
  project.collections.push({
    id: 'back-group',
    name: 'Back',
    face: 'back',
    visible: true,
    thickness: 0.7,
    items: [backItem],
  });
  const back = makeSnapShapes(project, template, 'back');
  const mirrored = back.find((shape) => shape.key === 'base')!;
  base.contours.forEach((contour, index) =>
    contour.forEach(([x, y], i) => near(mirrored.contours[index][i], [50 - x, y])),
  );
  near(back.find((shape) => shape.key === 'item:back-item')!.contours[0][0], [9, 20]);
  assert.equal(
    back.some((shape) => shape.key === 'label' || shape.key === 'panel'),
    false,
  );
});

test('changed glyphs generate new real references and hidden members never contribute candidates', async () => {
  const bytes = await readFile(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
  const font = opentype.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const item = { ...newShape(), id: 'visible', x: 3, y: 12 };
  const hidden = { ...newShape(), id: 'hidden', visible: false };
  const project = withItems([item, hidden]);
  assert.ok(project.template.label);
  const before = makeSnapShapes(project, template, 'front', font).find(
    (shape) => shape.key === 'label',
  )!;
  project.template.label.useOriginal = false;
  project.template.label.text = '工坊';
  project.template.label.rotation = 25;
  const after = makeSnapShapes(project, template, 'front', font).find(
    (shape) => shape.key === 'label',
  )!;
  assert.ok(after.contours.length > 0);
  assert.notDeepEqual(after.contours, before.contours);
  assert.notDeepEqual(after.boundsContour, before.boundsContour);
  assert.equal(
    makeSnapShapes(project, template, 'front', font).some((shape) => shape.key === 'item:hidden'),
    false,
  );
  project.collections[0].visible = false;
  project.template.label.visible = false;
  project.template.decorations['decoration-0'].visible = false;
  const names = makeSnapShapes(project, template, 'front', font).map((shape) => shape.key);
  assert.equal(names.includes('item:visible'), false);
  assert.equal(names.includes('label'), false);
  assert.equal(names.includes('decoration:decoration-0'), false);
});

test('projection clamps finite edges, extends centerlines and safely handles zero-length lines', () => {
  const segment = line([30, 42], [42, 42]);
  near(projectToFeature(segment, [13, 20]), [30, 42]);
  near(projectToFeature(segment, [37, 20]), [37, 42]);
  near(projectToFeature(segment, [50, 20]), [42, 42]);
  near(projectToFeature(line([30, 42], [42, 42], true), [13, 20]), [13, 42]);
  near(projectToFeature(line([4, 6], [4, 6]), [12, 40]), [4, 6]);
  assert.equal(pickSnapFeature([segment], [37, 20], 21.9), null);
  near(pickSnapFeature([segment], [37, 20], 22)!.point, [37, 42]);
  assert.equal(pickSnapFeature([segment], [NaN, 20], 30), null);
  assert.equal(pickSnapFeature([segment], [37, 20], -2), null);
});

test('point and line combinations use the selected references rather than arbitrary hovered coordinates', () => {
  const sourcePoint = picked(point(13, 20), [13, 20]);
  const edge = line([30, 42], [42, 42]);
  const result = resolveSnap(sourcePoint, edge, [39, 42]);
  near(result.source, [13, 20]);
  near(result.target, [30, 42]);
  near(result.delta, [17, 22]);
  near(resolveSnap(sourcePoint, line([30, 42], [42, 42], true), [39, 42]).delta, [0, 22]);
  const sourceEdge = picked(line([8, 20], [8, 32]), [8, 25]);
  const target = point(36, 42);
  const finiteResult = resolveSnap(sourceEdge, target, [36, 42]);
  near(finiteResult.source, [8, 32]);
  near(finiteResult.delta, [28, 10]);
  const sourceAxis = picked(line([8, 20], [8, 32], true), [8, 25]);
  near(resolveSnap(sourceAxis, target, [36, 42]).source, [8, 42]);
  near(resolveSnap(sourceAxis, target, [36, 42]).delta, [28, 0]);
  near(resolveSnap(sourcePoint, point(36, 42), [0, 0]).delta, [23, 22]);
});

test('parallel lines translate only along the normal and nonparallel lines retain the picked source anchor', () => {
  const source = picked(line([0, 0], [8, 8]), [2, 2]);
  const parallel = line([20, 30], [24, 34]);
  const parallelResult = resolveSnap(source, parallel, [22, 32]);
  near(parallelResult.delta, [-5, 5]);
  near(parallelResult.source, [2, 2]);
  near(parallelResult.target, [-3, 7]);
  const horizontal = picked(line([0, 0], [5, 0]), [2, 0]);
  near(resolveSnap(horizontal, line([30, 6], [42, 6]), [35, 6]).delta, [0, 6]);
  const nonparallel = resolveSnap(horizontal, line([8, -2], [8, 8]), [8, 6]);
  near(nonparallel.source, [2, 0]);
  near(nonparallel.target, [8, 0]);
  near(nonparallel.delta, [6, 0]);
});

test('snap deltas preserve submillimetre values and one translation preserves every member offset', () => {
  const source = picked(point(1 / 3, Math.PI), [0, 0]);
  const target = picked(point(Math.SQRT2, Math.E), [0, 0]);
  const delta = snapDelta(source, target);
  assert.equal(delta[0], Math.SQRT2 - 1 / 3);
  assert.equal(delta[1], Math.E - Math.PI);
  const positions: SnapPoint[] = [
    [1.25, 5.75],
    [-2.8, 11.02],
    [40, -4],
  ];
  const moved = positions.map(([x, y]) => [x + delta[0], y + delta[1]] as SnapPoint);
  moved
    .slice(1)
    .forEach((position, index) =>
      near(
        [position[0] - moved[0][0], position[1] - moved[0][1]],
        [positions[index + 1][0] - positions[0][0], positions[index + 1][1] - positions[0][1]],
      ),
    );
});

test('dense actual contours remain complete and nearest picking scans them within a practical budget', () => {
  const count = 25_000;
  const contour: SnapPoint[] = Array.from({ length: count }, (_, index) => {
    const angle = (index * Math.PI * 2) / count;
    return [25 + Math.cos(angle) * 20, 50 + Math.sin(angle) * 30];
  });
  const shape: SnapShape = {
    key: 'dense',
    name: 'Dense',
    selection: null,
    contours: [contour],
    center: [25, 50],
    boundsContour: [
      [5, 20],
      [45, 20],
      [45, 80],
      [5, 80],
    ],
  };
  const started = performance.now();
  const features = snapFeatures([shape], 'outline', 'edge');
  assert.equal(features.length, count);
  for (let iteration = 0; iteration < 30; iteration++)
    near(pickSnapFeature(features, [45.05, 50], 0.1)!.point, [45, 50], 1e-5);
  assert.ok(
    performance.now() - started < 4000,
    'dense picking should not block interaction for seconds',
  );
});

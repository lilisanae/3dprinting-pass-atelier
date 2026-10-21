import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import {
  createBadgeProject,
  badgePresets,
  badgeOutline,
  insertBadgeNode,
  smoothBadgeNode,
  moveBadgeNode,
  nodesPath,
  validateBadgeBase,
  defaultBadgeBase,
  badgeLayers,
  badgeLayerLimits,
  setBadgeLayer,
} from '../src/model/badge';
import {
  createProject,
  newShape,
  validateProject,
  backSurfaceDepth,
  collectionInlayDepth,
  newCollection,
} from '../src/model/project';
import { serializeProject } from '../src/io/projectFile';
import {
  generateGeometry,
  getManifoldRuntime,
  inspectGeneratedModel,
} from '../src/geometry/engine';
import { normalizeBadgeOutline } from '../src/geometry/badgeOutline';
import { export3mf, exportStlZip } from '../src/export';
import { flattenPath } from '../src/artwork/paths';
import type { BadgeNode, BadgeMount } from '../src/model/badge';
import type { GeneratedModel } from '../src/model/types';
const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
);
const font = readFileSync(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
const fontBuffer = font.buffer.slice(
  font.byteOffset,
  font.byteOffset + font.byteLength,
) as ArrayBuffer;
const runtime = await getManifoldRuntime();
const near = (a: number, b: number, t = 0.003) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const square = (x: number, y: number, w: number, h: number): BadgeNode[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const rectProject = () => {
  const p = createBadgeProject();
  Object.assign(p.badgeBase!, { shape: 'rect', width: 60, height: 40, thickness: 3 });
  return p;
};
const slot = (patch: Partial<BadgeMount> = {}): BadgeMount => ({
  id: 'slot',
  kind: 'pin-slot',
  x: 15,
  y: 20,
  width: 20,
  height: 5,
  depth: 0.6,
  rotation: 0,
  ...patch,
});
const volume = (model: GeneratedModel, id: string) =>
  model.meshes.find((m) => m.colorId === id)?.volume ?? 0;
const valid = async (model: GeneratedModel) => {
  const result = await inspectGeneratedModel(model);
  assert.ok(result.closed.every(Boolean));
  assert.ok(result.overlaps.every(([, , v]) => v < 1e-4));
  assert.equal(result.components, 1);
};

test('badge projects round trip alongside legacy pass files; malformed bases and mixed formats are refused', () => {
  const p = rectProject();
  p.badgeBase!.mounts = [slot()];
  p.badgeBase!.shape = 'custom';
  p.badgeBase!.contours = [square(0, 0, 1, 1)];
  assert.deepEqual(validateProject(JSON.parse(serializeProject(p))), p);
  const legacy = createProject(template);
  assert.deepEqual(validateProject(JSON.parse(serializeProject(legacy))), legacy);
  for (const mutate of [
    (v: typeof p) => {
      v.badgeBase!.width = NaN;
    },
    (v: typeof p) => {
      v.badgeBase!.thickness = 1;
    },
    (v: typeof p) => {
      v.badgeBase!.mounts[0].depth = 2.8;
    },
    (v: typeof p) => {
      v.badgeBase!.contours![0][0].out = [Infinity, 0];
    },
    (v: typeof p) => {
      v.templateVersion = 'maimai-template-v1';
    },
    (v: typeof p) => {
      v.format = 'pass-atelier';
      v.templateVersion = 'maimai-template-v1';
    },
  ]) {
    const invalid = structuredClone(p);
    mutate(invalid);
    assert.throws(() => validateProject(invalid));
  }
  const bad = defaultBadgeBase();
  bad.mounts = [slot(), slot()];
  assert.throws(() => validateBadgeBase(bad), /安装槽/);
});
test('inserting a Bezier node preserves its exact curve and moving anchors carries handles', () => {
  const nodes = smoothBadgeNode(square(0.1, 0.1, 0.8, 0.8), 1),
    inserted = insertBadgeNode(nodes, 1);
  const section = (n: BadgeNode[]) =>
    new runtime.CrossSection(
      flattenPath(nodesPath(n, 60, 40), 0.002) as [number, number][][],
      'EvenOdd',
    );
  const a = section(nodes),
    b = section(inserted),
    difference = runtime.CrossSection.difference(a, b);
  near(difference.area(), 0, 0.001);
  a.delete();
  b.delete();
  difference.delete();
  const original = nodes[1],
    moved = moveBadgeNode(original, original.x - 0.1, original.y + 0.2);
  near(moved.in![0], original.in![0] - 0.1, 1e-8);
  near(moved.out![1], original.out![1] + 0.2, 1e-8);
  assert.equal(nodes.length, 4);
  assert.equal(inserted.length, 5);
});
test('every badge preset and minimum/large board sizes generate closed single pieces with the declared thickness', async () => {
  for (const [shape] of badgePresets) {
    const p = createBadgeProject();
    p.badgeBase!.shape = shape;
    const model = await generateGeometry(p, template, fontBuffer);
    assert.ok(model.stats.volume > 1);
    near(model.bounds[5], 3);
    await valid(model);
  }
  for (const [width, height, thickness] of [
    [10, 10, 1.5],
    [200, 20, 2],
    [80, 35, 4],
  ]) {
    const p = rectProject();
    Object.assign(p.badgeBase!, { width, height, thickness });
    const model = await generateGeometry(p, template, fontBuffer);
    near(model.stats.volume, width * height * thickness, 0.03);
    near(model.bounds[3], width);
    near(model.bounds[4], height);
  }
});
test('back pin slots cut only their specified depth and use back-editor mirror coordinates', async () => {
  const p = rectProject();
  p.badgeBase!.mounts = [slot()];
  const model = await generateGeometry(p, template, fontBuffer);
  near(model.stats.volume, 7200 - 60);
  await valid(model);
  const part = model.meshes[0],
    mesh = new runtime.Mesh({ numProp: 3, vertProperties: part.positions, triVerts: part.indices });
  mesh.merge();
  const solid = new runtime.Manifold(mesh);
  const probe = (x: number, z: number) => {
    const cube = runtime.Manifold.cube([0.1, 0.1, 0.1]),
      placed = cube.translate([x, 20, z]),
      intersection = runtime.Manifold.intersection(solid, placed);
    const v = intersection.volume();
    intersection.delete();
    placed.delete();
    cube.delete();
    return v;
  };
  near(probe(45, 0.2), 0, 1e-8);
  near(probe(15, 0.2), 0.001, 1e-7);
  near(probe(45, 0.8), 0.001, 1e-7);
  solid.delete();
});
test('round, rectangular and overlapping magnetic slots remove their real union and preserve a floor', async () => {
  const p = rectProject();
  p.badgeBase!.mounts = [
    slot({ id: 'a', kind: 'magnet-rect', x: 30, width: 12, height: 6, depth: 1 }),
    slot({ id: 'b', kind: 'magnet-rect', x: 30, width: 12, height: 6, depth: 1.5 }),
  ];
  let model = await generateGeometry(p, template, fontBuffer);
  near(model.stats.volume, 7200 - 12 * 6 * 1.5);
  await valid(model);
  p.badgeBase!.mounts = [slot({ kind: 'magnet-round', x: 30, width: 10, height: 10, depth: 1.5 })];
  model = await generateGeometry(p, template, fontBuffer);
  near(model.stats.volume, 7200 - Math.PI * 25 * 1.5, 0.15);
  await valid(model);
});
test('invalid open-edge mounts and detached outline pieces fail without mutating the project', async () => {
  const p = rectProject();
  p.badgeBase!.mounts = [slot({ x: 3 })];
  const before = serializeProject(p);
  await assert.rejects(generateGeometry(p, template, fontBuffer), /完整放在底板内部/);
  assert.equal(serializeProject(p), before);
  p.badgeBase!.mounts = [];
  p.badgeBase!.shape = 'custom';
  p.badgeBase!.contours = [square(0, 0, 0.4, 1), square(0.6, 0, 0.4, 1)];
  await assert.rejects(generateGeometry(p, template, fontBuffer), /相连/);
});
test('custom holes clip front/back colors and recesses while ordinary/reversed cuts preserve the base', async () => {
  const p = rectProject();
  p.badgeBase!.shape = 'custom';
  p.badgeBase!.contours = [square(0, 0, 1, 1), square(0.4, 0.4, 0.2, 0.2)];
  p.badgeBase!.mounts = [slot({ x: 15, width: 10, height: 4, depth: 1.2 })];
  const target = { ...newShape('black', 'rect'), id: 'target', x: 0, y: 0, width: 60, height: 40 };
  p.collections = [
    {
      id: 'front',
      name: 'front',
      face: 'front',
      visible: true,
      thickness: 0.4,
      items: [
        target,
        {
          ...newShape('white', 'rect'),
          id: 'keep',
          x: 0,
          y: 0,
          width: 30,
          height: 40,
          cutout: { targetIds: ['target'], keepInside: true },
        },
      ],
    },
    {
      id: 'back',
      name: 'back',
      face: 'back',
      visible: true,
      thickness: 0.7,
      items: [{ ...target, id: 'back-color', colorId: 'accent' }],
    },
  ];
  const model = await generateGeometry(p, template, fontBuffer),
    area = 60 * 40 - 12 * 8;
  near(volume(model, 'black'), (30 * 40 - 6 * 8) * 0.4);
  near(volume(model, 'accent'), area * 0.7 - 10 * 4 * 0.7);
  near(model.stats.volume, area * 3 - 10 * 4 * 1.2 + (30 * 40 - 6 * 8) * 0.4, 0.01);
  await valid(model);
  const files = unzipSync(export3mf(model, p)),
    saved = validateProject(JSON.parse(strFromU8(files['Metadata/pass_atelier_project.json'])));
  assert.deepEqual(saved, p);
  assert.match(strFromU8(files['3D/3dmodel.model']), /分色实体徽章/);
  assert.equal(
    Object.keys(unzipSync(exportStlZip(model, p))).filter((n) => n.endsWith('.stl')).length,
    model.meshes.length,
  );
});
test('SVG normalization unions overlapping fills and retains holes with the original even-odd/nonzero rules', async () => {
  const outer = square(0, 0, 10, 10).map((n) => [n.x, n.y] as [number, number]),
    hole = square(4, 4, 2, 2).map((n) => [n.x, n.y] as [number, number]),
    extension = square(8, 0, 4, 10).map((n) => [n.x, n.y] as [number, number]);
  for (const fillRule of ['EvenOdd', 'NonZero'] as const) {
    const result = await normalizeBadgeOutline([
      { contours: [outer, hole], fillRule },
      { contours: [extension], fillRule: 'NonZero' },
    ]);
    near(result.aspect, 1.2, 1e-8);
    const p = rectProject();
    Object.assign(p.badgeBase!, {
      shape: 'custom',
      width: 60,
      height: 50,
      contours: result.contours,
    });
    const model = await generateGeometry(p, template, fontBuffer);
    near(model.stats.volume, (fillRule === 'EvenOdd' ? 116 : 120) * 25 * 3, 0.02);
  }
  await assert.rejects(
    normalizeBadgeOutline([
      { contours: [outer, extension.map(([x, y]) => [x + 20, y])], fillRule: 'NonZero' },
    ]),
    /相连/,
  );
  assert.ok(badgeOutline(defaultBadgeBase()).length > 0);
});

test('independent badge layers preserve legacy depths, other layers, slots and editable file metadata', () => {
  const p = rectProject();
  const c = newCollection('back');
  c.inlayDepth = 1.2;
  p.collections.push(c);
  p.badgeBase!.mounts = [slot()];
  const original = serializeProject(p);
  assert.deepEqual(badgeLayers(p.badgeBase!, backSurfaceDepth(p.collections)), {
    front: 0.7,
    core: 1.1,
    back: 1.2,
  });
  p.badgeBase = setBadgeLayer(p.badgeBase!, 'front', 0.3, backSurfaceDepth(p.collections));
  assert.deepEqual(p.badgeBase.layers, { front: 0.3, core: 1.1, back: 1.2 });
  near(p.badgeBase.thickness, 2.6);
  assert.deepEqual(p.badgeBase.mounts, [slot()]);
  assert.equal(c.inlayDepth, 1.2);
  p.badgeBase = setBadgeLayer(p.badgeBase, 'core', 2);
  p.badgeBase = setBadgeLayer(p.badgeBase, 'back', 0.5);
  assert.deepEqual(p.badgeBase.layers, { front: 0.3, core: 2, back: 0.5 });
  near(p.badgeBase.thickness, 2.8);
  assert.deepEqual(validateProject(JSON.parse(serializeProject(p))), p);
  const legacy = validateProject(JSON.parse(original));
  assert.equal(legacy.badgeBase!.layers, undefined);
  assert.equal(collectionInlayDepth(legacy.collections.at(-1)!, legacy), 1.2);
  const smallestLegacyCore = setBadgeLayer(defaultBadgeBase(), 'front', 0.3, 2.299);
  assert.deepEqual(smallestLegacyCore.layers, { front: 0.3, core: 0.001, back: 2.299 });
});

test('badge layer validation and field limits prevent zero, invalid totals and thin slot floors while accepting thin unmounted bases', async () => {
  const p = rectProject();
  for (const value of [0, 0.0001, -0.1, NaN, Infinity, 21]) {
    assert.throws(() => setBadgeLayer(p.badgeBase!, 'front', value));
  }
  for (const layers of [
    null,
    {},
    { front: 0.3, core: 1, back: 0.5 },
    { front: 0.3, core: NaN, back: 0.5 },
  ]) {
    assert.throws(() => validateBadgeBase({ ...p.badgeBase, layers }));
  }
  p.badgeBase!.mounts = [slot({ depth: 1.5 })];
  assert.throws(() => setBadgeLayer(p.badgeBase!, 'core', 0.1), /槽底/);
  const limits = badgeLayerLimits(p.badgeBase!, badgeLayers(p.badgeBase!), 'core');
  near(limits.min, 0.9);
  p.badgeBase = setBadgeLayer(p.badgeBase!, 'core', limits.min);
  near(p.badgeBase.thickness, 2.3);
  await valid(await generateGeometry(p, template, fontBuffer));
  p.badgeBase.mounts = [];
  p.badgeBase = setBadgeLayer(
    setBadgeLayer(setBadgeLayer(p.badgeBase, 'front', 0.01), 'core', 0.02),
    'back',
    0.03,
  );
  const thin = await generateGeometry(p, template, fontBuffer);
  near(thin.stats.volume, 144);
  near(thin.bounds[5], 0.06, 1e-6);
  await valid(thin);
});

test('three independent badge layer colors have exact physical depths and disjoint volumes in exported meshes', async () => {
  const p = rectProject();
  p.badgeBase = setBadgeLayer(
    setBadgeLayer(setBadgeLayer(p.badgeBase!, 'front', 0.3), 'core', 1.2),
    'back',
    0.5,
  );
  p.template.frontColorId = 'black';
  p.template.backColorId = 'accent';
  const model = await generateGeometry(p, template, fontBuffer);
  near(volume(model, 'black'), 2400 * 0.3);
  near(volume(model, 'white'), 2400 * 1.2);
  near(volume(model, 'accent'), 2400 * 0.5);
  near(model.stats.volume, 4800);
  near(model.stats.coreThickness, 1.2);
  const range = (id: string) => {
    const positions = model.meshes.find((m) => m.colorId === id)!.positions;
    const zs = Array.from(positions).filter((_, i) => i % 3 === 2);
    return [Math.min(...zs), Math.max(...zs)];
  };
  range('black').forEach((v, i) => near(v, [1.7, 2][i]));
  range('white').forEach((v, i) => near(v, [0.5, 1.7][i]));
  range('accent').forEach((v, i) => near(v, [0, 0.5][i]));
  await valid(model);
  const files = unzipSync(export3mf(model, p));
  const saved = validateProject(JSON.parse(strFromU8(files['Metadata/pass_atelier_project.json'])));
  assert.deepEqual(saved.badgeBase, p.badgeBase);
  const stls = unzipSync(exportStlZip(model, p));
  for (const data of Object.values(stls).filter((_, i) => Object.keys(stls)[i].endsWith('.stl'))) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let triangle = 0; triangle < view.getUint32(80, true); triangle++)
      for (let vertex = 0; vertex < 3; vertex++) {
        const z = view.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + 8, true);
        assert.ok(z >= -1e-6 && z <= 2.000001);
      }
  }
});

test('badge background artwork follows its surface layer, caps deep back inlays and keeps the original settings', async () => {
  const p = rectProject();
  p.badgeBase = setBadgeLayer(setBadgeLayer(p.badgeBase!, 'front', 0.25), 'back', 0.4);
  const item = { ...newShape('black', 'rect'), x: 5, y: 5, width: 10, height: 10 };
  const front = { ...newCollection('front'), mode: 'background' as const, items: [item] };
  const back = {
    ...newCollection('back'),
    inlayDepth: 1.1,
    items: [{ ...item, id: 'back-art', colorId: 'accent' }],
  };
  p.collections = [front, back];
  assert.equal(collectionInlayDepth(front, p), 0.25);
  assert.equal(collectionInlayDepth(back, p), 0.4);
  assert.equal(backSurfaceDepth(p.collections, p), 0.4);
  let model = await generateGeometry(p, template, fontBuffer);
  near(volume(model, 'black'), 25);
  near(volume(model, 'accent'), 40);
  await valid(model);
  p.badgeBase = setBadgeLayer(p.badgeBase, 'back', 1.2);
  model = await generateGeometry(p, template, fontBuffer);
  near(volume(model, 'accent'), 110);
  assert.equal(back.inlayDepth, 1.1);
  const inherited = newCollection('back', 'inherited', p);
  assert.equal(inherited.inlayDepth, undefined);
  assert.equal(collectionInlayDepth(inherited, p), 1.2);
  back.visible = false;
  assert.equal(backSurfaceDepth(p.collections, p), 1.2);
});

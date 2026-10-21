import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { createProject } from '../src/model/project';
import { newCutter } from '../src/model/booleanEditing';
import { templateAbovePath } from '../src/artwork/template-above';
import { flattenPath } from '../src/artwork/paths';
import {
  generateGeometry,
  getManifoldRuntime,
  inspectGeneratedModel,
} from '../src/geometry/engine';
import { export3mf, exportStlZip } from '../src/export';
import type {
  Collection,
  DesignItem,
  GeneratedModel,
  Project,
  TemplateData,
  TemplateObject,
} from '../src/model/types';

const fontData = await readFile(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
const fontBuffer = fontData.buffer.slice(
  fontData.byteOffset,
  fontData.byteOffset + fontData.byteLength,
) as ArrayBuffer;
const runtime = await getManifoldRuntime();
const T = 2.2585434913635254;
function object(
  id: string,
  role: TemplateObject['role'],
  solid: ReturnType<typeof runtime.Manifold.cube>,
  colorId = 'white',
): TemplateObject {
  const mesh = solid.getMesh(),
    box = solid.boundingBox();
  const result: TemplateObject = {
    id,
    name: id,
    role,
    colorId,
    positions: Array.from(mesh.vertProperties),
    indices: Array.from(mesh.triVerts),
    outlinePath: '',
    bounds: [...box.min, ...box.max],
    height: box.max[2] - box.min[2],
  };
  solid.delete();
  return result;
}
const baseCube = runtime.Manifold.cube([50, 100, T]);
const hole = runtime.Manifold.cylinder(T + 2, 2, 2, 32).translate([5, 95, -1]);
const base = runtime.Manifold.difference(baseCube, hole);
baseCube.delete();
hole.delete();
const minimal: TemplateData = {
  version: 'maimai-template-v1',
  source: 'tests',
  width: 50,
  height: 100,
  thickness: T,
  panelBounds: [0, 60, 8, 40],
  objects: [object('base', 'base', base, 'pink')],
};
const referenceBase = new runtime.Manifold(
  new runtime.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(minimal.objects[0].positions),
    triVerts: new Uint32Array(minimal.objects[0].indices),
  }),
);
const baseVolume = referenceBase.volume();
const baseArea = baseVolume / T;
referenceBase.delete();
const placement = { visible: true, x: 0, y: 0, width: 1, height: 1, rotation: 0, colorId: 'white' };
function project(): Project {
  return {
    format: 'pass-atelier',
    version: 1,
    templateVersion: minimal.version,
    name: 'Test',
    palette: [
      { id: 'pink', name: 'Pink', hex: '#EE88AA' },
      { id: 'white', name: 'White', hex: '#FFFFFF' },
      { id: 'black', name: 'Black', hex: '#111111' },
      { id: 'accent', name: 'Accent', hex: '#00CC88' },
    ],
    collections: [],
    template: {
      baseColorId: 'pink',
      panelColorId: 'white',
      panelDetailColorId: 'black',
      label: { ...placement, visible: false, text: 'O', useOriginal: true },
      decorations: {},
    },
  };
}
let nextId = 0;
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  colorId = 'white',
): DesignItem => ({
  id: `item-${nextId++}`,
  name: 'rect',
  kind: 'shape',
  shape: 'rect',
  visible: true,
  x,
  y,
  width,
  height,
  rotation: 0,
  colorId,
});
const collection = (
  items: DesignItem[],
  thickness = 0.6,
  face: 'front' | 'back' = 'front',
): Collection => ({
  id: `group-${nextId++}`,
  name: 'group',
  face,
  visible: true,
  thickness,
  items,
});
const background = (
  items: DesignItem[],
  face: 'front' | 'back' = 'front',
  thickness = 0.6,
): Collection => ({ ...collection(items, thickness, face), mode: 'background' });
const volumeOf = (model: GeneratedModel, colorId: string) =>
  model.meshes.find((part) => part.colorId === colorId)?.volume ?? 0;
const near = (actual: number, expected: number, tolerance = 0.002) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

test('boolean tool removes only target columns and never prints or cuts lower artwork/base', async () => {
  const p = project(),
    lower = rect(10, 20, 10, 10, 'black'),
    target = rect(10, 20, 10, 10, 'white');
  const tool = {
    ...newCutter(target),
    shape: 'rect' as const,
    x: 10,
    y: 20,
    width: 5,
    height: 10,
    colorId: 'accent',
  };
  p.collections = [collection([lower]), collection([target, tool])];
  const model = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(model, 'black'), 50 * 0.6);
  near(volumeOf(model, 'white'), 50 * 1.2);
  near(volumeOf(model, 'pink'), baseVolume);
  assert.equal(volumeOf(model, 'accent'), 0);
  const inspection = await inspectGeneratedModel(model);
  assert.ok(inspection.closed.every(Boolean));
  assert.ok(inspection.overlaps.every(([, , v]) => v < 1e-4));
  tool.visible = false;
  const restored = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(restored, 'white'), 100 * 1.2);
  near(volumeOf(restored, 'black'), 0);
});

test('boolean cuts front/back background colors without holes in either plate skin', async () => {
  for (const face of ['front', 'back'] as const) {
    const p = project(),
      target = rect(10, 20, 10, 10, 'white');
    const tool = {
      ...newCutter(target),
      shape: 'rect' as const,
      x: 10,
      y: 20,
      width: 5,
      height: 10,
    };
    p.collections = [background([target, tool], face)];
    const model = await generateGeometry(p, minimal, fontBuffer);
    near(volumeOf(model, 'white'), 50 * 0.7);
    near(volumeOf(model, 'pink'), baseVolume - 50 * 0.7);
    near(model.stats.volume, baseVolume);
  }
});

test('reversed cutter retains only target intersection while revealing lower artwork and preserving the plate and exports', async () => {
  const p = project(),
    lower = rect(10, 20, 10, 10, 'black'),
    target = rect(10, 20, 10, 10);
  const tool: DesignItem = {
    ...newCutter(target),
    shape: 'rect',
    x: 12,
    y: 20,
    width: 6,
    height: 10,
    colorId: 'accent',
    cutout: { targetIds: [target.id], keepInside: true },
  };
  p.collections = [collection([lower]), collection([target, tool])];
  const model = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(model, 'white'), 60 * 1.2);
  near(volumeOf(model, 'black'), 40 * 0.6);
  near(volumeOf(model, 'pink'), baseVolume);
  assert.equal(volumeOf(model, 'accent'), 0);
  const checked = await inspectGeneratedModel(model);
  assert.ok(checked.closed.every(Boolean));
  assert.ok(checked.overlaps.every(([, , v]) => v < 1e-4));
  const mf = unzipSync(export3mf(model, p));
  const saved = JSON.parse(strFromU8(mf['Metadata/pass_atelier_project.json']));
  assert.equal(saved.collections[1].items[1].cutout.keepInside, true);
  assert.ok(Object.keys(unzipSync(exportStlZip(model, p))).some((file) => file.endsWith('.stl')));
  tool.visible = false;
  near(volumeOf(await generateGeometry(p, minimal, fontBuffer), 'white'), 100 * 1.2);
});

test('mixed and multiple reversed cutters intersect keep regions, subtract normal holes and clip all imported colors', async () => {
  const p = project();
  const target: DesignItem = {
    ...rect(10, 20, 10, 10),
    kind: 'paths',
    shape: undefined,
    sourceWidth: 10,
    sourceHeight: 10,
    regions: [
      { path: 'M0 0H5V10H0Z', colorId: 'white' },
      { path: 'M5 0H10V10H5Z', colorId: 'black' },
    ],
  };
  const keep = (x: number): DesignItem => ({
    ...newCutter(target),
    shape: 'rect',
    x,
    y: 20,
    width: 6,
    height: 10,
    cutout: { targetIds: [target.id], keepInside: true },
  });
  const a = keep(12),
    b = keep(14),
    hole = { ...newCutter(target), shape: 'rect' as const, x: 15, y: 20, width: 1, height: 10 };
  const unrelated = rect(25, 20, 5, 10, 'accent');
  p.collections = [collection([target, unrelated, a, b, hole])];
  const model = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(model, 'white'), 10 * 0.6);
  near(volumeOf(model, 'black'), 20 * 0.6);
  near(volumeOf(model, 'accent'), 50 * 0.6);
  b.x = 30;
  const empty = await generateGeometry(p, minimal, fontBuffer);
  assert.equal(volumeOf(empty, 'white'), 0);
  assert.equal(volumeOf(empty, 'black'), 0);
  near(volumeOf(empty, 'pink'), baseVolume);
  near(volumeOf(empty, 'accent'), 50 * 0.6);
});

test('reversed clipping respects path holes, outline-only shapes, rotation and both background faces', async () => {
  for (const face of ['front', 'back'] as const) {
    const p = project(),
      target = rect(10, 20, 10, 10);
    const tool: DesignItem = {
      ...newCutter(target),
      kind: 'paths',
      shape: undefined,
      x: 11,
      y: 21,
      width: 8,
      height: 8,
      sourceWidth: 8,
      sourceHeight: 8,
      cutout: { targetIds: [target.id], keepInside: true },
      regions: [{ path: 'M0 0H8V8H0Z M2 2V6H6V2Z', colorId: 'accent' }],
    };
    p.collections = [background([target, tool], face)];
    const ring = await generateGeometry(p, minimal, fontBuffer);
    near(volumeOf(ring, 'white'), 48 * 0.7);
    near(ring.stats.volume, baseVolume);
    assert.ok((await inspectGeneratedModel(ring)).closed.every(Boolean));
    Object.assign(tool, {
      kind: 'shape',
      shape: 'rect',
      regions: undefined,
      shapeFill: false,
      shapeOutline: true,
      shapeOutlineWidth: 1,
    });
    near(volumeOf(await generateGeometry(p, minimal, fontBuffer), 'white'), 28 * 0.7);
    Object.assign(tool, {
      x: 10,
      y: 20,
      width: 8,
      height: 4,
      rotation: 90,
      shapeFill: true,
      shapeOutline: false,
    });
    near(volumeOf(await generateGeometry(p, minimal, fontBuffer), 'white'), 24 * 0.7);
  }
});

test('boolean combines multiple tools, respects imported colors and leaves unrelated artwork intact', async () => {
  const p = project();
  const target: DesignItem = {
    ...rect(10, 20, 10, 10),
    kind: 'paths',
    shape: undefined,
    sourceWidth: 10,
    sourceHeight: 10,
    regions: [
      { path: 'M0,0H5V10H0Z', colorId: 'white' },
      { path: 'M5,0H10V10H5Z', colorId: 'black' },
    ],
  };
  const tool: DesignItem = {
    ...newCutter(target),
    kind: 'paths',
    shape: undefined,
    x: 10,
    y: 20,
    width: 10,
    height: 10,
    sourceWidth: 10,
    sourceHeight: 10,
    regions: [
      { path: 'M0,0H2V10H0Z', colorId: 'accent' },
      { path: 'M8,0H10V10H8Z', colorId: 'accent' },
    ],
  };
  const unrelated = rect(25, 20, 5, 10, 'accent');
  const second = {
    ...newCutter(target),
    shape: 'rect' as const,
    x: 13,
    y: 20,
    width: 1,
    height: 10,
  };
  p.collections = [collection([target, unrelated, tool, second])];
  const model = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(model, 'white'), 20 * 0.6);
  near(volumeOf(model, 'black'), 30 * 0.6);
  near(volumeOf(model, 'accent'), 50 * 0.6);
  near(volumeOf(model, 'pink'), baseVolume);
});
async function colorAt(
  model: GeneratedModel,
  colorId: string,
  x: number,
  y: number,
  z: number,
): Promise<boolean> {
  const part = model.meshes.find((p) => p.colorId === colorId);
  if (!part) return false;
  const mesh = new runtime.Mesh({
    numProp: 3,
    vertProperties: part.positions,
    triVerts: part.indices,
  });
  mesh.merge();
  const solid = new runtime.Manifold(mesh),
    cube = runtime.Manifold.cube([0.02, 0.02, 0.02]).translate([x - 0.01, y - 0.01, z - 0.01]);
  const intersection = runtime.Manifold.intersection(solid, cube);
  try {
    return intersection.volume() > 1e-7;
  } finally {
    solid.delete();
    cube.delete();
    intersection.delete();
  }
}
async function good(model: GeneratedModel) {
  for (const part of model.meshes) {
    const edges = new Map<string, number>();
    for (let t = 0; t < part.indices.length; t += 3) {
      const vertices = part.indices.subarray(t, t + 3);
      for (let e = 0; e < 3; e++) {
        const a = vertices[e],
          b = vertices[(e + 1) % 3],
          key = a < b ? `${a}/${b}` : `${b}/${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok(
      [...edges.values()].every((n) => n === 2),
      `${part.colorId} has an unsealed indexed edge`,
    );
  }
  const inspected = await inspectGeneratedModel(model);
  assert.ok(inspected.closed.every(Boolean));
  for (const [a, b, volume] of inspected.overlaps)
    assert.ok(volume < 1e-4, `parts ${a}/${b} overlap ${volume} mm³`);
  assert.ok(Math.abs(inspected.unionVolume - model.stats.volume) < 0.02);
  assert.equal(
    inspected.components,
    1,
    JSON.stringify({ componentBounds: inspected.componentBounds, issues: model.issues }),
  );
}

test('front groups accumulate .4 + .8; highest item color owns full column and same-group regions share height', async () => {
  const p = project();
  p.collections = [
    collection([rect(10, 10, 10, 10, 'white')], 0.4),
    collection([rect(15, 15, 10, 10, 'black'), rect(28, 15, 4, 5, 'accent')], 0.8),
  ];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(model, 'white', 12, 88, T + 0.2));
  assert.equal(await colorAt(model, 'white', 12, 88, T + 0.5), false);
  assert.ok(await colorAt(model, 'black', 17, 83, T + 0.1));
  assert.ok(await colorAt(model, 'black', 17, 83, T + 1.1));
  assert.equal(await colorAt(model, 'white', 17, 83, T + 0.1), false);
  assert.ok(await colorAt(model, 'accent', 30, 83, T + 1.1));
  assert.equal(await colorAt(model, 'accent', 30, 83, T + 1.25), false);
  assert.ok(Math.abs(model.bounds[5] - (T + 1.2)) < 1e-5);
  await good(model);
});

test('empty visible front collection adds height, hidden items do not remove collection thickness', async () => {
  const p = project();
  const hidden = rect(5, 5, 1, 1);
  hidden.visible = false;
  p.collections = [collection([], 0.4), collection([rect(10, 10, 4, 4), hidden], 0.8)];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(model, 'white', 12, 88, T + 1.1));
  p.collections[0].visible = false;
  const hiddenModel = await generateGeometry(p, minimal, fontBuffer);
  assert.equal(await colorAt(hiddenModel, 'white', 12, 88, T + 1.1), false);
  assert.ok(await colorAt(hiddenModel, 'white', 12, 88, T + 0.7));
});

test('multicolor path regions share group height and later same-group items physically override older colors', async () => {
  const p = project();
  const paths: DesignItem = {
    ...rect(10, 10, 20, 10),
    kind: 'paths',
    sourceWidth: 20,
    sourceHeight: 10,
    regions: [
      { path: 'M0 0H10V10H0Z', colorId: 'white' },
      { path: 'M10 0H20V10H10Z', colorId: 'accent' },
    ],
  };
  p.collections = [collection([paths, rect(18, 12, 4, 4, 'black')], 0.6)];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(model, 'white', 12, 85, T + 0.5));
  assert.ok(await colorAt(model, 'accent', 27, 85, T + 0.5));
  assert.ok(await colorAt(model, 'black', 20, 86, T + 0.1));
  assert.ok(await colorAt(model, 'black', 20, 86, T + 0.5));
  assert.equal(await colorAt(model, 'white', 19, 86, T + 0.1), false);
  assert.equal(await colorAt(model, 'accent', 21, 86, T + 0.1), false);
  await good(model);
});

test('back groups all inlay .7 mm, mirror X, preserve holes and plate core', async () => {
  const p = project();
  p.collections = [
    collection([rect(10, 10, 10, 10, 'white')], 2, 'back'),
    collection([rect(15, 15, 10, 10, 'black'), rect(43, 3, 4, 4, 'black')], 0.1, 'back'),
  ];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.equal(
    await colorAt(model, 'pink', 32, 83, 0.3),
    false,
    'inlay replaces, rather than overlaps, the plate',
  );
  assert.ok(await colorAt(model, 'white', 38, 88, 0.3));
  assert.equal(await colorAt(model, 'white', 12, 88, 0.3), false);
  assert.ok(await colorAt(model, 'black', 32, 83, 0.3));
  assert.ok(await colorAt(model, 'pink', 32, 83, 0.8));
  assert.ok(Math.abs(model.stats.coreThickness - (T - 1.4)) < 1e-6);
  for (const part of model.meshes)
    assert.equal(await colorAt(model, part.colorId, 5, 95, 0.3), false);
  await good(model);
});

test('fixed panel full projection and original label glyph protect front only; tall decorations retain silhouette under shorter artwork', async () => {
  const panelOuter = runtime.Manifold.cube([8, 40, 1.45]).translate([0, 0, T]);
  const panelHole = runtime.Manifold.cube([6, 38, 2]).translate([1, 1, T - 0.1]);
  const panel = runtime.Manifold.difference(panelOuter, panelHole);
  panelOuter.delete();
  panelHole.delete();
  const template: TemplateData = {
    ...minimal,
    objects: [
      minimal.objects[0],
      object('panel', 'fixed-panel', panel),
      object('label', 'editable-label', runtime.Manifold.cube([4, 10, 1.45]).translate([0, 50, T])),
      object(
        'decoration',
        'decoration',
        runtime.Manifold.cube([5, 5, 2]).translate([30, 60, T + 0.3]),
        'accent',
      ),
    ],
  };
  const p = project();
  p.template.label = {
    ...placement,
    visible: true,
    x: 0,
    y: 40,
    width: 4,
    height: 10,
    text: 'ORIGINAL',
    useOriginal: true,
  };
  p.template.decorations.decoration = {
    ...placement,
    x: 30,
    y: 35,
    width: 5,
    height: 5,
    colorId: 'accent',
  };
  p.collections = [
    collection([rect(0, 0, 50, 100, 'black')], 0.2),
    collection([rect(43, 65, 5, 5, 'accent')], 2, 'back'),
  ];
  const model = await generateGeometry(p, template, fontBuffer);
  assert.equal(
    await colorAt(model, 'black', 4, 20, T + 0.1),
    false,
    'panel interior remains protected',
  );
  assert.equal(
    await colorAt(model, 'black', 2, 55, T + 0.1),
    false,
    'original glyph remains protected',
  );
  assert.ok(await colorAt(model, 'white', 2, 55, T + 1));
  assert.ok(
    await colorAt(model, 'black', 32, 62, T + 2.1),
    'taller template decoration is retained and recolored',
  );
  assert.equal(await colorAt(model, 'accent', 32, 62, T + 2.1), false);
  assert.ok(
    await colorAt(model, 'accent', 4, 32, 0.3),
    'front panel protection does not leak to rear',
  );
  await good(model);
});

test('modified label uses real glyph projection and holes, not its bounding rectangle', async () => {
  const template: TemplateData = {
    ...minimal,
    objects: [
      minimal.objects[0],
      object('label', 'editable-label', runtime.Manifold.cube([4, 10, 1.45]).translate([0, 50, T])),
    ],
  };
  const p = project();
  p.template.label = {
    ...placement,
    visible: true,
    x: 20,
    y: 20,
    width: 10,
    height: 12,
    colorId: 'accent',
    text: 'O',
    useOriginal: false,
  };
  p.collections = [collection([rect(17, 17, 16, 18, 'black')], 0.4)];
  const model = await generateGeometry(p, template, fontBuffer);
  assert.ok(await colorAt(model, 'black', 25, 74, T + 0.2), 'O counter remains open to artwork');
  assert.ok(await colorAt(model, 'accent', 20.5, 74, T + 0.2), 'O stem is protected');
  assert.equal(await colorAt(model, 'black', 20.5, 74, T + 0.2), false);
  await good(model);
});

test('real source template and default project generate exclusive closed colors', async () => {
  const template: TemplateData = JSON.parse(
    await readFile(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
  );
  const p = createProject(template);
  const model = await generateGeometry(p, template, fontBuffer);
  assert.equal(model.meshes.length, 4);
  assert.equal(model.issues.filter((i) => i.severity === 'error').length, 0);
  assert.ok(model.stats.triangles > 500);
  await good(model);
});

test('3MF stores one assembly, per-color real parts and matching Bambu filament slots; STL keeps shared coordinates', async () => {
  const p = project();
  p.collections = [collection([rect(10, 10, 10, 10, 'white'), rect(15, 15, 10, 10, 'black')], 0.6)];
  const model = await generateGeometry(p, minimal, fontBuffer);
  const files = unzipSync(export3mf(model, p));
  const xml = strFromU8(files['3D/3dmodel.model']),
    metadata = strFromU8(files['Metadata/model_settings.config']);
  const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
  assert.match(xml, /unit="millimeter"/);
  assert.equal((xml.match(/<item /g) ?? []).length, 1);
  assert.equal((xml.match(/<component /g) ?? []).length, model.meshes.length);
  assert.equal((metadata.match(/<part /g) ?? []).length, model.meshes.length);
  assert.equal(settings.filament_settings_id.length, model.meshes.length);
  assert.equal(settings.filament_colour.length, model.meshes.length);
  model.meshes.forEach((_, i) =>
    assert.match(metadata, new RegExp(`<metadata key="extruder" value="${i + 1}"/>`)),
  );
  const stls = unzipSync(exportStlZip(model, p)),
    manifest = JSON.parse(strFromU8(stls['colors.json']));
  assert.equal(manifest.sharedCoordinates, true);
  manifest.parts.forEach((part: { file: string }, i: number) => {
    const bytes = stls[part.file],
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(80, true), model.meshes[i].indices.length / 3);
    assert.equal(
      view.getFloat32(96, true),
      model.meshes[i].positions[model.meshes[i].indices[0] * 3],
    );
  });
});

test('print-detail warnings preserve positive geometry; huge finite thickness fails before invalid float meshes', async () => {
  const p = project();
  const smallText: DesignItem = { ...rect(20, 10, 4, 1.5, 'accent'), kind: 'text', text: 'A' };
  const tinyPath: DesignItem = {
    ...rect(30, 10, 0.1, 3, 'black'),
    kind: 'paths',
    sourceWidth: 0.1,
    sourceHeight: 3,
    regions: [{ path: 'M0 0H.1V3H0Z', colorId: 'black' }],
  };
  const thinShape = rect(10, 10, 0.19, 6, 'white');
  p.collections = [collection([thinShape, smallText, tinyPath], 0.05)];
  const snapshot = structuredClone(p);
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.deepEqual(p, snapshot, 'warnings must not change the design');
  assert.ok(model.meshes.every((part) => part.positions.every(Number.isFinite) && part.volume > 0));
  assert.ok(
    model.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('厚度')),
  );
  for (const item of [thinShape, smallText, tinyPath])
    assert.ok(model.issues.some((issue) => issue.itemId === item.id));
  assert.ok(
    model.issues.some(
      (issue) =>
        issue.itemId === tinyPath.id &&
        issue.message.includes(
          '含小于 0.2 mm 的轮廓细节，可能会影响打印效果，请按实际喷嘴与层高检查切片预览。',
        ),
    ),
  );
  assert.ok(await colorAt(model, 'white', 10.095, 87, T + 0.025));
  await good(model);
  p.collections[0].thickness = 1e100;
  await assert.rejects(generateGeometry(p, minimal, fontBuffer), /尺寸超出网格可计算范围/);
});

test('independent front and back skins are .7 mm with an unchanged continuous middle core', async () => {
  const p = project();
  p.template.frontColorId = 'white';
  p.template.backColorId = 'black';
  const model = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(model, 'white'), baseArea * 0.7);
  near(volumeOf(model, 'black'), baseArea * 0.7);
  near(volumeOf(model, 'pink'), baseArea * (T - 1.4));
  near(model.stats.volume, baseVolume);
  near(model.stats.coreThickness, T - 1.4);
  near(model.bounds[5], T);
  near(model.stats.frontHeight, 0);
  assert.ok(await colorAt(model, 'black', 20, 80, 0.35));
  assert.ok(await colorAt(model, 'pink', 20, 80, 0.8));
  assert.ok(await colorAt(model, 'pink', 20, 80, T - 0.8));
  assert.ok(await colorAt(model, 'white', 20, 80, T - 0.35));
  for (const color of ['white', 'black', 'pink'])
    for (const z of [0.35, 1.1, T - 0.35])
      assert.equal(await colorAt(model, color, 5, 95, z), false, 'hole crosses all three layers');
  await good(model);
  const legacy = await generateGeometry(project(), minimal, fontBuffer);
  assert.deepEqual(
    legacy.meshes.map((mesh) => mesh.colorId),
    ['pink'],
  );
  near(legacy.stats.volume, baseVolume);
});

test('backgrounds replace only their face skins, retain hole geometry, and mirror the back', async () => {
  const p = project();
  p.template.frontColorId = 'white';
  p.template.backColorId = 'black';
  const backGroup = background([rect(10, 10, 10, 10, 'accent')], 'back', 1e100);
  backGroup.mode = 'raised'; // A back collection always uses the background mode.
  p.collections = [background([rect(10, 10, 10, 10, 'accent')]), backGroup];
  const model = await generateGeometry(p, minimal, fontBuffer);
  near(volumeOf(model, 'accent'), 2 * 100 * 0.7);
  near(volumeOf(model, 'white'), (baseArea - 100) * 0.7);
  near(volumeOf(model, 'black'), (baseArea - 100) * 0.7);
  near(volumeOf(model, 'pink'), baseArea * (T - 1.4));
  near(model.stats.volume, baseVolume);
  assert.ok(await colorAt(model, 'accent', 12, 88, T - 0.35));
  assert.ok(await colorAt(model, 'white', 38, 88, T - 0.35));
  assert.ok(await colorAt(model, 'accent', 38, 88, 0.35));
  assert.ok(await colorAt(model, 'black', 12, 88, 0.35));
  assert.ok(await colorAt(model, 'pink', 12, 88, 1.1));
  assert.ok(await colorAt(model, 'pink', 38, 88, 1.1));
  assert.equal(await colorAt(model, 'accent', 12, 88, T + 0.1), false);
  // Fill patterns over the hole on both faces; neither may close it.
  p.collections.push(background([rect(3, 3, 4, 4, 'accent')]));
  p.collections.push(background([rect(43, 3, 4, 4, 'accent')], 'back'));
  const withHolePatterns = await generateGeometry(p, minimal, fontBuffer);
  for (const color of p.palette)
    for (const z of [0.35, 1.1, T - 0.35])
      assert.equal(await colorAt(withHolePatterns, color.id, 5, 95, z), false);
  await good(model);
  await good(withHolePatterns);
});

test('background collections are below raised artwork and never add to accumulated raised height', async () => {
  const p = project();
  const top = rect(15, 15, 10, 10, 'black');
  top.coversLower = false;
  p.collections = [
    collection([rect(10, 10, 10, 10, 'white')], 0.4),
    background([rect(20, 20, 10, 10, 'accent')], 'front', 0.01),
    collection([top], 0.8),
    background([], 'front', 1e100),
  ];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(model, 'white', 17, 83, T + 0.2));
  assert.equal(await colorAt(model, 'black', 17, 83, T + 0.2), false);
  assert.ok(await colorAt(model, 'accent', 22, 78, T - 0.35));
  assert.equal(await colorAt(model, 'black', 22, 78, T + 0.2), false);
  assert.ok(await colorAt(model, 'black', 22, 83, T + 1.1));
  near(model.bounds[5], T + 1.2);
  near(volumeOf(model, 'white'), 100 * 0.4);
  near(volumeOf(model, 'black'), 50 * 1.2);
  near(volumeOf(model, 'accent'), 100 * 0.7);
  near(model.stats.volume, baseVolume + 100 * 0.4 + 50 * 1.2);
  assert.equal(
    model.issues.some((issue) => issue.message.includes('厚度')),
    false,
  );
  await good(model);
});

test('coversLower changes physical color ownership in both background skins', async () => {
  for (const face of ['front', 'back'] as const) {
    for (const coversLower of [false, true]) {
      const p = project();
      const upper = rect(15, 15, 10, 10, 'black');
      upper.coversLower = coversLower;
      p.collections = [background([rect(10, 10, 10, 10, 'white'), upper], face)];
      const model = await generateGeometry(p, minimal, fontBuffer);
      const x = face === 'front' ? 17 : 33;
      const z = face === 'front' ? T - 0.35 : 0.35;
      assert.ok(await colorAt(model, coversLower ? 'black' : 'white', x, 83, z));
      assert.equal(await colorAt(model, coversLower ? 'white' : 'black', x, 83, z), false);
      near(volumeOf(model, 'white'), (coversLower ? 75 : 100) * 0.7);
      near(volumeOf(model, 'black'), (coversLower ? 100 : 75) * 0.7);
      near(model.stats.volume, baseVolume);
      await good(model);
    }
  }
});

test('legacy coversLower off preserves earlier raised height and color across groups and within one group', async () => {
  for (const sameGroup of [false, true]) {
    for (const coversLower of [false, true]) {
      const p = project();
      const lower = rect(10, 10, 10, 10, 'white');
      const upper = rect(15, 15, 10, 10, 'black');
      upper.coversLower = coversLower;
      const lowHeight = sameGroup ? 0.6 : 0.4;
      const highHeight = sameGroup ? 0.6 : 1.2;
      p.collections = sameGroup
        ? [collection([lower, upper], 0.6)]
        : [collection([lower], 0.4), collection([upper], 0.8)];
      const model = await generateGeometry(p, minimal, fontBuffer);
      assert.ok(await colorAt(model, coversLower ? 'black' : 'white', 17, 83, T + 0.2));
      assert.equal(await colorAt(model, coversLower ? 'white' : 'black', 17, 83, T + 0.2), false);
      if (!sameGroup) assert.equal(await colorAt(model, 'black', 17, 83, T + 0.7), coversLower);
      assert.ok(await colorAt(model, 'black', 22, 78, T + highHeight - 0.1));
      near(volumeOf(model, 'white'), (coversLower ? 75 : 100) * lowHeight);
      near(volumeOf(model, 'black'), (coversLower ? 100 : 75) * highHeight);
      near(
        model.stats.volume,
        baseVolume + (coversLower ? 75 : 100) * lowHeight + (coversLower ? 100 : 75) * highHeight,
      );
      await good(model);
    }
  }
});

test('volume coverage and XY avoidance independently preserve lower colors or remove the protrusion', async () => {
  for (const coversLower of [false, true])
    for (const avoidsLower of [false, true]) {
      const p = project();
      const upper = { ...rect(15, 15, 10, 10, 'black'), coversLower, avoidsLower };
      p.collections = [collection([rect(10, 10, 10, 10, 'white')], 0.4), collection([upper], 0.8)];
      const model = await generateGeometry(p, minimal, fontBuffer);
      assert.equal(await colorAt(model, 'white', 17, 83, T + 0.2), avoidsLower || !coversLower);
      assert.equal(await colorAt(model, 'black', 17, 83, T + 1.0), !avoidsLower);
      assert.ok(
        await colorAt(model, 'black', 22, 78, T + 1.0),
        'outside the lower footprint still protrudes',
      );
      near(model.stats.volume, baseVolume + (avoidsLower ? 130 : 150));
      await good(model);
    }
});

test('volume coverage preserves lower volumes while multicolor internals and later overrides remain exclusive', async () => {
  const p = project();
  const image: DesignItem = {
    ...rect(10, 10, 20, 10),
    kind: 'paths',
    coversLower: false,
    avoidsLower: false,
    sourceWidth: 20,
    sourceHeight: 10,
    regions: [
      { path: 'M0 0H12V10H0Z', colorId: 'white' },
      { path: 'M8 0H20V10H8Z', colorId: 'black' },
    ],
  };
  p.collections = [collection([rect(10, 10, 5, 10, 'accent')], 0.4), collection([image], 0.8)];
  const layered = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(layered, 'accent', 12, 85, T + 0.2));
  assert.ok(await colorAt(layered, 'white', 12, 85, T + 1.0));
  assert.ok(await colorAt(layered, 'black', 20, 85, T + 1.0));
  near(volumeOf(layered, 'white'), 80 * 1.2 - 50 * 0.4);
  near(layered.stats.volume, baseVolume + 200 * 1.2);
  await good(layered);
  // Same-height members have no space above the existing lower volume.
  p.collections = [collection([rect(10, 10, 5, 10, 'accent'), image], 0.6)];
  const sameHeight = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(sameHeight, 'accent', 12, 85, T + 0.5));
  await good(sameHeight);
  p.collections.push(collection([rect(10, 10, 20, 10, 'pink')], 0.6));
  const overwritten = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(overwritten, 'pink', 12, 85, T + 0.2));
  assert.ok(await colorAt(overwritten, 'pink', 20, 85, T + 1.0));
  await good(overwritten);
});

test('volume coverage retains stepped template heights and raised artwork above a background', async () => {
  const low = runtime.Manifold.cube([5, 5, 0.3]).translate([30, 60, T]);
  const high = runtime.Manifold.cube([2, 5, 1.5]).translate([33, 60, T]);
  const stepped = runtime.Manifold.union([low, high]);
  low.delete();
  high.delete();
  const decoration = object('decoration', 'decoration', stepped, 'accent');
  const template = { ...minimal, objects: [minimal.objects[0], decoration] };
  const p = project();
  p.template.decorations.decoration = {
    ...placement,
    x: 30,
    y: 35,
    width: 5,
    height: 5,
    colorId: 'accent',
  };
  p.collections = [
    collection([{ ...rect(30, 35, 10, 5, 'white'), coversLower: false, avoidsLower: false }], 0.6),
    background([rect(30, 35, 10, 5, 'black')]),
  ];
  const model = await generateGeometry(p, template, fontBuffer);
  assert.ok(await colorAt(model, 'accent', 31, 62, T + 0.2));
  assert.ok(await colorAt(model, 'white', 31, 62, T + 0.5));
  assert.ok(await colorAt(model, 'accent', 34, 62, T + 1.0));
  assert.equal(await colorAt(model, 'white', 34, 62, T + 0.5), false);
  assert.ok(await colorAt(model, 'white', 38, 62, T + 0.5));
  assert.ok(await colorAt(model, 'black', 38, 62, T - 0.35));
  const topProjection = flattenPath(templateAbovePath(decoration, T + 0.6, 100));
  assert.equal(Math.min(...topProjection.flat().map(([x]) => x)), 33);
  assert.notEqual(
    templateAbovePath(decoration, decoration.bounds[5], 100),
    '',
    'equal-height template tops remain visible',
  );
  assert.equal(templateAbovePath(decoration, T + 1.6, 100), '');
  await good(model);
});

test('multicolor regions share one coversLower mask and later regions win within that object', async () => {
  for (const mode of ['raised', 'background'] as const) {
    for (const coversLower of [false, true]) {
      const p = project();
      const image: DesignItem = {
        ...rect(10, 10, 20, 10),
        kind: 'paths',
        coversLower,
        sourceWidth: 20,
        sourceHeight: 10,
        regions: [
          { path: 'M0 0H12V10H0Z', colorId: 'white' },
          { path: 'M8 0H20V10H8Z', colorId: 'black' },
        ],
      };
      p.collections = [
        { ...collection([rect(10, 10, 5, 10, 'accent')], 0.4), mode },
        { ...collection([image], 0.8), mode },
      ];
      const model = await generateGeometry(p, minimal, fontBuffer);
      const depth = mode === 'raised' ? 1.2 : 0.7;
      const lowDepth = mode === 'raised' ? 0.4 : 0.7;
      const z = mode === 'raised' ? T + 0.2 : T - 0.35;
      assert.ok(await colorAt(model, coversLower ? 'white' : 'accent', 12, 85, z));
      assert.ok(await colorAt(model, 'white', 16, 85, z));
      assert.ok(
        await colorAt(model, 'black', 20, 85, z),
        'internal last region must remain present',
      );
      assert.equal(await colorAt(model, 'white', 20, 85, z), false);
      near(volumeOf(model, 'accent'), coversLower ? 0 : 50 * lowDepth);
      near(volumeOf(model, 'white'), (coversLower ? 80 : 30) * depth);
      near(volumeOf(model, 'black'), 120 * depth);
      near(
        model.stats.volume,
        mode === 'background'
          ? baseVolume
          : baseVolume + (coversLower ? 200 * depth : 150 * depth + 50 * lowDepth),
      );
      await good(model);
    }
  }
});

test('hidden groups and objects never obstruct a coversLower-off item or add height', async () => {
  const p = project();
  const hiddenItem = rect(10, 10, 10, 10, 'accent');
  hiddenItem.visible = false;
  const hiddenGroup = collection([rect(10, 10, 10, 10, 'white')], 20);
  hiddenGroup.visible = false;
  const upper = rect(10, 10, 10, 10, 'black');
  upper.coversLower = false;
  p.collections = [
    hiddenGroup,
    background([hiddenItem]),
    background([], 'front', 1e100),
    collection([upper], 0.6),
  ];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.ok(await colorAt(model, 'black', 15, 85, T + 0.5));
  near(volumeOf(model, 'black'), 100 * 0.6);
  near(volumeOf(model, 'white'), 0);
  near(volumeOf(model, 'accent'), 0);
  near(model.bounds[5], T + 0.6);
  near(model.stats.volume, baseVolume + 100 * 0.6);
  await good(model);
});

test('background is below original decorations; coversLower off respects both decoration and background XY', async () => {
  const template: TemplateData = {
    ...minimal,
    objects: [
      minimal.objects[0],
      object(
        'decoration',
        'decoration',
        runtime.Manifold.cube([5, 5, 2]).translate([30, 60, T + 0.3]),
        'accent',
      ),
    ],
  };
  for (const coversLower of [false, true]) {
    const p = project();
    p.template.decorations.decoration = {
      ...placement,
      x: 30,
      y: 35,
      width: 5,
      height: 5,
      colorId: 'accent',
    };
    const bg = rect(30, 35, 8, 5, 'black');
    bg.coversLower = false;
    const upper = rect(30, 35, 10, 5, 'white');
    upper.coversLower = coversLower;
    // Background comes later in the list but remains below the decoration.
    p.collections = [collection([upper], 0.2), background([bg])];
    const model = await generateGeometry(p, template, fontBuffer);
    assert.ok(await colorAt(model, 'black', 32, 62, T - 0.35));
    assert.ok(await colorAt(model, coversLower ? 'white' : 'accent', 32, 62, T + 2.1));
    assert.equal(await colorAt(model, 'black', 32, 62, T + 0.1), false);
    assert.equal(await colorAt(model, 'white', 37, 62, T + 0.1), coversLower);
    assert.ok(await colorAt(model, 'white', 39, 62, T + 0.1));
    near(volumeOf(model, 'black'), 40 * 0.7);
    near(volumeOf(model, 'accent'), coversLower ? 0 : 25 * 2.3);
    near(volumeOf(model, 'white'), coversLower ? 50 * 0.2 + 25 * 2.1 : 10 * 0.2);
    await good(model);
  }
});

test('front backgrounds honor the full fixed panel and current label glyph projections without masking back', async () => {
  const panelOuter = runtime.Manifold.cube([8, 40, 1.45]).translate([0, 0, T]);
  const panelHole = runtime.Manifold.cube([6, 38, 2]).translate([1, 1, T - 0.1]);
  const panel = runtime.Manifold.difference(panelOuter, panelHole);
  panelOuter.delete();
  panelHole.delete();
  const template: TemplateData = {
    ...minimal,
    objects: [
      minimal.objects[0],
      object('panel', 'fixed-panel', panel),
      object('label', 'editable-label', runtime.Manifold.cube([4, 10, 1.45]).translate([0, 50, T])),
    ],
  };
  const p = project();
  p.template.frontColorId = 'white';
  p.template.label = {
    ...placement,
    visible: true,
    x: 20,
    y: 20,
    width: 10,
    height: 12,
    text: 'O',
    useOriginal: false,
  };
  p.collections = [
    background([rect(0, 0, 50, 100, 'black')]),
    collection([rect(0, 0, 50, 100, 'accent')], 0.2),
    background([rect(43, 65, 5, 5, 'accent')], 'back'),
  ];
  const model = await generateGeometry(p, template, fontBuffer);
  assert.ok(
    await colorAt(model, 'white', 4, 20, T - 0.35),
    'entire panel bounding projection is protected',
  );
  assert.equal(await colorAt(model, 'black', 4, 20, T - 0.35), false);
  assert.equal(await colorAt(model, 'accent', 4, 20, T + 0.1), false);
  assert.ok(await colorAt(model, 'white', 20.5, 74, T - 0.35), 'actual O stem protects skin');
  assert.ok(await colorAt(model, 'white', 20.5, 74, T + 1), 'actual O stem retains label height');
  assert.ok(await colorAt(model, 'black', 25, 74, T - 0.35), 'O counter accepts background');
  assert.ok(await colorAt(model, 'accent', 25, 74, T + 0.1), 'O counter accepts raised artwork');
  assert.ok(await colorAt(model, 'accent', 4, 32, 0.35), 'front panel mask does not affect back');
  assert.ok(await colorAt(model, 'pink', 4, 32, 1.1));
  await good(model);
});

test('edge-clipped artwork generates without a disconnected-entity warning', async () => {
  const p = project();
  p.collections = [collection([rect(49.9, 97, 10, 10, 'white')], 0.4)];
  const model = await generateGeometry(p, minimal, fontBuffer);
  assert.equal(model.issues.length, 0);
  assert.ok(await colorAt(model, 'white', 49.95, 1, T + 0.2));
  await good(model);
});

test('real imported template stays closed with distinct skins and mixed background/raised coverage', async () => {
  const template: TemplateData = JSON.parse(
    await readFile(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
  );
  const p = createProject(template);
  p.template.frontColorId = 'white';
  p.template.backColorId = 'accent';
  p.collections[0].mode = 'background';
  p.collections[0].thickness = 12;
  for (const item of p.collections[1].items) item.coversLower = false;
  const model = await generateGeometry(p, template, fontBuffer);
  assert.ok(await colorAt(model, 'white', 25, 90, T - 0.35));
  assert.ok(await colorAt(model, 'pink', 25, 90, 1.1));
  assert.ok(await colorAt(model, 'accent', 25, 90, 0.35));
  assert.ok(await colorAt(model, 'black', 25, 75, T - 0.35));
  assert.equal(await colorAt(model, 'white', 25, 75, T + 0.2), false);
  near(model.stats.coreThickness, T - 1.4);
  assert.ok(model.bounds[5] < T + 2);
  await good(model);
});

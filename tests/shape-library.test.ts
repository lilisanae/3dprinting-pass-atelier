import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { shapeCatalog, shapeAppearance } from '../src/model/shapeCatalog';
import { newShape, validateProject } from '../src/model/project';
import { serializeProject } from '../src/io/projectFile';
import { itemPath, flattenPath } from '../src/artwork/paths';
import { applyShapeAppearance } from '../src/geometry/shapeAppearance';
import {
  getManifoldRuntime,
  generateGeometry,
  inspectGeneratedModel,
} from '../src/geometry/engine';
import { mergeArtwork } from '../src/geometry/merge';
import { export3mf, exportStlZip } from '../src/export';
import type { CrossSection, SimplePolygon } from 'manifold-3d';
import type { Project, TemplateData } from '../src/model/types';

const runtime = await getManifoldRuntime(),
  CS = runtime.CrossSection;
const source = readFileSync(new URL('../public/assets/pass-font-core-v1.woff', import.meta.url));
const font = source.buffer.slice(
  source.byteOffset,
  source.byteOffset + source.byteLength,
) as ArrayBuffer;
const cube = runtime.Manifold.cube([50, 100, 2.3]);
const mesh = cube.getMesh();
cube.delete();
const template: TemplateData = {
  version: 'maimai-template-v1',
  source: 'shape tests',
  width: 50,
  height: 100,
  thickness: 2.3,
  panelBounds: [0, 0, 1, 1],
  objects: [
    {
      id: 'base',
      name: 'base',
      role: 'base',
      colorId: 'pink',
      positions: Array.from(mesh.vertProperties),
      indices: Array.from(mesh.triVerts),
      outlinePath: 'M0 0H50V100H0Z',
      bounds: [0, 0, 0, 50, 100, 2.3],
      height: 2.3,
    },
  ],
};
const project = (): Project => ({
  format: 'pass-atelier',
  version: 1,
  templateVersion: template.version,
  name: 'Shapes',
  palette: [
    { id: 'pink', name: 'Pink', hex: '#ff88aa' },
    { id: 'white', name: 'White', hex: '#ffffff' },
  ],
  collections: [],
  template: {
    baseColorId: 'pink',
    panelColorId: 'white',
    panelDetailColorId: 'white',
    panel: null,
    label: null,
    decorations: {},
  },
});
const hollow = () => ({
  ...newShape('white', 'rect', { shapeFill: false, shapeOutline: true, shapeOutlineWidth: 1 }),
  x: 10,
  y: 20,
  width: 10,
  height: 10,
});
const volume = (model: Awaited<ReturnType<typeof generateGeometry>>, color: string) =>
  model.meshes.filter((part) => part.colorId === color).reduce((sum, part) => sum + part.volume, 0);

test('all 34 presets fit declared bounds and produce closed solid and inset-border geometry', () => {
  assert.equal(shapeCatalog.length, 34);
  assert.equal(new Set(shapeCatalog.map((shape) => shape.id)).size, 34);
  for (const preset of shapeCatalog) {
    const item = newShape('white', preset.id),
      contours = flattenPath(itemPath(item), 0.01),
      points = contours.flat();
    assert.ok(points.length >= 3, preset.id);
    const xs = points.map((point) => point[0]),
      ys = points.map((point) => point[1]);
    assert.ok(
      Math.abs(Math.min(...xs)) < 0.03 && Math.abs(Math.max(...xs) - item.width) < 0.03,
      preset.id,
    );
    assert.ok(
      Math.abs(Math.min(...ys)) < 0.03 && Math.abs(Math.max(...ys) - item.height) < 0.03,
      preset.id,
    );
    const owned: CrossSection[] = [],
      own = (section: CrossSection) => {
        owned.push(section);
        return section;
      };
    try {
      const full = own(new CS(contours as SimplePolygon[], 'NonZero'));
      assert.ok(full.area() > 0, preset.id);
      const ring = applyShapeAppearance(
        full,
        { ...item, shapeFill: false, shapeOutline: true, shapeOutlineWidth: 0.4 },
        own,
      );
      assert.ok(ring.area() > 0 && ring.area() < full.area(), preset.id);
      const solid = ring.extrude(0.4);
      assert.equal(solid.status(), 'NoError', preset.id);
      assert.ok(solid.volume() > 0, preset.id);
      solid.delete();
    } finally {
      for (const section of owned) section.delete();
    }
  }
});

test('appearance survives saving; legacy presets remain solid and invalid appearance is rejected', () => {
  const p = project();
  p.collections = [
    { id: 'front', name: 'front', face: 'front', visible: true, thickness: 0.4, items: [hollow()] },
  ];
  const saved = validateProject(JSON.parse(serializeProject(p))).collections[0].items[0];
  assert.deepEqual(shapeAppearance(saved), {
    shapeFill: false,
    shapeOutline: true,
    shapeOutlineWidth: 1,
    shapeOutlinePosition: -1,
  });
  assert.deepEqual(shapeAppearance(newShape('white', 'star')), {
    shapeFill: true,
    shapeOutline: false,
    shapeOutlineWidth: 0.6,
    shapeOutlinePosition: -1,
  });
  for (const patch of [
    { shapeFill: false, shapeOutline: false },
    { shapeOutlineWidth: 0 },
    { shapeOutlineWidth: Infinity },
    { shapeOutlineWidth: 21 },
    { shapeFill: 'false' },
  ]) {
    const invalid = structuredClone(p);
    Object.assign(invalid.collections[0].items[0], patch);
    assert.throws(() => validateProject(invalid));
  }
});

test('real front and back geometry preserve hollow centers; saved 3MF and STL use those meshes', async () => {
  for (const face of ['front', 'back'] as const) {
    const p = project();
    p.collections = [
      {
        id: face,
        name: face,
        face,
        visible: true,
        thickness: 0.4,
        inlayDepth: 0.7,
        items: [hollow()],
      },
    ];
    const model = await generateGeometry(p, template, font);
    const expected = 36 * (face === 'front' ? 0.4 : 0.7);
    assert.ok(Math.abs(volume(model, 'white') - expected) < 0.004);
    const inspection = await inspectGeneratedModel(model);
    assert.ok(inspection.closed.every(Boolean));
    assert.ok(inspection.overlaps.every((overlap) => Math.abs(overlap[2]) < 0.004));
    assert.equal(inspection.components, 1);
    const archive = unzipSync(export3mf(model, p)),
      stls = unzipSync(exportStlZip(model, p));
    assert.ok(Object.keys(archive).some((name) => name.endsWith('.model')));
    assert.ok(Object.keys(stls).some((name) => name.endsWith('.stl')));
    const entry = Object.keys(archive).find(
      (name) => name.endsWith('.json') && strFromU8(archive[name]).includes('shapeOutlineWidth'),
    );
    assert.ok(entry, '3MF must include editable appearance');
  }
});

test('merging outlined frames bakes their holes, while outlined cutting removes only its border', async () => {
  const p = project(),
    first = hollow(),
    second = { ...hollow(), x: 26 };
  p.collections = [
    {
      id: 'front',
      name: 'front',
      face: 'front',
      visible: true,
      thickness: 0.4,
      items: [first, second],
    },
  ];
  const merged = await mergeArtwork(
    p,
    {
      kind: 'items',
      items: [
        { collectionId: 'front', id: first.id },
        { collectionId: 'front', id: second.id },
      ],
    },
    font,
  );
  const shape = new CS(flattenPath(itemPath(merged)) as SimplePolygon[], 'NonZero');
  assert.ok(Math.abs(shape.area() - 72) < 0.01);
  assert.equal(shape.toPolygons().length, 4);
  shape.delete();
  const target = { ...newShape('white', 'rect'), x: 10, y: 20, width: 10, height: 10 };
  const cutter = { ...hollow(), cutout: { targetIds: [target.id] } };
  p.collections[0].items = [target, cutter];
  const model = await generateGeometry(p, template, font);
  assert.ok(Math.abs(volume(model, 'white') - 64 * 0.4) < 0.004);
});

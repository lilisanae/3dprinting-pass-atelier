import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { SimplePolygon, CrossSection } from 'manifold-3d';
import { traceRaster } from '../src/artwork/raster-trace';
import type { Raster, ImportResult } from '../src/artwork/import-options';
import { flattenPath } from '../src/artwork/paths';
import { insertImportedArtwork } from '../src/model/importedArtwork';
import {
  createProject,
  cumulativeHeights,
  newCollection,
  validateProject,
} from '../src/model/project';
import {
  generateGeometry,
  getManifoldRuntime,
  inspectGeneratedModel,
} from '../src/geometry/engine';
import type { DesignItem, PaletteColor, TemplateData } from '../src/model/types';

const runtime = await getManifoldRuntime();
const palette: PaletteColor[] = [
  { id: 'black', name: '墨', hex: '#111111' },
  { id: 'white', name: '白', hex: '#FFFFFF' },
  { id: 'red', name: '红', hex: '#FF0000' },
];
const raster = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
): Raster => ({
  width,
  height,
  data: new Uint8ClampedArray(
    Array.from({ length: width * height }, (_, i) =>
      pixel(i % width, Math.floor(i / width)),
    ).flat(),
  ),
});
const ring = () =>
  raster(40, 40, (x, y) =>
    x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 10 && x < 30 && y >= 10 && y < 30)
      ? [0, 0, 0, 255]
      : [255, 255, 255, 255],
  );
const trace = (image: Raster) =>
  traceRaster(image, palette, { mode: 'lineart', simplify: 0, silhouette: true });
const section = (path: string) =>
  new runtime.CrossSection(flattenPath(path) as SimplePolygon[], 'NonZero');
function covers(shape: CrossSection, x: number, y: number) {
  const square = runtime.CrossSection.square([0.01, 0.01]).translate([x, y]);
  const hit = runtime.CrossSection.intersection(shape, square);
  const yes = hit.area() > 1e-8;
  hit.delete();
  square.delete();
  return yes;
}
const template = JSON.parse(
  await readFile(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
const fixture = () => {
  const p = createProject(template);
  p.collections = [];
  p.template.label.visible = false;
  Object.values(p.template.decorations).forEach((d) => (d.visible = false));
  return p;
};
const item = (result: ImportResult): DesignItem => ({
  id: 'imported',
  name: '线稿',
  kind: 'paths',
  visible: true,
  x: 12,
  y: 20,
  width: result.width,
  height: result.height,
  rotation: 0,
  colorId: 'black',
  regions: result.regions,
  sourceWidth: result.width,
  sourceHeight: result.height,
});
const near = (a: number, b: number, epsilon = 1e-5) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('silhouette fills an enclosed lineart interior without changing the original holes', () => {
  const traced = trace(ring());
  const original = traceRaster(ring(), palette, { mode: 'lineart', simplify: 0 });
  assert.deepEqual(traced.regions, original.regions);
  assert.equal(original.silhouettePath, undefined);
  const ink = section(traced.regions[0].path),
    backing = section(traced.silhouettePath!);
  try {
    assert.equal(covers(ink, 12.5, 12.5), false);
    assert.equal(covers(backing, 12.5, 12.5), true);
    assert.ok(backing.area() > ink.area() * 1.5);
  } finally {
    ink.delete();
    backing.delete();
  }
});

test('silhouette retains concave outlines and does not bridge separate components', () => {
  const traced = trace(
    raster(48, 32, (x, y) =>
      (x >= 3 && x < 8 && y >= 3 && y < 28) ||
      (x >= 3 && x < 21 && y >= 22 && y < 28) ||
      (x >= 32 && x < 45 && y >= 8 && y < 24 && (x < 35 || x >= 42 || y < 11 || y >= 21))
        ? [0, 0, 0, 255]
        : [255, 255, 255, 255],
    ),
  );
  const backing = section(traced.silhouettePath!);
  try {
    const s = 25 / 48;
    assert.equal(covers(backing, 15 * s, 12 * s), false, 'concave notch stays empty');
    assert.equal(covers(backing, 27 * s, 18 * s), false, 'separate shapes are not connected');
    assert.equal(covers(backing, 38 * s, 16 * s), true, 'closed second shape is filled');
  } finally {
    backing.delete();
  }
});

test('open lineart does not invent a closed silhouette across a gap', () => {
  const traced = trace(
    raster(40, 40, (x, y) => {
      const frame =
        x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 10 && x < 30 && y >= 10 && y < 30);
      return frame && !(y < 10 && x >= 17 && x < 23) ? [0, 0, 0, 255] : [255, 255, 255, 255];
    }),
  );
  const backing = section(traced.silhouettePath!),
    ink = section(traced.regions[0].path);
  try {
    near(backing.area(), ink.area());
    assert.equal(covers(backing, 12.5, 12.5), false);
  } finally {
    backing.delete();
    ink.delete();
  }
});

test('transparent multicolor artwork produces a filled silhouette with unchanged color regions', () => {
  const image = raster(40, 40, (x, y) => {
    const frame = x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 10 && x < 30 && y >= 10 && y < 30);
    if (frame) return x < 20 ? [0, 0, 0, 255] : [255, 0, 0, 255];
    return [0, 0, 0, 0];
  });
  const result = traceRaster(image, palette, {
    mode: 'color',
    maxColors: 2,
    simplify: 0,
    silhouette: true,
  });
  assert.equal(result.regions.length, 2);
  const backing = section(result.silhouettePath!);
  try {
    assert.equal(covers(backing, 12.5, 12.5), true);
  } finally {
    backing.delete();
  }
});

test('underlay reuses the preceding raised collection without changing existing heights, placement or project roundtrip', () => {
  const p = fixture(),
    result = trace(ring()),
    imported = item(result);
  imported.x = -2.413;
  imported.rotation = 28;
  imported.width = 31.729;
  const first = newCollection('front'),
    target = newCollection('front'),
    last = newCollection('front');
  first.thickness = 0.4;
  target.thickness = 0.8;
  last.thickness = 0.1;
  p.collections = [first, target, last];
  const selection = insertImportedArtwork(p, 'front', imported, target.id, {
    path: result.silhouettePath!,
    colorId: 'white',
    artworkThickness: 0.35,
  });
  const lower = p.collections[0],
    silhouette = lower.items[0];
  assert.equal(selection?.kind, 'items');
  assert.deepEqual(
    p.collections.map((c) => c.id),
    [first.id, target.id, last.id],
  );
  assert.equal(lower.thickness, 0.4);
  assert.equal(target.items[0], imported);
  for (const key of [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'sourceWidth',
    'sourceHeight',
  ] as const)
    assert.equal(silhouette[key], imported[key]);
  const heights = cumulativeHeights(p.collections);
  near(heights[first.id], 0.4);
  near(heights[lower.id], 0.4);
  near(heights[target.id], 1.2);
  near(heights[last.id], 1.3);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
});

test('hidden target creates a hidden backing; plain import and first import keep normal collection rules', () => {
  const p = fixture(),
    result = trace(ring()),
    target = newCollection('front');
  target.visible = false;
  p.collections = [target];
  insertImportedArtwork(p, 'front', item(result), target.id, {
    path: result.silhouettePath!,
    colorId: 'white',
    artworkThickness: 0.6,
  });
  assert.equal(p.collections[0].visible, false);
  assert.deepEqual(cumulativeHeights(p.collections), {});
  const plain = fixture();
  const selection = insertImportedArtwork(plain, 'back', item(result));
  assert.equal(plain.collections.length, 1);
  assert.equal(plain.collections[0].thickness, 0.7);
  assert.equal(selection?.kind, 'item');
  const fresh = fixture();
  insertImportedArtwork(fresh, 'front', item(result), undefined, {
    path: result.silhouettePath!,
    colorId: 'white',
    artworkThickness: 0.6,
  });
  assert.equal(fresh.collections.length, 2);
  near(fresh.collections[0].thickness, 0.4);
  near(fresh.collections[1].thickness, 0.6);
  near(cumulativeHeights(fresh.collections)[fresh.collections[1].id], 1.0);
});

test('invalid height, back face and flush background reject the underlay without changing the design', () => {
  for (const thickness of [0, -0.6, NaN, Infinity]) {
    const p = fixture(),
      before = structuredClone(p),
      result = trace(ring());
    assert.throws(() =>
      insertImportedArtwork(p, 'front', item(result), undefined, {
        path: result.silhouettePath!,
        colorId: 'white',
        artworkThickness: thickness,
      }),
    );
    assert.deepEqual(p, before);
  }
  for (const face of ['front', 'back'] as const) {
    const p = fixture(),
      target = newCollection(face),
      result = trace(ring());
    target.mode = 'background';
    p.collections = [target];
    const before = structuredClone(p);
    assert.throws(() =>
      insertImportedArtwork(p, face, item(result), target.id, {
        path: result.silhouettePath!,
        colorId: 'white',
        artworkThickness: 0.6,
      }),
    );
    assert.deepEqual(p, before);
  }
});

test('real imported lineart and its backing export closed, supported, exclusive colors at separate heights', async () => {
  const p = fixture(),
    result = trace(ring()),
    target = newCollection('front');
  p.collections = [target];
  target.thickness = 0.35;
  insertImportedArtwork(p, 'front', item(result), target.id, {
    path: result.silhouettePath!,
    colorId: 'white',
    artworkThickness: 0.6,
  });
  const font = await readFile(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
  const model = await generateGeometry(
    p,
    { ...template, objects: template.objects.filter((object) => object.role === 'base') },
    font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer,
  );
  const inspected = await inspectGeneratedModel(model);
  assert.ok(inspected.closed.every(Boolean));
  assert.equal(inspected.components, 1);
  assert.ok(inspected.overlaps.every(([, , volume]) => volume < 1e-4));
  near(model.stats.frontHeight, 0.95);
  const ink = model.meshes.find((m) => m.colorId === 'black')!;
  const white = model.meshes.find((m) => m.colorId === 'white')!;
  const maxZ = (positions: Float32Array) => {
    let z = -Infinity;
    for (let i = 2; i < positions.length; i += 3) z = Math.max(z, positions[i]);
    return z;
  };
  near(maxZ(ink.positions), template.thickness + 0.95, 0.00001);
  near(maxZ(white.positions), template.thickness + 0.35, 0.00001);
});

test('bottommost import keeps backing and existing objects in place, creates only the artwork collection above it', () => {
  const p = fixture(),
    result = trace(ring()),
    target = newCollection('front'),
    upper = newCollection('front');
  const existing = { ...item(result), id: 'existing' };
  target.thickness = 0.27;
  target.items.push(existing);
  upper.thickness = 0.8;
  p.collections = [target, upper];
  const selection = insertImportedArtwork(p, 'front', item(result), target.id, {
    path: result.silhouettePath!,
    colorId: 'white',
    artworkThickness: 0.43,
  });
  assert.equal(p.collections.length, 3);
  assert.equal(p.collections[0], target);
  assert.equal(p.collections[2], upper);
  assert.equal(target.items[0], existing);
  assert.equal(target.items[1].name, '线稿 · 剪影');
  assert.equal(p.collections[1].items[0].id, 'imported');
  assert.equal(p.collections[1].thickness, 0.43);
  near(cumulativeHeights(p.collections)[target.id], 0.27);
  near(cumulativeHeights(p.collections)[upper.id], 1.5);
  assert.deepEqual(selection, {
    kind: 'items',
    items: [
      { collectionId: target.id, id: target.items[1].id },
      { collectionId: p.collections[1].id, id: 'imported' },
    ],
  });
});

test('plain import reuses the chosen collection; stale targets fail intact and interleaved backgrounds cannot receive a silhouette', () => {
  const p = fixture(),
    result = trace(ring()),
    lower = newCollection('front'),
    target = newCollection('front'),
    back = newCollection('back'),
    background = newCollection('front');
  background.mode = 'background';
  p.collections = [lower, back, background, target];
  insertImportedArtwork(p, 'front', item(result), target.id);
  assert.equal(p.collections.length, 4);
  assert.equal(target.items[0].id, 'imported');
  const before = structuredClone(p);
  assert.throws(() => insertImportedArtwork(p, 'front', item(result), 'removed'));
  assert.deepEqual(p, before);
  insertImportedArtwork(p, 'front', { ...item(result), id: 'second' }, target.id, {
    path: result.silhouettePath!,
    colorId: 'white',
  });
  assert.equal(p.collections.length, 4);
  assert.equal(lower.items.length, 1);
  assert.equal(back.items.length, 0);
  assert.equal(background.items.length, 0);
  assert.equal(target.items.length, 2);
});

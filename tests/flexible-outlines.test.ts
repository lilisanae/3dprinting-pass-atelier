import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CrossSection, SimplePolygon } from 'manifold-3d';
import { applyShapeAppearance } from '../src/geometry/shapeAppearance';
import { styleBadgeBase } from '../src/geometry/badgeAppearance';
import {
  getManifoldRuntime,
  generateGeometry,
  inspectGeneratedModel,
} from '../src/geometry/engine';
import {
  createBadgeProject,
  badgeOutline,
  defaultBadgeBase,
  badgePresets,
} from '../src/model/badge';
import { shapeAppearance, validateShapeAppearance } from '../src/model/shapeCatalog';
import { validateProject } from '../src/model/project';
import { serializeProject } from '../src/io/projectFile';
import { flattenPath } from '../src/artwork/paths';
import { silhouetteArtwork } from '../src/artwork/silhouette';
import { mergeArtwork } from '../src/geometry/merge';
import { export3mf, exportStlZip } from '../src/export';
import { unzipSync, strFromU8 } from 'fflate';
import type { DesignItem } from '../src/model/types';

const runtime = await getManifoldRuntime();
const fontSource = readFileSync(
  new URL('../public/assets/pass-font-core-v1.woff', import.meta.url),
);
const font = fontSource.buffer.slice(
  fontSource.byteOffset,
  fontSource.byteOffset + fontSource.byteLength,
) as ArrayBuffer;
const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
);
const near = (a: number, b: number, t = 0.025) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const rectangle = (patch: Partial<DesignItem> = {}): DesignItem => ({
  id: 'outline',
  name: '描边',
  kind: 'paths',
  regions: [{ path: 'M0 0H10V10H0Z', colorId: 'black' }],
  sourceWidth: 10,
  sourceHeight: 10,
  visible: true,
  x: 15,
  y: 15,
  width: 10,
  height: 10,
  rotation: 0,
  colorId: 'black',
  avoidsLower: false,
  shapeFill: false,
  shapeOutline: true,
  shapeOutlineWidth: 2,
  ...patch,
});
const project = () => {
  const p = createBadgeProject();
  Object.assign(p.badgeBase!, { shape: 'rect', width: 60, height: 40 });
  return p;
};

test('inside, centred and outside round borders have the specified width and analytic area for presets and imported paths', () => {
  const owned: CrossSection[] = [];
  const own = (v: CrossSection) => {
    owned.push(v);
    return v;
  };
  try {
    const raw = own(runtime.CrossSection.square([10, 10]));
    for (const kind of ['shape', 'paths'] as const) {
      for (const [position, min, area] of [
        [-1, 0, 64],
        [0, -1, 76 + Math.PI],
        [1, -2, 80 + 4 * Math.PI],
      ]) {
        const shape = applyShapeAppearance(
          raw,
          rectangle({ kind, shapeOutlinePosition: position }),
          own,
        );
        const points = shape.toPolygons().flat();
        near(Math.min(...points.map((p) => p[0])), min, 0.001);
        near(shape.area(), area);
        const filled = applyShapeAppearance(
          raw,
          rectangle({ kind, shapeFill: true, shapeOutlinePosition: position }),
          own,
        );
        near(
          filled.area(),
          position === -1 ? 100 : position === 0 ? 140 + Math.PI : 180 + 4 * Math.PI,
        );
      }
    }
    near(applyShapeAppearance(raw, rectangle({ shapeOutlinePosition: undefined }), own).area(), 64);
  } finally {
    owned.reverse().forEach((s) => s.delete());
  }
});

test('standalone silhouettes crop margins, fill no additional hull, keep islands, and do not mutate the original artwork', () => {
  const source = {
    regions: [{ path: 'M5 7H25V27H5Z M10 12V22H20V12Z', colorId: 'black' }],
    width: 40,
    height: 40,
    warnings: [],
    silhouettePath: 'M5 7H25V17H15V27H5Z M30 7H35V12H30Z',
  };
  const snapshot = structuredClone(source),
    result = silhouetteArtwork(source, 'white');
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].colorId, 'white');
  near(result.width, 30);
  near(result.height, 20);
  assert.deepEqual(source, snapshot);
  const cs = new runtime.CrossSection(
    flattenPath(result.regions[0].path) as SimplePolygon[],
    'NonZero',
  );
  near(cs.area(), 325);
  assert.equal(
    cs.decompose().map((p) => {
      p.delete();
      return 1;
    }).length,
    2,
  );
  cs.delete();
  assert.throws(() => silhouetteArtwork({ ...source, silhouettePath: '' }, 'white'), /剪影/);
});

test('badge border edits retain the original source, do not accumulate expansion, and preserve layers and mounting placement', async () => {
  const p = project();
  const base = {
    ...p.badgeBase!,
    layers: { front: 0.5, core: 2, back: 0.5 },
    mounts: [
      {
        id: 'pin',
        kind: 'pin-slot' as const,
        x: 15,
        y: 20,
        width: 20,
        height: 5,
        depth: 0.5,
        rotation: 0,
      },
    ],
  };
  const outside = shapeAppearance({
    shapeFill: true,
    shapeOutline: true,
    shapeOutlineWidth: 2,
    shapeOutlinePosition: 1,
  });
  const first = await styleBadgeBase(base, outside),
    again = await styleBadgeBase(first, outside);
  near(first.width, 64);
  near(first.height, 44);
  near(first.mounts[0].x, 17);
  assert.deepEqual(first, again);
  assert.deepEqual(first.layers, base.layers);
  assert.equal(first.outlineStyle!.source.shape, 'rect');
  const inside = await styleBadgeBase(first, { ...outside, shapeOutlinePosition: -1 });
  near(inside.width, 60);
  near(inside.mounts[0].x, 15);
  const hollow = await styleBadgeBase(first, { ...outside, shapeFill: false });
  assert.equal(hollow.contours!.length, 2);
  const fillAgain = await styleBadgeBase(hollow, {
    ...outside,
    shapeOutline: false,
    shapeFill: true,
  });
  near(fillAgain.width, 60);
  assert.equal(fillAgain.contours!.length, 1);
  p.badgeBase = first;
  assert.deepEqual(validateProject(JSON.parse(serializeProject(p))), p);
  for (const bad of [NaN, Infinity, -1.1, 1.1, null, '0'])
    assert.throws(() =>
      validateShapeAppearance({ ...outside, shapeOutlinePosition: bad as number }),
    );
  const corrupt = structuredClone(p);
  corrupt.badgeBase!.outlineStyle!.source.width = 61;
  assert.throws(() => validateProject(corrupt), /来源/);
  await assert.rejects(styleBadgeBase({ ...defaultBadgeBase(), width: 200 }, outside), /200/);
});

test('new imported borders survive solids, planar merging, saves and both printable exports', async () => {
  const p = project();
  p.collections[0].items = [rectangle({ shapeOutlinePosition: 1 })];
  const model = await generateGeometry(p, template, font);
  const ink = model.meshes.filter((m) => m.colorId === 'black').reduce((v, m) => v + m.volume, 0);
  near(ink, (80 + 4 * Math.PI) * 0.4, 0.04);
  const check = await inspectGeneratedModel(model);
  assert(check.closed.every(Boolean));
  assert(check.overlaps.every(([, , v]) => v < 1e-4));
  p.collections[0].items.push(
    rectangle({ id: 'second', x: 35, shapeFill: true, shapeOutline: false }),
  );
  const before = await generateGeometry(p, template, font);
  const merged = await mergeArtwork(
    p,
    {
      kind: 'items',
      items: p.collections[0].items.map((i) => ({ collectionId: p.collections[0].id, id: i.id })),
    },
    font,
  );
  p.collections[0].items = [merged];
  const after = await generateGeometry(p, template, font);
  near(before.stats.volume, after.stats.volume, 0.005);
  assert.deepEqual(validateProject(JSON.parse(serializeProject(p))), p);
  const mf = unzipSync(export3mf(after, p));
  assert(strFromU8(mf['3D/3dmodel.model']).includes('<triangle'));
  assert(Object.keys(unzipSync(exportStlZip(after, p))).some((n) => n.endsWith('.stl')));
});

test('all badge presets accept thin inside, centred and outside borders with stable frame coordinates', async () => {
  for (const [shape] of badgePresets)
    for (const fill of [false, true])
      for (const position of [-1, 0, 1]) {
        const base = { ...defaultBadgeBase(), shape };
        const result = await styleBadgeBase(
          base,
          shapeAppearance({
            shapeFill: fill,
            shapeOutline: true,
            shapeOutlineWidth: 0.6,
            shapeOutlinePosition: position,
          }),
        );
        near(result.width, 58 + 0.6 * (1 + position), 0.00001);
        assert(
          result.contours!.every((c) =>
            c.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
          ),
          `${shape} ${fill} ${position}`,
        );
      }
});

test('a hollow badge is a connected closed printable base, with no material filling its central opening', async () => {
  const p = project();
  p.badgeBase = await styleBadgeBase(
    p.badgeBase!,
    shapeAppearance({
      shapeFill: false,
      shapeOutline: true,
      shapeOutlineWidth: 2,
      shapeOutlinePosition: 1,
    }),
  );
  const result = await generateGeometry(p, template, font);
  near(result.stats.volume, (2 * (60 + 40) * 2 + 4 * Math.PI) * 3, 0.1);
  const check = await inspectGeneratedModel(result);
  assert(check.closed.every(Boolean));
  assert.equal(check.components, 1);
  const withoutStyle = structuredClone(p);
  delete withoutStyle.badgeBase!.outlineStyle;
  const restored = await generateGeometry(withoutStyle, template, font);
  near(restored.stats.volume, result.stats.volume, 0.001);
  const cs = new runtime.CrossSection(
    flattenPath(badgeOutline(p.badgeBase!), 0.01) as SimplePolygon[],
    'EvenOdd',
  );
  const middle = runtime.CrossSection.square([1, 1]).translate([32, 22]);
  const hit = cs.intersect(middle);
  near(hit.area(), 0, 0.001);
  hit.delete();
  middle.delete();
  cs.delete();
});

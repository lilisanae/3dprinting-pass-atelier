import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import {
  generateGeometry,
  getManifoldRuntime,
  inspectGeneratedModel,
} from '../src/geometry/engine';
import { componentKey, processColorBodies } from '../src/geometry/colorInspection';
import {
  applyColorCorrections,
  removeColorFragment,
  setColorCorrection,
} from '../src/model/colorCorrections';
import { removePaletteColor } from '../src/model/paletteEditing';
import { validateProject } from '../src/model/project';
import { export3mf, exportStlZip } from '../src/export';
import type { DesignItem, GeneratedModel, Project, TemplateData } from '../src/model/types';

const runtime = await getManifoldRuntime();
const font = await readFile(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
const fontBuffer = font.buffer.slice(
  font.byteOffset,
  font.byteOffset + font.byteLength,
) as ArrayBuffer;
const base = runtime.Manifold.cube([50, 100, 2]),
  mesh = base.getMesh();
const template: TemplateData = {
  version: 'maimai-template-v1',
  source: 'tests',
  width: 50,
  height: 100,
  thickness: 2,
  panelBounds: [0, 60, 8, 40],
  objects: [
    {
      id: 'base',
      name: 'base',
      role: 'base',
      colorId: 'pink',
      positions: Array.from(mesh.vertProperties),
      indices: Array.from(mesh.triVerts),
      outlinePath: '',
      bounds: [0, 0, 0, 50, 100, 2],
      height: 2,
    },
  ],
};
base.delete();
const rect = (
  id: string,
  colorId: string,
  x: number,
  width: number,
  height = width,
): DesignItem => ({
  id,
  name: id,
  kind: 'shape',
  shape: 'rect',
  visible: true,
  x,
  y: 10,
  width,
  height,
  rotation: 0,
  colorId,
});
function fixture(): Project {
  return {
    format: 'pass-atelier',
    version: 1,
    templateVersion: template.version,
    name: 'Tiny column',
    palette: [
      { id: 'pink', name: 'Pink', hex: '#ff88aa' },
      { id: 'white', name: 'White', hex: '#ffffff' },
      { id: 'black', name: 'Black', hex: '#222222' },
      { id: 'accent', name: 'Accent', hex: '#00cc88' },
    ],
    template: {
      baseColorId: 'pink',
      panelColorId: 'white',
      panelDetailColorId: 'black',
      label: null,
      decorations: {},
    },
    collections: [
      {
        id: 'lower',
        name: 'lower',
        face: 'front',
        visible: true,
        thickness: 0.6,
        items: [rect('thin', 'white', 10, 0.1), rect('large', 'white', 20, 3)],
      },
      {
        id: 'cap',
        name: 'cap',
        face: 'front',
        visible: true,
        thickness: 0.2,
        items: [{ ...rect('tiny-cap', 'black', 10, 0.1), coversLower: false, avoidsLower: false }],
      },
    ],
  };
}
const volume = (model: GeneratedModel, id: string) =>
  model.meshes.find((part) => part.colorId === id)?.volume ?? 0;
const near = (a: number, b: number, epsilon = 1e-5) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const generate = (p: Project, inspect = false) =>
  generateGeometry(p, template, fontBuffer, inspect ? { inspectionWidth: 0.2 } : undefined);
async function valid(model: GeneratedModel) {
  const result = await inspectGeneratedModel(model);
  assert.ok(result.closed.every(Boolean));
  assert.ok(result.overlaps.every(([, , amount]) => amount < 1e-5));
  assert.equal(result.components, 1, 'no detached caps in the assembled solid');
  return result;
}

function connectedFixture(): Project {
  const p = fixture();
  p.name = 'Connected tail';
  p.collections = [
    {
      ...p.collections[0],
      items: [
        rect('large', 'white', 20, 3),
        { ...rect('tail', 'white', 22.9, 2.1, 0.1), y: 11.45 },
      ],
    },
  ];
  return p;
}

test('connected narrow tails are separately editable while the broad body and default model stay intact', async () => {
  const p = connectedFixture(),
    plain = await generate(p),
    inspected = await generate(p, true);
  assert.deepEqual(inspected.meshes, plain.meshes, 'inspection is read-only');
  const tail = inspected.colorInspection!.candidates.find(
    (c) => c.fragment && c.originalColorId === 'white' && c.bounds[3] > 24.9,
  )!;
  assert.ok(tail && tail.bounds[0] > 22.8 && tail.volume < 0.2);
  assert.ok(setColorCorrection(p, tail.componentKey, 'accent', 'white', tail.fragment));
  const saved = validateProject(JSON.parse(JSON.stringify(p))),
    changed = await generate(saved, true);
  near((await valid(changed)).unionVolume, (await valid(plain)).unionVolume);
  near(volume(changed, 'accent'), tail.volume);
  near(volume(changed, 'white'), volume(plain, 'white') - tail.volume);
  assert.equal(changed.colorCorrectionStats?.applied, 1);
  assert.deepEqual(
    changed.colorInspection!.candidates.find((c) => c.componentKey === tail.componentKey)?.fragment,
    tail.fragment,
  );
  const wider = await generateGeometry(saved, template, fontBuffer, { inspectionWidth: 0.4 });
  assert.equal(wider.colorCorrectionStats?.applied, 1, 'saved selection uses its own width');
  assert.ok(
    wider.colorInspection!.candidates.find((c) => c.componentKey === tail.componentKey)?.corrected,
  );
  assert.equal(
    applyColorCorrections(
      saved,
      wider.colorInspection!.candidates.filter((c) => c.componentKey === tail.componentKey),
      'restore',
    ),
    1,
  );
  assert.deepEqual((await generate(saved)).meshes, plain.meshes);
});

test('local tail removal subtracts only the selected closed volume and pauses after source geometry changes', async () => {
  const p = connectedFixture(),
    original = await generate(p, true);
  const tail = original.colorInspection!.candidates.find(
    (c) => c.fragment && c.originalColorId === 'white',
  )!;
  assert.ok(removeColorFragment(p, tail.componentKey, tail.fragment));
  const changed = await generate(validateProject(JSON.parse(JSON.stringify(p))), true);
  near((await valid(original)).unionVolume - (await valid(changed)).unionVolume, tail.volume);
  near(volume(changed, 'pink'), volume(original, 'pink'));
  assert.ok(volume(changed, 'white') > 9 * 0.6 - 0.001, 'broad square survives');
  p.collections[0].items[1].x += 0.5;
  const stale = await generate(p);
  assert.equal(stale.colorCorrectionStats?.inactive, 1);
  assert.equal(stale.colorCorrectionStats?.applied, 0);
});

test('height bands reveal a thin connected color hidden under a wide same-color frame and preserve that frame on removal', () => {
  const owned: { delete(): void }[] = [],
    own = <T extends { delete(): void }>(v: T) => {
      owned.push(v);
      return v;
    };
  try {
    const frame = own(own(runtime.Manifold.cube([3, 20, 0.3])).translate([0, 0, 1]));
    const bar = own(own(runtime.Manifold.cube([2, 0.1, 1])).translate([1, 9, 0]));
    const joined = own(runtime.Manifold.union([frame, bar]));
    const body = { colorId: 'black', name: 'connected frame', solid: joined };
    const result = processColorBodies(runtime, [body], undefined, 0.2, own);
    const candidate = result.inspection!.candidates.find((c) => c.fragment)!;
    assert.equal(result.inspection!.total, 1);
    candidate.bounds.forEach((value, i) => near(value, [1, 9, 0, 3, 9.1, 1][i], 0.00005));
    near(candidate.volume, 0.2);
    const edit = {
      componentKey: candidate.componentKey,
      fragment: candidate.fragment,
      mode: 'remove' as const,
    };
    const removed = processColorBodies(runtime, [body], [edit], undefined, own);
    near(removed.bodies[0].solid.volume(), frame.volume());
    assert.equal(removed.bodies[0].solid.status(), 'NoError');
    const frameGap = own(runtime.Manifold.difference(frame, removed.bodies[0].solid));
    near(frameGap.volume(), 0);
  } finally {
    owned.reverse().forEach((v) => v.delete());
  }
});

test('ordinary broad corners stay out of local detection while diagonal connected tails are detected', () => {
  const owned: { delete(): void }[] = [],
    own = <T extends { delete(): void }>(v: T) => {
      owned.push(v);
      return v;
    };
  try {
    const square = own(runtime.Manifold.cube([2, 2, 0.6]));
    assert.equal(
      processColorBodies(
        runtime,
        [{ name: 'square', colorId: 'black', solid: square }],
        undefined,
        0.2,
        own,
      ).inspection!.total,
      0,
    );
    const tail = own(
      own(own(runtime.Manifold.cube([4, 0.1, 0.6])).rotate([0, 0, 45])).translate([1.8, 1.8, 0]),
    );
    const joined = own(runtime.Manifold.union([square, tail]));
    const result = processColorBodies(
      runtime,
      [{ name: 'diagonal tail', colorId: 'black', solid: joined }],
      undefined,
      0.2,
      own,
    );
    assert.ok(result.inspection!.candidates.some((c) => c.fragment && c.bounds[3] > 4.5));
  } finally {
    owned.reverse().forEach((v) => v.delete());
  }
});

test('local selectors validate their parent and width and survive bulk palette edits and model exports', async () => {
  const p = connectedFixture(),
    original = await generate(p, true),
    candidates = original.colorInspection!.candidates.filter((c) => c.fragment);
  assert.equal(applyColorCorrections(p, candidates, 'recolor', 'accent'), candidates.length);
  const first = p.colorCorrections![0];
  for (const fragment of [
    { parentKey: 'bad', width: 0.2 },
    { parentKey: first.componentKey, width: 0.2 },
    { parentKey: first.fragment!.parentKey, width: 0 },
    { parentKey: first.fragment!.parentKey, width: NaN },
  ]) {
    assert.throws(() => validateProject({ ...p, colorCorrections: [{ ...first, fragment }] }));
  }
  assert.throws(() =>
    validateProject({
      ...p,
      colorCorrections: [first, { componentKey: first.fragment!.parentKey, mode: 'remove' }],
    }),
  );
  removePaletteColor(p, 'accent');
  assert.equal(p.colorCorrections![0].colorId, 'black');
  assert.deepEqual(p.colorCorrections![0].fragment, first.fragment);
  const changed = await generate(validateProject(JSON.parse(JSON.stringify(p))));
  const archive = unzipSync(export3mf(changed, p));
  const embedded = JSON.parse(strFromU8(archive['Metadata/pass_atelier_project.json']));
  assert.deepEqual(embedded.colorCorrections, p.colorCorrections);
  const stls = unzipSync(exportStlZip(changed, p));
  assert.ok(Object.keys(stls).some((name) => name.endsWith('.stl')));
});

test('multiple local tails of the same parent support atomic removal and full restoration', async () => {
  const p = connectedFixture();
  p.collections[0].items.push({ ...rect('tail-two', 'white', 22.9, 2.1, 0.1), y: 10.45 });
  const original = await generate(p, true),
    tails = original.colorInspection!.candidates.filter((c) => c.fragment);
  assert.equal(tails.length, 2);
  assert.equal(applyColorCorrections(p, tails, 'remove'), 2);
  const changed = await generate(p, true);
  assert.equal(changed.colorCorrectionStats?.applied, 2);
  near(
    (await valid(original)).unionVolume - (await valid(changed)).unionVolume,
    tails.reduce((sum, c) => sum + c.volume, 0),
    0.00005,
  );
  assert.equal(applyColorCorrections(p, changed.colorInspection!.candidates, 'restore'), 2);
  assert.deepEqual((await generate(p)).meshes, original.meshes);
});

test('treated items remain reachable at the list end when more than 500 candidates are detected', () => {
  const owned: { delete(): void }[] = [],
    own = <T extends { delete(): void }>(v: T) => {
      owned.push(v);
      return v;
    };
  try {
    const dots = Array.from({ length: 501 }, (_, i) =>
      own(own(runtime.Manifold.cube([0.1, 0.1, 0.6])).translate([i * 0.3, 0, 0])),
    );
    const body = { name: 'many dots', colorId: 'black', solid: own(runtime.Manifold.union(dots)) };
    const original = processColorBodies(runtime, [body], undefined, 0.2, own);
    assert.equal(original.inspection!.total, 501);
    assert.equal(original.inspection!.candidates.length, 500);
    const key = original.inspection!.candidates[0].componentKey;
    const changed = processColorBodies(
      runtime,
      [body],
      [{ componentKey: key, colorId: 'pink' }],
      0.2,
      own,
    );
    assert.equal(changed.inspection!.candidates.length, 501);
    assert.equal(changed.inspection!.candidates.at(-1)!.componentKey, key);
    assert.ok(changed.inspection!.candidates.at(-1)!.corrected);
  } finally {
    owned.reverse().forEach((v) => v.delete());
  }
});

test('inspection finds stacked slivers without changing project or any default mesh', async () => {
  const p = fixture(),
    snapshot = JSON.stringify(p),
    normal = await generate(p),
    inspected = await generate(p, true);
  assert.equal(JSON.stringify(p), snapshot);
  assert.deepEqual(inspected.meshes, normal.meshes);
  assert.equal(inspected.colorInspection?.total, 2);
  assert.ok(inspected.colorInspection?.candidates.some((c) => c.originalColorId === 'white'));
  assert.ok(inspected.colorInspection?.candidates.some((c) => c.originalColorId === 'black'));
  await valid(inspected);
});

test('recolor transfers a closed component, preserves height/volume, persists and restores', async () => {
  const p = fixture(),
    baseline = await generate(p, true);
  const candidate = baseline.colorInspection!.candidates.find(
    (c) => c.originalColorId === 'white',
  )!;
  assert.ok(setColorCorrection(p, candidate.componentKey, 'accent', candidate.originalColorId));
  const serialized = validateProject(JSON.parse(JSON.stringify(p))),
    changed = await generate(serialized, true);
  assert.deepEqual(changed.bounds, baseline.bounds);
  near(volume(changed, 'accent'), candidate.volume);
  near(volume(changed, 'white'), volume(baseline, 'white') - candidate.volume);
  near((await valid(changed)).unionVolume, (await valid(baseline)).unionVolume);
  assert.ok(
    changed.colorInspection!.candidates.find((c) => c.componentKey === candidate.componentKey)
      ?.corrected,
  );
  assert.equal(changed.colorCorrectionStats?.applied, 1);
  assert.equal(changed.colorInspection!.candidates.at(-1)?.componentKey, candidate.componentKey);
  assert.equal(
    setColorCorrection(p, candidate.componentKey, 'missing', candidate.originalColorId),
    false,
  );
  assert.ok(
    setColorCorrection(
      p,
      candidate.componentKey,
      candidate.originalColorId,
      candidate.originalColorId,
    ),
  );
  assert.equal(p.colorCorrections, undefined);
  assert.deepEqual((await generate(p)).meshes, baseline.meshes);
});

test('removal clears overlying caps, keeps base/neighbors, persists, and can restore exactly', async () => {
  const p = fixture(),
    baseline = await generate(p, true);
  const candidate = baseline.colorInspection!.candidates.find(
    (c) => c.originalColorId === 'white',
  )!;
  assert.ok(removeColorFragment(p, candidate.componentKey));
  assert.equal(removeColorFragment(p, candidate.componentKey), false);
  const changed = await generate(validateProject(JSON.parse(JSON.stringify(p))), true);
  near(volume(changed, 'black'), 0);
  near(volume(changed, 'pink'), volume(baseline, 'pink'));
  near(volume(changed, 'white'), 9 * 0.6);
  near((await valid(baseline)).unionVolume - (await valid(changed)).unionVolume, 0.1 * 0.1 * 0.8);
  assert.equal(
    changed.colorInspection!.candidates.find((c) => c.componentKey === candidate.componentKey)
      ?.removed,
    true,
  );
  assert.equal(
    changed.colorInspection!.candidates.find((c) => c.originalColorId === 'black')
      ?.removalSourceKey,
    candidate.componentKey,
  );
  assert.ok(
    setColorCorrection(
      p,
      candidate.componentKey,
      candidate.originalColorId,
      candidate.originalColorId,
    ),
  );
  assert.deepEqual((await generate(p)).meshes, baseline.meshes);
});

test('cap-only removal preserves supporting column; changed geometry leaves stale corrections inactive', async () => {
  const p = fixture(),
    baseline = await generate(p, true);
  const cap = baseline.colorInspection!.candidates.find((c) => c.originalColorId === 'black')!;
  removeColorFragment(p, cap.componentKey);
  const changed = await generate(p);
  near(volume(changed, 'white'), volume(baseline, 'white'));
  near(volume(changed, 'black'), 0);
  await valid(changed);
  p.collections[1].items[0].x += 1;
  const stale = await generate(p);
  assert.equal(stale.colorCorrectionStats?.inactive, 1);
  assert.equal(stale.colorCorrectionStats?.applied, 0);
  near(volume(stale, 'black'), 0.1 * 0.1 * 0.8);
});

test('rotated thin lines are detected and numerical zero-volume seams ignored', () => {
  const owned: { delete(): void }[] = [],
    own = <T extends { delete(): void }>(value: T) => {
      owned.push(value);
      return value;
    };
  try {
    const thread = own(own(runtime.Manifold.cube([4, 0.1, 0.6])).rotate([0, 0, 45]));
    const broad = own(own(runtime.Manifold.cube([1, 1, 0.6])).translate([10, 0, 0]));
    const numerical = own(own(runtime.Manifold.cube([0.0001, 0.0001, 0.1])).translate([20, 0, 0]));
    const result = processColorBodies(
      runtime,
      [
        {
          name: 'white',
          colorId: 'white',
          solid: own(runtime.Manifold.union([thread, broad, numerical])),
        },
      ],
      undefined,
      0.2,
      own,
    );
    assert.equal(result.inspection!.total, 1);
    assert.ok(
      result.inspection!.candidates[0].bounds[3] - result.inspection!.candidates[0].bounds[0] > 2,
    );
    assert.equal(componentKey(thread), result.inspection!.candidates[0].componentKey);
    assert.throws(() => processColorBodies(runtime, [], undefined, NaN, own));
  } finally {
    owned.reverse().forEach((value) => value.delete());
  }
});

test('back-surface fragment removal goes outward and preserves the inner core/front surface', async () => {
  const p = fixture();
  p.collections = [
    {
      id: 'back',
      name: 'back',
      face: 'back',
      visible: true,
      mode: 'background',
      thickness: 0.4,
      inlayDepth: 0.4,
      items: [rect('back-dot', 'black', 10, 0.1)],
    },
  ];
  const original = await generate(p, true),
    candidate = original.colorInspection!.candidates[0];
  assert.equal(candidate.face, 'back');
  removeColorFragment(p, candidate.componentKey);
  const changed = await generate(p),
    check = await valid(changed);
  assert.deepEqual(changed.bounds, original.bounds);
  near(volume(changed, 'black'), 0);
  near(volume(changed, 'pink'), volume(original, 'pink'));
  near((await valid(original)).unionVolume - check.unionVolume, 0.1 * 0.1 * 0.4);
});

test('both correction modes validate strictly and deleted palette targets remap', () => {
  const p = fixture(),
    key = '0123456789abcdef';
  setColorCorrection(p, key, 'accent', 'white');
  assert.equal(removePaletteColor(p, 'accent')?.id, 'black');
  assert.equal(p.colorCorrections![0].colorId, 'black');
  validateProject(p);
  removeColorFragment(p, key);
  validateProject(p);
  const invalid = JSON.parse(JSON.stringify(p));
  invalid.colorCorrections[0].colorId = 'black';
  assert.throws(() => validateProject(invalid));
  invalid.colorCorrections = [{ componentKey: key, colorId: 'unknown' }];
  assert.throws(() => validateProject(invalid));
  invalid.colorCorrections = [
    { componentKey: key, mode: 'remove' },
    { componentKey: key, mode: 'remove' },
  ];
  assert.throws(() => validateProject(invalid));
});

test('batch edits transfer closed volumes together, order by operation and restore supported caps together', async () => {
  const p = fixture(),
    original = await generate(p, true),
    candidates = original.colorInspection!.candidates;
  const white = candidates.find((candidate) => candidate.originalColorId === 'white')!;
  const black = candidates.find((candidate) => candidate.originalColorId === 'black')!;
  assert.equal(applyColorCorrections(p, [white, black, white], 'recolor', 'accent'), 2);
  const recolored = await generate(p, true);
  assert.deepEqual(
    recolored.colorInspection!.candidates.map((candidate) => candidate.componentKey),
    [white.componentKey, black.componentKey],
  );
  near((await valid(original)).unionVolume, (await valid(recolored)).unionVolume);
  assert.equal(applyColorCorrections(p, recolored.colorInspection!.candidates, 'remove'), 2);
  const removed = await generate(p, true);
  near((await valid(original)).unionVolume - (await valid(removed)).unionVolume, 0.1 * 0.1 * 0.8);
  assert.equal(applyColorCorrections(p, removed.colorInspection!.candidates, 'restore'), 2);
  assert.equal(p.colorCorrections, undefined);
  assert.deepEqual((await generate(p)).meshes, original.meshes);
  const saturated = fixture();
  saturated.colorCorrections = Array.from({ length: 999 }, (_, index) => ({
    componentKey: index.toString(16).padStart(16, '0'),
    mode: 'remove' as const,
  }));
  const saved = JSON.stringify(saturated);
  assert.equal(applyColorCorrections(saturated, [white, black], 'recolor', 'accent'), 0);
  assert.equal(JSON.stringify(saturated), saved, 'a limit rejects the entire batch');
});

test('3MF and STL export edited material/geometry and include restorable project records', async () => {
  const p = fixture(),
    baseline = await generate(p, true);
  const white = baseline.colorInspection!.candidates.find((c) => c.originalColorId === 'white')!;
  setColorCorrection(p, white.componentKey, 'accent', 'white');
  for (const remove of [false, true]) {
    if (remove) removeColorFragment(p, white.componentKey);
    const model = await generate(p),
      mf = unzipSync(export3mf(model, p)),
      stl = unzipSync(exportStlZip(model, p));
    assert.equal(
      model.meshes.some((part) => part.colorId === 'accent'),
      !remove,
    );
    const projectPath = 'Metadata/pass_atelier_project.json';
    assert.deepEqual(JSON.parse(strFromU8(mf[projectPath])).colorCorrections, p.colorCorrections);
    const xml = strFromU8(mf['3D/3dmodel.model']);
    assert.equal((xml.match(/<component /g) ?? []).length, model.meshes.length);
    const manifest = JSON.parse(strFromU8(stl['colors.json']));
    manifest.parts.forEach((part: { file: string }, index: number) => {
      const bytes = stl[part.file],
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.equal(view.getUint32(80, true), model.meshes[index].indices.length / 3);
    });
    await valid(model);
  }
});

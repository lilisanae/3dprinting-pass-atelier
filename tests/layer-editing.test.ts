import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, newShape, validateProject } from '../src/model/project';
import { activeCutters, newCutter } from '../src/model/booleanEditing';
import {
  applyPlacementPatch,
  canvasItemVisible,
  unlockedSelection,
} from '../src/model/layerEditing';
import { duplicateDragItems } from '../src/model/dragEditing';
import { moveItemToAdjacentCollection } from '../src/model/collectionEditing';
import { insertImportedArtwork } from '../src/model/importedArtwork';
import { applyMergedArtwork, mergeReason } from '../src/model/mergeEditing';
import { mergeArtwork } from '../src/geometry/merge';
import { generateGeometry, getManifoldRuntime } from '../src/geometry/engine';
import { flattenPath, itemPath, placementTransform } from '../src/artwork/paths';
import type {
  Project,
  Selection,
  TemplateData,
  DesignItem,
  GeneratedModel,
} from '../src/model/types';
import type { SimplePolygon } from 'manifold-3d';
import GeometryClient from '../src/geometry/client';

const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
const fontData = readFileSync(new URL('../public/assets/pass-font-core-v1.woff', import.meta.url));
const fontBuffer = fontData.buffer.slice(
  fontData.byteOffset,
  fontData.byteOffset + fontData.byteLength,
) as ArrayBuffer;
const runtime = await getManifoldRuntime();
const cube = runtime.Manifold.cube([50, 100, template.thickness]);
const mesh = cube.getMesh();
const minimal: TemplateData = {
  ...template,
  objects: [
    {
      id: 'base',
      name: 'base',
      role: 'base',
      colorId: 'pink',
      outlinePath: 'M0 0H50V100H0Z',
      positions: Array.from(mesh.vertProperties),
      indices: Array.from(mesh.triVerts),
      bounds: [0, 0, 0, 50, 100, template.thickness],
      height: template.thickness,
    },
  ],
};
cube.delete();
const ref = (collectionId: string, id: string): Selection => ({ kind: 'item', collectionId, id });
const multi = (collectionId: string, ids: string[]): Selection => ({
  kind: 'items',
  items: ids.map((id) => ({ collectionId, id })),
});
function rect(id: string, colorId: string, x: number, y = 30, width = 10, height = 10): DesignItem {
  return { ...newShape(colorId, 'rect'), id, x, y, width, height, rotation: 0 };
}
function design(items: DesignItem[], face: 'front' | 'back' = 'front'): Project {
  const p = createProject(template);
  p.collections = [{ id: 'g', name: 'Test', face, visible: true, thickness: 0.6, items }];
  p.template.label.visible = false;
  for (const d of Object.values(p.template.decorations)) d.visible = false;
  return p;
}
function near(actual: number, expected: number, tolerance = 1e-3) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function area(item: DesignItem, colorId: string) {
  const section = new runtime.CrossSection(
    placementTransform(
      flattenPath(
        itemPath({ ...item, regions: item.regions!.filter((r) => r.colorId === colorId) }),
      ),
      item,
    ) as SimplePolygon[],
    'NonZero',
  );
  const result = section.area();
  section.delete();
  return result;
}
test('the shared worker routes concurrent model/merge results and captures the design before awaiting fonts', async () => {
  const oldWorker = globalThis.Worker,
    oldFetch = globalThis.fetch;
  const requests: Array<{ type: string; id: number; project: Project; selection?: Selection }> = [];
  const resultItem = rect('result', 'white', 1);
  class FakeWorker {
    onmessage?: (event: unknown) => void;
    postMessage(message: (typeof requests)[number]) {
      if (message.type === 'init') return;
      requests.push(message);
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            id: message.id,
            ...(message.type === 'merge' ? { merged: resultItem } : { model: { meshes: [] } }),
          },
        }),
      );
    }
    terminate() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  globalThis.fetch = async () => new Response(new Uint8Array(fontBuffer));
  const client = new GeometryClient(template);
  const p = design([rect('a', 'white', 1), rect('b', 'black', 20)]),
    selection = multi('g', ['a', 'b']);
  p.collections[0].items[0].sourceDataUrl = 'data:image/png;base64,' + 'A'.repeat(100000);
  try {
    const generation = client.generate(p),
      merging = client.merge(p, selection);
    p.collections[0].thickness = 99;
    if (selection?.kind === 'items') selection.items.length = 0;
    const [model, merged] = await Promise.all([generation, merging]);
    assert.equal(model.revision, 1);
    assert.equal(merged.id, resultItem.id);
    assert.equal(requests.find((r) => r.type === 'merge')!.project.collections[0].thickness, 0.6);
    const selected = requests.find((r) => r.type === 'merge')!.selection;
    assert.equal(selected?.kind === 'items' && selected.items.length, 2);
    assert.equal(requests[0].project.collections[0].items[0].sourceDataUrl, undefined);
    assert.ok(p.collections[0].items[0].sourceDataUrl!.length > 100000);
  } finally {
    client.dispose();
    globalThis.Worker = oldWorker;
    globalThis.fetch = oldFetch;
  }
});

function sameVolumes(a: GeneratedModel, b: GeneratedModel) {
  const before = new Map(a.meshes.map((m) => [m.colorId, m.volume])),
    after = new Map(b.meshes.map((m) => [m.colorId, m.volume]));
  assert.deepEqual([...before.keys()].sort(), [...after.keys()].sort());
  for (const [color, volume] of before) near(after.get(color)!, volume);
}

test('item and parent locks remove selection, block stale moves/copies and preserve individual flags after unlocking', () => {
  const a = rect('a', 'white', 10),
    b = rect('b', 'black', 20),
    p = design([a, b]);
  a.locked = true;
  assert.deepEqual(unlockedSelection(p, multi('g', ['a', 'b'])), ref('g', 'b'));
  applyPlacementPatch(p, ref('g', 'a'), { x: 99, y: 99 });
  assert.equal(a.x, 10);
  assert.equal(duplicateDragItems(p, [{ s: ref('g', 'a'), p: { ...a } }]).length, 0);
  p.collections[0].locked = true;
  assert.equal(unlockedSelection(p, multi('g', ['a', 'b'])), null);
  assert.equal(unlockedSelection(p, { kind: 'collection', id: 'g' }), null);
  applyPlacementPatch(p, ref('g', 'b'), { x: 99 });
  assert.equal(b.x, 20);
  p.collections[0].locked = false;
  assert.deepEqual(unlockedSelection(p, multi('g', ['a', 'b'])), ref('g', 'b'));
  applyPlacementPatch(p, ref('g', 'a'), { locked: false });
  applyPlacementPatch(p, ref('g', 'a'), { x: 12 });
  assert.equal(a.x, 12);
});

test('template locks and project round trips remain compatible; malformed locks cannot replace a design', () => {
  const p = createProject(template);
  p.template.label.locked = true;
  p.collections[0].locked = true;
  p.collections[0].items[0].locked = true;
  const saved = validateProject(JSON.parse(JSON.stringify(p)));
  assert.ok(saved.template.label);
  assert.equal(saved.template.label.locked, true);
  assert.equal(saved.collections[0].locked, true);
  assert.equal(unlockedSelection(p, { kind: 'label' }), null);
  const x = p.template.label.x;
  applyPlacementPatch(p, { kind: 'label' }, { x: 90 });
  assert.equal(p.template.label.x, x);
  assert.doesNotThrow(() => validateProject(createProject(template)));
  for (const object of [p.template.label, p.collections[0], p.collections[0].items[0]]) {
    const before = object.locked;
    (object as unknown as { locked: unknown }).locked = 'true';
    assert.throws(() => validateProject(p));
    object.locked = before;
  }
});

test('hiding cutter overlays keeps cuts active; actual visibility still pauses them', () => {
  const target = rect('a', 'white', 10),
    tool = newCutter(target),
    p = design([target, tool]);
  const before = JSON.stringify(p);
  assert.equal(canvasItemVisible(tool, false), false);
  assert.equal(canvasItemVisible(target, false), true);
  assert.equal(activeCutters(p, target.id).length, 1);
  assert.equal(JSON.stringify(p), before);
  tool.visible = false;
  assert.equal(activeCutters(p, target.id).length, 0);
});

test('locked destinations block collection moves and imports without mutating artwork', () => {
  const p = createProject(template),
    source = p.collections[1],
    target = p.collections[0];
  target.locked = true;
  const before = JSON.stringify(p);
  assert.equal(moveItemToAdjacentCollection(p, source.id, source.items[0].id, -1), null);
  assert.throws(() => insertImportedArtwork(p, 'front', newShape(), target.id), /锁定/);
  assert.equal(JSON.stringify(p), before);
});

test('merge preserves colors, bakes only specific cuts and leaves interleaved artwork and external tool targets intact', async () => {
  const a = rect('a', 'white', 15),
    b = rect('b', 'black', 20),
    other = rect('other', 'accent', 15, 35, 1, 1);
  const tool = { ...rect('tool', 'white', 17, 30, 2, 10), cutout: { targetIds: ['a', 'other'] } };
  const p = design([a, other, b, tool]),
    selected = multi('g', ['b', 'a']);
  assert.equal(mergeReason(p, selected), '');
  const before = await generateGeometry(p, minimal, fontBuffer);
  const original = JSON.stringify(p),
    merged = await mergeArtwork(p, selected, fontBuffer);
  assert.equal(JSON.stringify(p), original);
  near(area(merged, 'white'), 29);
  near(area(merged, 'black'), 100);
  const selectedAfter = applyMergedArtwork(p, selected, merged);
  assert.deepEqual(selectedAfter, ref('g', merged.id));
  assert.deepEqual(
    p.collections[0].items.map((i) => i.id),
    ['other', merged.id, 'tool'],
  );
  assert.deepEqual(tool.cutout!.targetIds, ['other']);
  assert.doesNotThrow(() => validateProject(p));
  sameVolumes(before, await generateGeometry(p, minimal, fontBuffer));
});

test('merging artwork bakes reversed clips without cropping unrelated merged layers', async () => {
  const a = rect('a', 'white', 10),
    b = rect('b', 'black', 30);
  const tool = {
    ...rect('keep', 'accent', 12, 30, 6, 10),
    cutout: { targetIds: ['a'], keepInside: true },
  };
  const p = design([a, b, tool]),
    selected = multi('g', ['a', 'b']),
    before = await generateGeometry(p, minimal, fontBuffer);
  const merged = await mergeArtwork(p, selected, fontBuffer);
  near(area(merged, 'white'), 60);
  near(area(merged, 'black'), 100);
  applyMergedArtwork(p, selected, merged);
  assert.deepEqual(tool.cutout, { targetIds: [], keepInside: true });
  sameVolumes(before, await generateGeometry(p, minimal, fontBuffer));
});

test('reversed tool merges retain their common window; mixed directions and disjoint keep shapes are rejected', async () => {
  const target = rect('target', 'white', 10);
  const a = {
    ...rect('keep-a', 'white', 11, 30, 6, 10),
    cutout: { targetIds: ['target'], keepInside: true },
  };
  const b = {
    ...rect('keep-b', 'black', 14, 30, 6, 10),
    cutout: { targetIds: ['target'], keepInside: true },
  };
  const p = design([target, a, b]),
    selected = multi('g', ['keep-a', 'keep-b']);
  b.cutout.keepInside = false;
  assert.match(mergeReason(p, selected), /裁切方向/);
  b.cutout.keepInside = true;
  const before = await generateGeometry(p, minimal, fontBuffer),
    merged = await mergeArtwork(p, selected, fontBuffer);
  near(area(merged, 'black'), 30);
  assert.equal(
    merged.regions!.some((region) => region.colorId === 'white'),
    false,
  );
  assert.deepEqual(merged.cutout, { targetIds: ['target'], keepInside: true });
  applyMergedArtwork(p, selected, merged);
  sameVolumes(before, await generateGeometry(p, minimal, fontBuffer));
  const disjoint = design([target, a, { ...b, x: 30 }]);
  await assert.rejects(mergeArtwork(disjoint, selected, fontBuffer), /共同重叠/);
});

test('non-covering and avoiding merges retain earlier colors and physical volumes', async () => {
  for (const options of [
    { coversLower: false, avoidsLower: false },
    { coversLower: true, avoidsLower: true },
  ]) {
    const a = { ...rect('a', 'white', 15), ...options },
      b = { ...rect('b', 'black', 20), ...options };
    const p = design([a, b]);
    p.collections.unshift({
      id: 'lower',
      name: '',
      face: 'front',
      visible: true,
      thickness: 0.4,
      items: [rect('lower-art', 'accent', 12)],
    });
    const before = await generateGeometry(p, minimal, fontBuffer);
    const merged = await mergeArtwork(p, multi('g', ['a', 'b']), fontBuffer);
    near(area(merged, 'white'), 100);
    near(area(merged, 'black'), 50);
    applyMergedArtwork(p, multi('g', ['a', 'b']), merged);
    sameVolumes(before, await generateGeometry(p, minimal, fontBuffer));
  }
});

test('back merges keep editor coordinates and fixed depth; rotated outlined text remains printable', async () => {
  const a = { ...rect('a', 'white', 9, 24, 5, 3), rotation: 90 };
  const b = { ...rect('b', 'black', 25, 38, 8, 4), kind: 'text' as const, text: 'AB' };
  const p = design([a, b], 'back'),
    before = await generateGeometry(p, minimal, fontBuffer);
  const merged = await mergeArtwork(p, multi('g', ['a', 'b']), fontBuffer);
  assert.equal(merged.rotation, 0);
  assert.ok(merged.x < 12);
  assert.ok(merged.regions!.some((r) => r.colorId === 'black'));
  applyMergedArtwork(p, multi('g', ['a', 'b']), merged);
  sameVolumes(before, await generateGeometry(p, minimal, fontBuffer));
});

test('merge refuses incompatible uses/settings/heights and combines tools only with identical target sets', async () => {
  const a = rect('a', 'white', 10),
    b = rect('b', 'black', 20),
    p = design([a, b]),
    selected = multi('g', ['a', 'b']);
  b.coversLower = false;
  assert.match(mergeReason(p, selected), /覆盖/);
  b.coversLower = true;
  b.locked = true;
  assert.match(mergeReason(p, selected), /解锁/);
  b.locked = false;
  b.cutout = { targetIds: ['a'] };
  assert.match(mergeReason(p, selected), /混合/);
  a.cutout = { targetIds: ['outside'] };
  assert.match(mergeReason(p, selected), /相同/);
  a.cutout = { targetIds: ['outside'] };
  b.cutout = { targetIds: ['outside'] };
  const tool = await mergeArtwork(p, selected, fontBuffer);
  assert.deepEqual(tool.cutout!.targetIds, ['outside']);
  near(area(tool, 'white') + area(tool, 'black'), 200);
  p.collections.push({
    id: 'other',
    name: '',
    face: 'front',
    visible: true,
    thickness: 0.9,
    items: [rect('c', 'white', 1)],
  });
  assert.match(
    mergeReason(p, {
      kind: 'items',
      items: [
        { collectionId: 'g', id: 'a' },
        { collectionId: 'other', id: 'c' },
      ],
    }),
    /同一集合/,
  );
});

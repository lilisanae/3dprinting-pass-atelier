import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  alignPlacements,
  placementBounds,
  selectedItems,
  selectionEntries,
  toggleItemSelection,
} from '../src/model/selection';
import { createProject, cumulativeHeights, validateProject } from '../src/model/project';
import type { Selection, TemplateData } from '../src/model/types';

const template: TemplateData = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
);
const a = { id: 'a', x: 10, y: 20, width: 4, height: 10, rotation: 0 };
const b = { id: 'b', x: 30, y: 50, width: 6, height: 10, rotation: 0 };
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('nonadjacent items across collections toggle independently and stale references are ignored', () => {
  const project = createProject(template);
  const first = { collectionId: project.collections[0].id, id: project.collections[0].items[0].id };
  const second = {
    collectionId: project.collections[1].id,
    id: project.collections[1].items[2].id,
  };
  let selection: Selection = toggleItemSelection(null, first, false);
  selection = toggleItemSelection(selection, second, true);
  assert.equal(selectedItems(project, selection).length, 2);
  assert.deepEqual(selectionEntries(selection), [first, second]);
  const removed = structuredClone(project);
  removed.collections[0].items = [];
  assert.deepEqual(
    selectedItems(removed, selection).map((entry) => entry.id),
    [second.id],
  );
  selection = toggleItemSelection(selection, first, true);
  assert.deepEqual(selection, { kind: 'item', ...second });
  assert.equal(toggleItemSelection(selection, second, true), null);
});

test('board edge and custom point alignment move the group while preserving offsets', () => {
  const left = alignPlacements([a, b], {
    reference: 'board',
    width: 50,
    height: 100,
    alignment: 'left',
  });
  assert.deepEqual(left, [
    { id: 'a', x: 0, y: 20 },
    { id: 'b', x: 20, y: 50 },
  ]);
  const middle = alignPlacements([a, b], {
    reference: 'board',
    width: 50,
    height: 100,
    alignment: 'center',
  });
  assert.deepEqual(middle, [
    { id: 'a', x: 12, y: 30 },
    { id: 'b', x: 32, y: 60 },
  ]);
  const point = alignPlacements([a, b], {
    reference: 'point',
    width: 50,
    height: 100,
    point: { x: 7, y: 9 },
    alignment: 'topLeft',
  });
  assert.deepEqual(point, [
    { id: 'a', x: 7, y: 9 },
    { id: 'b', x: 27, y: 39 },
  ]);
});

test('last-selected alignment preserves the key object and uses rotated edge bounds', () => {
  const rotated = { ...a, rotation: 90 };
  const bounds = placementBounds(rotated);
  bounds.forEach((value, index) => close(value, [7, 23, 17, 27][index]));
  const result = alignPlacements([rotated, b], {
    reference: 'last',
    width: 50,
    height: 100,
    alignment: 'right',
  });
  close(result[0].x, 29);
  close(result[0].y, 20);
  assert.deepEqual(result[1], { id: 'b', x: 30, y: 50 });
  const centered = alignPlacements([rotated, b], {
    reference: 'last',
    width: 50,
    height: 100,
    alignment: 'centerY',
  });
  close(centered[0].x, 10);
  close(centered[0].y, 50);
});

test('legacy projects gain matching face colors; background collections never add raised height', () => {
  const old = createProject(template);
  delete old.template.frontColorId;
  delete old.template.backColorId;
  old.template.baseColorId = 'accent';
  const imported = validateProject(old);
  assert.equal(imported.template.frontColorId, 'accent');
  assert.equal(imported.template.backColorId, 'accent');
  assert.deepEqual(imported.collections, old.collections);
  imported.collections[0].mode = 'background';
  imported.collections[1].items[0].coversLower = false;
  const restored = validateProject(JSON.parse(JSON.stringify(imported)));
  assert.equal(restored.collections[1].items[0].coversLower, false);
  const heights = cumulativeHeights(restored.collections);
  assert.equal(heights[restored.collections[0].id], undefined);
  // The current raised default is 0.4 mm; the background adds no raised height.
  assert.equal(heights[restored.collections[1].id], 0.4);
  restored.collections[1].items[0].coversLower = 'no' as unknown as boolean;
  assert.throws(() => validateProject(restored), /覆盖/);
});

test('legacy cut-outs migrate to avoidance; new non-covering designs survive repeated save and import', () => {
  const old = createProject(template);
  const i = old.collections[1].items[0];
  i.coversLower = false;
  delete i.avoidsLower;
  const migrated = validateProject(old);
  assert.equal(migrated.collections[1].items[0].avoidsLower, true);
  assert.equal(i.avoidsLower, undefined, 'validation must not modify its input');
  migrated.collections[1].items[0].avoidsLower = false;
  const restored = validateProject(JSON.parse(JSON.stringify(migrated)));
  assert.equal(restored.collections[1].items[0].coversLower, false);
  assert.equal(restored.collections[1].items[0].avoidsLower, false);
  restored.collections[1].items[0].avoidsLower = 'no' as unknown as boolean;
  assert.throws(() => validateProject(restored), /避让/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, newCollection, cumulativeHeights } from '../src/model/project';
import {
  adjacentCollection,
  faceCollections,
  moveItemToAdjacentCollection,
} from '../src/model/collectionEditing';
import type { DesignItem, TemplateData } from '../src/model/types';
const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
function fixture() {
  const p = createProject(template),
    lower = newCollection('front'),
    upper = newCollection('front'),
    back = newCollection('back'),
    background = newCollection('front');
  background.mode = 'background';
  lower.thickness = 0.4;
  upper.thickness = 0.9;
  const item: DesignItem = {
    id: 'moving',
    name: '保持原图',
    kind: 'paths',
    visible: true,
    x: -2.413,
    y: 18.117,
    width: 12.715,
    height: 8.19,
    rotation: 28,
    colorId: 'white',
    coversLower: false,
    regions: [{ path: 'M0 0H10V8H0Z', colorId: 'white' }],
    sourceWidth: 10,
    sourceHeight: 8,
    sourceDataUrl: 'data:image/svg+xml,test',
  };
  lower.items.push(item);
  p.collections = [lower, back, background, upper];
  return { p, lower, upper, back, background, item };
}
test('adjacent moves preserve complete artwork and all collection heights, with a valid new selection', () => {
  const { p, lower, upper, item } = fixture(),
    before = structuredClone(item),
    heights = cumulativeHeights(p.collections);
  assert.deepEqual(moveItemToAdjacentCollection(p, lower.id, item.id, 1), {
    kind: 'item',
    collectionId: upper.id,
    id: item.id,
  });
  assert.equal(lower.items.length, 0);
  assert.deepEqual(upper.items[0], before);
  assert.deepEqual(cumulativeHeights(p.collections), heights);
  assert.deepEqual(moveItemToAdjacentCollection(p, upper.id, item.id, -1), {
    kind: 'item',
    collectionId: lower.id,
    id: item.id,
  });
  assert.deepEqual(lower.items[0], before);
});
test('displayed ordering respects front background depth and never moves across faces', () => {
  const { p, lower, upper, back, background, item } = fixture();
  assert.deepEqual(
    faceCollections(p, 'front').map((c) => c.id),
    [upper.id, lower.id, background.id],
  );
  assert.equal(adjacentCollection(p, lower.id, -1)?.id, background.id);
  assert.equal(adjacentCollection(p, lower.id, 1)?.id, upper.id);
  assert.equal(adjacentCollection(p, upper.id, 1), undefined);
  assert.equal(adjacentCollection(p, background.id, -1), undefined);
  assert.deepEqual(
    p.collections.map((c) => c.id),
    [lower.id, back.id, background.id, upper.id],
  );
  assert.deepEqual(
    faceCollections(p, 'back').map((c) => c.id),
    [back.id],
  );
  moveItemToAdjacentCollection(p, lower.id, item.id, -1);
  assert.equal(background.items[0].id, item.id);
  assert.equal(back.items.length, 0);
});
test('boundaries and stale items leave project data untouched; hidden destinations retain their visibility', () => {
  const { p, lower, upper, background, item } = fixture();
  const before = structuredClone(p);
  assert.equal(moveItemToAdjacentCollection(p, background.id, item.id, -1), null);
  assert.equal(moveItemToAdjacentCollection(p, upper.id, 'missing', -1), null);
  assert.equal(moveItemToAdjacentCollection(p, upper.id, item.id, 1), null);
  assert.deepEqual(p, before);
  upper.visible = false;
  moveItemToAdjacentCollection(p, lower.id, item.id, 1);
  assert.equal(upper.visible, false);
  assert.equal(upper.items[0].visible, true);
});

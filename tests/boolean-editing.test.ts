import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, validateProject } from '../src/model/project';
import {
  activeCutters,
  copyArtwork,
  newCutter,
  pruneCutTargets,
} from '../src/model/booleanEditing';
import type { TemplateData } from '../src/model/types';

const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;

test('tools save their specific targets; invalid targets cannot replace a design', () => {
  const p = createProject(template),
    target = p.collections[1].items[0],
    tool = newCutter(target);
  p.collections[1].items.push(tool);
  assert.deepEqual(
    validateProject(JSON.parse(JSON.stringify(p))).collections[1].items.at(-1)!.cutout,
    { targetIds: [target.id] },
  );
  for (const id of [tool.id, 'missing', p.collections[2].items[0].id]) {
    tool.cutout!.targetIds = [id];
    assert.throws(() => validateProject(p), /切割目标/);
  }
});

test('copying related artwork follows the copied target; deletion cleans only missing references', () => {
  const p = createProject(template),
    target = p.collections[1].items[0],
    other = p.collections[1].items[1],
    tool = newCutter(target);
  tool.cutout!.targetIds.push(other.id);
  p.collections[1].items.push(tool);
  const [targetCopy, toolCopy] = copyArtwork([target, tool]);
  assert.deepEqual(toolCopy.cutout!.targetIds, [targetCopy.id, other.id]);
  p.collections[1].items = p.collections[1].items.filter((i) => i.id !== target.id);
  pruneCutTargets(p);
  assert.deepEqual(tool.cutout!.targetIds, [other.id]);
  assert.doesNotThrow(() => validateProject(p));
  assert.equal(activeCutters(p, other.id).length, 1);
  tool.visible = false;
  assert.equal(activeCutters(p, other.id).length, 0);
});

test('reversed cutters keep their direction through save, copy and reference cleanup; legacy defaults remain subtractive', () => {
  const p = createProject(template),
    target = p.collections[1].items[0],
    tool = newCutter(target);
  assert.equal(tool.cutout!.keepInside, undefined);
  tool.cutout!.keepInside = true;
  p.collections[1].items.push(tool);
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.collections[1].items.at(-1)!.cutout!.keepInside, true);
  const [copy, cutterCopy] = copyArtwork([target, tool]);
  assert.deepEqual(cutterCopy.cutout, { targetIds: [copy.id], keepInside: true });
  p.collections[1].items = p.collections[1].items.filter((i) => i.id !== target.id);
  pruneCutTargets(p);
  assert.deepEqual(tool.cutout, { targetIds: [], keepInside: true });
  for (const keepInside of ['true', 1, null]) {
    const bad = JSON.parse(JSON.stringify(p));
    bad.collections[1].items.at(-1).cutout.keepInside = keepInside;
    assert.throws(() => validateProject(bad));
  }
});

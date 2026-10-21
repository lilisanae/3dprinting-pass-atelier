import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBadgeProject, setBadgeLayer } from '../src/model/badge';
import { createBlankProject, collectionInlayDepth, newShape } from '../src/model/project';
import { insertImportedArtwork } from '../src/model/importedArtwork';
import {
  loadBrowserProgress,
  PROGRESS_KEY,
  WORKSHOP_PROGRESS_KEYS,
} from '../src/io/browserProgress';
import { workshopFromLocation, workshopHref } from '../src/model/workshop';
const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
);
const pass = createBlankProject(template, 'minimal'),
  badge = createBadgeProject();
const record = (project: typeof pass) => ({
  version: 1,
  json: JSON.stringify(project),
  savedAt: 1,
});
function storage(records: Record<string, unknown>) {
  let legacyReads = 0;
  return {
    read: async <T>(key: string) => records[key] as T | undefined,
    legacy: async () => {
      legacyReads++;
      return undefined;
    },
    get legacyReads() {
      return legacyReads;
    },
  };
}
test('public entrances, aliases and standalone query identify the intended workshop', () => {
  for (const pathname of ['/badge/', '/atelier/badge/'])
    assert.equal(workshopFromLocation({ pathname, search: '' }), 'badge');
  assert.equal(workshopFromLocation({ pathname: '/', search: '?workshop=badge' }), 'badge');
  assert.equal(workshopFromLocation({ pathname: '/pass/', search: '' }), 'pass');
  assert.equal(workshopFromLocation({ pathname: '/badge-other/', search: '' }), 'pass');
  assert.equal(workshopHref('badge', { hostname: 'beatsanae.cn', pathname: '/pass/' }), '/badge/');
  assert.equal(
    workshopHref('badge', { hostname: 'pass.beatsanae.cn', pathname: '/' }),
    '/?workshop=badge',
  );
});
test('each workshop restores only its own progress without consuming the previous shared record', async () => {
  for (const [kind, project] of [
    ['pass', pass],
    ['badge', badge],
  ] as const) {
    const shared = record(project),
      data = { [PROGRESS_KEY]: shared },
      source = storage(data);
    assert.deepEqual(await loadBrowserProgress(template, kind, source), {
      project,
      migrated: true,
    });
    const other = kind === 'pass' ? 'badge' : 'pass';
    assert.deepEqual(await loadBrowserProgress(template, other, source), {});
    assert.deepEqual(data, { [PROGRESS_KEY]: shared });
  }
});
test('dedicated progress wins; badges skip old pass recovery and wrong or corrupt records remain protected', async () => {
  const source = storage({
    [PROGRESS_KEY]: record(pass),
    [WORKSHOP_PROGRESS_KEYS.badge]: record(badge),
  });
  assert.deepEqual(await loadBrowserProgress(template, 'badge', source), { project: badge });
  assert.equal(source.legacyReads, 0);
  for (const value of [record(pass), { version: 1, json: 'bad', savedAt: 1 }]) {
    const result = await loadBrowserProgress(
      template,
      'badge',
      storage({ [WORKSHOP_PROGRESS_KEYS.badge]: value }),
    );
    assert.ok(result.error);
    assert.equal(result.project, undefined);
  }
});

test('the first back import in a badge inherits its background layer through later thickness edits', () => {
  const p = createBadgeProject();
  p.badgeBase = setBadgeLayer(p.badgeBase!, 'back', 0.2);
  p.collections = [];
  insertImportedArtwork(p, 'back', newShape('black'));
  assert.equal(p.collections[0].inlayDepth, undefined);
  assert.equal(collectionInlayDepth(p.collections[0], p), 0.2);
  p.badgeBase = setBadgeLayer(p.badgeBase, 'back', 1);
  assert.equal(collectionInlayDepth(p.collections[0], p), 1);
});

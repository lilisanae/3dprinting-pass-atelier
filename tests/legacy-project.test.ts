import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject } from '../src/model/project';
import { createLegacyRecovery } from '../src/model/legacyProject';
import { warnBeforeUnload } from '../src/ui/unsavedChanges';
import type { Project, TemplateData } from '../src/model/types';

const template = JSON.parse(readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8')) as TemplateData;
const key = 'pass-atelier-project-v1';
test('legacy recovery selects the latest valid design and preserves embedded fonts', async () => {
  const old = createProject(template), newer = { ...old, name: '旧字体项目', fonts: [{ id: 'custom-font', name: '本地字体', dataUrl: 'data:font/otf;base64,AQID' }] };
  const values = new Map([[key, JSON.stringify(old)]]);
  const local = { getItem: (name: string) => values.get(name) ?? null } as Storage;
  let record: { project: Project; savedAt: number } | undefined = { project: newer, savedAt: 5 };
  const recovery = createLegacyRecovery({ local: () => local, read: async () => record, clear: async () => {} });
  assert.deepEqual((await recovery.read())?.fonts, newer.fonts);
  record = undefined;
  assert.equal((await recovery.read())?.name, old.name);
  values.clear(); assert.equal(await recovery.read(), undefined);
  assert.equal('save' in recovery, false);
});
test('explicit removal clears only design records; close warning performs no storage deletion', async () => {
  const values = new Map([[key, 'old'], [`${key}-saved-at`, '5'], ['theme', 'dark'], ['other-app', 'keep']]);
  let dbCleared = false, prevented = false;
  const recovery = createLegacyRecovery({
    local: () => ({ removeItem: (name: string) => values.delete(name) }) as unknown as Storage,
    read: async () => undefined, clear: async () => { dbCleared = true; },
  });
  const event = { preventDefault() { prevented = true; }, returnValue: false };
  warnBeforeUnload(event as unknown as BeforeUnloadEvent);
  assert.ok(prevented); assert.equal(event.returnValue, true); assert.ok(values.has(key));
  await recovery.clear();
  assert.ok(dbCleared); assert.deepEqual([...values.keys()], ['theme', 'other-app']);
});

import { readProjectRecord, deleteProjectRecord } from '../io/projectStorage';
import { validateProject } from './project';
import type { Project } from './types';

const KEY = 'pass-atelier-project-v1';
const TIME = `${KEY}-saved-at`;
type SavedRecord = { project: Project; savedAt: number };
const readRecord = () => readProjectRecord<SavedRecord>(KEY);
const clearRecord = () => deleteProjectRecord(KEY);
/** Compatibility reader for old snapshots; new compact progress uses a separate key. */
export function createLegacyRecovery(deps: {
  local: () => Storage;
  read: () => Promise<SavedRecord | undefined>;
  clear: () => Promise<void>;
}) {
  return {
    async read(): Promise<Project | undefined> {
      const candidates: SavedRecord[] = [];
      try {
        const record = await deps.read();
        if (record) candidates.push(record);
      } catch {}
      try {
        const text = deps.local().getItem(KEY);
        if (text)
          candidates.push({
            project: JSON.parse(text),
            savedAt: Number(deps.local().getItem(TIME)) || 0,
          });
      } catch {}
      for (const record of candidates.sort((a, b) => b.savedAt - a.savedAt)) {
        try {
          return validateProject(record.project);
        } catch {}
      }
    },
    async clear() {
      deps.local().removeItem(KEY);
      deps.local().removeItem(TIME);
      await deps.clear();
    },
  };
}
export const legacyRecovery = createLegacyRecovery({
  local: () => localStorage,
  read: readRecord,
  clear: clearRecord,
});

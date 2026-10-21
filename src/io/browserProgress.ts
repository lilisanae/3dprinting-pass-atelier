import { serializeProject } from './projectFile';
import { readProjectRecord, writeProjectRecord } from './projectStorage';
import { validateProject } from '../model/project';
import type { Project, TemplateData } from '../model/types';
import { projectWorkshop, type WorkshopKind } from '../model/workshop';

// A separate key keeps the old recovery copy available until explicitly cleared.
export const PROGRESS_KEY = 'pass-atelier-progress-v1';
export const WORKSHOP_PROGRESS_KEYS = {
  pass: 'pass-atelier-pass-progress-v1',
  badge: 'badge-atelier-progress-v1',
};
type ProgressRecord = { version: 1; json: string; savedAt: number };
export type BrowserProgress = { project?: Project; migrated?: boolean; error?: string };

type ProgressStorage = {
  read: typeof readProjectRecord;
  legacy: () => Promise<Project | undefined>;
};
export async function loadBrowserProgress(
  template: TemplateData,
  kind: WorkshopKind = 'pass',
  storage: ProgressStorage = {
    read: readProjectRecord,
    legacy: async () => (await import('../model/legacyProject')).legacyRecovery.read(),
  },
): Promise<BrowserProgress> {
  try {
    const parse = (record: ProgressRecord) => {
      if (record.version !== 1 || typeof record.json !== 'string')
        throw new Error('本地进度格式无效');
      const project = validateProject(JSON.parse(record.json));
      if (project.format !== 'badge-atelier' && project.templateVersion !== template.version)
        throw new Error('本地进度与底板模板不匹配');
      return project;
    };
    const record = await storage.read<ProgressRecord>(WORKSHOP_PROGRESS_KEYS[kind]);
    if (record) {
      const project = parse(record);
      if (projectWorkshop(project) !== kind) throw new Error('本地进度类型与当前工坊不匹配');
      return { project };
    }
    // Copy on first save, never delete or overwrite the previous shared record.
    const shared = await storage.read<ProgressRecord>(PROGRESS_KEY);
    if (shared) {
      const project = parse(shared);
      if (projectWorkshop(project) === kind) return { project, migrated: true };
    }
    if (kind === 'badge') return {};
    const previous = await storage.legacy();
    if (previous) {
      if (previous.templateVersion !== template.version) throw new Error('旧设计与底板模板不匹配');
      return { project: validateProject(JSON.parse(serializeProject(previous))), migrated: true };
    }
    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '本地进度暂时无法读取，请下载项目备份。',
    };
  }
}

export async function saveBrowserProgress(
  json: string,
  kind: WorkshopKind = 'pass',
): Promise<void> {
  await writeProjectRecord(WORKSHOP_PROGRESS_KEYS[kind], {
    version: 1,
    json,
    savedAt: Date.now(),
  } satisfies ProgressRecord);
}

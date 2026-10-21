import { downloadBuffer } from '../io/download';
import { validateProject } from './project';
import type { Project, TemplateData } from './types';

export const isStarterProject = (project: Project) =>
  project.collections.some((c) => c.id === 'starter-front-base');

/** Use this case when no saved browser progress is available. */
export async function loadStarterProject(template: TemplateData): Promise<Project> {
  const buffer = await downloadBuffer(
    new URL('../presets/first-pass.json', import.meta.url).href,
    '案例预设',
  );
  const project = validateProject(JSON.parse(new TextDecoder().decode(buffer)));
  if (project.templateVersion !== template.version) throw new Error('案例与底板模板版本不匹配。');
  return project;
}

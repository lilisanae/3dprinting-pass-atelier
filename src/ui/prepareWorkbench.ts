import { loadTemplate } from '../model/project';
import { loadStarterProject } from '../model/starterProject';
import { loadProjectFont, loadFontBuffer } from '../artwork/font-loader';
import type { TextFont } from '../artwork/font-pack';
import type { Project, TemplateData } from '../model/types';
import { loadBrowserProgress, type BrowserProgress } from '../io/browserProgress';
import { waitForWorkshopCache } from '../io/workshopCache';
import { createBadgeProject } from '../model/badge';
import type { WorkshopKind } from '../model/workshop';

export const preparationSteps = ['读取模板与设计', '准备文字字库'];
export type PreparationProgress = { percent: number; fractions: number[]; detail: string };
export type PreparedWorkbench = {
  template: TemplateData;
  project: Project;
  font: TextFont;
  localProgress?: BrowserProgress;
};
type Dependencies = {
  template: typeof loadTemplate;
  restore: (template: TemplateData) => Project | Promise<Project>;
  font: typeof loadProjectFont;
};

export async function prepareWorkbench(
  report: (p: PreparationProgress) => void,
  cancelled: () => boolean = () => false,
  overrides: Partial<Dependencies> = {},
  kind: WorkshopKind = 'pass',
): Promise<PreparedWorkbench> {
  const deps: Dependencies = {
    template: loadTemplate,
    font: loadProjectFont,
    restore: kind === 'badge' ? createBadgeProject : loadStarterProject,
    ...overrides,
  };
  const fractions = [0, 0],
    weights = [30, 70];
  let failed = false;
  const update = (index: number, fraction: number, detail: string) => {
    if (failed || cancelled()) return;
    fractions[index] = Math.max(fractions[index], Math.min(1, fraction));
    report({
      percent: Math.floor(fractions.reduce((sum, value, i) => sum + value * weights[i], 0)),
      fractions: [...fractions],
      detail,
    });
  };
  update(0, 0, '正在读取模板与本地进度…');
  // Best effort: let an already-installed worker claim the page before the
  // first template/font requests, but never hold opening for long.
  if (!overrides.template) await waitForWorkshopCache();
  // Only assets needed to draw and edit belong on the opening path.
  if (!overrides.font) void loadFontBuffer('').catch(() => {});
  const template = await deps.template();
  if (cancelled()) throw new Error('准备已取消。');
  const localProgress = overrides.restore ? undefined : await loadBrowserProgress(template, kind);
  const project = localProgress?.project ?? (await deps.restore(template));
  update(0, 1, '正在准备文字字库…');
  try {
    const font = await deps.font(project, (p) => {
      const amount = `${Math.round(p.loaded / 1024)} / ${Math.round(p.total / 1024)} KB`;
      const detail =
        p.source === 'cache'
          ? `正在读取本机字库 · ${amount}`
          : p.source === 'network'
             ? `正在读取字库 · ${amount}`
            : `正在准备文字字库 · ${amount}`;
      update(1, p.total ? (p.loaded / p.total) * 0.95 : 0, detail);
    });
    if (cancelled()) throw new Error('准备已取消。');
    update(1, 1, '可以开始编辑，实体将在后台准备。');
    return { template, project, font, ...(localProgress ? { localProgress } : {}) };
  } catch (error) {
    failed = true;
    throw error;
  }
}

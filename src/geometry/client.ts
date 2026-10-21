import type { BadgeBase } from '../model/badge';
import type { ShapeAppearance } from '../model/shapeCatalog';
import type {
  ColorInspection,
  DesignItem,
  GeneratedModel,
  Project,
  Selection,
} from '../model/types';
import { loadTemplate } from '../model/project';
import { loadProjectFontBuffer } from '../artwork/font-loader';
import { createBadgeProject, type BadgeVectorShape, type BadgeOutlineResult } from '../model/badge';

type Pending = {
  resolve: (result: {
    model?: GeneratedModel;
    merged?: DesignItem;
    colorInspection?: ColorInspection;
    badgeOutline?: BadgeOutlineResult;
    styledBadgeBase?: BadgeBase;
  }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
/** One worker serializes WASM access; request ids isolate every revision. */
export class GeometryClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private revision = 0;
  private disposed = false;
  private workerError: Error | undefined;
  private ready: Promise<void>;
  private template: Awaited<ReturnType<typeof loadTemplate>> | undefined;
  private fontBuffer: ArrayBuffer | undefined;
  constructor(
    initialTemplate?: Awaited<ReturnType<typeof loadTemplate>>,
    private jobTimeoutMs = 90000,
  ) {
    this.worker = this.startWorker();
    this.ready = (initialTemplate ? Promise.resolve(initialTemplate) : loadTemplate()).then(
      (template) => {
        if (this.disposed) throw new Error('几何计算已关闭。');
        this.template = template;
      },
    );
    this.ready.catch(() => {});
  }
  private startWorker(): Worker {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        model?: GeneratedModel;
        merged?: DesignItem;
        colorInspection?: ColorInspection;
        badgeOutline?: BadgeOutlineResult;
        styledBadgeBase?: BadgeBase;
        error?: string;
      }>,
    ) => {
      const { id, model, merged, colorInspection, badgeOutline, styledBadgeBase, error } =
        event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else if (model) pending.resolve({ model: { ...model, revision: id } });
      else if (merged) pending.resolve({ merged });
      else if (colorInspection) pending.resolve({ colorInspection });
      else if (badgeOutline) pending.resolve({ badgeOutline });
      else if (styledBadgeBase) pending.resolve({ styledBadgeBase });
      else pending.reject(new Error('几何计算返回了无效结果，请重试。'));
    };
    const workerFailed = () => {
      this.workerError = new Error('几何计算进程出错，请刷新页面。');
      this.failAll(this.workerError);
    };
    worker.onerror = workerFailed;
    worker.onmessageerror = workerFailed;
    return worker;
  }
  async generate(project: Project): Promise<GeneratedModel> {
    const result = await this.request(project, 'generate');
    if (!result.model) throw new Error('实体生成结果无效。');
    return result.model;
  }
  async merge(project: Project, selection: Selection): Promise<DesignItem> {
    const result = await this.request(project, 'merge', selection);
    if (!result.merged) throw new Error('图层合并结果无效。');
    return result.merged;
  }
  async inspectColors(project: Project, inspectionWidth: number): Promise<ColorInspection> {
    const result = await this.request(project, 'inspectColors', undefined, inspectionWidth);
    if (!result.colorInspection) throw new Error('细小色块检查结果无效。');
    return result.colorInspection;
  }
  private async request(
    project: Project,
    type: 'generate' | 'merge' | 'inspectColors' | 'badgeOutline' | 'badgeAppearance',
    selection?: Selection,
    inspectionWidth?: number,
    badgeShapes?: BadgeVectorShape[],
    badgeAppearance?: ShapeAppearance,
  ): Promise<{
    model?: GeneratedModel;
    merged?: DesignItem;
    colorInspection?: ColorInspection;
    badgeOutline?: BadgeOutlineResult;
    styledBadgeBase?: BadgeBase;
  }> {
    if (this.disposed) throw new Error('几何计算已关闭。');
    const id = ++this.revision;
    // Capture before assets load so later editor changes cannot mutate this job.
    // Raster sources are retained in saves; geometry uses only their vector outlines.
    const fonts = project.fonts?.map((font) => ({ ...font }));
    const snapshot = structuredClone({
      ...project,
      fonts: undefined,
      collections: project.collections.map((c) => ({
        ...c,
        items: c.items.map(({ sourceDataUrl: _source, ...item }) => item),
      })),
    });
    const selected = structuredClone(selection);
    await this.ready;
    const fontBuffer = await loadProjectFontBuffer({ ...snapshot, fonts });
    // Fonts are already in the binary bundle; avoid cloning embedded files on every job.
    delete snapshot.fonts;
    if (this.disposed) throw new Error('几何计算已关闭。');
    if (this.workerError) {
      this.worker.terminate();
      this.worker = this.startWorker();
      this.workerError = undefined;
      this.fontBuffer = undefined;
    }
    if (fontBuffer !== this.fontBuffer) {
      const copy = fontBuffer.slice(0);
      this.worker.postMessage({ type: 'init', template: this.template, fontBuffer: copy }, [copy]);
      this.fontBuffer = fontBuffer;
    }
    return new Promise<{
      model?: GeneratedModel;
      merged?: DesignItem;
      colorInspection?: ColorInspection;
      badgeOutline?: BadgeOutlineResult;
      styledBadgeBase?: BadgeBase;
    }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.workerError = new Error('生成引擎暂时没有响应，请点击重试。设计已保留。');
        this.worker.terminate();
        this.failAll(this.workerError);
      }, this.jobTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({
        type,
        id,
        project: snapshot,
        selection: selected,
        inspectionWidth,
        badgeShapes,
        badgeAppearance,
      });
    });
  }
  private failAll(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  async normalizeBadgeOutline(shapes: BadgeVectorShape[]) {
    const result = await this.request(
      createBadgeProject(),
      'badgeOutline',
      undefined,
      undefined,
      shapes,
    );
    if (!result.badgeOutline) throw new Error('底板轮廓解析失败。');
    return result.badgeOutline;
  }
  async styleBadgeBase(base: BadgeBase, appearance: ShapeAppearance) {
    const result = await this.request(
      { ...createBadgeProject(), badgeBase: base },
      'badgeAppearance',
      undefined,
      undefined,
      undefined,
      appearance,
    );
    if (!result.styledBadgeBase) throw new Error('底板描边生成失败。');
    return result.styledBadgeBase;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error('几何计算已关闭。'));
  }
}
export default GeometryClient;

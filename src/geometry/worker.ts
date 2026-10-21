import { styleBadgeBase } from './badgeAppearance';
import type { ShapeAppearance } from '../model/shapeCatalog';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { configureManifold, generateGeometry } from './engine';
import type { Project, Selection, TemplateData } from '../model/types';
import { mergeArtwork } from './merge';
import { normalizeBadgeOutline } from './badgeOutline';
import type { BadgeVectorShape } from '../model/badge';
configureManifold(new URL(wasmUrl, import.meta.url).href);
let template: TemplateData | undefined, fontBuffer: ArrayBuffer | undefined;
let queue = Promise.resolve();
self.onmessage = (
  event: MessageEvent<{
    type: 'init' | 'generate' | 'merge' | 'inspectColors' | 'badgeOutline' | 'badgeAppearance';
    id: number;
    project: Project;
    template: TemplateData;
    fontBuffer: ArrayBuffer;
    selection: Selection;
    inspectionWidth?: number;
    badgeShapes?: BadgeVectorShape[];
    badgeAppearance?: ShapeAppearance;
  }>,
) => {
  const message = event.data;
  if (message.type === 'init') {
    template = message.template;
    fontBuffer = message.fontBuffer;
    return;
  }
  const jobTemplate = template,
    jobFont = fontBuffer;
  queue = queue.then(async () => {
    try {
      if (message.type === 'badgeAppearance') {
        if (!message.project.badgeBase || !message.badgeAppearance)
          throw new Error('底板描边参数无效。');
        const styledBadgeBase = await styleBadgeBase(
          message.project.badgeBase,
          message.badgeAppearance,
        );
        self.postMessage({ id: message.id, styledBadgeBase });
        return;
      }
      if (message.type === 'badgeOutline') {
        const badgeOutline = await normalizeBadgeOutline(message.badgeShapes ?? []);
        self.postMessage({ id: message.id, badgeOutline });
        return;
      }
      if (!jobTemplate || !jobFont) throw new Error('模板与字体尚未加载。');
      if (message.type === 'merge') {
        const merged = await mergeArtwork(message.project, message.selection, jobFont);
        self.postMessage({ id: message.id, merged });
        return;
      }
      const model = await generateGeometry(
        message.project,
        jobTemplate,
        jobFont,
        message.type === 'inspectColors'
          ? { inspectionWidth: message.inspectionWidth ?? 0.2 }
          : undefined,
      );
      if (message.type === 'inspectColors') {
        const colorInspection = model.colorInspection!;
        const buffers = colorInspection.candidates.flatMap((part) => [
          part.positions.buffer,
          part.indices.buffer,
        ]) as ArrayBuffer[];
        self.postMessage({ id: message.id, colorInspection }, buffers);
        return;
      }
      const buffers = model.meshes.flatMap((p) => [
        p.positions.buffer,
        p.indices.buffer,
      ]) as ArrayBuffer[];
      self.postMessage({ id: message.id, model }, buffers);
    } catch (error) {
      self.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

import { isItemVisible } from '../model/layerEditing';
import { coverage, commonChunks, packSizes } from './font-coverage';
import type { Project } from '../model/types';
import { packFonts, packFontFamilies, parseFontPack, type TextFont } from './font-pack';
import { textFontSizes } from './text-font-sizes';
import { DEFAULT_FONT, embeddedFontBuffer } from './text-fonts';
import { downloadBuffer, type DownloadProgress } from '../io/download';

const core = new Set(coverage.core);
const common = new Set(coverage.common);
const chunks = new Map([...commonChunks].map((c, i) => [c, Math.floor(i / 128)]));
export function fontTier(text = ''): 'core' | 'common' | 'full' {
  const chars = [...text].filter((c) => c !== '\n' && c !== '\r' && c !== '\t');
  if (chars.every((c) => core.has(c))) return 'core';
  if (chars.every((c) => common.has(c))) return 'common';
  return 'full';
}
export function projectText(project: Project): string {
  return [
    project.template.label?.visible && !project.template.label.useOriginal
      ? project.template.label.text
      : '',
    ...project.collections
      .filter((c) => c.visible)
      .flatMap((c) =>
        c.items.filter((i) => isItemVisible(c, i) && i.kind === 'text').map((i) => i.text ?? ''),
      ),
  ].join('\n');
}
export function fontFiles(text = '', family = DEFAULT_FONT): string[] {
  if (family !== DEFAULT_FONT)
    return fontFiles(text).map((name) =>
      name.replace('pass-font-', `text-${family}-`).replace('-v2.woff', '-v1.woff'),
    );
  const tier = fontTier(text);
  if (tier === 'full') return ['pass-font-full-v1.woff'];
  const selected = [
    ...new Set([...text].filter((c) => chunks.has(c)).map((c) => chunks.get(c)!)),
  ].sort((a, b) => a - b);
  return [
    'pass-font-core-v1.woff',
    ...selected.map((i) => `pass-font-common-${String(i).padStart(2, '0')}-v2.woff`),
  ];
}
const assets = new Map<string, Promise<ArrayBuffer>>();
const states = new Map<string, DownloadProgress>();
const listeners = new Set<() => void>();
const buffers = new Map<string, Promise<ArrayBuffer>>();
const fonts = new Map<string, Promise<TextFont>>();
function readAsset(name: string) {
  let promise = assets.get(name);
  if (!promise) {
    const base = import.meta.env?.BASE_URL ?? '/';
    promise = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await downloadBuffer(
            `${base}assets/${name}`,
            '中文字库',
            textFontSizes[name] ?? packSizes[name] ?? (name.includes('full') ? 13990408 : 47036),
            (p) => {
              states.set(name, p);
              listeners.forEach((fn) => fn());
            },
            attempt > 0,
          );
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
    })().catch((error) => {
      assets.delete(name);
      states.delete(name);
      throw error;
    });
    assets.set(name, promise);
  }
  return promise;
}
export async function loadFontBuffer(
  text = '',
  progress?: (p: DownloadProgress) => void,
  family = DEFAULT_FONT,
): Promise<ArrayBuffer> {
  const names = fontFiles(text, family),
    key = names.join('|');
  const notify = () =>
    progress?.(
      (() => {
        const current = names.map((name) => states.get(name));
        const source: DownloadProgress['source'] = current.some(
          (p) => p?.source === 'network',
        )
          ? 'network'
          : current.every((p) => p?.source === 'cache')
            ? 'cache'
            : undefined;
        return names.reduce(
          (sum, name) => {
            const p = states.get(name);
            return {
              loaded: sum.loaded + (p?.loaded ?? 0),
              total:
                sum.total +
                (p?.total ||
                  textFontSizes[name] ||
                  packSizes[name] ||
                  (name.includes('full') ? 13990408 : 47036)),
              ...(source ? { source } : {}),
            };
          },
          { loaded: 0, total: 0 } as DownloadProgress,
        );
      })(),
    );
  listeners.add(notify);
  notify();
  try {
    let promise = buffers.get(key);
    if (!promise) {
      promise = Promise.all(names.map(readAsset))
        .then(packFonts)
        .catch((error) => {
          buffers.delete(key);
          throw error;
        });
      buffers.set(key, promise);
    }
    return await promise;
  } finally {
    listeners.delete(notify);
  }
}

export function projectFontChoices(project: Project): string[] {
  return [
    ...new Set([
      ...(project.template.label?.visible && !project.template.label.useOriginal
        ? [project.template.label.fontId ?? DEFAULT_FONT]
        : []),
      ...project.collections
        .filter((c) => c.visible)
        .flatMap((c) =>
          c.items
            .filter((i) => isItemVisible(c, i) && i.kind === 'text')
            .map((i) => i.fontId ?? DEFAULT_FONT),
        ),
    ]),
  ].sort();
}
const familyBundles = new Map<string, ArrayBuffer>();
const bufferIds = new WeakMap<ArrayBuffer, number>();
const parsedBundles = new WeakMap<ArrayBuffer, TextFont>();
let nextBuffer = 0;
export async function loadProjectFontBuffer(
  project: Project,
  progress?: (p: DownloadProgress) => void,
): Promise<ArrayBuffer> {
  const text = projectText(project);
  const choices = projectFontChoices(project).filter((id) => id !== DEFAULT_FONT);
  const families = [{ id: DEFAULT_FONT, buffer: await loadFontBuffer(text, progress) }];
  const added = await Promise.all(
    choices.map(async (id) => {
      const custom = project.fonts?.find((f) => f.id === id);
      return {
        id,
        buffer: custom
          ? embeddedFontBuffer(custom.dataUrl)
          : await loadFontBuffer(text, undefined, id),
      };
    }),
  );
  families.push(...added);
  const key = families
    .map((f) => {
      if (!bufferIds.has(f.buffer)) bufferIds.set(f.buffer, ++nextBuffer);
      return `${f.id}:${bufferIds.get(f.buffer)}`;
    })
    .join('|');
  let buffer = familyBundles.get(key);
  if (!buffer) {
    buffer = packFontFamilies(families);
    familyBundles.set(key, buffer);
  }
  return buffer;
}
export async function loadProjectFont(
  project: Project,
  progress?: (p: DownloadProgress) => void,
): Promise<TextFont> {
  const buffer = await loadProjectFontBuffer(project, progress);
  let font = parsedBundles.get(buffer);
  if (!font) {
    font = parseFontPack(buffer);
    parsedBundles.set(buffer, font);
  }
  return font;
}
export function loadFont(text = '', progress?: (p: DownloadProgress) => void): Promise<TextFont> {
  const key = fontFiles(text).join('|');
  let promise = fonts.get(key);
  if (!promise) {
    promise = loadFontBuffer(text, progress)
      .then(parseFontPack)
      .catch((error) => {
        fonts.delete(key);
        throw error;
      });
    fonts.set(key, promise);
  } else if (progress) {
    // Join an in-flight shared download; report cached resources as completed too.
    void loadFontBuffer(text, progress).catch(() => {});
  }
  return promise;
}

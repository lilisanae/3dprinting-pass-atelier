import opentype from 'opentype.js';
import type { ProjectFont } from '../model/types';

export const DEFAULT_FONT = 'sans-bold';
export const builtinFonts = [
  { id: DEFAULT_FONT, name: '思源黑体 · 粗体', family: 'Noto Sans SC' },
  { id: 'sans-regular', name: '思源黑体 · 常规', family: 'Noto Sans SC' },
  { id: 'serif-regular', name: '思源宋体 · 常规', family: 'Noto Serif SC' },
];
const customBuffers = new Map<string, ArrayBuffer>();
export function embeddedFontBuffer(dataUrl: string): ArrayBuffer {
  let buffer = customBuffers.get(dataUrl);
  if (!buffer) {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    buffer = Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
    customBuffers.set(dataUrl, buffer);
  }
  return buffer;
}
export async function importTextFont(file: File): Promise<ProjectFont> {
  if (!/\.(ttf|otf|woff)$/i.test(file.name))
    throw new Error('请选择 TTF、OTF 或 WOFF 字体；暂不支持 WOFF2 和字体合集。');
  if (file.size > 40 * 1024 * 1024) throw new Error('字体文件超过 40 MB，请使用单个字体文件。');
  const buffer = await file.arrayBuffer();
  let font: opentype.Font;
  try {
    font = opentype.parse(buffer);
    font.getPath('Aa早苗', 0, 0, 100);
  } catch {
    throw new Error('这个字体暂时无法解析，请换用静态 TTF、OTF 或 WOFF 字体。');
  }
  const name =
    font.names.fullName?.zh ?? font.names.fullName?.en ?? file.name.replace(/\.[^.]+$/, '');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  const dataUrl = `data:font/otf;base64,${btoa(binary)}`;
  customBuffers.set(dataUrl, buffer);
  return { id: `font-${crypto.randomUUID()}`, name: name.slice(0, 100), dataUrl };
}

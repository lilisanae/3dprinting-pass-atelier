import type { PaletteColor } from '../model/types';
import type { ImportOptions, ImportResult, Raster } from './import-options';
import { importDimensions } from './import-options';
import { TraceSession } from './trace-session';
export type { ImportOptions, ImportResult, Raster } from './import-options';
const decodeEntities = (value: string) =>
  value
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code: string) =>
      String.fromCodePoint(
        code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10),
      ),
    )
    .replace(/&(?:colon|Tab|NewLine);/gi, (match) =>
      match.toLowerCase() === '&colon;' ? ':' : match.toLowerCase() === '&tab;' ? '\t' : '\n',
    )
    .replace(/&amp;/g, '&');
function safeReference(value: string): boolean {
  const reference = decodeEntities(value).trim();
  return (
    reference.startsWith('#') ||
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(reference)
  );
}
function checkCss(value: string) {
  const css = decodeEntities(value).replace(/\/\*[\s\S]*?\*\//g, '');
  if (
    /@(?:import|font-face)|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:|\\/i.test(css)
  )
    throw new Error('SVG 包含脚本、外部样式或转义样式，请先导出为自包含的静态 SVG / PNG。');
  for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi))
    if (!safeReference(match[2])) throw new Error('SVG 引用了外部资源，请先嵌入图片或导出为 PNG。');
}

/** Also usable before DOM parsing: active content and network references are rejected. */
export function validateSvgSource(source: string): void {
  if (source.length > 12_000_000) throw new Error('SVG 文件过大，请简化后再导入。');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source))
    throw new Error('SVG 不支持外部实体或样式表。');
  if (
    /<\s*(?:[a-z][\w.-]*:)?(?:script|foreignObject|iframe|object|embed|animate|animateMotion|animateTransform|set)\b/i.test(
      source,
    ) ||
    /\s+on[a-z]+\s*=/i.test(source)
  )
    throw new Error('SVG 包含主动内容，请先导出为静态 SVG / PNG。');
  if (/\s+xml:base\s*=/i.test(source))
    throw new Error('SVG 不支持外部基准地址，请导出为自包含 SVG / PNG。');
  for (const match of source.matchAll(/\s(?:href|xlink:href|src)\s*=\s*(['"])([\s\S]*?)\1/gi))
    if (!safeReference(match[2])) throw new Error('SVG 引用了外部资源，请先嵌入图片或导出为 PNG。');
  checkCss(source);
}

export function sanitizeSvgSource(source: string): { source: string; warnings: string[] } {
  validateSvgSource(source);
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg')
    throw new Error('SVG 文件结构无效。');
  document.querySelectorAll('metadata').forEach((element) => element.remove());
  const allowed = new Set([
    'svg',
    'g',
    'defs',
    'title',
    'desc',
    'metadata',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'textPath',
    'image',
    'use',
    'symbol',
    'clipPath',
    'mask',
    'pattern',
    'linearGradient',
    'radialGradient',
    'stop',
    'style',
    'filter',
    'feBlend',
    'feColorMatrix',
    'feComponentTransfer',
    'feComposite',
    'feConvolveMatrix',
    'feDiffuseLighting',
    'feDisplacementMap',
    'feDistantLight',
    'feDropShadow',
    'feFlood',
    'feFuncA',
    'feFuncB',
    'feFuncG',
    'feFuncR',
    'feGaussianBlur',
    'feMerge',
    'feMergeNode',
    'feMorphology',
    'feOffset',
    'fePointLight',
    'feSpecularLighting',
    'feSpotLight',
    'feTile',
    'feTurbulence',
  ]);
  const elements = Array.from(document.getElementsByTagName('*'));
  if (elements.length > 30000) throw new Error('SVG 元素过多，请简化后再导入。');
  for (const element of elements) {
    if (!allowed.has(element.localName))
      throw new Error(`SVG 元素 ${element.localName} 暂不支持，请导出为 PNG。`);
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg')
      throw new Error('SVG 包含非图形内容，请导出为静态 SVG / PNG。');
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      if (name.startsWith('on')) throw new Error('SVG 包含事件脚本，请导出为静态 SVG / PNG。');
      if (name === 'base') throw new Error('SVG 不支持外部基准地址，请导出为自包含 SVG / PNG。');
      if (['href', 'src'].includes(name) && !safeReference(attribute.value))
        throw new Error('SVG 引用了外部资源，请先嵌入图片或导出为 PNG。');
      if (name === 'style' || /url\s*\(/i.test(attribute.value)) checkCss(attribute.value);
    }
    if (element.localName === 'style') checkCss(element.textContent ?? '');
  }
  const root = document.documentElement;
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    if (!root.getAttribute('width') || root.getAttribute('width')?.includes('%'))
      root.setAttribute('width', String(vb[2]));
    if (!root.getAttribute('height') || root.getAttribute('height')?.includes('%'))
      root.setAttribute('height', String(vb[3]));
  }
  const warnings = ['SVG 按可见图形描摹为封闭色块，描边与变换已计入；很细的线条可能需要放大导入。'];
  if (document.querySelector('text'))
    warnings.push('SVG 中的文字按浏览器可用字体渲染；精确字形请先将文字转为路径。');
  return { source: new XMLSerializer().serializeToString(document), warnings };
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片文件读取失败。'));
    reader.readAsDataURL(file);
  });
}
function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法解码，请检查文件或改用 PNG。'));
    image.src = url;
  });
}

type Decoded = { image: HTMLImageElement; sourceDataUrl: string; warnings: string[]; svg: boolean };
/** Decode once per dialog, retain just the current sampling size, and release on close. */
export class ArtworkImporter {
  private decoded?: Promise<Decoded>;
  private raster?: Raster;
  private session = new TraceSession();
  private cache = new Map<string, ImportResult>();
  private disposed = false;
  constructor(private file: File) {}
  private async decode(): Promise<Decoded> {
    const file = this.file;
    if (file.size > 20_000_000) throw new Error('文件超过 20 MB，请缩小图片后再导入。');
    const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    if (
      !svg &&
      !/^image\/(png|jpeg|webp)$/.test(file.type) &&
      !/\.(png|jpe?g|webp)$/i.test(file.name)
    )
      throw new Error('请选择 PNG、JPG、WebP 或静态 SVG。');
    let sourceDataUrl: string,
      warnings: string[] = [];
    if (svg) {
      const safe = sanitizeSvgSource(await file.text());
      sourceDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safe.source)}`;
      warnings = safe.warnings;
    } else sourceDataUrl = await fileDataUrl(file);
    const image = await decodeImage(sourceDataUrl);
    if (this.disposed) {
      image.src = '';
      throw new DOMException('描图已取消。', 'AbortError');
    }
    return { image, sourceDataUrl, warnings, svg };
  }
  async trace(
    palette: PaletteColor[],
    options: Partial<ImportOptions> = {},
    signal?: AbortSignal,
  ): Promise<ImportResult> {
    const check = () => {
      if (this.disposed || signal?.aborted) throw new DOMException('描图已取消。', 'AbortError');
    };
    check();
    const key = JSON.stringify([options, palette]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const decoded = await (this.decoded ??= this.decode().catch((error) => {
      this.decoded = undefined;
      throw error;
    }));
    check();
    const size = importDimensions(
      decoded.image.naturalWidth,
      decoded.image.naturalHeight,
      options.quality,
      decoded.svg,
    );
    if (!this.raster || this.raster.width !== size.width || this.raster.height !== size.height) {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('浏览器无法创建图片画布。');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(decoded.image, 0, 0, size.width, size.height);
      const pixels = context.getImageData(0, 0, size.width, size.height);
      this.raster = { ...size, data: pixels.data };
      canvas.width = canvas.height = 1;
    }
    const result = await this.session.trace(this.raster, palette, options, signal);
    check();
    if (!result.regions.length)
      throw new Error('未找到可导入的封闭图案，请调整阈值、反相或背景选项。');
    const complete = {
      ...result,
      sourceDataUrl: decoded.sourceDataUrl,
      warnings: [...decoded.warnings, ...result.warnings],
    };
    this.cache.set(key, complete);
    if (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
    return complete;
  }
  dispose() {
    this.disposed = true;
    this.session.dispose();
    this.cache.clear();
    this.raster = undefined;
    void this.decoded
      ?.then(({ image }) => {
        image.src = '';
      })
      .catch(() => {});
  }
}

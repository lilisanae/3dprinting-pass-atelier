import ImageTracer from 'imagetracerjs';
import type { TraceColor, TracePath } from 'imagetracerjs';
import type { ColorRegion, PaletteColor } from '../model/types';
import { defaultImportOptions } from './import-options';
import type { ImportOptions, ImportResult, Raster } from './import-options';
import { processLineartBeta } from './lineart-beta';
const clamp = (n: number, min: number, max: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
const fmt = (n: number) => Number(n.toFixed(5)).toString();
const normalizeOptions = (options: Partial<ImportOptions>): ImportOptions => ({
  ...defaultImportOptions,
  ...options,
  mode: options.mode === 'lineart' ? 'lineart' : 'color',
  threshold: clamp(options.threshold ?? 170, 0, 255, 170),
  maxColors: Math.round(clamp(options.maxColors ?? 4, 2, 8, 4)),
  simplify: clamp(options.simplify ?? 0.7, 0, 5, 0.7),
  removeBackground: !!options.removeBackground,
  invert: !!options.invert,
  silhouette: !!options.silhouette,
  lineartBeta: options.mode === 'lineart' && !!options.lineartBeta,
  lineartSmooth: Math.round(clamp(options.lineartSmooth ?? 1, 0, 3, 1)),
  lineartMinWidth: clamp(options.lineartMinWidth ?? 0.2, 0, 0.6, 0.2),
  lineartDespeckle: clamp(options.lineartDespeckle ?? 0.01, 0, 0.1, 0.01),
});

const colorDistance = (a: number[], b: number[]) =>
  0.3 * (a[0] - b[0]) ** 2 + 0.59 * (a[1] - b[1]) ** 2 + 0.11 * (a[2] - b[2]) ** 2;
const parseHex = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
function nearestPalette(color: TraceColor, palette: PaletteColor[]) {
  let nearest = palette[0],
    best = Infinity;
  for (const entry of palette) {
    const distance = colorDistance([color.r, color.g, color.b], parseHex(entry.hex));
    if (distance < best) {
      best = distance;
      nearest = entry;
    }
  }
  return nearest.id;
}

/** Removes only a nearly uniform edge-connected area. Enclosed whites remain intact. */
export function removeConnectedBackground(image: Raster): { removed: number; warning?: string } {
  const { width, height, data } = image,
    border: number[] = [];
  for (let x = 0; x < width; x++) {
    border.push(x);
    if (height > 1) border.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    border.push(y * width);
    if (width > 1) border.push(y * width + width - 1);
  }
  const opaque = border.filter((index) => data[index * 4 + 3] >= 250);
  if (opaque.length < border.length * 0.8)
    return { removed: 0, warning: '已保留原图透明背景；复杂背景建议先准备透明 PNG。' };
  const histogram = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const index of opaque) {
    const offset = index * 4,
      r = data[offset],
      g = data[offset + 1],
      b = data[offset + 2],
      key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4),
      entry = histogram.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    entry.count++;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    histogram.set(key, entry);
  }
  const dominant = [...histogram.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant || dominant.count < opaque.length * 0.72)
    return { removed: 0, warning: '边缘颜色不够统一，已保留背景；透明 PNG 的轮廓更稳定。' };
  const target = [
    dominant.r / dominant.count,
    dominant.g / dominant.count,
    dominant.b / dominant.count,
  ];
  const matches = (index: number) =>
    data[index * 4 + 3] >= 128 &&
    colorDistance([data[index * 4], data[index * 4 + 1], data[index * 4 + 2]], target) <= 18 ** 2;
  const visited = new Uint8Array(width * height),
    queue = new Uint32Array(width * height);
  let head = 0,
    tail = 0;
  const enqueue = (index: number) => {
    if (!visited[index] && matches(index)) {
      visited[index] = 1;
      queue[tail++] = index;
    }
  };
  for (const index of border) enqueue(index);
  while (head < tail) {
    const index = queue[head++],
      x = index % width,
      y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }
  return {
    removed: tail,
    warning: tail
      ? '已移除与边缘连通的纯色背景；请检查贴近背景颜色的细节。'
      : '未找到可移除的纯色背景；透明 PNG 的轮廓更稳定。',
  };
}

type Sample = { r: number; g: number; b: number; count: number };
function quantizedPalette(image: Raster, count: number): TraceColor[] {
  const histogram = new Map<number, Sample>();
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 128) continue;
    const r = image.data[i],
      g = image.data[i + 1],
      b = image.data[i + 2],
      key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4),
      sample = histogram.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    sample.r += r;
    sample.g += g;
    sample.b += b;
    sample.count++;
    histogram.set(key, sample);
  }
  const samples = [...histogram.values()].map((s) => ({
    r: s.r / s.count,
    g: s.g / s.count,
    b: s.b / s.count,
    count: s.count,
  }));
  if (!samples.length) return [];
  const buckets: Sample[][] = [samples];
  const extent = (bucket: Sample[]) => {
    const bounds = ['r', 'g', 'b'].map((key) => {
      const values = bucket.map((s) => s[key as 'r' | 'g' | 'b']);
      return Math.max(...values) - Math.min(...values);
    });
    return {
      range: Math.max(...bounds),
      axis: ['r', 'g', 'b'][bounds.indexOf(Math.max(...bounds))] as 'r' | 'g' | 'b',
    };
  };
  while (buckets.length < count) {
    const candidates = buckets
      .map((bucket, index) => ({
        index,
        bucket,
        ...extent(bucket),
        weight: bucket.reduce((sum, s) => sum + s.count, 0),
      }))
      .filter((b) => b.bucket.length > 1)
      .sort((a, b) => b.range * b.weight - a.range * a.weight);
    if (!candidates.length) break;
    const chosen = candidates[0],
      sorted = [...chosen.bucket].sort((a, b) => a[chosen.axis] - b[chosen.axis]);
    let sum = 0,
      split = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      sum += sorted[i].count;
      split = i + 1;
      if (sum >= chosen.weight / 2) break;
    }
    buckets.splice(chosen.index, 1, sorted.slice(0, split), sorted.slice(split));
  }
  return buckets.map((bucket) => {
    const weight = bucket.reduce((sum, s) => sum + s.count, 0);
    return {
      r: Math.round(bucket.reduce((sum, s) => sum + s.r * s.count, 0) / weight),
      g: Math.round(bucket.reduce((sum, s) => sum + s.g * s.count, 0) / weight),
      b: Math.round(bucket.reduce((sum, s) => sum + s.b * s.count, 0) / weight),
      a: 255,
    };
  });
}

function tracePath(path: TracePath, sx: number, sy: number, reverse = false): string {
  if (!path.segments.length) return '';
  const pair = (x: number, y: number) => `${fmt(x * sx)},${fmt(y * sy)}`;
  if (!reverse)
    return `M${pair(path.segments[0].x1, path.segments[0].y1)}${path.segments.map((s) => (s.type === 'Q' ? `Q${pair(s.x2, s.y2)} ${pair(s.x3!, s.y3!)}` : `L${pair(s.x2, s.y2)}`)).join('')}Z`;
  const last = path.segments[path.segments.length - 1];
  return `M${pair(last.type === 'Q' ? last.x3! : last.x2, last.type === 'Q' ? last.y3! : last.y2)}${[
    ...path.segments,
  ]
    .reverse()
    .map((s) =>
      s.type === 'Q' ? `Q${pair(s.x2, s.y2)} ${pair(s.x1, s.y1)}` : `L${pair(s.x1, s.y1)}`,
    )
    .join('')}Z`;
}

// Typed rows avoid boxed per-pixel numbers. Equal RGB pixels share an exact palette lookup.
function indexRaster(image: Raster, palette: TraceColor[]) {
  const rows = Array.from({ length: image.height + 2 }, () =>
    new Int16Array(image.width + 2).fill(-1),
  );
  const transparent = palette.findIndex((color) => color.a === 0);
  const opaque = palette
    .map((color, index) => ({ color, index }))
    .filter(({ color }) => color.a >= 128);
  const cache = new Map<number, number>();
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] < 128) {
        rows[y + 1][x + 1] = transparent;
        continue;
      }
      if (opaque.length === 1) {
        rows[y + 1][x + 1] = opaque[0].index;
        continue;
      }
      const key = image.data[i] * 65536 + image.data[i + 1] * 256 + image.data[i + 2];
      let nearest = cache.get(key);
      if (nearest === undefined) {
        let distance = Infinity;
        nearest = 0;
        for (const { color, index } of opaque) {
          const d =
            Math.abs(color.r - image.data[i]) +
            Math.abs(color.g - image.data[i + 1]) +
            Math.abs(color.b - image.data[i + 2]);
          if (d < distance) {
            distance = d;
            nearest = index;
          }
        }
        if (cache.size < 65_536) cache.set(key, nearest);
      }
      rows[y + 1][x + 1] = nearest;
    }
  return rows;
}

function traceLayer(
  rows: Int16Array[],
  color: number,
  settings: Record<string, number | boolean>,
  smoothing = 0,
) {
  const nodes = rows.map((row) => new Uint8Array(row.length));
  for (let y = 1; y < rows.length; y++)
    for (let x = 1; x < rows[0].length; x++) {
      nodes[y][x] =
        Number(rows[y - 1][x - 1] === color) +
        2 * Number(rows[y - 1][x] === color) +
        8 * Number(rows[y][x - 1] === color) +
        4 * Number(rows[y][x] === color);
    }
  const options = ImageTracer.checkoptions(settings);
  const paths = ImageTracer.internodes(
    ImageTracer.pathscan(nodes, Number(options.pathomit)),
    options,
  );
  for (const path of paths) {
    if (!smoothing || path.points.length < 12) continue;
    const original = path.points.map(({ x, y }) => ({ x, y }));
    for (let pass = 0; pass < smoothing; pass++) {
      const before = path.points.map(({ x, y }) => ({ x, y })),
        n = before.length;
      path.points.forEach((point, i) => {
        const prev = before[(i + n - 1) % n],
          next = before[(i + 1) % n];
        point.x = Math.max(
          original[i].x - 0.35,
          Math.min(original[i].x + 0.35, before[i].x * 0.6 + (prev.x + next.x) * 0.2),
        );
        point.y = Math.max(
          original[i].y - 0.35,
          Math.min(original[i].y + 0.35, before[i].y * 0.6 + (prev.y + next.y) * 0.2),
        );
      });
    }
    path.points.forEach((point, i) => {
      const next = path.points[(i + 1) % path.points.length];
      point.linesegment = ImageTracer.getdirection(point.x, point.y, next.x, next.y);
    });
  }
  return ImageTracer.batchtracepaths(paths, Number(options.ltres), Number(options.qtres));
}

/** Deterministic pure raster tracing, shared by the browser importer and validation tests. */
export function traceRaster(
  input: Raster,
  palette: PaletteColor[],
  options: Partial<ImportOptions> = {},
): ImportResult {
  if (!palette.length || palette.some((color) => !/^#[0-9a-f]{6}$/i.test(color.hex)))
    throw new Error('请先设置有效的打印颜色。');
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.data.length !== input.width * input.height * 4
  )
    throw new Error('图片像素数据无效。');
  if (input.width * input.height > 4_200_000) throw new Error('图片过大，请降低导入分辨率。');
  // Canvas ImageData exposes dimensions through getters, so a spread loses them.
  const settings = normalizeOptions(options),
    image: Raster = {
      width: input.width,
      height: input.height,
      data: new Uint8ClampedArray(input.data),
    },
    warnings: string[] = [];
  if (settings.removeBackground) {
    const result = removeConnectedBackground(image);
    if (result.warning) warnings.push(result.warning);
  }
  let hasTransparent = false;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 128) {
      image.data[i] = image.data[i + 1] = image.data[i + 2] = image.data[i + 3] = 0;
      hasTransparent = true;
      continue;
    }
    if (settings.mode === 'lineart') {
      const luminance =
          0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2],
        foreground = settings.invert
          ? luminance >= settings.threshold
          : luminance <= settings.threshold;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
      image.data[i + 3] = foreground ? 255 : 0;
      if (!foreground) hasTransparent = true;
    } else {
      const alpha = image.data[i + 3] / 255;
      for (let k = 0; k < 3; k++)
        image.data[i + k] = Math.round(image.data[i + k] * alpha + 255 * (1 - alpha));
      image.data[i + 3] = 255;
    }
  }
  const width = Math.min(25, (60 * image.width) / image.height),
    height = (width * image.height) / image.width;
  if (settings.lineartBeta) {
    const removed = processLineartBeta(
      image,
      width,
      settings.lineartMinWidth!,
      settings.lineartDespeckle!,
    );
    hasTransparent = false;
    for (let i = 3; i < image.data.length; i += 4)
      if (image.data[i] < 128) {
        hasTransparent = true;
        break;
      }
    if (removed) warnings.push(`黑白线稿 Beta 已清理 ${removed} 处独立散点，请核对小装饰和标点。`);
  }
  const colors =
    settings.mode === 'lineart'
      ? [{ r: 0, g: 0, b: 0, a: 255 }]
      : quantizedPalette(image, settings.maxColors);
  if (hasTransparent) colors.push({ r: 0, g: 0, b: 0, a: 0 });
  if (!colors.length) return { regions: [], width, height, warnings };
  // Fixed palette plus one quantization cycle keeps transparency and source colors distinct.
  const tracingOptions = {
    colorquantcycles: 1,
    colorsampling: 0,
    mincolorratio: 0,
    pathomit: 2,
    ltres: settings.lineartBeta && settings.lineartSmooth ? 0.01 : (settings.simplify + 0.35) ** 2,
    qtres: (settings.simplify + 0.35) ** 2,
    linefilter: false,
    rightangleenhance: !(settings.lineartBeta && settings.lineartSmooth),
    blurradius: 0,
    layering: 0,
  };
  const rows = indexRaster(image, colors);
  const layers = colors.map((color, index) =>
    color.a < 128
      ? []
      : traceLayer(rows, index, tracingOptions, settings.lineartBeta ? settings.lineartSmooth : 0),
  );
  const regions: ColorRegion[] = [];
  layers.forEach((layer, index) => {
    const color = colors[index];
    if (color.a < 128) return;
    const outerPaths = layer.filter((path) => !path.isholepath && path.segments.length);
    const paths = outerPaths.map(
      (path) =>
        tracePath(path, width / image.width, height / image.height) +
        path.holechildren
          .map((hole) => tracePath(layer[hole], width / image.width, height / image.height, true))
          .join(''),
    );
    if (!paths.length) return;
    // Keep quantized source colors independent even if their initial palette match is the same.
    // This lets the editor remap each source color without retracing the image.
    regions.push({ colorId: nearestPalette(color, palette), path: paths.join('') });
  });
  if (regions.reduce((sum, region) => sum + region.path.length, 0) > 3_000_000)
    throw new Error('描摹结果过于复杂，请提高简化程度或减少颜色。');
  let silhouettePath: string | undefined;
  if (settings.silhouette) {
    // Reuse binary lineart contours. For color, union indices before tracing so multicolor holes fill.
    const foreground =
      settings.mode === 'lineart'
        ? layers[0]
        : traceLayer(
            rows.map((row) => {
              const mask = new Int16Array(row.length).fill(-1);
              for (let x = 0; x < row.length; x++)
                if (row[x] >= 0 && colors[row[x]].a >= 128) mask[x] = 0;
              return mask;
            }),
            0,
            tracingOptions,
          );
    // Only drop interior holes. Concave contours and separated islands stay intact.
    silhouettePath = foreground
      .filter((path) => !path.isholepath && path.segments.length)
      .map((path) => tracePath(path, width / image.width, height / image.height))
      .join('');
  }
  if (silhouettePath && silhouettePath.length > 3_000_000)
    throw new Error('剪影轮廓过于复杂，请提高简化程度。');
  if (settings.mode === 'color')
    warnings.push(
      `已将 ${regions.length} 种描摹颜色映射到 ${new Set(regions.map((region) => region.colorId)).size} 种现有打印颜色，可逐区调整。`,
    );
  if (!hasTransparent && !settings.removeBackground)
    warnings.push('原图背景已作为色块保留；使用透明 PNG 或开启纯色背景移除可获得独立轮廓。');
  return { regions, width, height, warnings, silhouettePath };
}

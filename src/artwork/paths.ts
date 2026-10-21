import opentype from 'opentype.js';
import parseSVG from 'svg-path-parser';
import type { DesignItem } from '../model/types';
import type { TextFont } from './font-pack';
import { textOutline } from './text-layout';
import { decorativeShapePath } from '../model/shapeCatalog';

type Point = [number, number];
type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
};
export { loadFontBuffer, loadFont } from './font-loader';

const number = (n: number) => Number(n.toFixed(6)).toString();
export const contoursToPath = (contours: number[][][]) =>
  contours
    .map((points) =>
      points.length < 3
        ? ''
        : `M${points.map((p) => `${number(p[0])},${number(p[1])}`).join('L')}Z`,
    )
    .join('');
const area = (p: number[][]) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function lineDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  return length < 1e-12
    ? Math.hypot(p[0] - a[0], p[1] - a[1])
    : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
}
function cubic(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tolerance: number,
  append: (p: Point) => void,
  depth = 0,
): void {
  // Checking control-polygon length also catches loops whose endpoints coincide.
  const excess =
    Math.hypot(b[0] - a[0], b[1] - a[1]) +
    Math.hypot(c[0] - b[0], c[1] - b[1]) +
    Math.hypot(d[0] - c[0], d[1] - c[1]) -
    Math.hypot(d[0] - a[0], d[1] - a[1]);
  if (
    depth >= 18 ||
    (Math.max(lineDistance(b, a, d), lineDistance(c, a, d)) <= tolerance && excess <= tolerance * 2)
  ) {
    append(d);
    return;
  }
  const ab = midpoint(a, b),
    bc = midpoint(b, c),
    cd = midpoint(c, d),
    abc = midpoint(ab, bc),
    bcd = midpoint(bc, cd),
    center = midpoint(abc, bcd);
  cubic(a, ab, abc, center, tolerance, append, depth + 1);
  cubic(center, bcd, cd, d, tolerance, append, depth + 1);
}
function arc(
  a: Point,
  b: Point,
  rxValue: number,
  ryValue: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  tolerance: number,
  append: (p: Point) => void,
) {
  let rx = Math.abs(rxValue),
    ry = Math.abs(ryValue);
  if (rx < 1e-12 || ry < 1e-12) {
    append(b);
    return;
  }
  if (same(a, b)) return;
  const phi = (rotation * Math.PI) / 180,
    cos = Math.cos(phi),
    sin = Math.sin(phi);
  const halfX = (a[0] - b[0]) / 2,
    halfY = (a[1] - b[1]) / 2,
    xp = cos * halfX + sin * halfY,
    yp = -sin * halfX + cos * halfY;
  const radii = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (radii > 1) {
    const factor = Math.sqrt(radii);
    rx *= factor;
    ry *= factor;
  }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp),
    denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(numerator / Math.max(denominator, 1e-30));
  const cxp = (factor * rx * yp) / ry,
    cyp = (-factor * ry * xp) / rx,
    cx = cos * cxp - sin * cyp + (a[0] + b[0]) / 2,
    cy = sin * cxp + cos * cyp + (a[1] + b[1]) / 2;
  const u: Point = [(xp - cxp) / rx, (yp - cyp) / ry],
    v: Point = [(-xp - cxp) / rx, (-yp - cyp) / ry];
  const start = Math.atan2(u[1], u[0]);
  let angle = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  if (!sweep && angle > 0) angle -= Math.PI * 2;
  if (sweep && angle < 0) angle += Math.PI * 2;
  const step = Math.max(
    0.001,
    Math.min(
      Math.PI / 4,
      2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / Math.max(rx, ry)))),
    ),
  );
  const count = Math.max(1, Math.min(20000, Math.ceil(Math.abs(angle) / step)));
  for (let i = 1; i <= count; i++) {
    const theta = start + (angle * i) / count;
    append(
      i === count
        ? b
        : [
            cx + cos * rx * Math.cos(theta) - sin * ry * Math.sin(theta),
            cy + sin * rx * Math.cos(theta) + cos * ry * Math.sin(theta),
          ],
    );
  }
}

/** Closed SVG contours in their original winding; the final point is not repeated. */
export function flattenPath(d: string, tolerance = 0.035): number[][][] {
  if (!d.trim()) return [];
  if (d.length > 4_000_000) throw new Error('图案轮廓过于复杂，请降低导入精度。');
  const commands = parseSVG.makeAbsolute(parseSVG(d));
  if (commands.length > 150000) throw new Error('图案路径节点过多，请降低导入精度。');
  const tol = Number.isFinite(tolerance) ? Math.max(0.00001, tolerance) : 0.035;
  const contours: Point[][] = [];
  let points: Point[] = [],
    position: Point = [0, 0],
    start: Point = [0, 0],
    lastCode = '',
    lastCubic: Point | undefined,
    lastQuadratic: Point | undefined,
    total = 0;
  const append = (point: Point) => {
    if (!point.every(Number.isFinite)) throw new Error('图案路径包含无效坐标。');
    if (!points.length || !same(point, points[points.length - 1])) {
      points.push(point);
      if (++total > 250000) throw new Error('图案轮廓采样过密，请降低导入精度。');
    }
  };
  for (const command of commands) {
    const code = command.code.toUpperCase(),
      end: Point = [command.x ?? position[0], command.y ?? position[1]];
    let nextCubic: Point | undefined, nextQuadratic: Point | undefined;
    switch (code) {
      case 'M':
        points = [];
        start = end;
        append(end);
        break;
      case 'L':
      case 'H':
      case 'V':
        append(end);
        break;
      case 'C': {
        const c1: Point = [command.x1!, command.y1!],
          c2: Point = [command.x2!, command.y2!];
        cubic(position, c1, c2, end, tol, append);
        nextCubic = c2;
        break;
      }
      case 'S': {
        const c1: Point =
            (lastCode === 'C' || lastCode === 'S') && lastCubic
              ? [2 * position[0] - lastCubic[0], 2 * position[1] - lastCubic[1]]
              : position,
          c2: Point = [command.x2!, command.y2!];
        cubic(position, c1, c2, end, tol, append);
        nextCubic = c2;
        break;
      }
      case 'Q':
      case 'T': {
        const control: Point =
          code === 'Q'
            ? [command.x1!, command.y1!]
            : (lastCode === 'Q' || lastCode === 'T') && lastQuadratic
              ? [2 * position[0] - lastQuadratic[0], 2 * position[1] - lastQuadratic[1]]
              : position;
        const c1: Point = [
            position[0] + ((control[0] - position[0]) * 2) / 3,
            position[1] + ((control[1] - position[1]) * 2) / 3,
          ],
          c2: Point = [
            end[0] + ((control[0] - end[0]) * 2) / 3,
            end[1] + ((control[1] - end[1]) * 2) / 3,
          ];
        cubic(position, c1, c2, end, tol, append);
        nextQuadratic = control;
        break;
      }
      case 'A':
        arc(
          position,
          end,
          command.rx!,
          command.ry!,
          command.xAxisRotation ?? 0,
          !!command.largeArc,
          !!command.sweep,
          tol,
          append,
        );
        break;
      case 'Z':
        if (points.length && same(points[points.length - 1], start)) points.pop();
        if (points.length >= 3 && Math.abs(area(points)) > 1e-10) contours.push(points);
        points = [];
        break;
      default:
        throw new Error(`暂不支持图案路径指令 ${code}。`);
    }
    position = code === 'Z' ? start : end;
    lastCode = code;
    lastCubic = nextCubic;
    lastQuadratic = nextQuadratic;
  }
  return contours;
}

export function placementTransform(contours: number[][][], placement: Placement): number[][][] {
  const { x, y, width, height, rotation } = placement;
  const angle = (rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    cx = width / 2,
    cy = height / 2;
  return contours.map((contour) =>
    contour.map(([px, py]) => [
      x +
        cx +
        (px - cx) * (placement.mirrorX ? -1 : 1) * cos -
        (py - cy) * (placement.mirrorY ? -1 : 1) * sin,
      y +
        cy +
        (px - cx) * (placement.mirrorX ? -1 : 1) * sin +
        (py - cy) * (placement.mirrorY ? -1 : 1) * cos,
    ]),
  );
}

/** Reflection around the placement center; dimensions remain positive for bounds and meshes. */
export function placementSvgTransform(p: Placement): string {
  return `translate(${p.x} ${p.y}) rotate(${p.rotation} ${p.width / 2} ${p.height / 2}) translate(${p.mirrorX ? p.width : 0} ${p.mirrorY ? p.height : 0}) scale(${p.mirrorX ? -1 : 1} ${p.mirrorY ? -1 : 1})`;
}

function polygonPath(points: Point[], width: number, height: number): string {
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0])),
    minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  return contoursToPath([
    points.map(([x, y]) => [
      ((x - minX) * width) / (maxX - minX),
      ((y - minY) * height) / (maxY - minY),
    ]),
  ]);
}
function shapePath(shape: DesignItem['shape'], width: number, height: number): string {
  const w = number(width),
    h = number(height);
  switch (shape) {
    case 'pill': {
      const radius = Math.min(width, height) / 2,
        r = number(radius);
      return `M${r},0H${number(width - radius)}A${r},${r} 0 0 1 ${w},${r}V${number(height - radius)}A${r},${r} 0 0 1 ${number(width - radius)},${h}H${r}A${r},${r} 0 0 1 0,${number(height - radius)}V${r}A${r},${r} 0 0 1 ${r},0Z`;
    }
    case 'circle':
      return `M0,${number(height / 2)}A${number(width / 2)},${number(height / 2)} 0 1 0 ${w},${number(height / 2)}A${number(width / 2)},${number(height / 2)} 0 1 0 0,${number(height / 2)}Z`;
    case 'triangle':
      return `M${number(width / 2)},0L${w},${h}L0,${h}Z`;
    case 'star':
      return polygonPath(
        Array.from({ length: 10 }, (_, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI) / 5,
            r = i % 2 ? 0.43 : 1;
          return [Math.cos(angle) * r, Math.sin(angle) * r] as Point;
        }),
        width,
        height,
      );
    case 'heart':
      return `M${number(width / 2)},${h}C${number(width * 0.46)},${number(height * 0.88)} 0,${number(height * 0.55)} 0,${number(height * 0.28)}C0,${number(-height * 0.05)} ${number(width * 0.4)},${number(-height * 0.08)} ${number(width / 2)},${number(height * 0.19)}C${number(width * 0.6)},${number(-height * 0.08)} ${w},${number(-height * 0.05)} ${w},${number(height * 0.28)}C${w},${number(height * 0.55)} ${number(width * 0.54)},${number(height * 0.88)} ${number(width / 2)},${h}Z`;
    case 'arrow':
      return `M0,${number(height * 0.3)}H${number(width * 0.58)}V0L${w},${number(height / 2)}L${number(width * 0.58)},${h}V${number(height * 0.7)}H0Z`;
    case 'stripe':
      return `M${number(width * 0.3)},0H${w}L${number(width * 0.7)},${h}H0Z`;
    default:
      if (shape) {
        const source = decorativeShapePath(shape);
        if (source) {
          const contours = flattenPath(source, 0.03),
            points = contours.flat();
          const minX = Math.min(...points.map((p) => p[0])),
            maxX = Math.max(...points.map((p) => p[0]));
          const minY = Math.min(...points.map((p) => p[1])),
            maxY = Math.max(...points.map((p) => p[1]));
          return contoursToPath(
            contours.map((contour) =>
              contour.map(([x, y]) => [
                ((x - minX) * width) / (maxX - minX),
                ((y - minY) * height) / (maxY - minY),
              ]),
            ),
          );
        }
      }
      return `M0,0H${w}V${h}H0Z`;
  }
}

/** Paths are local millimetres; placement belongs in placementTransform / the UI transform. */
function buildItemPath(item: DesignItem, font?: TextFont): string {
  const { width, height } = item;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  if (item.kind === 'paths') {
    const source = item as DesignItem & { sourceWidth?: number; sourceHeight?: number };
    const sx = width / (source.sourceWidth || width),
      sy = height / (source.sourceHeight || height);
    const path = (item.regions ?? []).map((region) => region.path).join('');
    if (sx === 1 && sy === 1) return path;
    return contoursToPath(
      flattenPath(path, 0.015).map((contour) => contour.map(([x, y]) => [x * sx, y * sy])),
    );
  }
  if (item.kind === 'shape') {
    const path = shapePath(item.shape, width, height);
    // The heart's Bezier controls extend slightly above its visible bounding box.
    if (item.shape === 'heart') {
      const contours = flattenPath(path, 0.01),
        points = contours.flat(),
        minY = Math.min(...points.map((p) => p[1])),
        maxY = Math.max(...points.map((p) => p[1]));
      return contoursToPath(
        contours.map((c) => c.map(([x, y]) => [x, ((y - minY) * height) / (maxY - minY)])),
      );
    }
    return path;
  }
  if (!font || !(item.text ?? '').trim()) return '';
  const combined = textOutline(item.text ?? '', item, font);
  if (!combined.commands.length) return '';
  const bounds = combined.getBoundingBox(),
    bw = bounds.x2 - bounds.x1,
    bh = bounds.y2 - bounds.y1;
  if (bw <= 0 || bh <= 0) return '';
  const scaled = new opentype.Path();
  scaled.commands = combined.commands.map((command) => {
    const result = { ...command };
    for (const key of ['x', 'x1', 'x2'] as const)
      if (key in result)
        (result as unknown as Record<string, number>)[key] =
          (((command as unknown as Record<string, number>)[key] - bounds.x1) * width) / bw;
    for (const key of ['y', 'y1', 'y2'] as const)
      if (key in result)
        (result as unknown as Record<string, number>)[key] =
          (((command as unknown as Record<string, number>)[key] - bounds.y1) * height) / bh;
    return result;
  });
  return scaled.toPathData(5);
}

// Moving, selecting or recoloring never changes local outlines. Cache only
// expensive outlines, keyed by geometry and font, with a fixed retention budget.
const outlineCache = new Map<string, string>();
const fontIds = new WeakMap<TextFont, number>();
let nextFontId = 0,
  retainedCharacters = 0;
export function itemPath(item: DesignItem, font?: TextFont): string {
  const { width, height } = item;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  if (
    item.kind === 'shape' &&
    ['rect', 'circle', 'triangle', 'star', 'arrow', 'stripe'].includes(item.shape ?? '')
  )
    return shapePath(item.shape, width, height);
  if (
    item.kind === 'paths' &&
    (!item.sourceWidth || item.sourceWidth === width) &&
    (!item.sourceHeight || item.sourceHeight === height)
  )
    return (item.regions ?? []).map((region) => region.path).join('');
  if (item.kind === 'text' && (!font || !(item.text ?? '').trim())) return '';
  if (item.kind === 'text' && font && !fontIds.has(font)) fontIds.set(font, ++nextFontId);
  const key = JSON.stringify(
    item.kind === 'text'
      ? [
          item.kind,
          width,
          height,
          fontIds.get(font!),
          item.fontId,
          item.text,
          item.letterSpacing,
          item.lineHeight,
          item.textAlign,
        ]
      : [
          item.kind,
          width,
          height,
          item.shape,
          item.sourceWidth,
          item.sourceHeight,
          item.regions?.map((region) => region.path),
        ],
  );
  const cached = outlineCache.get(key);
  if (cached !== undefined) {
    outlineCache.delete(key);
    outlineCache.set(key, cached);
    return cached;
  }
  const path = buildItemPath(item, font);
  const size = key.length + path.length;
  if (size <= 2_000_000) {
    while (outlineCache.size >= 128 || retainedCharacters + size > 2_000_000) {
      const oldest = outlineCache.keys().next().value!;
      retainedCharacters -= oldest.length + outlineCache.get(oldest)!.length;
      outlineCache.delete(oldest);
    }
    outlineCache.set(key, path);
    retainedCharacters += size;
  }
  return path;
}

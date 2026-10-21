import type { TemplatePlacement } from './types';
import type { Bounds2 } from './selection';
import { scalePlacementsXY } from './scaling';
import { artworkPlacementPatch, artworkSelectionFrame } from './artworkBounds';

export type TransformHandle = { x: -1 | 0 | 1; y: -1 | 0 | 1; name: string };
export const transformHandles: TransformHandle[] = [
  { x: -1, y: -1, name: '左上' },
  { x: 0, y: -1, name: '上边' },
  { x: 1, y: -1, name: '右上' },
  { x: 1, y: 0, name: '右边' },
  { x: 1, y: 1, name: '右下' },
  { x: 0, y: 1, name: '下边' },
  { x: -1, y: 1, name: '左下' },
  { x: -1, y: 0, name: '左边' },
];
const nonzero = (n: number, min: number) => (Math.abs(n) < min ? (n < 0 ? -min : min) : n);
export type ResizeOptions = { free?: boolean; centered?: boolean; axis?: 'x' | 'y' | null };

function resizeFactors(
  width: number,
  height: number,
  handle: TransformHandle,
  delta: [number, number],
  options: ResizeOptions,
  minimumX: number,
  minimumY: number,
): [number, number] {
  const dx = delta[0] * (options.centered ? 2 : 1),
    dy = delta[1] * (options.centered ? 2 : 1);
  const limit = (factor: number, minimum: number) =>
    nonzero(Math.max(-100, Math.min(100, factor)), minimum);
  if (options.axis) {
    const axis = !handle.x ? 'y' : !handle.y ? 'x' : options.axis;
    return axis === 'x'
      ? [limit(1 + (handle.x * dx) / width, minimumX), 1]
      : [1, limit(1 + (handle.y * dy) / height, minimumY)];
  }
  if (options.free)
    return [
      handle.x ? limit(1 + (handle.x * dx) / width, minimumX) : 1,
      handle.y ? limit(1 + (handle.y * dy) / height, minimumY) : 1,
    ];
  const factor = limit(
    1 +
      (handle.x * dx * width + handle.y * dy * height) /
        ((handle.x ? width ** 2 : 0) + (handle.y ? height ** 2 : 0)),
    Math.max(minimumX, minimumY),
  );
  return [factor, factor];
}

/** Default proportional, Shift axis only, Ctrl free; Alt retains the original center. */
export function resizePlacement(
  p: TemplatePlacement,
  handle: TransformHandle,
  delta: [number, number],
  options: ResizeOptions = {},
): Partial<TemplatePlacement> {
  const angle = (p.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const dx = delta[0] * c + delta[1] * s,
    dy = -delta[0] * s + delta[1] * c;
  const [factorX, factorY] = resizeFactors(
    p.width,
    p.height,
    handle,
    [dx, dy],
    options,
    Math.min(1, 0.5 / p.width),
    Math.min(1, 0.5 / p.height),
  );
  const width = p.width * factorX,
    height = p.height * factorY;
  const offsetX = options.centered ? 0 : (handle.x * (width - p.width)) / 2;
  const offsetY = options.centered ? 0 : (handle.y * (height - p.height)) / 2;
  return {
    x: p.x + p.width / 2 + offsetX * c - offsetY * s - Math.abs(width) / 2,
    y: p.y + p.height / 2 + offsetX * s + offsetY * c - Math.abs(height) / 2,
    width: Math.abs(width),
    height: Math.abs(height),
    mirrorX: width < 0 ? !p.mirrorX : !!p.mirrorX,
    mirrorY: height < 0 ? !p.mirrorY : !!p.mirrorY,
  };
}

/** Resize from visible artwork edges, preserving the source placement. */
export function resizeArtworkPlacement(
  p: TemplatePlacement,
  handle: TransformHandle,
  delta: [number, number],
  options: ResizeOptions = {},
): Partial<TemplatePlacement> {
  return artworkPlacementPatch(
    p,
    resizePlacement(artworkSelectionFrame(p), handle, delta, options),
  );
}

/** Group resizing shares modifiers and scales from the opposite handle or center. */
export function resizeTransformGroup(
  placements: TemplatePlacement[],
  bounds: Bounds2,
  handle: TransformHandle,
  delta: [number, number],
  options: ResizeOptions = {},
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1];
  const [factorX, factorY] = resizeFactors(width, height, handle, delta, options, 0.01, 0.01);
  return scalePlacementsXY(
    placements,
    [
      options.centered || !handle.x
        ? (bounds[0] + bounds[2]) / 2
        : handle.x > 0
          ? bounds[0]
          : bounds[2],
      options.centered || !handle.y
        ? (bounds[1] + bounds[3]) / 2
        : handle.y > 0
          ? bounds[1]
          : bounds[3],
    ],
    factorX,
    factorY,
  );
}

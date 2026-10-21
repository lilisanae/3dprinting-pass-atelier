import type { TemplatePlacement } from './types';
import { placementBounds, type Bounds2 } from './selection';
import { artworkSelectionFrame } from './artworkBounds';

type ScalePlacement = Pick<
  TemplatePlacement,
  'x' | 'y' | 'width' | 'height' | 'rotation' | 'mirrorX' | 'mirrorY'
>;

export function groupPlacementBounds(placements: ScalePlacement[]): Bounds2 | null {
  if (!placements.length) return null;
  const bounds = placements.map(placementBounds);
  return [
    Math.min(...bounds.map((b) => b[0])),
    Math.min(...bounds.map((b) => b[1])),
    Math.max(...bounds.map((b) => b[2])),
    Math.max(...bounds.map((b) => b[3])),
  ];
}

/** Uniform scaling preserves rotated contours, relative placement and source-image registration. */
export function scalePlacements(
  placements: ScalePlacement[],
  anchor: [number, number],
  factor: number,
): Array<Partial<TemplatePlacement> & Pick<TemplatePlacement, 'x' | 'y' | 'width' | 'height'>> {
  if (!Number.isFinite(factor) || factor === 0 || !anchor.every(Number.isFinite))
    throw new Error('缩放比例需要是非零的有限数值。');
  return placements.map((p) => {
    const magnitude = Math.abs(factor);
    const result =
      factor === 1
        ? { x: p.x, y: p.y, width: p.width, height: p.height }
        : {
            x: anchor[0] + (p.x + p.width / 2 - anchor[0]) * factor - (p.width * magnitude) / 2,
            y: anchor[1] + (p.y + p.height / 2 - anchor[1]) * factor - (p.height * magnitude) / 2,
            width: p.width * magnitude,
            height: p.height * magnitude,
          };
    if (!Object.values(result).every(Number.isFinite) || result.width <= 0 || result.height <= 0)
      throw new Error('缩放后的尺寸超出可用范围，请减小缩放比例。');
    return {
      ...result,
      mirrorX: factor < 0 ? !p.mirrorX : !!p.mirrorX,
      mirrorY: factor < 0 ? !p.mirrorY : !!p.mirrorY,
    };
  });
}

/** Keep members editable: scale their centers in group axes and their own sizes. */
export function scalePlacementsXY(
  placements: ScalePlacement[],
  anchor: [number, number],
  factorX: number,
  factorY: number,
): Array<Partial<TemplatePlacement> & Pick<TemplatePlacement, 'x' | 'y' | 'width' | 'height'>> {
  if (factorX === factorY) return scalePlacements(placements, anchor, factorX);
  if (![...anchor, factorX, factorY].every(Number.isFinite) || factorX === 0 || factorY === 0)
    throw new Error('缩放比例需要是非零的有限数值。');
  return placements.map((p) => {
    const width = p.width * Math.abs(factorX),
      height = p.height * Math.abs(factorY);
    const result = {
      x: anchor[0] + (p.x + p.width / 2 - anchor[0]) * factorX - width / 2,
      y: anchor[1] + (p.y + p.height / 2 - anchor[1]) * factorY - height / 2,
      width,
      height,
    };
    if (!Object.values(result).every(Number.isFinite) || width <= 0 || height <= 0)
      throw new Error('缩放后的尺寸超出可用范围，请减小缩放比例。');
    return {
      ...result,
      mirrorX: factorX < 0 ? !p.mirrorX : !!p.mirrorX,
      mirrorY: factorY < 0 ? !p.mirrorY : !!p.mirrorY,
      ...(factorX < 0 !== factorY < 0 ? { rotation: -p.rotation } : {}),
    };
  });
}

/** A negative group width/height reflects the whole group along that world axis. */
export function scaleGroupAxis(
  placements: ScalePlacement[],
  anchor: [number, number],
  factor: number,
  axis: 'x' | 'y',
) {
  if (!Number.isFinite(factor) || factor === 0) throw new Error('尺寸需要为非零有限数值。');
  const scaled = scalePlacements(placements, anchor, Math.abs(factor));
  if (factor > 0 || !scaled.length) return scaled;
  const bounds = groupPlacementBounds(
    scaled.map((p, i) => artworkSelectionFrame({ ...placements[i], ...p })),
  )!;
  return scaled.map((p, i) => ({
    ...p,
    x: axis === 'x' ? bounds[0] + bounds[2] - p.x - p.width : p.x,
    y: axis === 'y' ? bounds[1] + bounds[3] - p.y - p.height : p.y,
    rotation: -placements[i].rotation,
    ...(axis === 'x' ? { mirrorX: !placements[i].mirrorX } : { mirrorY: !placements[i].mirrorY }),
  }));
}

/** Project the gesture onto the whole box diagonal, including off-center handle grabs. */
export function groupResizeFactor(
  bounds: Bounds2,
  start: [number, number],
  pointer: [number, number],
): number {
  if (![...bounds, ...start, ...pointer].every(Number.isFinite)) return 1;
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1];
  const diagonal = Math.hypot(width, height);
  if (!Number.isFinite(diagonal) || diagonal <= 0) return 1;
  const delta =
    (pointer[0] - start[0]) * (width / diagonal) + (pointer[1] - start[1]) * (height / diagonal);
  const factor = Math.max(-100, Math.min(100, 1 + delta / diagonal));
  return Math.abs(factor) < 0.01 ? (factor < 0 ? -0.01 : 0.01) : factor;
}

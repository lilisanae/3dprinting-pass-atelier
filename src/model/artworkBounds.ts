import { flattenPath } from '../artwork/paths';
import type { Bounds2 } from './selection';
import type { DesignItem, TemplatePlacement } from './types';

type Placement = Pick<
  TemplatePlacement,
  'x' | 'y' | 'width' | 'height' | 'rotation' | 'mirrorX' | 'mirrorY'
> &
  Partial<Pick<DesignItem, 'kind' | 'regions' | 'sourceWidth' | 'sourceHeight'>>;

// Projects are cloned on edits. Cache by immutable path text, rather than item
// identity, so pointer movement never retraces the same artwork. Bound retention.
const cache = new Map<string, Bounds2 | null>();
let cachedCharacters = 0;
function pathBounds(path: string): Bounds2 | null {
  if (cache.has(path)) return cache.get(path)!;
  let bounds: Bounds2 | null = null;
  try {
    for (const contour of flattenPath(path, 0.015))
      for (const [x, y] of contour) {
        if (!bounds) bounds = [x, y, x, y];
        else {
          bounds[0] = Math.min(bounds[0], x);
          bounds[1] = Math.min(bounds[1], y);
          bounds[2] = Math.max(bounds[2], x);
          bounds[3] = Math.max(bounds[3], y);
        }
      }
  } catch {
    // Failed or empty artwork keeps its existing frame and error handling.
  }
  if (path.length <= 4_000_000) {
    while (cache.size && (cache.size >= 128 || cachedCharacters + path.length > 4_000_000)) {
      const oldest = cache.keys().next().value!;
      cachedCharacters -= oldest.length;
      cache.delete(oldest);
    }
    cache.set(path, bounds);
    cachedCharacters += path.length;
  }
  return bounds;
}

/** Filled source contours, as fractions of the original image's placement. */
function artworkFractions(p: Placement): Bounds2 | null {
  if (p.kind !== 'paths') return null;
  let bounds: Bounds2 | null = null;
  for (const region of p.regions ?? []) {
    const b = pathBounds(region.path);
    if (!b) continue;
    if (!bounds) bounds = [...b];
    else {
      bounds[0] = Math.min(bounds[0], b[0]);
      bounds[1] = Math.min(bounds[1], b[1]);
      bounds[2] = Math.max(bounds[2], b[2]);
      bounds[3] = Math.max(bounds[3], b[3]);
    }
  }
  const sourceWidth = p.sourceWidth || p.width;
  const sourceHeight = p.sourceHeight || p.height;
  if (
    !bounds ||
    bounds[2] <= bounds[0] ||
    bounds[3] <= bounds[1] ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  )
    return null;
  return [
    bounds[0] / sourceWidth,
    bounds[1] / sourceHeight,
    bounds[2] / sourceWidth,
    bounds[3] / sourceHeight,
  ];
}

function centerOffset(p: Placement, bounds: Bounds2): [number, number] {
  const dx = ((bounds[0] + bounds[2]) / 2 - 0.5) * p.width * (p.mirrorX ? -1 : 1);
  const dy = ((bounds[1] + bounds[3]) / 2 - 0.5) * p.height * (p.mirrorY ? -1 : 1);
  const angle = (p.rotation * Math.PI) / 180;
  return [dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle)];
}

/** A display/edit frame only: never crop, translate or rewrite stored artwork. */
export function artworkSelectionFrame<T extends Placement>(p: T): T {
  const bounds = artworkFractions(p);
  if (!bounds) return p;
  const width = p.width * (bounds[2] - bounds[0]);
  const height = p.height * (bounds[3] - bounds[1]);
  const offset = centerOffset(p, bounds);
  return {
    ...p,
    x: p.x + p.width / 2 + offset[0] - width / 2,
    y: p.y + p.height / 2 + offset[1] - height / 2,
    width,
    height,
  };
}

/** Map a tight frame's resize back to the original image coordinates. This
 * keeps transparent margins out of handles without changing saved path data. */
export function artworkPlacementPatch(
  p: Placement,
  patch: Partial<TemplatePlacement>,
): Partial<TemplatePlacement> {
  const bounds = artworkFractions(p);
  if (!bounds) return patch;
  const frame = { ...artworkSelectionFrame(p), ...patch };
  const original = {
    ...p,
    ...patch,
    width: frame.width / (bounds[2] - bounds[0]),
    height: frame.height / (bounds[3] - bounds[1]),
  };
  const offset = centerOffset(original, bounds);
  return {
    ...patch,
    x: frame.x + frame.width / 2 - offset[0] - original.width / 2,
    y: frame.y + frame.height / 2 - offset[1] - original.height / 2,
    width: original.width,
    height: original.height,
  };
}

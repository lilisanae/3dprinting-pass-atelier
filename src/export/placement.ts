import reference from './presets/author-a1-placement.json';
import type { GeneratedModel } from '../model/types';

export const PRINT_PLACEMENT = reference;

/** Place the whole assembly, never individual color meshes. Bambu's saved parts
 * have their own local origins; copy their resulting plate center, not offsets. */
export function createBuildPlacement(bounds: GeneratedModel['bounds']) {
  if (!bounds.every(Number.isFinite) || [0, 1, 2].some((axis) => bounds[axis] > bounds[axis + 3]))
    throw new Error('模型边界无效，无法放置到打印板。');
  const translationMm = [
    reference.centerMm[0] - (bounds[0] + bounds[3]) / 2,
    reference.centerMm[1] - (bounds[1] + bounds[4]) / 2,
    -bounds[2],
  ].map((n) => (n === 0 ? 0 : n));
  const transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, ...translationMm];
  return {
    id: reference.id,
    source: reference.source,
    centerMm: [...reference.centerMm],
    translationMm,
    transform,
  };
}

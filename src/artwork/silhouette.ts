import { contoursToPath, flattenPath } from './paths';
import type { ImportResult } from './import-options';

/** Tight, one-colour silhouette, retaining concavities and separate outer islands. */
export function silhouetteArtwork(result: ImportResult, colorId: string): ImportResult {
  if (!result.silhouettePath?.trim()) throw new Error('未找到剪影，请调整阈值或背景设置。');
  const contours = flattenPath(result.silhouettePath, 0.15),
    points = contours.flat();
  if (!points.length) throw new Error('剪影轮廓为空。');
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX - minX < 1e-6 || maxY - minY < 1e-6) throw new Error('剪影没有有效面积。');
  const path = contoursToPath(contours.map((c) => c.map(([x, y]) => [x - minX, y - minY])));
  return {
    ...result,
    width: maxX - minX,
    height: maxY - minY,
    regions: [{ path, colorId }],
    silhouettePath: path,
  };
}

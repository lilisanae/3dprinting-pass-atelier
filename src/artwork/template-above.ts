import { contoursToPath } from './paths';
import type { TemplateObject } from '../model/types';

/** Project only the original template volume reaching above an item's top. */
export function templateAbovePath(object: TemplateObject, z: number, boardHeight: number): string {
  if (object.bounds[5] < z - 1e-6) return '';
  // Equal-height lower template surfaces also own the visible top. Allow for
  // the imported float32 plate top when comparing against collection heights.
  z -= 1e-6;
  const polygons: number[][][] = [];
  for (let t = 0; t < object.indices.length; t += 3) {
    const triangle = object.indices
      .slice(t, t + 3)
      .map((index) => object.positions.slice(index * 3, index * 3 + 3));
    const clipped: number[][] = [];
    for (let n = 0; n < 3; n++) {
      const a = triangle[n],
        b = triangle[(n + 1) % 3];
      if (a[2] >= z) clipped.push(a);
      if (a[2] >= z !== b[2] >= z) {
        const f = (z - a[2]) / (b[2] - a[2]);
        clipped.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), z]);
      }
    }
    const points = clipped.map(([x, y]) => [x, boardHeight - y]);
    const area = points.reduce((sum, a, n) => {
      const b = points[(n + 1) % points.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    if (Math.abs(area) < 1e-10) continue;
    // All projections wind alike so adjacent/overlapping triangles form a union.
    if (area < 0) points.reverse();
    polygons.push(points);
  }
  return contoursToPath(polygons);
}

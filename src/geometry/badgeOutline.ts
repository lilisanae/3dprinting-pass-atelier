import type { CrossSection, SimplePolygon } from 'manifold-3d';
import { getManifoldRuntime } from './engine';
import type { BadgeVectorShape, BadgeOutlineResult } from '../model/badge';

/** Union SVG fills in the worker, retaining holes according to each source fill rule. */
export async function normalizeBadgeOutline(
  shapes: BadgeVectorShape[],
): Promise<BadgeOutlineResult> {
  const runtime = await getManifoldRuntime(),
    owned: CrossSection[] = [];
  const own = (s: CrossSection) => {
    owned.push(s);
    return s;
  };
  try {
    if (!shapes.length || shapes.length > 300) throw new Error('SVG 需要 1～300 个填充图形。');
    const parts = shapes.map((s) =>
      own(new runtime.CrossSection(s.contours as SimplePolygon[], s.fillRule)),
    );
    const merged = own(runtime.CrossSection.union(parts));
    const components = merged.decompose().map(own);
    if (merged.isEmpty() || components.length !== 1)
      throw new Error('SVG 底板需要一个相连的填充形状，请先连接分离的图形。');
    const area = (p: number[][]) =>
      Math.abs(
        p.reduce((sum, a, i) => {
          const b = p[(i + 1) % p.length];
          return sum + a[0] * b[1] - b[0] * a[1];
        }, 0),
      );
    const polygons = merged.toPolygons().sort((a, b) => area(b) - area(a)),
      all = polygons.flat();
    const xs = all.map((p) => p[0]),
      ys = all.map((p) => p[1]),
      minX = Math.min(...xs),
      minY = Math.min(...ys),
      width = Math.max(...xs) - minX,
      height = Math.max(...ys) - minY;
    if (width <= 0 || height <= 0 || width / height < 0.05 || width / height > 20)
      throw new Error('SVG 轮廓的宽高比例过于极端。');
    if (polygons.length > 16 || all.length > 1024 || polygons.some((p) => p.length > 512))
      throw new Error('SVG 轮廓节点过多，请简化路径后再导入。');
    return {
      aspect: width / height,
      contours: polygons.map((c) =>
        c.map(([x, y]) => ({ x: (x - minX) / width, y: (y - minY) / height })),
      ),
    };
  } finally {
    owned.reverse().forEach((s) => s.delete());
  }
}

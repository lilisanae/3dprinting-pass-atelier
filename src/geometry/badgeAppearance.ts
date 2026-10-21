import type { CrossSection, SimplePolygon } from 'manifold-3d';
import { getManifoldRuntime } from './engine';
import { applyShapeAppearance } from './shapeAppearance';
import { badgeOutline, validateBadgeBase, type BadgeBase } from '../model/badge';
import {
  outlineDistances,
  validateShapeAppearance,
  type ShapeAppearance,
} from '../model/shapeCatalog';
import { flattenPath } from '../artwork/paths';

/** Bake once for every consumer, retaining the unmodified source for further edits. */
export async function styleBadgeBase(
  base: BadgeBase,
  appearance: ShapeAppearance,
): Promise<BadgeBase> {
  validateBadgeBase(base);
  validateShapeAppearance(appearance);
  const source = base.outlineStyle?.source ?? {
    width: base.width,
    height: base.height,
    shape: base.shape,
    ...(base.contours ? { contours: base.contours } : {}),
  };
  const runtime = await getManifoldRuntime(),
    owned = new Set<CrossSection>();
  const own = (s: CrossSection) => {
    owned.add(s);
    return s;
  };
  try {
    const raw = own(
      new runtime.CrossSection(
        flattenPath(
          badgeOutline({ ...source, thickness: base.thickness, mounts: [] }),
          0.015,
        ) as SimplePolygon[],
        'EvenOdd',
      ),
    );
    const styled = applyShapeAppearance(raw, { kind: 'shape', ...appearance }, own);
    const components = styled.decompose().map(own);
    if (styled.isEmpty() || styled.area() < 1 || components.length !== 1)
      throw new Error('描边后底板为空或分成多块，请增加线宽、调整位置或开启填充。');
    const { outside } = outlineDistances(appearance);
    const previousOutside = base.outlineStyle
      ? outlineDistances(base.outlineStyle.appearance).outside
      : 0;
    const width = source.width + 2 * outside,
      height = source.height + 2 * outside;
    const polygons = styled.toPolygons();
    const coordinate = (v: number, size: number) => {
      if (v < -0.000001 || v > size + 0.000001) throw new Error('描边轮廓超出底板尺寸框。');
      // Clipper's fixed-point offsets can overshoot an exact border by nanometres.
      return Math.max(0, Math.min(1, v / size));
    };
    const area = (p: number[][]) =>
      Math.abs(
        p.reduce((s, a, i) => {
          const b = p[(i + 1) % p.length];
          return s + a[0] * b[1] - a[1] * b[0];
        }, 0),
      );
    polygons.sort((a, b) => area(b) - area(a));
    const next: BadgeBase = {
      ...base,
      width,
      height,
      shape: 'custom',
      contours: polygons.map((c) =>
        c.map(([x, y]) => ({
          x: coordinate(x + outside, width),
          y: coordinate(y + outside, height),
        })),
      ),
      mounts: base.mounts.map((m) => ({
        ...m,
        x: m.x + outside - previousOutside,
        y: m.y + outside - previousOutside,
      })),
      outlineStyle: { source: structuredClone(source), appearance: { ...appearance } },
    };
    validateBadgeBase(next);
    return next;
  } finally {
    [...owned].reverse().forEach((s) => s.delete());
  }
}

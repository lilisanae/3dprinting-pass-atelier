import type { CrossSection } from 'manifold-3d';
import type { DesignItem } from '../model/types';
import {
  outlineDistances,
  shapeAppearance,
  validateShapeAppearance,
  type ShapeAppearance,
} from '../model/shapeCatalog';

/** Round borders in physical millimetres, shared by solids and merge/cutting.
 * Legacy files remain inset; hollow centres stay hollow through export. */
export function applyShapeAppearance(
  section: CrossSection,
  item: Pick<DesignItem, 'kind'> & Partial<ShapeAppearance>,
  own: (section: CrossSection) => CrossSection,
): CrossSection {
  if (item.kind !== 'shape' && item.kind !== 'paths') return section;
  const appearance = shapeAppearance(item);
  validateShapeAppearance(appearance);
  if (!appearance.shapeOutline) return section;
  const { outside, inside } = outlineDistances(appearance);
  const outer = outside > 1e-9 ? own(section.offset(outside, 'Round', 2, 64)) : section;
  if (appearance.shapeFill) return outer;
  const inner = inside > 1e-9 ? own(section.offset(-inside, 'Round', 2, 64)) : section;
  return own(outer.subtract(inner));
}

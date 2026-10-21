import type { CrossSection, ManifoldToplevel } from 'manifold-3d';

export type CutoutMask = { remove: CrossSection; keep?: CrossSection };
type Own = (value: CrossSection) => CrossSection;

/** Subtractive tools accumulate holes; reversed tools constrain the shared keep region. */
export function addCutoutMask(
  runtime: ManifoldToplevel,
  previous: CutoutMask | undefined,
  shape: CrossSection,
  keepInside: boolean | undefined,
  own: Own,
): CutoutMask {
  const mask = previous ?? { remove: own(runtime.CrossSection.square(0)) };
  return keepInside
    ? {
        ...mask,
        keep: mask.keep ? own(runtime.CrossSection.intersection(mask.keep, shape)) : shape,
      }
    : { ...mask, remove: own(runtime.CrossSection.union(mask.remove, shape)) };
}

/** Crop all colors before ownership/stacking; a disjoint keep mask intentionally keeps nothing. */
export function applyCutoutMask(
  runtime: ManifoldToplevel,
  section: CrossSection,
  mask: CutoutMask | undefined,
  own: Own,
): CrossSection {
  if (!mask) return section;
  const kept = mask.keep ? own(runtime.CrossSection.intersection(section, mask.keep)) : section;
  return mask.remove.isEmpty() ? kept : own(runtime.CrossSection.difference(kept, mask.remove));
}

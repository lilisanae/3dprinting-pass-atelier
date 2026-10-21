import type { TemplatePlacement } from './types';

export type RotationPlacement = Pick<
  TemplatePlacement,
  'x' | 'y' | 'width' | 'height' | 'rotation'
>;

/** Smallest signed step, so crossing the atan2 seam does not jump by 360 degrees. */
export function rotationStep(previous: number, next: number): number {
  return ((((next - previous) * 180) / Math.PI + 540) % 360) - 180;
}

/** Rotate all members from the gesture's original placements, without cumulative drift. */
export function rotatePlacements(
  placements: RotationPlacement[],
  pivot: [number, number],
  delta: number,
): Array<Pick<TemplatePlacement, 'x' | 'y' | 'rotation'>> {
  const angle = (delta * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return placements.map((p) => {
    const dx = p.x + p.width / 2 - pivot[0],
      dy = p.y + p.height / 2 - pivot[1];
    return {
      x: p.x + dx * (c - 1) - dy * s,
      y: p.y + dx * s + dy * (c - 1),
      rotation: p.rotation + delta,
    };
  });
}

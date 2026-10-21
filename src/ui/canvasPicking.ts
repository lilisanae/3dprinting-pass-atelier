import type { Selection } from '../model/types';

export type CanvasPick = Extract<
  NonNullable<Selection>,
  { kind: 'item' | 'label' | 'panel' | 'decoration' }
>;
export type PickCycle = { screen: [number, number]; keys: string[]; index: number; key: string };

export function canvasPickKey(selection: Selection): string | undefined {
  if (selection?.kind === 'item')
    return JSON.stringify(['item', selection.collectionId, selection.id]);
  if (selection?.kind === 'label' || selection?.kind === 'panel') return selection.kind;
  if (selection?.kind === 'decoration') return JSON.stringify(['decoration', selection.id]);
}

/** SVG paint order and exact path fill, including holes and local transforms. */
export function canvasHitStack(
  svg: SVGSVGElement,
  screen: [number, number],
  eligible: (pick: CanvasPick) => boolean,
): CanvasPick[] {
  const seen = new Set<string>();
  const hits: CanvasPick[] = [];
  // Card-clipped layers outside its contour are not visible candidates.
  let insideCard = true;
  const clip = svg.querySelector<SVGPathElement>('#card-outline path');
  const viewport = svg.getScreenCTM();
  if (clip && viewport) {
    try {
      let transform = new DOMMatrix();
      const list = clip.transform.baseVal;
      for (let i = 0; i < list.numberOfItems; i++)
        transform = transform.multiply(list.getItem(i).matrix);
      const local = new DOMPoint(...screen)
        .matrixTransform(viewport.inverse())
        .matrixTransform(transform.inverse());
      insideCard = clip.isPointInFill(local);
    } catch {
      // Keep ordinary hit testing available if a browser cannot read the clip.
    }
  }
  for (const element of [...svg.querySelectorAll<SVGGraphicsElement>('.canvas-object')].reverse()) {
    const { pickKind, itemId, collectionId, pickId } = element.dataset;
    const pick: CanvasPick | undefined =
      pickKind === 'item' && itemId && collectionId
        ? { kind: 'item', collectionId, id: itemId }
        : pickKind === 'decoration' && pickId
          ? { kind: 'decoration', id: pickId }
          : pickKind === 'label' || pickKind === 'panel'
            ? { kind: pickKind }
            : undefined;
    if (!pick || !eligible(pick)) continue;
    if (!insideCard && element.closest('[clip-path="url(#card-outline)"]')) continue;
    const key = canvasPickKey(pick)!;
    if (seen.has(key)) continue;
    const paths =
      element instanceof SVGPathElement ? [element] : [...element.querySelectorAll('path')];
    const stroke = element.dataset.cuttingTool === 'true';
    const hit = paths.some((path) => {
      // Clip/mask definitions describe empty areas too; they are never painted hits.
      if (path.closest('defs')) return false;
      const side = path.dataset.outlineSide;
      const strokeMatrix = side ? path.getScreenCTM() : null;
      const halfWidth = Number(path.getAttribute('stroke-width')) / 2;
      const box = path.getBoundingClientRect(),
        margin =
          side && strokeMatrix
            ? halfWidth *
              Math.max(
                Math.hypot(strokeMatrix.a, strokeMatrix.b),
                Math.hypot(strokeMatrix.c, strokeMatrix.d),
              )
            : stroke
              ? 3
              : 0;
      if (
        screen[0] < box.left - margin ||
        screen[0] > box.right + margin ||
        screen[1] < box.top - margin ||
        screen[1] > box.bottom + margin
      )
        return false;
      const matrix = strokeMatrix ?? path.getScreenCTM();
      if (!matrix) return false;
      try {
        const local = new DOMPoint(...screen).matrixTransform(matrix.inverse());
        const inside = path.isPointInFill(local);
        if (side) return path.isPointInStroke(local) && (side === 'inside' ? inside : !inside);
        if (path.dataset.outlineOnly === 'true') return inside && path.isPointInStroke(local);
        return inside || (stroke && path.isPointInStroke(local));
      } catch {
        return false;
      }
    });
    if (hit) {
      seen.add(key);
      hits.push(pick);
    }
  }
  return hits;
}

/** Repeated clicks advance only while position, hit order and selection still match. */
export function nextCanvasPick(
  hits: CanvasPick[],
  screen: [number, number],
  selection: Selection,
  previous: PickCycle | null,
): { pick: CanvasPick; dragPick: CanvasPick; cycle: PickCycle } | undefined {
  if (!hits.length) return;
  const keys = hits.map((hit) => canvasPickKey(hit)!);
  const repeat =
    previous &&
    Math.hypot(screen[0] - previous.screen[0], screen[1] - previous.screen[1]) <= 4 &&
    canvasPickKey(selection) === previous.key &&
    keys.length === previous.keys.length &&
    keys.every((key, i) => key === previous.keys[i]);
  const index = repeat ? (previous.index + 1) % hits.length : 0;
  const dragIndex =
    previous && canvasPickKey(selection) === previous.key ? keys.indexOf(previous.key) : -1;
  return {
    pick: hits[index],
    // A drag keeps the previously chosen underlying layer; only clicks advance.
    dragPick: hits[dragIndex >= 0 ? dragIndex : 0],
    cycle: { screen, keys, index, key: keys[index] },
  };
}

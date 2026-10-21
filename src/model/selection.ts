import type { Project, Selection, TemplatePlacement } from './types';

export type ItemRef = { collectionId: string; id: string };
export function selectionEntries(selection: Selection): ItemRef[] {
  const values =
    selection?.kind === 'item' ? [selection] : selection?.kind === 'items' ? selection.items : [];
  const seen = new Set<string>();
  return values
    .filter(({ id }) => !seen.has(id) && !!seen.add(id))
    .map(({ collectionId, id }) => ({ collectionId, id }));
}
export function selectionContains(selection: Selection, ref: ItemRef): boolean {
  return selectionEntries(selection).some(
    (entry) => entry.id === ref.id && entry.collectionId === ref.collectionId,
  );
}
export function toggleItemSelection(
  selection: Selection,
  ref: ItemRef,
  additive: boolean,
): Selection {
  if (!additive) return { kind: 'item', ...ref };
  const entries = selectionEntries(selection);
  const selected = selectionContains(selection, ref);
  const next = selected ? entries.filter((entry) => entry.id !== ref.id) : [...entries, ref];
  return next.length > 1
    ? { kind: 'items', items: next }
    : next.length === 1
      ? { kind: 'item', ...next[0] }
      : null;
}
export function selectedItems(project: Project, selection: Selection) {
  return selectionEntries(selection).flatMap((ref) => {
    const collection = project.collections.find((c) => c.id === ref.collectionId);
    const item = collection?.items.find((i) => i.id === ref.id);
    return collection && item ? [{ ...ref, item, collection }] : [];
  });
}

export type Bounds2 = [number, number, number, number];
/** Axis-aligned bounds of the rotated placement, in the face's editor coordinates. */
export function placementBounds(
  placement: Pick<TemplatePlacement, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
): Bounds2 {
  const { x, y, width, height, rotation } = placement;
  const angle = (rotation * Math.PI) / 180;
  const extentX = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
  const extentY = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2;
  return [
    x + width / 2 - extentX,
    y + height / 2 - extentY,
    x + width / 2 + extentX,
    y + height / 2 + extentY,
  ];
}
export type Alignment =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'centerX'
  | 'centerY'
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'centerLeft'
  | 'center'
  | 'centerRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';
export type AlignmentOptions = {
  reference: 'board' | 'last' | 'point';
  width: number;
  height: number;
  alignment: Alignment;
  point?: { x: number; y: number };
};
type AlignablePlacement = Pick<TemplatePlacement, 'x' | 'y' | 'width' | 'height' | 'rotation'> & {
  id: string;
};
const factors: Record<Alignment, [number | null, number | null]> = {
  left: [0, null],
  right: [1, null],
  top: [null, 0],
  bottom: [null, 1],
  centerX: [0.5, null],
  centerY: [null, 0.5],
  topLeft: [0, 0],
  topCenter: [0.5, 0],
  topRight: [1, 0],
  centerLeft: [0, 0.5],
  center: [0.5, 0.5],
  centerRight: [1, 0.5],
  bottomLeft: [0, 1],
  bottomCenter: [0.5, 1],
  bottomRight: [1, 1],
};
/** Board/custom point move a selected group together. Last-picked keeps that
 * object fixed and aligns the others individually using their rotated bounds. */
export function alignPlacements(
  placements: AlignablePlacement[],
  options: AlignmentOptions,
): Array<{ id: string; x: number; y: number }> {
  if (!placements.length) return [];
  const [fx, fy] = factors[options.alignment];
  const allBounds = placements.map(placementBounds);
  const group: Bounds2 = [
    Math.min(...allBounds.map((b) => b[0])),
    Math.min(...allBounds.map((b) => b[1])),
    Math.max(...allBounds.map((b) => b[2])),
    Math.max(...allBounds.map((b) => b[3])),
  ];
  const point = options.point ?? { x: options.width / 2, y: options.height / 2 };
  if (![options.width, options.height, point.x, point.y].every(Number.isFinite))
    throw new Error('对齐目标坐标必须是有限数值。');
  const target: Bounds2 =
    options.reference === 'last'
      ? allBounds.at(-1)!
      : options.reference === 'point'
        ? [point.x, point.y, point.x, point.y]
        : [0, 0, options.width, options.height];
  return placements.map((placement, i) => {
    if (options.reference === 'last' && i === placements.length - 1)
      return { id: placement.id, x: placement.x, y: placement.y };
    const source = options.reference === 'last' ? allBounds[i] : group;
    const dx =
      fx === null
        ? 0
        : target[0] + (target[2] - target[0]) * fx - source[0] - (source[2] - source[0]) * fx;
    const dy =
      fy === null
        ? 0
        : target[1] + (target[3] - target[1]) * fy - source[1] - (source[3] - source[1]) * fy;
    return { id: placement.id, x: placement.x + dx, y: placement.y + dy };
  });
}

import type { Project, Selection, TemplatePlacement } from './types';
import { copyArtwork } from './booleanEditing';
import { isItemLocked } from './layerEditing';

export type DragEntry = { s: Selection; p: TemplatePlacement };

/** Called inside the drag's existing history transaction. Originals stay at the
 * pointer-down position, even when Alt is pressed halfway through the drag. */
export function duplicateDragItems(
  project: Project,
  entries: DragEntry[],
  includeHidden = false,
): DragEntry[] {
  const sources = entries.flatMap(({ s, p }) => {
    if (s?.kind !== 'item') return [];
    const collection = project.collections.find((c) => c.id === s.collectionId && c.visible);
    const item = collection?.items.find((i) => i.id === s.id && (includeHidden || i.visible));
    return collection && item && !isItemLocked(collection, item)
      ? [{ collection, item, origin: p }]
      : [];
  });
  if (!sources.length) return [];
  for (const { item, origin } of sources) {
    item.x = origin.x;
    item.y = origin.y;
  }
  const copies = copyArtwork(sources.map((source) => source.item));
  return copies.map((item, index) => {
    const { collection } = sources[index];
    item.name += ' 副本';
    collection.items.push(item);
    return { s: { kind: 'item', collectionId: collection.id, id: item.id }, p: { ...item } };
  });
}

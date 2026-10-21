import { isItemLocked } from './layerEditing';
import { pruneFolders } from './folderEditing';
import type { Collection, DesignItem, Face, Project, Selection } from './types';
import { collectionMode } from './project';

/** Front layers display top-to-bottom; storage and physical stacking stay bottom-to-top. */
export function faceCollections(project: Project, face: Face): Collection[] {
  const ordered = project.collections
    .filter((c) => c.face === face)
    .sort((a, b) =>
      face === 'front'
        ? Number(collectionMode(a) === 'raised') - Number(collectionMode(b) === 'raised')
        : 0,
    );
  return face === 'front' ? ordered.reverse() : ordered;
}

export function adjacentCollection(
  project: Project,
  collectionId: string,
  direction: -1 | 1,
): Collection | undefined {
  const source = project.collections.find((c) => c.id === collectionId);
  if (!source) return;
  const ordered = faceCollections(project, source.face);
  // Direction denotes physical height: -1 lowers and +1 raises an object.
  const step = source.face === 'front' ? -direction : direction;
  return ordered[ordered.findIndex((c) => c.id === collectionId) + step];
}

/** Move one existing object intact; never reorder/remove collections or cross faces. */
export function moveItemToAdjacentCollection(
  project: Project,
  collectionId: string,
  itemId: string,
  direction: -1 | 1,
): Selection {
  const source = project.collections.find((c) => c.id === collectionId);
  const target = adjacentCollection(project, collectionId, direction);
  const index = source?.items.findIndex((i: DesignItem) => i.id === itemId) ?? -1;
  if (
    !source ||
    !target ||
    index < 0 ||
    source.locked ||
    target.locked ||
    isItemLocked(source, source.items[index])
  )
    return null;
  const [item] = source.items.splice(index, 1);
  delete item.folderId;
  target.items.push(item);
  pruneFolders(project);
  return { kind: 'item', collectionId: target.id, id: item.id };
}

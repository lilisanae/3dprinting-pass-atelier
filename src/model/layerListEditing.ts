import type { Project, Selection, Collection } from './types';
import { selectedItems, selectionEntries } from './selection';
import { isItemLocked, isItemVisible } from './layerEditing';
import { faceCollections } from './collectionEditing';
import { folderSelection, groupLayers, pruneFolders } from './folderEditing';

/** Before/after refer to the visible list, which is reversed on the front. */
export type LayerDropTarget = {
  collectionId: string;
  kind: 'collection' | 'item' | 'folder';
  id: string;
  position: 'before' | 'after' | 'inside';
};

export function layerDragReason(project: Project, selection: Selection): string | null {
  const entries = selectedItems(project, selection);
  if (!entries.length || entries.length !== selectionEntries(selection).length)
    return '请选择要移动的图层';
  if (entries.some((e) => e.collection.face !== entries[0].collection.face))
    return '只能移动当前面的图层';
  if (entries.some((e) => !e.collection.visible || isItemLocked(e.collection, e.item)))
    return '请先显示集合并解锁要移动的图层';
  if (selection?.kind === 'items' && selection.folder) {
    const c = project.collections.find((c) => c.id === selection.folder!.collectionId);
    const members = c?.items.filter((i) => i.folderId === selection.folder!.id);
    if (!members?.length || members.some((i) => !entries.some((e) => e.item.id === i.id)))
      return '请先解锁文件夹中的全部图层';
  }
  return null;
}

export function layerDropReason(
  project: Project,
  selection: Selection,
  target: LayerDropTarget,
): string | null {
  const reason = layerDragReason(project, selection);
  if (reason) return reason;
  const entries = selectedItems(project, selection);
  const c = project.collections.find((c) => c.id === target.collectionId);
  if (!c || c.face !== entries[0].collection.face) return '不能移到另一面';
  if (!c.visible || c.locked) return '请先显示并解锁目标集合';
  if (target.kind === 'collection') return null;
  const ids = new Set(entries.map((e) => e.item.id));
  if (target.kind === 'item') {
    const item = c.items.find((i) => i.id === target.id);
    if (!item || !isItemVisible(c, item) || isItemLocked(c, item)) return '目标图层不可编辑';
    if (ids.has(item.id)) return '不能拖到所选图层自身';
    if (
      target.position === 'inside' &&
      item.folderId &&
      entries.every((e) => e.collection === c && e.item.folderId === item.folderId)
    )
      return '图层已经在这个文件夹里';
  } else {
    const folder = c.folders?.find((f) => f.id === target.id);
    const members = c.items.filter((i) => i.folderId === target.id);
    if (!folder || folder.locked || folder.visible === false || !members.length)
      return '目标文件夹不可编辑';
    if (members.every((i) => ids.has(i.id))) return '不能拖到所选文件夹自身';
    if (
      target.position === 'inside' &&
      entries.every((e) => e.collection === c && e.item.folderId === target.id)
    )
      return '图层已经在这个文件夹里';
  }
  return null;
}

function listSignature(project: Project) {
  return JSON.stringify(
    project.collections.map((c) => [
      c.id,
      c.items.map((i) => [i.id, i.folderId]),
      c.folders?.map((f) => f.id),
    ]),
  );
}

function insertionIndex(c: Collection, target: LayerDropTarget): number {
  const reversed = c.face === 'front';
  if (target.kind === 'collection')
    return target.position === 'after'
      ? reversed
        ? 0
        : c.items.length
      : reversed
        ? c.items.length
        : 0;
  const indices = c.items.flatMap((i, index) =>
    (target.kind === 'folder' ? i.folderId === target.id : i.id === target.id) ? [index] : [],
  );
  if (!indices.length) return c.items.length;
  const after = target.position !== 'before';
  return after !== reversed ? indices.at(-1)! + 1 : indices[0];
}

/** Apply one atomic list operation. Artwork, IDs, transforms and cut targets stay intact. */
export function dropLayerSelection(
  project: Project,
  selection: Selection,
  target: LayerDropTarget,
): Selection {
  if (layerDropReason(project, selection, target)) return null;
  const before = listSignature(project);
  const entries = selectedItems(project, selection);
  const destination = project.collections.find((c) => c.id === target.collectionId)!;
  const ids = new Set(entries.map((e) => e.item.id));
  // Use physical stacking order rather than the order of selection clicks.
  const collections = faceCollections(project, destination.face);
  if (destination.face === 'front') collections.reverse();
  const moving = collections.flatMap((c) => c.items.filter((i) => ids.has(i.id)));
  const targetItem =
    target.kind === 'item' ? destination.items.find((i) => i.id === target.id) : undefined;
  const intoFolder =
    target.kind === 'folder' && target.position === 'inside' ? target.id : targetItem?.folderId;
  const makeFolder = target.kind === 'item' && target.position === 'inside' && !intoFolder;
  // Entire folders move intact. Partial membership leaves the source folder.
  const keptFolders =
    !intoFolder && !makeFolder
      ? collections.flatMap((c) =>
          (c.folders ?? []).filter((f) => {
            const members = c.items.filter((i) => i.folderId === f.id);
            return members.length > 0 && members.every((i) => ids.has(i.id));
          }),
        )
      : [];
  const keptIds = new Set(keptFolders.map((f) => f.id));
  for (const c of project.collections) c.items = c.items.filter((i) => !ids.has(i.id));
  for (const folder of keptFolders)
    if (!destination.folders?.some((f) => f.id === folder.id))
      (destination.folders ??= []).push(folder);
  for (const item of moving) {
    if (intoFolder) item.folderId = intoFolder;
    else if (!item.folderId || !keptIds.has(item.folderId)) delete item.folderId;
  }
  let index = insertionIndex(destination, target);
  if (target.kind === 'folder' && target.position === 'inside') {
    const members = destination.items.flatMap((i, n) => (i.folderId === target.id ? [n] : []));
    index = destination.face === 'front' ? members.at(-1)! + 1 : members[0];
  }
  destination.items.splice(index, 0, ...moving);
  const refs = moving.map((i) => ({ collectionId: destination.id, id: i.id }));
  let next: Selection;
  if (makeFolder) {
    next = groupLayers(
      project,
      { kind: 'items', items: [...refs, { collectionId: destination.id, id: target.id }] },
      undefined,
      target.id,
    );
  } else {
    pruneFolders(project);
    next = intoFolder
      ? folderSelection(destination, intoFolder)
      : selection?.kind === 'items' && selection.folder && keptIds.has(selection.folder.id)
        ? folderSelection(destination, selection.folder.id)
        : refs.length === 1
          ? { kind: 'item', ...refs[0] }
          : { kind: 'items', items: refs };
  }
  return listSignature(project) === before ? null : next;
}

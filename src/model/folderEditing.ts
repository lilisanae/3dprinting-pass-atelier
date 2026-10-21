import type { Collection, DesignItem, LayerFolder, Project, Selection } from './types';
import { uid } from './project';
import { selectedItems } from './selection';
import { isItemLocked } from './layerEditing';

export type LayerUnit = { folder?: LayerFolder; items: DesignItem[] };

/** Folder members stay consecutive, while artwork IDs and cutting targets survive. */
export function layerUnits(collection: Collection): LayerUnit[] {
  const seen = new Set<string>();
  return collection.items.flatMap((item): LayerUnit[] => {
    const folder = collection.folders?.find((f) => f.id === item.folderId);
    if (!folder) return [{ items: [item] }];
    if (seen.has(folder.id)) return [];
    seen.add(folder.id);
    return [{ folder, items: collection.items.filter((i) => i.folderId === folder.id) }];
  });
}

export function pruneFolders(project: Project): void {
  for (const c of project.collections) {
    c.folders = c.folders?.filter((f) => c.items.some((i) => i.folderId === f.id));
    for (const item of c.items)
      if (item.folderId && !c.folders?.some((f) => f.id === item.folderId)) delete item.folderId;
    c.items = layerUnits(c).flatMap((u) => u.items);
  }
}

export function folderSelection(collection: Collection, id: string): Selection {
  return {
    kind: 'items',
    folder: { collectionId: collection.id, id },
    items: collection.items
      .filter((i) => i.folderId === id && !isItemLocked(collection, i))
      .map((i) => ({ collectionId: collection.id, id: i.id })),
  };
}

export function groupingReason(project: Project, selection: Selection): string | null {
  const entries = selectedItems(project, selection);
  if (entries.length < 2) return '请在同一集合中选择至少两个图层';
  if (entries.some((e) => e.collection.id !== entries[0].collection.id))
    return '文件夹只能包含同一集合的图层';
  if (entries.some((e) => isItemLocked(e.collection, e.item))) return '请先解锁要组合的图层';
  return null;
}

export function groupLayers(
  project: Project,
  selection: Selection,
  intoFolderId?: string,
  anchorId?: string,
): Selection {
  const entries = selectedItems(project, selection);
  const c = entries[0]?.collection;
  if (!c || c.locked || entries.some((e) => e.collection !== c || isItemLocked(c, e.item)))
    return null;
  let folder = c.folders?.find((f) => f.id === intoFolderId);
  if (folder?.locked || folder?.visible === false || (!folder && entries.length < 2)) return null;
  if (!folder) {
    folder = { id: uid('folder'), name: '新建文件夹', visible: true };
    (c.folders ??= []).push(folder);
  }
  const ids = new Set(entries.map((e) => e.item.id));
  const anchor = anchorId ?? entries[entries.length - 1].item.id;
  const anchorIndex = c.items.findIndex((i) => i.id === anchor);
  const members = c.items.filter((i) => ids.has(i.id) || i.folderId === folder!.id);
  const memberIds = new Set(members.map((i) => i.id));
  const before = c.items.slice(0, anchorIndex).filter((i) => !memberIds.has(i.id)).length;
  c.items = c.items.filter((i) => !memberIds.has(i.id));
  for (const i of members) i.folderId = folder.id;
  c.items.splice(before, 0, ...members);
  pruneFolders(project);
  return folderSelection(c, folder.id);
}

export function dissolveFolder(project: Project, collectionId: string, id: string): void {
  const c = project.collections.find((c) => c.id === collectionId);
  if (!c || c.locked || c.folders?.find((f) => f.id === id)?.locked) return;
  for (const i of c.items) if (i.folderId === id) delete i.folderId;
  c.folders = c.folders?.filter((f) => f.id !== id);
}

export function leaveFolder(project: Project, collectionId: string, id: string): void {
  const c = project.collections.find((c) => c.id === collectionId);
  const item = c?.items.find((i) => i.id === id);
  if (!c || !item?.folderId || isItemLocked(c, item)) return;
  const oldId = item.folderId;
  c.items = c.items.filter((i) => i.id !== id);
  const last = c.items.reduce((n, i, index) => (i.folderId === oldId ? index : n), -1);
  delete item.folderId;
  c.items.splice(last + 1, 0, item);
  pruneFolders(project);
}

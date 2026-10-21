import { pruneFolders } from './folderEditing';
import type { DesignItem, Project, Selection } from './types';
import { selectedItems } from './selection';
import { avoidsLowerArea } from './project';
import { isCuttingItem, pruneCutTargets } from './booleanEditing';
import { isItemLocked, isItemVisible } from './layerEditing';

export function mergeReason(project: Project, selection: Selection): string {
  const entries = selectedItems(project, selection);
  if (entries.length < 2) return '请选择至少两个图层。';
  if (new Set(entries.map((e) => e.collectionId)).size !== 1)
    return '请先将图层移到同一集合，避免改变高度。';
  if (
    entries.some((e) => !isItemVisible(e.collection, e.item) || isItemLocked(e.collection, e.item))
  )
    return '请先显示并解锁所选图层。';
  const { collection, item: first } = entries[0];
  if (entries.some((e) => isCuttingItem(e.item) !== isCuttingItem(first)))
    return '实体图案与切割工具不能混合合并。';
  if (isCuttingItem(first)) {
    if (entries.some((e) => !!e.item.cutout!.keepInside !== !!first.cutout!.keepInside))
      return '切割工具需要使用相同的裁切方向才能合并。';
    const targets = JSON.stringify(first.cutout!.targetIds.slice().sort());
    return entries.some((e) => JSON.stringify(e.item.cutout!.targetIds.slice().sort()) !== targets)
      ? '切割工具需要指定相同的目标才能合并。'
      : '';
  }
  const avoids = avoidsLowerArea(first),
    covers = first.coversLower !== false;
  if (
    entries.some(
      (e) => avoidsLowerArea(e.item) !== avoids || (e.item.coversLower !== false) !== covers,
    )
  )
    return '请先统一所选图层的覆盖与避让设置，保留原来的打印效果。';
  if (avoids || !covers) {
    const ids = new Set(entries.map((e) => e.id));
    const indices = collection.items.flatMap((item, i) => (ids.has(item.id) ? [i] : []));
    if (
      collection.items
        .slice(Math.min(...indices), Math.max(...indices) + 1)
        .some(
          (item) => isItemVisible(collection, item) && !isCuttingItem(item) && !ids.has(item.id),
        )
    )
      return '这些图层使用保留下层／避让规则，请一并选中夹在它们之间的实体图案。';
  }
  return '';
}

/** One atomic replacement; retain unrelated layers and cut targets. Baked cuts
 * must not be retargeted onto the whole merged footprint. */
export function applyMergedArtwork(
  project: Project,
  selection: Selection,
  merged: DesignItem,
): Selection {
  const reason = mergeReason(project, selection);
  if (reason) throw new Error(reason);
  const entries = selectedItems(project, selection),
    collection = entries[0].collection;
  const ids = new Set(entries.map((e) => e.id));
  const top = Math.max(...collection.items.flatMap((item, i) => (ids.has(item.id) ? [i] : [])));
  const insertion = collection.items.slice(0, top + 1).filter((item) => !ids.has(item.id)).length;
  collection.items = collection.items.filter((item) => !ids.has(item.id));
  if (
    entries[0].item.folderId &&
    entries.every((e) => e.item.folderId === entries[0].item.folderId)
  )
    merged.folderId = entries[0].item.folderId;
  collection.items.splice(insertion, 0, merged);
  pruneFolders(project);
  pruneCutTargets(project);
  return { kind: 'item', collectionId: collection.id, id: merged.id };
}

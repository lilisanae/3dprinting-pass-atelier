import { isCuttingItem } from './booleanEditing';
import { layerUnits } from './folderEditing';
import { selectedItems } from './selection';
import type { Collection, Face, Project, Selection } from './types';

/** Selection scope is independent of activeCutters and the printable cut masks. */
export function cutterViewScope(
  project: Project,
  face: Face,
  selection: Selection,
  previousTargets: ReadonlySet<string> = new Set(),
): { targetIds: Set<string>; cutterIds: Set<string> } {
  const entries = selectedItems(project, selection).filter((e) => e.collection.face === face);
  let targetIds = new Set(entries.filter((e) => !isCuttingItem(e.item)).map((e) => e.id));
  const selectedCutters = entries.filter((e) => isCuttingItem(e.item));
  if (!targetIds.size && selectedCutters.length) {
    const toolTargets = new Set(selectedCutters.flatMap((e) => e.item.cutout!.targetIds));
    const retained = new Set([...previousTargets].filter((id) => toolTargets.has(id)));
    // Moving a shared tool from target A must not suddenly reveal target B's tools.
    targetIds = retained.size ? retained : toolTargets;
  }
  const cutterIds = new Set(selectedCutters.map((e) => e.id));
  if (targetIds.size)
    for (const c of project.collections)
      if (c.face === face)
        for (const item of c.items)
          if (item.cutout?.targetIds.some((id) => targetIds.has(id))) cutterIds.add(item.id);
  return { targetIds, cutterIds };
}

/** Separate view sections without changing stack order, references or folder membership. */
export function collectionLayerSections(collection: Collection, face: Face) {
  const units = layerUnits(collection);
  if (face === 'front') units.reverse();
  return [
    { kind: 'artwork', label: '实体图层', cutting: false },
    { kind: 'cutters', label: '切割块', cutting: true },
  ]
    .map((section) => ({
      ...section,
      units: units.flatMap((unit) => {
        const items = unit.items.filter((item) => isCuttingItem(item) === section.cutting);
        return items.length ? [{ ...unit, items, totalItems: unit.items.length }] : [];
      }),
    }))
    .filter((section) => section.units.length);
}

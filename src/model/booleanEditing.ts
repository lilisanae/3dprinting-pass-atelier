import { isItemVisible } from './layerEditing';
import type { DesignItem, Project } from './types';
import { newShape, uid } from './project';

export const isCuttingItem = (item: DesignItem) => item.cutout !== undefined;

export function activeCutters(project: Project, targetId: string): DesignItem[] {
  const targetCollection = project.collections.find((c) =>
    c.items.some((i) => i.id === targetId && !isCuttingItem(i)),
  );
  if (!targetCollection) return [];
  return project.collections
    .filter((c) => c.visible && c.face === targetCollection.face)
    .flatMap((c) =>
      c.items.filter((i) => isItemVisible(c, i) && i.cutout?.targetIds.includes(targetId)),
    );
}

/** Build once per canvas snapshot instead of scanning all layers for each target. */
export function activeCuttersByTarget(project: Project): Map<string, DesignItem[]> {
  const faces = new Map(
    project.collections.flatMap((c) =>
      c.items.filter((i) => !isCuttingItem(i)).map((i) => [i.id, c.face] as const),
    ),
  );
  const targets = new Map<string, DesignItem[]>();
  for (const collection of project.collections) {
    if (!collection.visible) continue;
    for (const cutter of collection.items) {
      if (!cutter.cutout || !isItemVisible(collection, cutter)) continue;
      for (const id of new Set(cutter.cutout.targetIds)) {
        if (faces.get(id) !== collection.face) continue;
        const items = targets.get(id) ?? [];
        items.push(cutter);
        targets.set(id, items);
      }
    }
  }
  return targets;
}

export function newCutter(target: DesignItem): DesignItem {
  const width = Math.max(0.5, target.width * 0.4),
    height = Math.max(0.5, target.height * 0.4);
  return {
    ...newShape(target.colorId, 'circle'),
    name: `${target.name} · 切割`,
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
    rotation: target.rotation,
    cutout: { targetIds: [target.id] },
  };
}

/** Deleting/changing a target never leaves a broken reference in the saved design. */
export function pruneCutTargets(project: Project) {
  const targets = new Map(
    project.collections.flatMap((c) =>
      c.items.filter((i) => !isCuttingItem(i)).map((i) => [i.id, c.face] as const),
    ),
  );
  for (const c of project.collections)
    for (const item of c.items)
      if (item.cutout)
        item.cutout.targetIds = item.cutout.targetIds.filter((id) => targets.get(id) === c.face);
}

/** Copy related artwork together, preserving references to targets outside the copy. */
export function copyArtwork(items: DesignItem[]): DesignItem[] {
  const ids = new Map(items.map((i) => [i.id, uid()]));
  return items.map((item) => {
    const copy = { ...structuredClone(item), id: ids.get(item.id)! };
    if (copy.cutout) copy.cutout.targetIds = copy.cutout.targetIds.map((id) => ids.get(id) ?? id);
    return copy;
  });
}

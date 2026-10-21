import type {
  Collection,
  DesignItem,
  Project,
  Selection,
  TemplatePlacement,
  TemplateData,
} from './types';
import { defaultPanelPlacement } from './templateEditing';
import { selectionEntries } from './selection';

export const isItemLocked = (collection: Collection, item: DesignItem) =>
  !!(
    collection.locked ||
    item.locked ||
    collection.folders?.find((f) => f.id === item.folderId)?.locked
  );

export const isItemVisible = (collection: Collection, item: DesignItem) =>
  collection.visible &&
  item.visible &&
  collection.folders?.find((f) => f.id === item.folderId)?.visible !== false;

export function selectionLocked(project: Project, selection: Selection): boolean {
  if (selection?.kind === 'items' && selection.folder) {
    const c = project.collections.find((c) => c.id === selection.folder!.collectionId);
    if (c?.locked || c?.folders?.find((f) => f.id === selection.folder!.id)?.locked) return true;
  }
  if (selection?.kind === 'collection')
    return !!project.collections.find((c) => c.id === selection.id)?.locked;
  if (selection?.kind === 'label') return !!project.template.label?.locked;
  if (selection?.kind === 'panel') return !!project.template.panel?.locked;
  if (selection?.kind === 'decoration') return !!project.template.decorations[selection.id]?.locked;
  return selectionEntries(selection).some((ref) => {
    const collection = project.collections.find((c) => c.id === ref.collectionId);
    const item = collection?.items.find((i) => i.id === ref.id);
    return collection && item ? isItemLocked(collection, item) : false;
  });
}

/** Locking a parent removes every child from the active selection without
 * changing the child's own lock flag, visibility, artwork or print geometry. */
export function unlockedSelection(project: Project, selection: Selection): Selection {
  if (selection?.kind === 'label' && !project.template.label) return null;
  if (selection?.kind === 'panel' && project.template.panel === null) return null;
  if (selection?.kind === 'decoration' && !project.template.decorations[selection.id]) return null;
  if (selection?.kind === 'items' && selection.folder) {
    const c = project.collections.find((c) => c.id === selection.folder!.collectionId);
    const folder = c?.folders?.find((f) => f.id === selection.folder!.id);
    if (!c?.visible || c.locked || !folder || folder.locked || folder.visible === false)
      return null;
    return {
      ...selection,
      items: c.items
        .filter((i) => i.folderId === folder.id && !isItemLocked(c, i))
        .map((i) => ({ collectionId: c.id, id: i.id })),
    };
  }
  if (selection?.kind !== 'item' && selection?.kind !== 'items')
    return selectionLocked(project, selection) ? null : selection;
  const refs = selectionEntries(selection).filter((ref) => {
    const c = project.collections.find((c) => c.id === ref.collectionId && c.visible);
    const item = c?.items.find((i) => i.id === ref.id && i.visible);
    return c && item && isItemVisible(c, item) && !isItemLocked(c, item);
  });
  return refs.length > 1
    ? { kind: 'items', items: refs }
    : refs.length
      ? { kind: 'item', ...refs[0] }
      : null;
}

/** Guard all movement paths, including a stale drag, keyboard and property input.
 * Visibility and the object's own lock toggle remain available from the list. */
export function applyPlacementPatch(
  project: Project,
  selection: Selection,
  patch: Partial<TemplatePlacement>,
  template?: TemplateData,
): void {
  if (selection?.kind === 'panel') {
    if (project.template.panel === null) return;
    const panel =
      project.template.panel ?? (template ? defaultPanelPlacement(template) : undefined);
    if (!panel) return;
    project.template.panel = panel;
    if (panel.locked) {
      if (patch.visible !== undefined) panel.visible = patch.visible;
      if (patch.locked !== undefined) panel.locked = patch.locked;
    } else {
      const { colorId, ...placementPatch } = patch;
      Object.assign(panel, placementPatch);
      if (colorId !== undefined) project.template.panelColorId = colorId;
    }
    return;
  }
  let placement: TemplatePlacement | undefined;
  if (selection?.kind === 'label') placement = project.template.label ?? undefined;
  if (selection?.kind === 'decoration') placement = project.template.decorations[selection.id];
  if (selection?.kind === 'item')
    placement = project.collections
      .find((c) => c.id === selection.collectionId)
      ?.items.find((i) => i.id === selection.id);
  if (!placement) return;
  if (selectionLocked(project, selection)) {
    if (patch.visible !== undefined) placement.visible = patch.visible;
    if (patch.locked !== undefined) placement.locked = patch.locked;
  } else {
    const text = placement as TemplatePlacement & { textScaleX?: number; textScaleY?: number };
    if (patch.width !== undefined && text.textScaleX)
      text.textScaleX *= patch.width / placement.width;
    if (patch.height !== undefined && text.textScaleY)
      text.textScaleY *= patch.height / placement.height;
    Object.assign(placement, patch);
  }
}

/** View-only filtering: hidden tool overlays never pause the actual cut. */
export function canvasItemVisible(
  item: DesignItem,
  showCutters: boolean,
  collection?: Collection,
  visibleCutterIds?: ReadonlySet<string>,
): boolean {
  return (
    (collection ? isItemVisible(collection, item) : item.visible) &&
    (item.cutout === undefined ||
      (showCutters && (!visibleCutterIds || visibleCutterIds.has(item.id))))
  );
}

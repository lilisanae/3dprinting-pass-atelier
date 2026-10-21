import { validateShapeAppearance, type ShapeAppearance } from './shapeCatalog';
import type { DesignItem, Face, PaletteColor, Project, Selection } from './types';
import { collectionMode, DEFAULT_RAISED_THICKNESS, newCollection, uid } from './project';

export type SilhouetteUnderlay = {
  path: string;
  colorId: string;
  artworkThickness?: number;
  appearance?: ShapeAppearance;
};

/** Existing preceding raised group; backgrounds and the opposite face are not backing layers. */
export function silhouetteCollection(project: Project, targetId?: string) {
  const raised = project.collections.filter(
    (c) => c.face === 'front' && collectionMode(c) === 'raised',
  );
  const index = raised.findIndex((c) => c.id === targetId);
  return index > 0 ? raised[index - 1] : undefined;
}

export function lightestColorId(palette: PaletteColor[]): string {
  return palette.reduce((best, color) => {
    const brightness = (hex: string) =>
      0.2126 * parseInt(hex.slice(1, 3), 16) +
      0.7152 * parseInt(hex.slice(3, 5), 16) +
      0.0722 * parseInt(hex.slice(5, 7), 16);
    return brightness(color.hex) > brightness(best.hex) ? color : best;
  }, palette[0]).id;
}

/** Reuse the selected stack; only the bottommost import needs a new artwork layer above it. */
export function insertImportedArtwork(
  project: Project,
  face: Face,
  item: DesignItem,
  targetId?: string,
  underlay?: SilhouetteUnderlay,
): Selection {
  let target = project.collections.find((c) => c.id === targetId && c.face === face);
  if (targetId && !target) throw new Error('所选集合已不可用，请重新选择导入集合。');
  const previous = silhouetteCollection(project, target?.id);
  if (target?.locked || (underlay && previous?.locked))
    throw new Error('导入目标或剪影的下层集合已锁定，请先解锁。');
  const artworkThickness = underlay?.artworkThickness ?? DEFAULT_RAISED_THICKNESS;
  if (underlay) {
    validateShapeAppearance(underlay.appearance ?? {});
    if (face !== 'front' || (target && collectionMode(target) !== 'raised'))
      throw new Error('剪影垫层用于正面凸起集合，请先选择一个正面凸起集合。');
    if (!previous && (!Number.isFinite(artworkThickness) || artworkThickness <= 0))
      throw new Error('新图案集合厚度需要填写有限正数。');
    if (!underlay.path.trim() || !project.palette.some((c) => c.id === underlay.colorId))
      throw new Error('剪影轮廓或耗材颜色无效。');
  }
  if (!target) {
    target = newCollection(face, face === 'front' ? '新图案集合' : '背面图案', project);
    project.collections.push(target);
  }
  if (!underlay) {
    target.items.push(item);
    return { kind: 'item', collectionId: target.id, id: item.id };
  }
  const backing: DesignItem = {
    id: uid(),
    ...underlay.appearance,
    name: `${item.name} · 剪影`,
    kind: 'paths',
    visible: item.visible,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    rotation: item.rotation,
    colorId: underlay.colorId,
    coversLower: true,
    avoidsLower: false,
    regions: [{ path: underlay.path, colorId: underlay.colorId }],
    sourceWidth: item.sourceWidth,
    sourceHeight: item.sourceHeight,
  };
  const lower = previous ?? target;
  if (!previous) {
    const artwork = newCollection('front', `${item.name} · 图案集合`);
    artwork.visible = target.visible;
    artwork.thickness = artworkThickness;
    project.collections.splice(project.collections.indexOf(target) + 1, 0, artwork);
    target = artwork;
  }
  lower.items.push(backing);
  target.items.push(item);
  return {
    kind: 'items',
    items: [
      { collectionId: lower.id, id: backing.id },
      { collectionId: target.id, id: item.id },
    ],
  };
}

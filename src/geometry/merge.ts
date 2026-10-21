import { isItemVisible } from '../model/layerEditing';
import type { CrossSection, SimplePolygon } from 'manifold-3d';
import type { DesignItem, Project, Selection } from '../model/types';
import { ARTWORK_CURVE_TOLERANCE, getManifoldRuntime } from './engine';
import { parseFontPack } from '../artwork/font-pack';
import { contoursToPath, flattenPath, itemPath, placementTransform } from '../artwork/paths';
import { activeCutters, isCuttingItem } from '../model/booleanEditing';
import { avoidsLowerArea, uid } from '../model/project';
import { selectedItems } from '../model/selection';
import { mergeReason } from '../model/mergeEditing';
import { applyShapeAppearance } from './shapeAppearance';
import { addCutoutMask, applyCutoutMask, type CutoutMask } from './cutoutMask';

/** Real 2D CSG in the existing geometry worker. Coordinates remain in the
 * active face's editor space, so back artwork is not mirrored a second time. */
export async function mergeArtwork(
  project: Project,
  selection: Selection,
  fontBuffer: ArrayBuffer,
): Promise<DesignItem> {
  const reason = mergeReason(project, selection);
  if (reason) throw new Error(reason);
  const selected = selectedItems(project, selection),
    collection = selected[0].collection;
  const ids = new Set(selected.map((e) => e.id));
  const items = collection.items.filter((i) => ids.has(i.id)),
    first = items[0];
  const toolMode = isCuttingItem(first);
  const runtime = await getManifoldRuntime(),
    { CrossSection: CS } = runtime,
    font = parseFontPack(fontBuffer);
  const owned = new Set<CrossSection>();
  const own = (value: CrossSection) => {
    owned.add(value);
    return value;
  };
  const empty = () => own(CS.square(0));
  const union = (a: CrossSection, b: CrossSection) => own(CS.union(a, b));
  const diff = (a: CrossSection, b: CrossSection) => own(CS.difference(a, b));
  const part = (item: DesignItem) => {
    const polygons = placementTransform(
      flattenPath(itemPath(item, font), ARTWORK_CURVE_TOLERANCE),
      item,
    );
    return applyShapeAppearance(
      polygons.length ? own(new CS(polygons as SimplePolygon[], 'NonZero')) : empty(),
      item,
      own,
    );
  };
  const footprint = (item: DesignItem) =>
    item.kind === 'paths'
      ? (item.regions ?? []).reduce(
          (all, r) => union(all, part({ ...item, regions: [r] })),
          empty(),
        )
      : part(item);
  type Cell = { owner: string; colorId: string; section: CrossSection };
  try {
    const indices = collection.items.flatMap((item, index) => (ids.has(item.id) ? [index] : []));
    const span = toolMode
      ? items
      : collection.items
          .slice(Math.min(...indices), Math.max(...indices) + 1)
          .filter((i) => isItemVisible(collection, i) && !isCuttingItem(i));
    let cells: Cell[] = [],
      coverage = empty();
    const cutterCache = new Map<string, CrossSection>();
    let toolKeep: CrossSection | undefined;
    if (toolMode && first.cutout!.keepInside)
      for (const item of items) {
        const shape = footprint(item);
        toolKeep = toolKeep ? own(CS.intersection(toolKeep, shape)) : shape;
      }
    for (const item of span) {
      let cuts: CutoutMask | undefined;
      if (!toolMode)
        for (const cutter of activeCutters(project, item.id)) {
          let shape = cutterCache.get(cutter.id);
          if (!shape) {
            shape = footprint(cutter);
            cutterCache.set(cutter.id, shape);
          }
          cuts = addCutoutMask(runtime, cuts, shape, cutter.cutout!.keepInside, own);
        }
      const entries =
        item.kind === 'paths'
          ? (item.regions ?? []).map((r) => ({
              colorId: r.colorId,
              item: { ...item, regions: [r] },
            }))
          : [{ colorId: item.colorId, item }];
      let ownCoverage = empty();
      const ownCells: Cell[] = [];
      // Later colors within a multi-color image always win independently of
      // that item's rule for earlier artwork.
      for (const entry of entries.slice().reverse()) {
        const shape = applyCutoutMask(runtime, part(entry.item), cuts, own);
        ownCells.push({
          owner: item.id,
          colorId: entry.colorId,
          section: diff(shape, ownCoverage),
        });
        ownCoverage = union(ownCoverage, shape);
      }
      const keepsEarlier = !toolMode && (avoidsLowerArea(item) || item.coversLower === false);
      if (keepsEarlier)
        cells.push(...ownCells.map((cell) => ({ ...cell, section: diff(cell.section, coverage) })));
      else {
        cells = cells.map((cell) => ({ ...cell, section: diff(cell.section, ownCoverage) }));
        cells.push(...ownCells);
      }
      coverage = union(coverage, ownCoverage);
    }
    const colors = new Map<string, CrossSection>();
    for (const cell of cells.filter((cell) => ids.has(cell.owner) && !cell.section.isEmpty())) {
      const section = toolKeep ? own(CS.intersection(cell.section, toolKeep)) : cell.section;
      if (!section.isEmpty())
        colors.set(cell.colorId, union(colors.get(cell.colorId) ?? empty(), section));
    }
    const polygons = [...colors.values()].flatMap((s) => s.toPolygons());
    if (!polygons.length)
      throw new Error(
        toolMode && first.cutout!.keepInside
          ? '反向裁切工具没有共同重叠范围，无法合并为一个保留形状。'
          : '所选图案已完全被切割或遮挡，没有可合并的轮廓。',
      );
    const points = polygons.flat(),
      xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const x = Math.min(...xs),
      y = Math.min(...ys),
      width = Math.max(...xs) - x,
      height = Math.max(...ys) - y;
    return {
      id: uid(),
      name: `合并图案 · ${items.length} 层`,
      kind: 'paths',
      visible: true,
      locked: false,
      x,
      y,
      width,
      height,
      rotation: 0,
      sourceWidth: width,
      sourceHeight: height,
      colorId: first.colorId,
      coversLower: first.coversLower !== false,
      avoidsLower: avoidsLowerArea(first),
      regions: [...colors].map(([colorId, section]) => ({
        colorId,
        path: contoursToPath(
          section.toPolygons().map((c) => c.map(([px, py]) => [px - x, py - y])),
        ),
      })),
      ...(toolMode ? { cutout: structuredClone(first.cutout) } : {}),
    };
  } finally {
    for (const object of owned) object.delete();
  }
}

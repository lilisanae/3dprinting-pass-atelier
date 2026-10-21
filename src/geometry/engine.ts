import { isItemVisible } from '../model/layerEditing';
import { panelPlacement } from '../model/templateEditing';
import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { parseFontPack, type TextFont } from '../artwork/font-pack';
import { flattenPath, itemPath, placementTransform } from '../artwork/paths';
import {
  avoidsLowerArea,
  collectionMode,
  collectionInlayDepth,
  backSurfaceDepth,
  maxBackInlayDepth,
  frontSurfaceDepth,
} from '../model/project';
import { isCuttingItem } from '../model/booleanEditing';
import { applyShapeAppearance } from './shapeAppearance';
import { shapeAppearance } from '../model/shapeCatalog';
import { meshPart, processColorBodies, type ColorBody } from './colorInspection';
import { addCutoutMask, applyCutoutMask, type CutoutMask } from './cutoutMask';
import { badgeTemplate, validateBadgeBase, mountOutline, mountPlacement } from '../model/badge';
const DETAIL_WARNING_WIDTH = 0.2;
import type {
  DesignItem,
  Face,
  GeneratedModel,
  Issue,
  MeshPart,
  Project,
  TemplateData,
  TemplateObject,
  TemplatePlacement,
} from '../model/types';

export const ARTWORK_CURVE_TOLERANCE = 0.035;
let runtimePromise: Promise<ManifoldToplevel> | undefined;
let runtimeWasmUrl: string | undefined;
const parsedFonts = new WeakMap<ArrayBuffer, TextFont>();
export function configureManifold(wasmUrl: string) {
  if (runtimePromise) throw new Error('几何运行时已初始化。');
  runtimeWasmUrl = wasmUrl;
}
export function getManifoldRuntime(): Promise<ManifoldToplevel> {
  const url = runtimeWasmUrl;
  return (runtimePromise ??= Module(url ? { locateFile: () => url } : undefined).then((m) => {
    m.setup();
    return m;
  }));
}

/** Own every embind object, including boolean intermediates, for worker longevity. */
class Arena {
  private objects: Set<{ delete(): void }> = new Set();
  own<T extends { delete(): void }>(value: T): T {
    this.objects.add(value);
    return value;
  }
  dispose() {
    for (const o of this.objects) o.delete();
    this.objects.clear();
  }
}
type ColoredSolid = { colorId: string; name: string; solid: Manifold; protected: boolean };
type Region = {
  colorId: string;
  name: string;
  section: CrossSection;
  top: number;
  inlayDepth: number;
  itemId: string;
  coversLower: boolean;
};

/** True CSG geometry: each output color owns an exclusive closed physical volume. */
export async function generateGeometry(
  project: Project,
  template: TemplateData,
  fontBuffer: ArrayBuffer,
  options?: { inspectionWidth: number },
): Promise<GeneratedModel> {
  if (project.format === 'badge-atelier') {
    validateBadgeBase(project.badgeBase);
    template = badgeTemplate(project.badgeBase);
  }
  const m = await getManifoldRuntime();
  const arena = new Arena();
  const own = <T extends { delete(): void }>(o: T) => arena.own(o);
  const issues: Issue[] = [];
  let font = parsedFonts.get(fontBuffer);
  if (!font) {
    font = parseFontPack(fontBuffer);
    parsedFonts.set(fontBuffer, font);
  }
  const { CrossSection: CS, Manifold: MF, Mesh } = m;
  const section = (contours: number[][][]): CrossSection =>
    contours.length ? own(new CS(contours as SimplePolygon[], 'NonZero')) : own(CS.square(0));
  const emptySection = () => own(CS.square(0));
  const union2 = (a: CrossSection, b: CrossSection) => own(CS.union(a, b));
  const diff2 = (a: CrossSection, b: CrossSection) => own(CS.difference(a, b));
  const intersect2 = (a: CrossSection, b: CrossSection) => own(CS.intersection(a, b));
  const union3 = (parts: Manifold[]) => own(MF.union(parts));
  const diff3 = (a: Manifold, b: Manifold) => own(MF.difference(a, b));
  const intersect3 = (a: Manifold, b: Manifold) => own(MF.intersection(a, b));
  // Manifold 3.5 rejects extruding an empty section with InvalidConstruction.
  // Preserve a valid empty solid so boolean difference keeps its left operand.
  const prism = (s: CrossSection, z: number, height: number) =>
    s.isEmpty() ? union3([]) : own(own(s.extrude(height)).translate([0, 0, z]));
  const world = (contours: number[][][], face: Face = 'front') =>
    contours.map((c) =>
      c.map(([x, y]) => [face === 'back' ? template.width - x : x, template.height - y]),
    );
  const fromMesh = (
    object: TemplateObject,
    placement?: TemplatePlacement,
    frame: TemplateObject = object,
  ): Manifold => {
    const positions = new Float32Array(object.positions);
    if (placement) {
      const [x0, y0, , x1, y1] = frame.bounds;
      const sx = placement.width / (x1 - x0),
        sy = placement.height / (y1 - y0);
      const radians = (placement.rotation * Math.PI) / 180,
        cos = Math.cos(radians),
        sin = Math.sin(radians);
      const cx = placement.width / 2,
        cy = placement.height / 2;
      for (let v = 0; v < positions.length; v += 3) {
        const x = ((positions[v] - x0) * sx - cx) * (placement.mirrorX ? -1 : 1),
          y = ((y1 - positions[v + 1]) * sy - cy) * (placement.mirrorY ? -1 : 1);
        positions[v] = placement.x + cx + cos * x - sin * y;
        positions[v + 1] = template.height - (placement.y + cy + sin * x + cos * y);
      }
    }
    const indices = new Uint32Array(object.indices);
    if (!!placement?.mirrorX !== !!placement?.mirrorY)
      for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    const mesh = new Mesh({
      numProp: 3,
      vertProperties: positions,
      triVerts: indices,
      tolerance: 1e-6,
    });
    mesh.merge();
    const solid = own(new MF(mesh));
    if (solid.status() !== 'NoError')
      throw new Error(`模板「${object.name}」网格不闭合：${solid.status()}`);
    return solid;
  };
  const colors = new Set(project.palette.map((c) => c.id));
  const assertColor = (id: string) => {
    if (!colors.has(id)) throw new Error(`找不到材料颜色 ${id}。`);
  };
  for (const c of project.collections)
    if (!Number.isFinite(c.thickness) || c.thickness <= 0) throw new Error('集合厚度必须为正数。');
  for (const c of project.collections) {
    if (!c.visible) continue;
    if (collectionMode(c) === 'raised' && c.thickness < 0.1)
      issues.push({
        severity: 'warning',
        message: `集合「${c.name}」厚度 ${c.thickness.toFixed(3)} mm 较薄，请结合实际层高确认。`,
      });
    for (const item of c.items) {
      if (!isItemVisible(c, item)) continue;
      if (isCuttingItem(item)) {
        if (!item.cutout!.targetIds.length)
          issues.push({
            severity: 'warning',
            itemId: item.id,
            message: `切割工具「${item.name}」尚未选择被切图案。`,
          });
        continue;
      }
      if (item.kind === 'shape' && Math.min(item.width, item.height) < DETAIL_WARNING_WIDTH - 1e-6)
        issues.push({
          severity: 'warning',
          itemId: item.id,
          message: `「${item.name}」局部宽度约 ${Math.min(item.width, item.height).toFixed(2)} mm，建议用 0.2 mm 喷嘴或在切片预览中确认细线保留情况。`,
        });
      if (
        item.kind !== 'text' &&
        !shapeAppearance(item).shapeFill &&
        shapeAppearance(item).shapeOutlineWidth < DETAIL_WARNING_WIDTH - 1e-6
      )
        issues.push({
          severity: 'warning',
          itemId: item.id,
          message: `「${item.name}」轮廓线宽小于 0.2 mm，请在切片预览中确认细线保留情况。`,
        });
      if (item.kind === 'text') {
        const lines = (item.text ?? '').split('\n').filter((line) => line.trim()).length || 1;
        if (item.height / lines < 2)
          issues.push({
            severity: 'warning',
            itemId: item.id,
            message: `「${item.name}」每行文字高度约 ${(item.height / lines).toFixed(2)} mm，请在切片预览中检查小字笔画。`,
          });
      }
    }
  }
  try {
    const baseObject = template.objects.find((o) => o.role === 'base');
    if (!baseObject) throw new Error('模板缺少底板。');
    let originalBase: Manifold;
    if (project.format === 'badge-atelier') {
      const footprint = own(
        new CS(world(flattenPath(baseObject.outlinePath, 0.005)) as SimplePolygon[], 'EvenOdd'),
      );
      const components = footprint.decompose().map(own);
      if (footprint.isEmpty() || footprint.area() < 1 || components.length !== 1)
        throw new Error('徽章底板需要一块相连的闭合轮廓；请检查交叉线、分离片或过大的镂空。');
      originalBase = prism(footprint, 0, template.thickness);
      const safeInterior = own(footprint.offset(-0.6, 'Round'));
      for (const mount of project.badgeBase!.mounts) {
        const slot = section(
          world(
            placementTransform(flattenPath(mountOutline(mount), 0.0025), mountPlacement(mount)),
            'back',
          ),
        );
        if (!diff2(slot, safeInterior).isEmpty())
          throw new Error('安装槽需要完整放在底板内部，并与外边缘、镂空保持至少 0.6 mm 距离。');
        originalBase = diff3(originalBase, prism(slot, -0.01, mount.depth + 0.01));
      }
    } else originalBase = fromMesh(baseObject);
    // Reuse the imported float32 top so adjacent front/base faces coincide exactly.
    const T = originalBase.boundingBox().max[2];
    const frontDepth = frontSurfaceDepth(project);
    const rearDepth = backSurfaceDepth(project.collections, project);
    if (T <= frontDepth + rearDepth) throw new Error('底板厚度不足以保留两面嵌色后的核心。');
    for (const c of project.collections.filter((c) => c.face === 'back')) {
      const depth = collectionInlayDepth(c, project);
      if (!Number.isFinite(depth) || depth <= 0 || depth > maxBackInlayDepth(T, project))
        throw new Error(
          `背面集合「${c.name}」嵌入深度须大于 0，且不超过 ${maxBackInlayDepth(T, project)} mm。`,
        );
    }
    const baseSection = own(originalBase.project());
    const maxOriginalZ = Math.max(T, ...template.objects.map((o) => o.bounds[5]));
    let totalFrontHeight = 0;
    for (const c of project.collections)
      if (collectionMode(c) === 'raised' && c.visible) totalFrontHeight += c.thickness;
    if (!Number.isFinite(totalFrontHeight) || !Number.isFinite(Math.fround(T + totalFrontHeight)))
      throw new Error('尺寸超出网格可计算范围，请检查集合厚度。');
    const columnTop = Math.max(maxOriginalZ + 1, T + totalFrontHeight + 1);
    const baseColumn = prism(baseSection, T, columnTop - T);
    const itemSection = (item: DesignItem, face: Face) => {
      const path = itemPath(item, font);
      const contours = flattenPath(path, ARTWORK_CURVE_TOLERANCE);
      if (
        item.kind === 'paths' &&
        contours.some((contour) => {
          const xs = contour.map((p) => p[0]),
            ys = contour.map((p) => p[1]);
          return (
            Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) <
            DETAIL_WARNING_WIDTH - 1e-6
          );
        }) &&
        !issues.some((issue) => issue.itemId === item.id)
      )
        issues.push({
          severity: 'warning',
          itemId: item.id,
          message: `「${item.name}」含小于 0.2 mm 的轮廓细节，可能会影响打印效果，请按实际喷嘴与层高检查切片预览。`,
        });
      return applyShapeAppearance(
        section(world(placementTransform(contours, item), face)),
        item,
        own,
      );
    };
    const supportAndClip = (solid: Manifold) => {
      const bounds = solid.boundingBox();
      let result = solid;
      if (bounds.min[2] > T + 1e-6) {
        // Source letters/decorations can float microns above the plate. This
        // support stays below the original visible silhouette and seals the gap.
        result = union3([solid, prism(own(solid.project()), T, bounds.min[2] - T)]);
      }
      return intersect3(result, baseColumn);
    };
    const originals: ColoredSolid[] = [];
    let protectedSection = emptySection();
    const panel = template.objects.find((o) => o.role === 'fixed-panel');
    const panelFrame = panelPlacement(project, template);
    if (panel && panelFrame.visible) {
      const panelRectangle = itemSection(
        {
          ...panelFrame,
          id: 'template-panel',
          name: '侧边框',
          kind: 'shape',
          shape: 'rect',
        },
        'front',
      );
      protectedSection = union2(protectedSection, panelRectangle);
      assertColor(project.template.panelColorId);
      originals.push({
        name: panel.name,
        colorId: project.template.panelColorId,
        solid: supportAndClip(fromMesh(panel, panelFrame)),
        protected: true,
      });
    }
    for (const detail of template.objects.filter((o) => o.role === 'fixed-detail')) {
      if (!panel || !panelFrame.visible) continue;
      assertColor(project.template.panelDetailColorId);
      originals.push({
        name: detail.name,
        colorId: project.template.panelDetailColorId,
        solid: supportAndClip(fromMesh(detail, panelFrame, panel)),
        protected: true,
      });
    }
    const labelObject = template.objects.find((o) => o.role === 'editable-label');
    const label = project.template.label;
    if (labelObject && label?.visible) {
      assertColor(label.colorId);
      let solid: Manifold;
      if (label.useOriginal) solid = supportAndClip(fromMesh(labelObject, label));
      else {
        const labelItem: DesignItem = {
          ...label,
          id: 'template-label',
          name: '模板文字',
          kind: 'text',
          text: label.text,
          fontId: label.fontId,
          letterSpacing: label.letterSpacing,
          lineHeight: label.lineHeight,
          textAlign: label.textAlign,
        };
        const contour = intersect2(itemSection(labelItem, 'front'), baseSection);
        solid = prism(contour, T, labelObject.height);
      }
      protectedSection = union2(protectedSection, own(solid.project()));
      originals.push({ name: labelObject.name, colorId: label.colorId, solid, protected: true });
    }
    for (const object of template.objects.filter((o) => o.role === 'decoration')) {
      const placement = project.template.decorations[object.id];
      if (!placement?.visible) continue;
      assertColor(placement.colorId);
      let solid = supportAndClip(fromMesh(object, placement));
      // Keep protected template projections exclusive even after moving a decoration.
      solid = diff3(solid, prism(protectedSection, T, columnTop - T));
      originals.unshift({ name: object.name, colorId: placement.colorId, solid, protected: false });
    }
    // Resolve internal source overlaps physically. Protected label/detail wins.
    let originalCoverage: Manifold | undefined;
    const exclusiveOriginals: ColoredSolid[] = [];
    for (const original of originals.slice().reverse()) {
      const solid = originalCoverage ? diff3(original.solid, originalCoverage) : original.solid;
      originalCoverage = originalCoverage
        ? union3([originalCoverage, original.solid])
        : original.solid;
      exclusiveOriginals.push({ ...original, solid });
    }
    const unprotectedOriginal = union3(
      exclusiveOriginals.filter((o) => !o.protected).map((o) => o.solid),
    );
    const cuts = new Map<string, CutoutMask>();
    for (const c of project.collections.filter((c) => c.visible))
      for (const tool of c.items.filter((i) => isItemVisible(c, i) && isCuttingItem(i))) {
        const cutterSection =
          tool.kind === 'paths'
            ? (tool.regions ?? []).reduce(
                (all, region) => union2(all, itemSection({ ...tool, regions: [region] }, c.face)),
                emptySection(),
              )
            : itemSection(tool, c.face);
        for (const id of tool.cutout!.targetIds) {
          const targetCollection = project.collections.find(
            (group) =>
              group.face === c.face && group.items.some((i) => i.id === id && !isCuttingItem(i)),
          );
          if (targetCollection)
            cuts.set(
              id,
              addCutoutMask(m, cuts.get(id), cutterSection, tool.cutout!.keepInside, own),
            );
        }
      }
    const collectRegions = (face: Face) => {
      const background: Region[] = [];
      const raised: Region[] = [];
      let cumulative = 0;
      let earlier = emptySection();
      const collections = project.collections.filter((c) => c.face === face && c.visible);
      // A face background is below every raised group regardless of list order.
      // Original decorations enter the lower-artwork mask between these phases.
      const ordered = [
        ...collections.filter((c) => collectionMode(c) === 'background'),
        ...collections.filter((c) => collectionMode(c) === 'raised'),
      ];
      let enteredRaised = false;
      for (const c of ordered) {
        const mode = collectionMode(c);
        if (mode === 'raised') {
          if (!enteredRaised) {
            if (!unprotectedOriginal.isEmpty())
              earlier = union2(earlier, own(unprotectedOriginal.project()));
            enteredRaised = true;
          }
          cumulative += c.thickness;
        }
        for (const item of c.items) {
          if (!isItemVisible(c, item) || isCuttingItem(item)) continue;
          const entries =
            item.kind === 'paths'
              ? (item.regions ?? []).map((r) => ({
                  item: { ...item, regions: [r] },
                  colorId: r.colorId,
                }))
              : [{ item, colorId: item.colorId }];
          let itemCoverage = emptySection();
          for (const entry of entries) {
            assertColor(entry.colorId);
            let region = intersect2(itemSection(entry.item, face), baseSection);
            region = applyCutoutMask(m, region, cuts.get(item.id), own);
            if (face === 'front') region = diff2(region, protectedSection);
            // Every region in one image sees the same earlier-item mask. Its
            // own later regions still win internally in exclusiveRegions.
            if (avoidsLowerArea(item) || (mode === 'background' && item.coversLower === false))
              region = diff2(region, earlier);
            if (region.isEmpty()) continue;
            itemCoverage = union2(itemCoverage, region);
            (mode === 'raised' ? raised : background).push({
              name: item.name,
              colorId: entry.colorId,
              section: region,
              top: cumulative,
              inlayDepth: collectionInlayDepth(c, project),
              itemId: item.id,
              coversLower: item.coversLower !== false || avoidsLowerArea(item),
            });
          }
          earlier = union2(earlier, itemCoverage);
        }
      }
      return { background, raised };
    };
    const exclusiveRegions = (regions: Region[]) => {
      const result: Region[] = [];
      let coverage = emptySection();
      for (const region of regions.slice().reverse()) {
        const exclusive = diff2(region.section, coverage);
        coverage = union2(coverage, region.section);
        if (!exclusive.isEmpty()) result.push({ ...region, section: exclusive });
      }
      return { regions: result, coverage };
    };
    const frontRegions = collectRegions('front');
    const front = exclusiveRegions(frontRegions.raised);
    const frontBackground = exclusiveRegions(frontRegions.background);
    const backRegions = collectRegions('back').background;
    const byColor = new Map<string, { solids: Manifold[]; names: Set<string> }>();
    const add = (colorId: string, name: string, solid: Manifold) => {
      if (solid.isEmpty()) return;
      let group = byColor.get(colorId);
      if (!group) {
        group = { solids: [], names: new Set() };
        byColor.set(colorId, group);
      }
      group.solids.push(solid);
      group.names.add(name);
    };
    if (frontRegions.raised.some((region) => !region.coversLower)) {
      // Resolve per object so its own later color regions still win. Only the
      // existing lower volume is subtracted when coverage is disabled; the
      // portion above that volume continues to the object's collection top.
      let solids = exclusiveOriginals.filter((original) => !original.protected);
      const batches: Region[][] = [];
      for (const region of frontRegions.raised) {
        if (batches.at(-1)?.[0].itemId === region.itemId) batches.at(-1)!.push(region);
        else batches.push([region]);
      }
      for (const batch of batches) {
        const resolved = exclusiveRegions(batch);
        const coversLower = batch[0].coversLower;
        const lowerVolume = coversLower ? undefined : union3(solids.map((part) => part.solid));
        if (coversLower) {
          const column = prism(resolved.coverage, T, columnTop - T);
          solids = solids.map((part) => ({ ...part, solid: diff3(part.solid, column) }));
        }
        for (const region of resolved.regions) {
          const body = prism(region.section, T, region.top);
          const solid = coversLower
            ? union3([
                body,
                intersect3(unprotectedOriginal, prism(region.section, T, columnTop - T)),
              ])
            : diff3(body, lowerVolume!);
          solids.push({ colorId: region.colorId, name: region.name, solid, protected: false });
        }
      }
      for (const part of [
        ...exclusiveOriginals.filter((original) => original.protected),
        ...solids,
      ])
        add(part.colorId, part.name, part.solid);
    } else {
      // Keep the existing fast 2D ownership path for default/legacy designs.
      const overwriteColumn = prism(front.coverage, T, columnTop - T);
      for (const original of exclusiveOriginals) {
        add(
          original.colorId,
          original.name,
          original.protected ? original.solid : diff3(original.solid, overwriteColumn),
        );
      }
      for (const region of front.regions) {
        // The highest collection/item owns the full existing front column,
        // including any original decoration taller than this collection.
        const column = prism(region.section, T, columnTop - T);
        const retainedDecoration = intersect3(unprotectedOriginal, column);
        add(
          region.colorId,
          region.name,
          union3([prism(region.section, T, region.top), retainedDecoration]),
        );
      }
    }
    assertColor(project.template.baseColorId);
    const frontColorId = project.template.frontColorId ?? project.template.baseColorId;
    const backColorId = project.template.backColorId ?? project.template.baseColorId;
    assertColor(frontColorId);
    assertColor(backColorId);
    const rearSkin = intersect3(originalBase, prism(baseSection, 0, rearDepth));
    const frontSkin = intersect3(originalBase, prism(baseSection, T - frontDepth, frontDepth));
    // Resolve ownership per depth band. Shallower later artwork covers the
    // surface while deeper earlier colors remain below it, without overlaps.
    const rearDepths = [...new Set(backRegions.map((region) => region.inlayDepth))].sort(
      (a, b) => a - b,
    );
    const rearCuts: Manifold[] = [];
    let sliceBottom = 0;
    for (const depth of rearDepths) {
      const slice = exclusiveRegions(backRegions.filter((region) => region.inlayDepth >= depth));
      const height = depth - sliceBottom;
      rearCuts.push(prism(slice.coverage, sliceBottom, height));
      for (const region of slice.regions)
        add(
          region.colorId,
          region.name,
          intersect3(originalBase, prism(region.section, sliceBottom, height)),
        );
      sliceBottom = depth;
    }
    const rearArtwork = union3(rearCuts);
    const core = diff3(originalBase, union3([rearSkin, frontSkin]));
    add(project.template.baseColorId, '中间底板', core);
    add(
      frontColorId,
      '正面底色',
      diff3(frontSkin, prism(frontBackground.coverage, T - frontDepth, frontDepth)),
    );
    add(backColorId, '背面底色', diff3(rearSkin, rearArtwork));
    for (const region of frontBackground.regions)
      add(
        region.colorId,
        region.name,
        intersect3(frontSkin, prism(region.section, T - frontDepth, frontDepth)),
      );
    const rawBodies: ColorBody[] = [];
    for (const color of project.palette) {
      const group = byColor.get(color.id);
      if (!group) continue;
      const solid = own(union3(group.solids).simplify(0.00002));
      if (solid.status() !== 'NoError')
        throw new Error(`颜色「${color.name}」实体生成失败：${solid.status()}`);
      if (solid.volume() >= 1e-8) rawBodies.push({ colorId: color.id, name: color.name, solid });
    }
    for (const correction of project.colorCorrections ?? [])
      if (correction.mode !== 'remove') assertColor(correction.colorId);
    const processed = processColorBodies(
      m,
      rawBodies,
      project.colorCorrections,
      options?.inspectionWidth,
      own,
      T / 2,
    );
    if (processed.inactive)
      issues.push({
        severity: 'warning',
        message: `${processed.inactive} 条实体处理与当前几何不匹配，已暂停应用；请重新检查或清除处理记录。`,
      });
    const meshes: MeshPart[] = [];
    const finalSolids: Manifold[] = [];
    const bounds: [number, number, number, number, number, number] = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    let triangles = 0,
      totalVolume = 0;
    for (const color of project.palette) {
      const body = processed.bodies.find((entry) => entry.colorId === color.id);
      if (!body) continue;
      const solid = body.solid;
      if (solid.status() !== 'NoError')
        throw new Error(`颜色「${color.name}」实体生成失败：${solid.status()}`);
      const volume = solid.volume();
      if (volume < 1e-8) continue;
      const part = meshPart(solid, color.id, color.name),
        { positions, indices } = part;
      if (!positions.every(Number.isFinite))
        throw new Error('尺寸超出网格可计算范围，请检查图案尺寸与集合厚度。');
      const box = solid.boundingBox();
      for (let axis = 0; axis < 3; axis++) {
        bounds[axis] = Math.min(bounds[axis], box.min[axis]);
        bounds[axis + 3] = Math.max(bounds[axis + 3], box.max[axis]);
      }
      triangles += indices.length / 3;
      totalVolume += volume;
      meshes.push(part);
      finalSolids.push(solid);
    }
    if (!meshes.length) throw new Error('项目未生成任何实体。');
    const assembled = union3(finalSolids);
    if (assembled.status() !== 'NoError') throw new Error('最终模型未形成闭合实体。');
    return {
      meshes,
      issues,
      bounds,
      ...(processed.inspection ? { colorInspection: processed.inspection } : {}),
      ...(project.colorCorrections?.length
        ? { colorCorrectionStats: { applied: processed.applied, inactive: processed.inactive } }
        : {}),
      stats: {
        triangles,
        volume: totalVolume,
        colors: meshes.length,
        frontHeight: bounds[5] - T,
        coreThickness: T - frontDepth - rearDepth,
      },
    };
  } finally {
    arena.dispose();
  }
}

/** Geometric validation utility shared by export tests; no surface painting. */
export async function inspectGeneratedModel(model: GeneratedModel) {
  const m = await getManifoldRuntime();
  const solids: Manifold[] = [];
  try {
    const closed = model.meshes.map((part) => {
      const mesh = new m.Mesh({
        numProp: 3,
        vertProperties: part.positions,
        triVerts: part.indices,
      });
      mesh.merge();
      const solid = new m.Manifold(mesh);
      solids.push(solid);
      return solid.status() === 'NoError';
    });
    const overlaps: number[][] = [];
    for (let a = 0; a < solids.length; a++)
      for (let b = a + 1; b < solids.length; b++) {
        const intersection = m.Manifold.intersection(solids[a], solids[b]);
        try {
          overlaps.push([a, b, intersection.volume()]);
        } finally {
          intersection.delete();
        }
      }
    const combined = m.Manifold.union(solids);
    const components = combined.decompose();
    try {
      return {
        closed,
        overlaps,
        unionVolume: combined.volume(),
        components: components.length,
        componentBounds: components.map((c) => c.boundingBox()),
      };
    } finally {
      components.forEach((c) => c.delete());
      combined.delete();
    }
  } finally {
    solids.forEach((s) => s.delete());
  }
}

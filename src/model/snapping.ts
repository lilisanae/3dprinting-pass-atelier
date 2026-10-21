import { isItemVisible } from './layerEditing';
import { panelPlacement } from './templateEditing';
import { artworkSelectionFrame } from './artworkBounds';
import type { TextFont as Font } from '../artwork/font-pack';
import { flattenPath, itemPath, placementTransform } from '../artwork/paths';
import type {
  DesignItem,
  Face,
  Project,
  Selection,
  TemplateData,
  TemplateObject,
  TemplatePlacement,
} from './types';

export type SnapPoint = [number, number];
export type SnapKind = 'vertex' | 'midpoint' | 'center' | 'edge' | 'centerline';
export type SnapBasis = 'outline' | 'bounds';
export type SnapShape = {
  key: string;
  name: string;
  selection: Selection;
  contours: SnapPoint[][];
  center: SnapPoint;
  /** The object's placement rectangle, including its rotation; not an axis-aligned box. */
  boundsContour: SnapPoint[];
};
export type SnapFeature = {
  id: string;
  owner: string;
  name: string;
  kind: SnapKind;
  point?: SnapPoint;
  a?: SnapPoint;
  b?: SnapPoint;
  infinite?: boolean;
};
export type SnapPick = { feature: SnapFeature; point: SnapPoint };
export type SnapResult = { source: SnapPoint; target: SnapPoint; delta: SnapPoint };

const EPSILON = 1e-10;
const TEMPLATE_WELD = 1e-4;
const copy = (point: SnapPoint): SnapPoint => [point[0], point[1]];
const middle = (a: SnapPoint, b: SnapPoint): SnapPoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const difference = (a: SnapPoint, b: SnapPoint): SnapPoint => [a[0] - b[0], a[1] - b[1]];
const finitePoint = (point: SnapPoint) => point.every(Number.isFinite);
const hasLine = (feature: SnapFeature) => !!feature.a && !!feature.b;

function placementRectangle(placement: TemplatePlacement): SnapPoint[] {
  return placementTransform(
    [
      [
        [0, 0],
        [placement.width, 0],
        [placement.width, placement.height],
        [0, placement.height],
      ],
    ],
    placement,
  )[0] as SnapPoint[];
}

function removeCollinear(points: SnapPoint[]): SnapPoint[] {
  if (points.length <= 3) return points;
  return points.filter((point, index) => {
    const before = points[(index + points.length - 1) % points.length];
    const after = points[(index + 1) % points.length];
    const dx = after[0] - before[0],
      dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-8) return true;
    const distance = Math.abs((point[0] - before[0]) * dy - (point[1] - before[1]) * dx) / length;
    const along = ((point[0] - before[0]) * dx + (point[1] - before[1]) * dy) / (length * length);
    return distance > TEMPLATE_WELD || along < 0 || along > 1;
  });
}

const originalContours = new WeakMap<TemplateObject, { height: number; contours: SnapPoint[][] }>();

/** Template outlinePath consists of projected triangles, so those triangles' interior
 * diagonals must not become snapping edges. Weld XY coordinates, split collinear
 * T-junctions, cancel shared edges, and discard edges covered on both sides. This
 * is cached for the unchanged template; no WASM/CSG work runs during pointer moves. */
function templateOutline(object: TemplateObject, height: number): SnapPoint[][] {
  const cached = originalContours.get(object);
  if (cached?.height === height) return cached.contours;
  if (!object.positions.length || !object.indices.length) {
    const result = flattenPath(object.outlinePath, 0.025) as SnapPoint[][];
    originalContours.set(object, { height, contours: result });
    return result;
  }
  const vertices: SnapPoint[] = [];
  const welded = new Map<string, number[]>();
  const triangles: number[][] = [];
  const rawEdges: Array<[number, number]> = [];
  const weldPoint = (x: number, y: number) => {
    const cellX = Math.floor(x / TEMPLATE_WELD),
      cellY = Math.floor(y / TEMPLATE_WELD);
    // Neighbouring cells matter: Blender float exports can straddle a quantization
    // boundary although they differ only by the export's float precision.
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const candidate of welded.get(`${cellX + dx},${cellY + dy}`) ?? []) {
          const point = vertices[candidate];
          if (Math.hypot(point[0] - x, point[1] - y) <= TEMPLATE_WELD) return candidate;
        }
    const key = `${cellX},${cellY}`,
      result = vertices.length;
    vertices.push([x, y]);
    const candidates = welded.get(key) ?? [];
    candidates.push(result);
    welded.set(key, candidates);
    return result;
  };
  const vertex = (index: number) =>
    weldPoint(object.positions[index * 3], height - object.positions[index * 3 + 1]);
  for (let index = 0; index < object.indices.length; index += 3) {
    const ia = object.indices[index],
      ib = object.indices[index + 1],
      ic = object.indices[index + 2];
    const a = ia * 3,
      b = ib * 3,
      c = ic * 3;
    const cross =
      (object.positions[b] - object.positions[a]) *
        (object.positions[c + 1] - object.positions[a + 1]) -
      (object.positions[b + 1] - object.positions[a + 1]) *
        (object.positions[c] - object.positions[a]);
    // Upward-facing triangles tile the projected solid; downward/bottom faces duplicate them.
    if (cross <= EPSILON) continue;
    const ids = [vertex(ia), vertex(ib), vertex(ic)];
    triangles.push(ids);
    for (let edge = 0; edge < 3; edge++) rawEdges.push([ids[edge], ids[(edge + 1) % 3]]);
  }
  // Nonplanar source decorations can have crossing projected edges. Their union
  // boundary changes at those crossings, so add intersection vertices before
  // testing the filled side of each split segment.
  const uniqueEdges = [
    ...new Map(
      rawEdges.map(([a, b]) => [a < b ? `${a}:${b}` : `${b}:${a}`, [a, b] as [number, number]]),
    ).values(),
  ];
  for (let i = 0; i < uniqueEdges.length; i++) {
    const [ia, ib] = uniqueEdges[i],
      a = vertices[ia],
      b = vertices[ib];
    const rx = b[0] - a[0],
      ry = b[1] - a[1];
    for (let j = i + 1; j < uniqueEdges.length; j++) {
      const [ic, id] = uniqueEdges[j];
      if (ia === ic || ia === id || ib === ic || ib === id) continue;
      const c = vertices[ic],
        d = vertices[id];
      if (
        Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) < Math.min(a[1], b[1])
      )
        continue;
      const sx = d[0] - c[0],
        sy = d[1] - c[1],
        cross = rx * sy - ry * sx;
      if (Math.abs(cross) < EPSILON) continue;
      const qx = c[0] - a[0],
        qy = c[1] - a[1];
      const t = (qx * sy - qy * sx) / cross,
        u = (qx * ry - qy * rx) / cross;
      if (t > 1e-7 && t < 1 - 1e-7 && u > 1e-7 && u < 1 - 1e-7)
        weldPoint(a[0] + t * rx, a[1] + t * ry);
    }
  }
  const edges = new Map<string, number>();
  for (const [ia, ib] of rawEdges) {
    const a = vertices[ia],
      b = vertices[ib];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-16) continue;
    const length = Math.sqrt(lengthSquared);
    const split = [
      { id: ia, t: 0 },
      { id: ib, t: 1 },
    ];
    for (let id = 0; id < vertices.length; id++) {
      if (id === ia || id === ib) continue;
      const point = vertices[id];
      const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
      if (t <= 1e-7 || t >= 1 - 1e-7) continue;
      const distance = Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
      if (distance < TEMPLATE_WELD) split.push({ id, t });
    }
    split.sort((left, right) => left.t - right.t);
    for (let index = 0; index + 1 < split.length; index++) {
      const a = split[index].id,
        b = split[index + 1].id;
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1));
    }
  }
  const inside = (point: SnapPoint) =>
    triangles.some((ids) => {
      const a = vertices[ids[0]],
        b = vertices[ids[1]],
        c = vertices[ids[2]];
      const cross = (a: SnapPoint, b: SnapPoint) =>
        (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
      // Editor Y is inverted, so upward world triangles have negative winding here.
      return cross(a, b) <= EPSILON && cross(b, c) <= EPSILON && cross(c, a) <= EPSILON;
    });
  const following = new Map<number, number[]>();
  for (const [key, count] of edges) {
    if (!count) continue;
    const [ia, ib] = key.split(':').map(Number),
      a = vertices[ia],
      b = vertices[ib];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    if (length < 1e-8) continue;
    const midpoint = middle(a, b),
      offset = Math.min(1e-4, length * 0.1);
    const left = inside([
      midpoint[0] - (dy / length) * offset,
      midpoint[1] + (dx / length) * offset,
    ]);
    const right = inside([
      midpoint[0] + (dy / length) * offset,
      midpoint[1] - (dx / length) * offset,
    ]);
    if (left === right) continue;
    // Keep the filled side on the right, independent of overlaps or edge count.
    const start = right ? ia : ib,
      end = right ? ib : ia;
    const ends = following.get(start) ?? [];
    ends.push(end);
    following.set(start, ends);
  }
  const contours: SnapPoint[][] = [];
  const visited = new Set<string>();
  for (const [start, next] of following) {
    for (const first of next) {
      if (visited.has(`${start}:${first}`)) continue;
      const ids = [start];
      let before = start,
        current = first;
      for (let guard = 0; guard <= edges.size; guard++) {
        const key = `${before}:${current}`;
        if (visited.has(key)) break;
        visited.add(key);
        if (current === start) {
          if (ids.length >= 3) contours.push(removeCollinear(ids.map((id) => vertices[id])));
          break;
        }
        ids.push(current);
        const ends = following.get(current)?.filter((end) => !visited.has(`${current}:${end}`));
        if (!ends?.length) break;
        before = current;
        current = ends[0];
      }
    }
  }
  originalContours.set(object, { height, contours });
  return contours;
}

function originalPlacement(object: TemplateObject, height: number): TemplatePlacement {
  return {
    x: object.bounds[0],
    y: height - object.bounds[4],
    width: object.bounds[3] - object.bounds[0],
    height: object.bounds[4] - object.bounds[1],
    rotation: 0,
    colorId: object.colorId,
    visible: true,
  };
}
function placedTemplateOutline(
  object: TemplateObject,
  placement: TemplatePlacement,
  height: number,
  frame: TemplateObject = object,
) {
  const original = originalPlacement(frame, height);
  if (original.width <= 0 || original.height <= 0) return [];
  const local = templateOutline(object, height).map((contour) =>
    contour.map(([x, y]) => [
      ((x - original.x) * placement.width) / original.width,
      ((y - original.y) * placement.height) / original.height,
    ]),
  );
  return placementTransform(local, placement) as SnapPoint[][];
}
function placedItemOutline(item: DesignItem, font?: Font | null): SnapPoint[][] {
  try {
    return placementTransform(
      flattenPath(itemPath(item, font ?? undefined), 0.025),
      item,
    ) as SnapPoint[][];
  } catch {
    // A failed imported path must not disable the editor's other reference shapes.
    return [];
  }
}

/** All coordinates are in the active face's editor space. New back objects are
 * already entered in back editor coordinates; only the fixed base is mirrored. */
export function makeSnapShapes(
  project: Project,
  template: TemplateData,
  face: Face,
  font?: Font | null,
  basis: SnapBasis = 'outline',
): SnapShape[] {
  const shapes: SnapShape[] = [];
  const add = (
    key: string,
    name: string,
    selection: Selection,
    contours: SnapPoint[][],
    placement: TemplatePlacement,
  ) => {
    shapes.push({
      key,
      name,
      selection,
      contours,
      center: [placement.x + placement.width / 2, placement.y + placement.height / 2],
      boundsContour: placementRectangle(placement),
    });
  };
  const base = template.objects.find((object) => object.role === 'base');
  const basePlacement: TemplatePlacement = {
    x: 0,
    y: 0,
    width: template.width,
    height: template.height,
    rotation: 0,
    visible: true,
    colorId: project.template.baseColorId,
  };
  const baseContours =
    base && basis === 'outline'
      ? templateOutline(base, template.height)
      : [placementRectangle(basePlacement)];
  add(
    'base',
    project.format === 'badge-atelier' ? '徽章底板' : '通行证底板',
    null,
    face === 'back'
      ? baseContours.map((contour) => contour.map(([x, y]) => [template.width - x, y]))
      : baseContours,
    basePlacement,
  );
  if (face === 'front') {
    for (const object of template.objects) {
      if (object.role === 'base') continue;
      if (object.role === 'editable-label') {
        const placement = project.template.label;
        if (!placement?.visible) continue;
        const contours =
          basis === 'bounds'
            ? []
            : placement.useOriginal
              ? placedTemplateOutline(object, placement, template.height)
              : placedItemOutline(
                  { ...placement, kind: 'text', id: 'template-label', name: '上方标识' },
                  font,
                );
        add('label', '上方标识', { kind: 'label' }, contours, placement);
      } else if (object.role === 'decoration') {
        const placement = project.template.decorations[object.id];
        if (!placement?.visible) continue;
        add(
          `decoration:${object.id}`,
          object.name,
          { kind: 'decoration', id: object.id },
          basis === 'bounds' ? [] : placedTemplateOutline(object, placement, template.height),
          placement,
        );
      } else {
        const frame = template.objects.find((o) => o.role === 'fixed-panel');
        const placement = panelPlacement(project, template);
        if (!frame || !placement.visible) continue;
        add(
          object.role === 'fixed-panel' ? 'panel' : `fixed-detail:${object.id}`,
          object.role === 'fixed-panel' ? '侧边框' : '侧边框细节',
          { kind: 'panel' },
          basis === 'bounds'
            ? []
            : placedTemplateOutline(object, placement, template.height, frame),
          placement,
        );
      }
    }
  }
  for (const collection of project.collections) {
    if (collection.face !== face || !collection.visible) continue;
    for (const item of collection.items) {
      if (!isItemVisible(collection, item)) continue;
      add(
        `item:${item.id}`,
        item.name,
        { kind: 'item', collectionId: collection.id, id: item.id },
        basis === 'bounds' ? [] : placedItemOutline(item, font),
        artworkSelectionFrame(item),
      );
    }
  }
  return shapes;
}

/** Source and target may call this with different bases and feature kinds. */
export function snapFeatures(shapes: SnapShape[], basis: SnapBasis, kind: SnapKind): SnapFeature[] {
  const features: SnapFeature[] = [];
  for (const shape of shapes) {
    const prefix = `${shape.key}:${basis}:${kind}`;
    const common = { owner: shape.key, kind };
    if (kind === 'center') {
      features.push({
        ...common,
        id: prefix,
        name: `${shape.name} · 中心`,
        point: copy(shape.center),
      });
      continue;
    }
    if (kind === 'centerline') {
      const [x, y] = shape.center;
      features.push(
        {
          ...common,
          id: `${prefix}:horizontal`,
          name: `${shape.name} · 水平中线`,
          a: [x - 1, y],
          b: [x + 1, y],
          infinite: true,
        },
        {
          ...common,
          id: `${prefix}:vertical`,
          name: `${shape.name} · 竖直中线`,
          a: [x, y - 1],
          b: [x, y + 1],
          infinite: true,
        },
      );
      continue;
    }
    const contours = basis === 'bounds' ? [shape.boundsContour] : shape.contours;
    for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
      const contour = contours[contourIndex];
      for (let index = 0; index < contour.length; index++) {
        const a = contour[index],
          b = contour[(index + 1) % contour.length];
        const id = `${prefix}:${contourIndex}:${index}`;
        const name = `${shape.name} · ${basis === 'bounds' ? '外接框' : '轮廓'} ${contourIndex + 1} · ${index + 1}`;
        if (kind === 'vertex') features.push({ ...common, id, name, point: copy(a) });
        else if (kind === 'midpoint') features.push({ ...common, id, name, point: middle(a, b) });
        else if (Math.hypot(a[0] - b[0], a[1] - b[1]) > EPSILON)
          features.push({ ...common, id, name, a: copy(a), b: copy(b), infinite: false });
      }
    }
  }
  return features;
}

function projectToLine(a: SnapPoint, b: SnapPoint, point: SnapPoint, infinite: boolean): SnapPoint {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-20) return copy(a);
  let factor = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  if (!infinite) factor = Math.max(0, Math.min(1, factor));
  return [a[0] + factor * dx, a[1] + factor * dy];
}
/** Finite edges clamp the perpendicular foot to their endpoints; centerlines extend. */
export function projectToFeature(feature: SnapFeature, point: SnapPoint): SnapPoint {
  if (feature.point) return copy(feature.point);
  if (feature.a && feature.b)
    return projectToLine(feature.a, feature.b, point, feature.infinite === true);
  throw new Error('吸附参照缺少点或线坐标。');
}
export function pickSnapFeature(
  features: SnapFeature[],
  pointer: SnapPoint,
  tolerance: number,
): SnapPick | null {
  if (!finitePoint(pointer) || !Number.isFinite(tolerance) || tolerance < 0) return null;
  let nearest: SnapPick | null = null,
    distanceSquared = tolerance * tolerance;
  for (const feature of features) {
    const point = projectToFeature(feature, pointer);
    const dx = pointer[0] - point[0],
      dy = pointer[1] - point[1],
      distance = dx * dx + dy * dy;
    if (distance <= distanceSquared && (!nearest || distance < distanceSquared)) {
      nearest = { feature, point };
      distanceSquared = distance;
    }
  }
  return nearest;
}
/** Apply this same, unrounded delta to every movable member of a multi-selection. */
export function snapDelta(source: SnapPick, target: SnapPick): SnapPoint {
  return difference(target.point, source.point);
}

/** Resolves point/line combinations without rotating the object. The pointer has
 * already chosen targetFeature; a target line uses a perpendicular projection,
 * rather than making its arbitrary hovered point the final anchor. A source line
 * aimed at a point likewise moves perpendicular to itself (with finite-edge clamp).
 * Parallel lines translate only along their common normal, even when the selected
 * segments have different lengths; nonparallel lines use the picked source anchor. */
export function resolveSnap(
  source: SnapPick,
  targetFeature: SnapFeature,
  _pointer: SnapPoint,
): SnapResult {
  let sourcePoint = copy(source.point),
    targetPoint: SnapPoint;
  if (hasLine(source.feature) && hasLine(targetFeature)) {
    const sourceA = source.feature.a!,
      sourceB = source.feature.b!;
    const targetA = targetFeature.a!,
      targetB = targetFeature.b!;
    const sx = sourceB[0] - sourceA[0],
      sy = sourceB[1] - sourceA[1];
    const tx = targetB[0] - targetA[0],
      ty = targetB[1] - targetA[1];
    const lengths = Math.hypot(sx, sy) * Math.hypot(tx, ty);
    if (lengths > EPSILON && Math.abs(sx * ty - sy * tx) <= lengths * 1e-10) {
      const center = middle(sourceA, sourceB);
      const foot = projectToLine(targetA, targetB, center, true);
      const delta = difference(foot, center);
      targetPoint = [sourcePoint[0] + delta[0], sourcePoint[1] + delta[1]];
    } else targetPoint = projectToFeature(targetFeature, sourcePoint);
  } else if (hasLine(source.feature)) {
    targetPoint = projectToFeature(targetFeature, sourcePoint);
    sourcePoint = projectToFeature(source.feature, targetPoint);
  } else targetPoint = projectToFeature(targetFeature, sourcePoint);
  return { source: sourcePoint, target: targetPoint, delta: difference(targetPoint, sourcePoint) };
}

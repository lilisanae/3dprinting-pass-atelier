import { flattenPath, itemPath } from '../artwork/paths';
import {
  isShapeKind,
  outlineDistances,
  validateShapeAppearance,
  type ShapeKind,
  type ShapeAppearance,
} from './shapeCatalog';
import type { Project, TemplateData, Vec2 } from './types';

export type BadgeNode = { x: number; y: number; in?: Vec2; out?: Vec2 };
export type BadgeVectorShape = { contours: Vec2[][]; fillRule: 'NonZero' | 'EvenOdd' };
export type BadgeOutlineResult = { contours: BadgeNode[][]; aspect: number };
export type BadgeMount = {
  id: string;
  kind: 'magnet-round' | 'magnet-rect' | 'pin-slot';
  /** Centre in the back editor's millimetre coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  rotation: number;
};
export type BadgeOutlineSource = Pick<BadgeBase, 'width' | 'height' | 'shape' | 'contours'>;
export type BadgeOutlineStyle = { source: BadgeOutlineSource; appearance: ShapeAppearance };
export type BadgeBase = {
  width: number;
  height: number;
  thickness: number;
  /** Optional for v0.5.0 files: absent layers retain their original depths. */
  layers?: BadgeLayers;
  shape: ShapeKind | 'custom';
  /** Normalized anchors/handles; even-odd closed contours allow inner holes. */
  contours?: BadgeNode[][];
  mounts: BadgeMount[];
  /** Editable source for a baked round border; print geometry stays in contours. */
  outlineStyle?: BadgeOutlineStyle;
};
export type BadgeLayers = { front: number; core: number; back: number };
export const badgeLayerNames = [
  ['front', '正面背景厚度'],
  ['core', '中心夹层厚度'],
  ['back', '背面背景厚度'],
] as const;
export function badgeLayers(base: BadgeBase, legacyBackDepth = 0.7): BadgeLayers {
  return (
    base.layers ?? {
      front: 0.7,
      core: Number((base.thickness - 0.7 - legacyBackDepth).toFixed(6)),
      back: legacyBackDepth,
    }
  );
}
/** Keep the other two layers and every mount unchanged. */
export function badgeLayerLimits(base: BadgeBase, layers: BadgeLayers, layer: keyof BadgeLayers) {
  const other = Object.entries(layers).reduce(
    (sum, [key, value]) => sum + (key === layer ? 0 : value),
    0,
  );
  const floor = base.mounts.length ? Math.max(...base.mounts.map((m) => m.depth)) + 0.8 : 0;
  return {
    min: Number(Math.max(0.001, floor - other).toFixed(6)),
    max: Number((20 - other).toFixed(6)),
  };
}
export function setBadgeLayer(
  base: BadgeBase,
  layer: keyof BadgeLayers,
  value: number,
  legacyBackDepth = 0.7,
): BadgeBase {
  const layers = { ...badgeLayers(base, legacyBackDepth), [layer]: value };
  const next = {
    ...base,
    layers,
    thickness: Number((layers.front + layers.core + layers.back).toFixed(6)),
  };
  validateBadgeBase(next);
  return next;
}
export const BADGE_VERSION = 'badge-template-v1';
export const badgePresets = [
  ['circle', '圆形 / 椭圆'],
  ['rounded-rect', '圆角方形'],
  ['rect', '方形'],
  ['hexagon', '六边形'],
  ['heart', '爱心'],
  ['star', '星形'],
  ['shield', '盾形'],
  ['flower', '花形'],
] as const;
export const defaultBadgeBase = (): BadgeBase => ({
  width: 58,
  height: 58,
  thickness: 3,
  shape: 'circle',
  mounts: [],
});
export function badgeArtworkColor(project: Project, face: 'front' | 'back'): string {
  const background =
    project.palette.find(
      (c) =>
        c.id === (face === 'front' ? project.template.frontColorId : project.template.backColorId),
    ) ?? project.palette.find((c) => c.id === project.template.baseColorId)!;
  const luminance = (hex: string) =>
    0.2126 * parseInt(hex.slice(1, 3), 16) +
    0.7152 * parseInt(hex.slice(3, 5), 16) +
    0.0722 * parseInt(hex.slice(5, 7), 16);
  return project.palette.reduce(
    (best, color) =>
      Math.abs(luminance(color.hex) - luminance(background.hex)) >
      Math.abs(luminance(best.hex) - luminance(background.hex))
        ? color
        : best,
    project.palette[0],
  ).id;
}
const n = (v: number) => Number(v.toFixed(6));
const point = (node: BadgeNode): Vec2 => [node.x, node.y];
const middle = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function nodesPath(nodes: BadgeNode[], width = 1, height = 1): string {
  if (nodes.length < 3) return '';
  const xy = (p: Vec2) => `${n(p[0] * width)},${n(p[1] * height)}`;
  return (
    `M${xy(point(nodes[0]))}` +
    nodes
      .map((a, i) => {
        const b = nodes[(i + 1) % nodes.length];
        return a.out || b.in
          ? `C${xy(a.out ?? point(a))} ${xy(b.in ?? point(b))} ${xy(point(b))}`
          : `L${xy(point(b))}`;
      })
      .join('') +
    'Z'
  );
}
export function badgeOutline(base: BadgeBase): string {
  if (base.shape === 'custom')
    return (base.contours ?? []).map((c) => nodesPath(c, base.width, base.height)).join('');
  return itemPath({
    id: 'badge-base',
    name: '徽章底板',
    kind: 'shape',
    shape: base.shape,
    visible: true,
    x: 0,
    y: 0,
    width: base.width,
    height: base.height,
    rotation: 0,
    colorId: 'white',
  });
}
/** Exact de Casteljau split: inserting a node does not change the curve. */
export function insertBadgeNode(nodes: BadgeNode[], index: number): BadgeNode[] {
  const next = structuredClone(nodes),
    a = next[index],
    b = next[(index + 1) % next.length];
  const p = point(a),
    q = point(b);
  if (!a.out && !b.in) {
    const r = middle(p, q);
    next.splice(index + 1, 0, { x: r[0], y: r[1] });
    return next;
  }
  const ab = middle(p, a.out ?? p),
    bc = middle(a.out ?? p, b.in ?? q),
    cd = middle(b.in ?? q, q),
    abc = middle(ab, bc),
    bcd = middle(bc, cd),
    r = middle(abc, bcd);
  a.out = ab;
  b.in = cd;
  next.splice(index + 1, 0, { x: r[0], y: r[1], in: abc, out: bcd });
  return next;
}
export function smoothBadgeNode(nodes: BadgeNode[], index: number): BadgeNode[] {
  const next = structuredClone(nodes),
    a = next[index],
    previous = next[(index + next.length - 1) % next.length],
    following = next[(index + 1) % next.length];
  const dx = (following.x - previous.x) / 6,
    dy = (following.y - previous.y) / 6;
  a.in = [a.x - dx, a.y - dy];
  a.out = [a.x + dx, a.y + dy];
  return next;
}
export function moveBadgeNode(node: BadgeNode, x: number, y: number): BadgeNode {
  const dx = x - node.x,
    dy = y - node.y;
  return {
    ...node,
    x,
    y,
    ...(node.in ? { in: [node.in[0] + dx, node.in[1] + dy] as Vec2 } : {}),
    ...(node.out ? { out: [node.out[0] + dx, node.out[1] + dy] as Vec2 } : {}),
  };
}
/** Simplify only captured/imported outlines, never a user's already edited nodes. */
export function simplifyBadgePoints(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return points;
  const a = points[0],
    b = points.at(-1)!,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy;
  let far = 0,
    index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d)) : 0;
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (distance > far) {
      far = distance;
      index = i;
    }
  }
  if (far <= tolerance) return [a, b];
  return [
    ...simplifyBadgePoints(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyBadgePoints(points.slice(index), tolerance),
  ];
}
export function badgeEditableContours(base: BadgeBase): BadgeNode[][] {
  if (base.shape === 'custom') return structuredClone(base.contours ?? []);
  return flattenPath(badgeOutline(base), 0.08).map((contour) => {
    const points = contour.map(([x, y]) => [x / base.width, y / base.height] as Vec2);
    if (Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) < 1e-8)
      points.pop();
    return points.map(([x, y]) => ({ x, y }));
  });
}
export function mountOutline(mount: BadgeMount): string {
  const width = mount.width,
    height = mount.kind === 'magnet-round' ? width : mount.height;
  return itemPath({
    id: mount.id,
    name: '安装槽',
    kind: 'shape',
    shape: mount.kind === 'magnet-round' ? 'circle' : 'rect',
    visible: true,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    colorId: 'white',
  });
}
export const mountPlacement = (mount: BadgeMount) => ({
  ...mount,
  x: mount.x - mount.width / 2,
  y: mount.y - (mount.kind === 'magnet-round' ? mount.width : mount.height) / 2,
  height: mount.kind === 'magnet-round' ? mount.width : mount.height,
});
export function validateBadgeBase(value: unknown): asserts value is BadgeBase {
  const base = value as BadgeBase;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (
    !base ||
    typeof base !== 'object' ||
    !finite(base.width) ||
    !finite(base.height) ||
    !finite(base.thickness) ||
    base.width < 10 ||
    base.width > 200 ||
    base.height < 10 ||
    base.height > 200 ||
    base.thickness < (base.layers ? 0.003 : 1.5) ||
    base.thickness > 20
  )
    throw new Error('徽章宽高须为 10～200 mm，底板总厚度不能超过 20 mm。');
  if (base.outlineStyle !== undefined) {
    const style = base.outlineStyle;
    if (
      !style ||
      typeof style !== 'object' ||
      !style.source ||
      typeof style.source !== 'object' ||
      !style.appearance ||
      typeof style.appearance !== 'object'
    )
      throw new Error('底板描边来源无效。');
    validateShapeAppearance(style.appearance);
    const source = style.source;
    validateBadgeBase({
      width: source.width,
      height: source.height,
      shape: source.shape,
      contours: source.contours,
      thickness: base.thickness,
      layers: base.layers,
      mounts: [],
    });
    const { outside } = outlineDistances(style.appearance);
    if (
      Math.abs(base.width - source.width - 2 * outside) > 0.00001 ||
      Math.abs(base.height - source.height - 2 * outside) > 0.00001
    )
      throw new Error('底板描边尺寸与来源不一致。');
  }
  if (base.layers !== undefined) {
    const layers = base.layers;
    if (
      !layers ||
      typeof layers !== 'object' ||
      ![layers.front, layers.core, layers.back].every((v) => finite(v) && v >= 0.001) ||
      Math.abs(layers.front + layers.core + layers.back - base.thickness) > 0.000001
    )
      throw new Error('底板三层厚度须各至少为 0.001 mm，且相加等于底板总厚度。');
  }
  if (base.shape !== 'custom' && !isShapeKind(base.shape)) throw new Error('徽章底板形状无效。');
  if (base.shape === 'custom') {
    if (!Array.isArray(base.contours) || !base.contours.length || base.contours.length > 16)
      throw new Error('请画出至少一条闭合轮廓。');
    let count = 0;
    for (const contour of base.contours) {
      if (!Array.isArray(contour) || contour.length < 3 || contour.length > 512)
        throw new Error('每条轮廓需要 3～512 个节点。');
      count += contour.length;
      for (const node of contour) {
        if (
          !node ||
          !finite(node.x) ||
          !finite(node.y) ||
          node.x < 0 ||
          node.x > 1 ||
          node.y < 0 ||
          node.y > 1
        )
          throw new Error('轮廓节点须在底板尺寸框内。');
        for (const handle of [node.in, node.out])
          if (
            handle !== undefined &&
            (!Array.isArray(handle) ||
              handle.length !== 2 ||
              !handle.every((v) => finite(v) && v >= -1 && v <= 2))
          )
            throw new Error('曲线控制柄无效。');
      }
    }
    if (count > 1024) throw new Error('轮廓节点过多，请简化后导入。');
    const contours = flattenPath(badgeOutline(base), 0.03);
    if (!contours.length) throw new Error('轮廓没有有效面积。');
    if (
      contours.some((c) =>
        c.some(
          ([x, y]) => x < -0.001 || x > base.width + 0.001 || y < -0.001 || y > base.height + 0.001,
        ),
      )
    )
      throw new Error('曲线超出尺寸框，请将控制柄收回框内。');
  }
  if (!Array.isArray(base.mounts) || base.mounts.length > 12)
    throw new Error('最多添加 12 个背面安装槽。');
  const ids = new Set<string>();
  for (const mount of base.mounts) {
    if (
      !mount ||
      typeof mount.id !== 'string' ||
      !mount.id ||
      ids.has(mount.id) ||
      !['magnet-round', 'magnet-rect', 'pin-slot'].includes(mount.kind) ||
      ![mount.x, mount.y, mount.width, mount.height, mount.depth, mount.rotation].every(finite) ||
      mount.width < 1 ||
      mount.height < 1 ||
      mount.width > 200 ||
      mount.height > 200 ||
      mount.depth < 0.1 ||
      mount.depth > base.thickness - 0.8 + 0.000001 ||
      mount.x < 0 ||
      mount.x > base.width ||
      mount.y < 0 ||
      mount.y > base.height
    )
      throw new Error('安装槽尺寸或位置无效；槽底至少保留 0.8 mm 厚度。');
    ids.add(mount.id);
  }
}
/** Outline-only metadata on the UI thread; the worker extrudes the actual base. */
export function badgeTemplate(base: BadgeBase): TemplateData {
  return {
    version: BADGE_VERSION,
    source: '用户设计的徽章底板',
    width: base.width,
    height: base.height,
    thickness: base.thickness,
    panelBounds: [0, 0, 0, 0],
    objects: [
      {
        id: 'badge-base',
        name: '徽章底板',
        role: 'base',
        colorId: 'white',
        positions: [],
        indices: [],
        outlinePath: badgeOutline(base),
        bounds: [0, 0, 0, base.width, base.height, base.thickness],
        height: base.thickness,
      },
    ],
  };
}
export function createBadgeProject(): Project {
  return {
    format: 'badge-atelier',
    version: 1,
    templateVersion: BADGE_VERSION,
    name: '新的徽章',
    badgeBase: defaultBadgeBase(),
    palette: [
      { id: 'pink', name: '樱桃汽水', hex: '#F57CAB' },
      { id: 'white', name: '奶油白', hex: '#FFF8EC' },
      { id: 'black', name: '墨色', hex: '#303039' },
      { id: 'accent', name: '杏子糖', hex: '#F9CB7A' },
    ],
    collections: [
      {
        id: `group-${crypto.randomUUID()}`,
        name: '正面图案',
        face: 'front',
        visible: true,
        thickness: 0.4,
        items: [],
      },
    ],
    template: {
      baseColorId: 'white',
      frontColorId: 'white',
      backColorId: 'white',
      panelColorId: 'white',
      panelDetailColorId: 'black',
      panel: null,
      label: null,
      decorations: {},
    },
  };
}

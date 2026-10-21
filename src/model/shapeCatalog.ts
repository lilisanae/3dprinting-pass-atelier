export const shapeGroups = ['基础几何', '闪光符号', '票签标记', '自然装饰'] as const;
export const shapeCatalog = [
  { id: 'circle', name: '圆形', group: '基础几何' },
  { id: 'rect', name: '方形', group: '基础几何' },
  { id: 'rounded-rect', name: '圆角方形', group: '基础几何' },
  { id: 'pill', name: '胶囊', group: '基础几何' },
  { id: 'triangle', name: '三角', group: '基础几何' },
  { id: 'diamond', name: '菱形', group: '基础几何' },
  { id: 'pentagon', name: '五边形', group: '基础几何' },
  { id: 'hexagon', name: '六边形', group: '基础几何' },
  { id: 'octagon', name: '八边形', group: '基础几何' },
  { id: 'star', name: '星星', group: '闪光符号' },
  { id: 'heart', name: '爱心', group: '闪光符号' },
  { id: 'sparkle', name: '四角闪光', group: '闪光符号' },
  { id: 'star6', name: '六角星', group: '闪光符号' },
  { id: 'burst', name: '放射星芒', group: '闪光符号' },
  { id: 'plus', name: '十字', group: '闪光符号' },
  { id: 'cross', name: '交叉', group: '闪光符号' },
  { id: 'lightning', name: '闪电', group: '闪光符号' },
  { id: 'ticket', name: '票券', group: '票签标记' },
  { id: 'ribbon', name: '缎带', group: '票签标记' },
  { id: 'bookmark', name: '书签', group: '票签标记' },
  { id: 'shield', name: '盾牌', group: '票签标记' },
  { id: 'tag', name: '标签', group: '票签标记' },
  { id: 'bubble', name: '对话气泡', group: '票签标记' },
  { id: 'chevron', name: '折角', group: '票签标记' },
  { id: 'arrow', name: '箭头', group: '票签标记' },
  { id: 'stripe', name: '斜纹', group: '票签标记' },
  { id: 'leaf', name: '叶片', group: '自然装饰' },
  { id: 'drop', name: '水滴', group: '自然装饰' },
  { id: 'flower', name: '六瓣花', group: '自然装饰' },
  { id: 'flower8', name: '八瓣花', group: '自然装饰' },
  { id: 'cloud', name: '云朵', group: '自然装饰' },
  { id: 'crescent', name: '弯月', group: '自然装饰' },
  { id: 'sun', name: '太阳花', group: '自然装饰' },
  { id: 'wave', name: '波浪飘带', group: '自然装饰' },
] as const;
export type ShapeKind = (typeof shapeCatalog)[number]['id'];
export type ShapeAppearance = {
  shapeFill: boolean;
  shapeOutline: boolean;
  shapeOutlineWidth: number;
  /** -1 inside, 0 centred, +1 outside. Missing keeps the legacy inset border. */
  shapeOutlinePosition?: number;
};
export const defaultShapeAppearance: ShapeAppearance = {
  shapeFill: true,
  shapeOutline: false,
  shapeOutlineWidth: 0.6,
  shapeOutlinePosition: -1,
};
export const shapeAppearance = (value: Partial<ShapeAppearance>): ShapeAppearance => ({
  shapeFill: value.shapeFill ?? true,
  shapeOutline: value.shapeOutline ?? false,
  shapeOutlineWidth: value.shapeOutlineWidth ?? 0.6,
  shapeOutlinePosition: value.shapeOutlinePosition ?? -1,
});
export function outlineDistances(value: Partial<ShapeAppearance>) {
  const style = shapeAppearance(value);
  const outside = style.shapeOutline
    ? (style.shapeOutlineWidth * (1 + (style.shapeOutlinePosition ?? -1))) / 2
    : 0;
  return { outside, inside: style.shapeOutline ? style.shapeOutlineWidth - outside : 0 };
}
export function validateShapeAppearance(value: Partial<ShapeAppearance>) {
  if (
    value.shapeOutlinePosition !== undefined &&
    (typeof value.shapeOutlinePosition !== 'number' ||
      !Number.isFinite(value.shapeOutlinePosition) ||
      value.shapeOutlinePosition < -1 ||
      value.shapeOutlinePosition > 1)
  )
    throw new Error('描边位置须在向内与向外之间。');
  if (value.shapeOutlineWidth !== undefined && typeof value.shapeOutlineWidth !== 'number')
    throw new Error('图形轮廓线宽无效。');
  if (
    (value.shapeFill !== undefined && typeof value.shapeFill !== 'boolean') ||
    (value.shapeOutline !== undefined && typeof value.shapeOutline !== 'boolean')
  )
    throw new Error('图形填充与轮廓选项无效。');
  const style = shapeAppearance(value);
  if (!style.shapeFill && !style.shapeOutline) throw new Error('图形至少需要填充或轮廓。');
  if (
    !Number.isFinite(style.shapeOutlineWidth) ||
    typeof style.shapeOutlineWidth !== 'number' ||
    style.shapeOutlineWidth <= 0 ||
    style.shapeOutlineWidth > 20
  )
    throw new Error('图形轮廓线宽必须大于 0，且不超过 20 mm。');
  if (
    typeof style.shapeOutlinePosition !== 'number' ||
    !Number.isFinite(style.shapeOutlinePosition) ||
    style.shapeOutlinePosition < -1 ||
    style.shapeOutlinePosition > 1
  )
    throw new Error('描边位置须在向内与向外之间。');
}
const kinds = new Set<string>(shapeCatalog.map((shape) => shape.id));
export const isShapeKind = (value: unknown): value is ShapeKind =>
  typeof value === 'string' && kinds.has(value);
export function shapeDimensions(kind: ShapeKind): [number, number] {
  if (['pill', 'ticket', 'ribbon', 'wave', 'chevron'].includes(kind)) return [18, 8];
  if (['bookmark', 'shield', 'leaf', 'drop', 'lightning'].includes(kind)) return [10, 16];
  if (['cloud', 'bubble', 'tag', 'rounded-rect'].includes(kind)) return [16, 10];
  return [10, 10];
}

/** Decorative paths in a neutral coordinate system. The renderer fits their
 * actual bounds to the declared millimetres, including curved silhouettes. */
export function decorativeShapePath(kind: ShapeKind): string {
  const polygon = (points: number[][]) =>
    `M${points.map((point) => point.map((n) => +n.toFixed(5)).join(',')).join('L')}Z`;
  const radial = (points: number, radius: (angle: number, index: number) => number) =>
    polygon(
      Array.from({ length: points }, (_, i) => {
        const angle = (i * Math.PI * 2) / points - Math.PI / 2,
          r = radius(angle, i);
        return [50 + 50 * r * Math.cos(angle), 50 + 50 * r * Math.sin(angle)];
      }),
    );
  switch (kind) {
    case 'rounded-rect':
      return 'M18 0H82Q100 0 100 18V82Q100 100 82 100H18Q0 100 0 82V18Q0 0 18 0Z';
    case 'diamond':
      return 'M50 0L100 50L50 100L0 50Z';
    case 'pentagon':
      return radial(5, () => 1);
    case 'hexagon':
      return radial(6, () => 1);
    case 'octagon':
      return radial(8, () => 1);
    case 'sparkle':
      return 'M50 0Q54 42 100 50Q58 54 50 100Q46 58 0 50Q42 46 50 0Z';
    case 'star6':
      return radial(12, (_angle, i) => (i % 2 ? 0.5 : 1));
    case 'burst':
      return radial(24, (_angle, i) => (i % 2 ? 0.68 : 1));
    case 'plus':
      return 'M35 0H65V35H100V65H65V100H35V65H0V35H35Z';
    case 'cross':
      return 'M0 20L20 0L50 30L80 0L100 20L70 50L100 80L80 100L50 70L20 100L0 80L30 50Z';
    case 'lightning':
      return 'M55 0L5 58H42L25 100L95 36H59L78 0Z';
    case 'ticket':
      return 'M10 0H90Q100 0 100 10V32C80 32 80 68 100 68V90Q100 100 90 100H10Q0 100 0 90V68C20 68 20 32 0 32V10Q0 0 10 0Z';
    case 'ribbon':
      return 'M0 0H100L82 50L100 100H0L18 50Z';
    case 'bookmark':
      return 'M0 0H100V100L50 72L0 100Z';
    case 'shield':
      return 'M0 0H100V48C100 75 75 90 50 100C25 90 0 75 0 48Z';
    case 'tag':
      return 'M0 0H70L100 50L70 100H0Z';
    case 'bubble':
      return 'M15 0H85Q100 0 100 15V65Q100 80 85 80H45L18 100L23 80H15Q0 80 0 65V15Q0 0 15 0Z';
    case 'chevron':
      return 'M0 0H40L100 50L40 100H0L60 50Z';
    case 'leaf':
      return 'M0 100C-4 26 26 -4 100 0C104 74 74 104 0 100Z';
    case 'drop':
      return 'M50 0C42 25 0 48 0 70C0 110 100 110 100 70C100 48 58 25 50 0Z';
    case 'flower':
      return radial(192, (angle) => 0.76 + 0.24 * Math.cos(6 * (angle + Math.PI / 2)));
    case 'flower8':
      return radial(192, (angle) => 0.79 + 0.21 * Math.cos(8 * (angle + Math.PI / 2)));
    case 'cloud':
      return 'M18 100C-8 100 -8 52 18 48C12 15 48 -8 66 20C88 3 114 33 96 56C118 78 104 100 82 100Z';
    case 'crescent':
      return 'M85 5C40 -15 -5 20 0 55C5 100 60 115 95 85C45 98 18 48 85 5Z';
    case 'sun':
      return radial(240, (angle) => 0.84 + 0.16 * Math.cos(12 * (angle + Math.PI / 2)));
    case 'wave':
      return 'M0 16C33 -18 67 50 100 16V84C67 118 33 50 0 84Z';
    default:
      return '';
  }
}

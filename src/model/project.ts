import type { Collection, DesignItem, Project, TemplateData, TextStyle } from './types';
import { defaultPanelPlacement } from './templateEditing';
import { BADGE_VERSION, validateBadgeBase } from './badge';
import { builtinFonts } from '../artwork/text-fonts';
import {
  isShapeKind,
  shapeCatalog,
  validateShapeAppearance,
  shapeDimensions,
  type ShapeKind,
  type ShapeAppearance,
} from './shapeCatalog';
export const SURFACE_DEPTH = 0.7;
export const DEFAULT_RAISED_THICKNESS = 0.4;
/** Pass files retain the original fixed front skin; badges may opt into layers. */
export const frontSurfaceDepth = (project?: Project) =>
  (project?.format === 'badge-atelier' ? project.badgeBase?.layers?.front : undefined) ??
  SURFACE_DEPTH;
export const collectionInlayDepth = (collection: Collection, project?: Project) => {
  const layers = project?.format === 'badge-atelier' ? project.badgeBase?.layers : undefined;
  const backDepth = collection.inlayDepth ?? layers?.back ?? SURFACE_DEPTH;
  return collection.face === 'back'
    ? layers && Number.isFinite(backDepth)
      ? Math.min(backDepth, layers.back)
      : backDepth
    : frontSurfaceDepth(project);
};
/** Legacy skins follow visible collections; explicit badge layers stay independent. */
export function backSurfaceDepth(collections: Collection[], project?: Project): number {
  if (project?.format === 'badge-atelier' && project.badgeBase?.layers)
    return project.badgeBase.layers.back;
  let depth: number | undefined;
  for (const c of collections)
    if (c.face === 'back' && c.visible) depth = Math.max(depth ?? 0, collectionInlayDepth(c));
  return depth ?? SURFACE_DEPTH;
}
export const maxBackInlayDepth = (boardThickness: number, project?: Project) =>
  project?.format === 'badge-atelier' && project.badgeBase?.layers
    ? project.badgeBase.layers.back
    : Math.floor((boardThickness - SURFACE_DEPTH - 0.001) * 1000) / 1000;
/** Preserve the original cut-out behavior of designs saved before this split. */
export const avoidsLowerArea = (item: DesignItem) => item.avoidsLower ?? item.coversLower === false;
export const collectionMode = (collection: Collection) =>
  collection.face === 'back' || collection.mode === 'background' ? 'background' : 'raised';
export const uid = (prefix = 'item') => `${prefix}-${crypto.randomUUID()}`;
export const cumulativeHeights = (collections: Collection[]) => {
  let h = 0;
  const result: Record<string, number> = {};
  for (const c of collections)
    if (c.face === 'front' && collectionMode(c) === 'raised' && c.visible) {
      h += c.thickness;
      result[c.id] = h;
    }
  return result;
};
export const newCollection = (
  face: 'front' | 'back',
  name = '新集合',
  project?: Project,
): Collection => ({
  id: uid('group'),
  name,
  face,
  mode: face === 'back' ? 'background' : 'raised',
  visible: true,
  thickness: face === 'back' ? SURFACE_DEPTH : DEFAULT_RAISED_THICKNESS,
  ...(face === 'back' && !(project?.format === 'badge-atelier' && project.badgeBase?.layers)
    ? { inlayDepth: SURFACE_DEPTH }
    : {}),
  items: [],
});
export const newShape = (
  colorId = 'white',
  shape: ShapeKind = 'star',
  appearance: Partial<ShapeAppearance> = {},
): DesignItem => ({
  id: uid(),
  name: shapeCatalog.find((entry) => entry.id === shape)?.name ?? '图形',
  kind: 'shape',
  shape,
  visible: true,
  x: 30,
  y: 70,
  width: shapeDimensions(shape)[0],
  height: shapeDimensions(shape)[1],
  rotation: 0,
  colorId,
  avoidsLower: false,
  ...appearance,
});
export function createProject(template: TemplateData): Project & {
  template: Project['template'] & { label: NonNullable<Project['template']['label']> };
} {
  const label = template.objects.find((o) => o.role === 'editable-label')!;
  const placement = (o: typeof label) => ({
    visible: true,
    x: o.bounds[0],
    y: template.height - o.bounds[4],
    width: o.bounds[3] - o.bounds[0],
    height: o.bounds[4] - o.bounds[1],
    rotation: 0,
    colorId: o.colorId,
  });
  const ink: DesignItem = {
    id: uid(),
    name: '角色色块',
    kind: 'shape',
    shape: 'rect',
    visible: true,
    x: 13,
    y: 18,
    width: 29,
    height: 58,
    rotation: 0,
    colorId: 'black',
    avoidsLower: false,
  };
  const heart = {
    ...newShape('white', 'heart'),
    x: 18,
    y: 29,
    width: 19,
    height: 18,
    name: '心动图案',
  };
  const caption: DesignItem = {
    id: uid(),
    name: '你的名字',
    kind: 'text',
    text: 'YOUR\nPASS',
    visible: true,
    x: 16,
    y: 55,
    width: 23,
    height: 13,
    rotation: 0,
    colorId: 'white',
    avoidsLower: false,
  };
  const spark = { ...newShape('accent', 'star'), x: 35, y: 80, width: 8, height: 8, name: '闪光' };
  return {
    format: 'pass-atelier',
    version: 1,
    templateVersion: template.version,
    name: '我的第一张通行证',
    palette: [
      { id: 'pink', name: '樱桃汽水', hex: '#F57CAB' },
      { id: 'white', name: '奶油白', hex: '#FFF8EC' },
      { id: 'black', name: '墨色', hex: '#303039' },
      { id: 'accent', name: '杏子糖', hex: '#F9CB7A' },
    ],
    collections: [
      {
        id: uid('group'),
        name: '01 · 轮廓与底色',
        face: 'front',
        visible: true,
        thickness: DEFAULT_RAISED_THICKNESS,
        items: [ink],
      },
      {
        id: uid('group'),
        name: '02 · 喜欢的细节',
        face: 'front',
        visible: true,
        thickness: DEFAULT_RAISED_THICKNESS,
        items: [heart, caption, spark],
      },
      {
        id: uid('group'),
        name: '背面 · 小小签名',
        face: 'back',
        visible: true,
        thickness: 0.7,
        items: [
          { ...newShape('white', 'heart'), x: 17, y: 30, width: 16, height: 15 },
          {
            id: uid(),
            name: '背面签名',
            kind: 'text',
            text: 'MADE\nWITH LOVE',
            visible: true,
            x: 13,
            y: 54,
            width: 24,
            height: 10,
            rotation: 0,
            colorId: 'white',
          },
        ],
      },
    ],
    template: {
      baseColorId: 'pink',
      frontColorId: 'pink',
      backColorId: 'pink',
      panelColorId: 'white',
      panelDetailColorId: 'black',
      panel: defaultPanelPlacement(template),
      label: { ...placement(label), text: 'MAIMAIDX', useOriginal: true },
      decorations: Object.fromEntries(
        template.objects.filter((o) => o.role === 'decoration').map((o) => [o.id, placement(o)]),
      ),
    },
  };
}
export type NewProjectMode = 'normal' | 'minimal';

/** A fresh document uses the template, never the user's current artwork or starter. */
export function createBlankProject(template: TemplateData, mode: NewProjectMode): Project {
  const project: Project = createProject(template);
  project.name = '新的通行证';
  project.collections =
    mode === 'normal' ? [newCollection('front', '集合 1'), newCollection('front', '集合 2')] : [];
  if (mode === 'minimal') {
    project.template.label = null;
    project.template.panel = null;
    project.template.decorations = {};
  }
  return project;
}

export function validateProject(value: unknown): Project {
  if (!value || typeof value !== 'object') throw new Error('项目文件不是有效对象。');
  const p = value as Project;
  if (
    p.version !== 1 ||
    (p.format === 'badge-atelier'
      ? p.templateVersion !== BADGE_VERSION
      : p.format !== 'pass-atelier' || p.templateVersion !== 'maimai-template-v1')
  )
    throw new Error('项目格式或模板版本不受支持。');
  if (p.format === 'badge-atelier') validateBadgeBase(p.badgeBase);
  else if (p.badgeBase !== undefined) throw new Error('通行证项目不能混用徽章底板。');
  if (
    typeof p.name !== 'string' ||
    !Array.isArray(p.palette) ||
    !p.palette.length ||
    !Array.isArray(p.collections) ||
    !p.template
  )
    throw new Error('项目数据不完整。');
  const object = (o: unknown) => !!o && typeof o === 'object' && !Array.isArray(o);
  if (
    p.palette.some((c) => !object(c)) ||
    p.collections.some((c) => !object(c)) ||
    (p.template.label !== null && !object(p.template.label)) ||
    !object(p.template.decorations)
  )
    throw new Error('项目结构不完整。');
  const ids = new Set<string>();
  const colors = new Set(p.palette.map((c) => c.id));
  if (p.colorCorrections !== undefined) {
    if (
      !Array.isArray(p.colorCorrections) ||
      p.colorCorrections.length > 1000 ||
      p.colorCorrections.some(
        (entry) =>
          !object(entry) ||
          typeof entry.componentKey !== 'string' ||
          !/^[a-f0-9]{16}$/.test(entry.componentKey) ||
          (entry.fragment !== undefined &&
            (!object(entry.fragment) ||
              typeof entry.fragment.parentKey !== 'string' ||
              !/^[a-f0-9]{16}$/.test(entry.fragment.parentKey) ||
              entry.fragment.parentKey === entry.componentKey ||
              typeof entry.fragment.width !== 'number' ||
              !Number.isFinite(entry.fragment.width) ||
              entry.fragment.width < 0.05 ||
              entry.fragment.width > 2)) ||
          (entry.mode !== undefined && !['recolor', 'remove'].includes(entry.mode)) ||
          (entry.mode === 'remove' ? entry.colorId !== undefined : !colors.has(entry.colorId!)),
      ) ||
      new Set(p.colorCorrections.map((entry) => entry.componentKey)).size !==
        p.colorCorrections.length ||
      p.colorCorrections.some(
        (entry) =>
          entry.fragment &&
          p.colorCorrections!.some(
            (parent) => !parent.fragment && parent.componentKey === entry.fragment!.parentKey,
          ),
      )
    )
      throw new Error('实体处理记录无效。');
  }
  const fontIds = new Set(builtinFonts.map((f) => f.id));
  if (p.fonts !== undefined) {
    if (!Array.isArray(p.fonts) || p.fonts.length > 8)
      throw new Error('项目最多支持 8 个导入字体。');
    for (const font of p.fonts) {
      if (
        !object(font) ||
        typeof font.id !== 'string' ||
        !font.id ||
        fontIds.has(font.id) ||
        typeof font.name !== 'string' ||
        !font.name ||
        font.name.length > 100 ||
        typeof font.dataUrl !== 'string' ||
        font.dataUrl.length > 56 * 1024 * 1024 ||
        !/^data:font\/(otf|ttf|woff);base64,[A-Za-z0-9+/]+={0,2}$/.test(font.dataUrl)
      )
        throw new Error('导入字体的数据无效或不完整。');
      fontIds.add(font.id);
    }
  }
  const validTextStyle = (style: TextStyle) => {
    for (const scale of [style.textScaleX, style.textScaleY])
      if (scale !== undefined && (!finite(scale) || scale <= 0))
        throw new Error('文字缩放比例无效。');
    if (style.fontId !== undefined && !fontIds.has(style.fontId))
      throw new Error('找不到文字使用的字体。');
    if (
      style.letterSpacing !== undefined &&
      (!finite(style.letterSpacing) || style.letterSpacing < -200 || style.letterSpacing > 2000)
    )
      throw new Error('字间距必须在 -200～2000 之间。');
    if (
      style.lineHeight !== undefined &&
      (!finite(style.lineHeight) || style.lineHeight < 0.5 || style.lineHeight > 5)
    )
      throw new Error('行间距必须在 0.5～5 倍之间。');
    if (style.textAlign !== undefined && !['left', 'center', 'right'].includes(style.textAlign))
      throw new Error('文字对齐方式无效。');
  };
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  for (const c of p.palette)
    if (
      typeof c.id !== 'string' ||
      !c.id ||
      typeof c.name !== 'string' ||
      typeof c.hex !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(c.hex)
    )
      throw new Error('项目包含无效颜色。');
  if (colors.size !== p.palette.length) throw new Error('颜色编号重复。');
  const validPlacement = (o: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    colorId: string;
    visible: boolean;
    locked?: boolean;
    mirrorX?: boolean;
    mirrorY?: boolean;
  }) => {
    if (
      !object(o) ||
      ![o.x, o.y, o.width, o.height, o.rotation].every(finite) ||
      o.width <= 0 ||
      o.height <= 0 ||
      !colors.has(o.colorId) ||
      typeof o.visible !== 'boolean' ||
      (o.locked !== undefined && typeof o.locked !== 'boolean') ||
      (o.mirrorX !== undefined && typeof o.mirrorX !== 'boolean') ||
      (o.mirrorY !== undefined && typeof o.mirrorY !== 'boolean')
    )
      throw new Error('图案尺寸、位置或颜色无效。');
  };
  let frontHeight = 0;
  for (const c of p.collections) {
    if (
      typeof c.id !== 'string' ||
      !c.id ||
      ids.has(c.id) ||
      typeof c.name !== 'string' ||
      !['front', 'back'].includes(c.face) ||
      !finite(c.thickness) ||
      c.thickness <= 0 ||
      !Array.isArray(c.items) ||
      typeof c.visible !== 'boolean' ||
      (c.locked !== undefined && typeof c.locked !== 'boolean')
    )
      throw new Error('集合数据无效。');
    if (c.mode !== undefined && !['raised', 'background'].includes(c.mode))
      throw new Error('集合模式无效。');
    if (c.inlayDepth !== undefined && (!finite(c.inlayDepth) || c.inlayDepth <= 0))
      throw new Error('背面嵌入深度必须为有限正数。');
    if (c.face === 'back' && c.mode === 'raised') throw new Error('背面集合只支持齐平背景。');
    ids.add(c.id);
    if (c.folders !== undefined && !Array.isArray(c.folders)) throw new Error('文件夹数据无效。');
    const folderIds = new Set<string>();
    for (const f of c.folders ?? []) {
      if (
        !object(f) ||
        typeof f.id !== 'string' ||
        !f.id ||
        ids.has(f.id) ||
        typeof f.name !== 'string' ||
        (f.visible !== undefined && typeof f.visible !== 'boolean') ||
        (f.locked !== undefined && typeof f.locked !== 'boolean')
      )
        throw new Error('文件夹编号、名称或状态无效。');
      ids.add(f.id);
      folderIds.add(f.id);
    }
    if (c.visible && c.face === 'front' && collectionMode(c) === 'raised')
      frontHeight += c.thickness;
    for (const i of c.items) {
      if (
        !object(i) ||
        typeof i.id !== 'string' ||
        !i.id ||
        ids.has(i.id) ||
        typeof i.name !== 'string' ||
        !['shape', 'text', 'paths'].includes(i.kind)
      )
        throw new Error('图案编号或类型无效。');
      ids.add(i.id);
      validPlacement(i);
      if (
        i.folderId !== undefined &&
        (typeof i.folderId !== 'string' || !folderIds.has(i.folderId))
      )
        throw new Error('图层的文件夹必须属于同一集合。');
      if (i.coversLower !== undefined && typeof i.coversLower !== 'boolean')
        throw new Error('图案覆盖选项必须为布尔值。');
      if (i.avoidsLower !== undefined && typeof i.avoidsLower !== 'boolean')
        throw new Error('图案避让选项必须为布尔值。');
      if (
        i.cutout !== undefined &&
        (!object(i.cutout) ||
          !Array.isArray(i.cutout.targetIds) ||
          (i.cutout.keepInside !== undefined && typeof i.cutout.keepInside !== 'boolean') ||
          i.cutout.targetIds.some((id) => typeof id !== 'string') ||
          new Set(i.cutout.targetIds).size !== i.cutout.targetIds.length)
      )
        throw new Error('切割图案的目标设置无效。');
      if (i.kind === 'shape') {
        if (!isShapeKind(i.shape)) throw new Error('图形类型无效。');
      }
      if (i.kind === 'shape' || i.kind === 'paths') validateShapeAppearance(i);
      if (i.kind === 'text' && typeof i.text !== 'string') throw new Error('文字内容无效。');
      if (i.kind === 'text') validTextStyle(i);
      if (
        i.kind === 'paths' &&
        (!Array.isArray(i.regions) ||
          i.regions.some((r) => !object(r) || typeof r.path !== 'string' || !colors.has(r.colorId)))
      )
        throw new Error('图案轮廓或颜色无效。');
      if (
        (i.sourceWidth !== undefined || i.sourceHeight !== undefined) &&
        (!finite(i.sourceWidth) ||
          !finite(i.sourceHeight) ||
          i.sourceWidth! <= 0 ||
          i.sourceHeight! <= 0)
      )
        throw new Error('素材原始尺寸无效。');
      if (
        i.sourceDataUrl !== undefined &&
        (typeof i.sourceDataUrl !== 'string' ||
          !/^data:image\/(png|jpe?g|webp|svg\+xml)[;,]/i.test(i.sourceDataUrl))
      )
        throw new Error('素材必须包含在项目文件中。');
    }
  }
  if (!Number.isFinite(frontHeight)) throw new Error('累计厚度超出可计算范围。');
  const artwork = new Map(
    p.collections.flatMap((c) => c.items.map((item) => [item.id, { item, face: c.face }] as const)),
  );
  for (const c of p.collections)
    for (const item of c.items)
      for (const id of item.cutout?.targetIds ?? []) {
        const target = artwork.get(id);
        if (!target || target.face !== c.face || target.item.cutout !== undefined)
          throw new Error('切割目标必须是同一面的实体图案，不能选择切割工具。');
      }
  if (
    !colors.has(p.template.baseColorId) ||
    !colors.has(p.template.panelColorId) ||
    !colors.has(p.template.panelDetailColorId)
  )
    throw new Error('模板颜色不存在。');
  for (const colorId of [p.template.frontColorId, p.template.backColorId])
    if (colorId !== undefined && !colors.has(colorId)) throw new Error('背景层颜色不存在。');
  if (p.template.label !== null) {
    validPlacement(p.template.label);
    validTextStyle(p.template.label);
    if (
      typeof p.template.label.text !== 'string' ||
      typeof p.template.label.useOriginal !== 'boolean'
    )
      throw new Error('模板文字无效。');
  }
  for (const o of Object.values(p.template.decorations)) validPlacement(o);
  if (p.template.panel !== undefined && p.template.panel !== null) {
    if (!object(p.template.panel)) throw new Error('侧边框位置数据无效。');
    validPlacement({ ...p.template.panel, colorId: p.template.panelColorId });
  }
  const result = structuredClone(p);
  // Old projects keep their appearance, then expose independent surface colors.
  result.template.frontColorId ??= result.template.baseColorId;
  result.template.backColorId ??= result.template.baseColorId;
  for (const c of result.collections)
    for (const i of c.items)
      if (i.avoidsLower === undefined && i.coversLower === false) i.avoidsLower = true;
  return result;
}
let templatePromise: Promise<TemplateData> | undefined;
export function loadTemplate(): Promise<TemplateData> {
  // Version the unhashed template URL so an older worker generation cannot
  // serve a previous template after a deployment.
  const templateVersion =
    typeof __WORKSHOP_TEMPLATE_VERSION__ === 'string' ? __WORKSHOP_TEMPLATE_VERSION__ : 'dev';
  return (templatePromise ??= fetch(
    `${import.meta.env.BASE_URL}assets/template.json?v=${encodeURIComponent(templateVersion)}`,
    {
      signal: AbortSignal.timeout(60000),
    },
  )
    .then((r) => {
      if (!r.ok) throw new Error('模板读取失败。');
      return r.json();
    })
    .catch((error) => {
      templatePromise = undefined;
      throw error;
    }));
}

import AppearancePath from './AppearancePath';
import {
  transformHandles,
  resizeArtworkPlacement,
  resizeTransformGroup,
  type TransformHandle,
} from '../model/freeTransform';
import { panelPlacement, previewDecorations } from '../model/templateEditing';
import { mountOutline, mountPlacement } from '../model/badge';
import { artworkSelectionFrame } from '../model/artworkBounds';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextFont as Font } from '../artwork/font-pack';
import type {
  DesignItem,
  Collection,
  Face,
  Project,
  Selection,
  TemplateData,
  TemplateObject,
  TemplatePlacement,
} from '../model/types';
import { contoursToPath, itemPath, placementSvgTransform } from '../artwork/paths';
import { templateAbovePath } from '../artwork/template-above';
import { makeSnapShapes, snapFeatures, pickSnapFeature, resolveSnap } from '../model/snapping';
import type { SnapPoint, SnapShape } from '../model/snapping';
import { dragAxis, makeDragSnapScene, resolveDragSnap } from '../model/dragSnapping';
import type { DragAxis, DragGuide, DragSnapScene } from '../model/dragSnapping';
import type { DragEntry } from '../model/dragEditing';
import {
  canvasHitStack,
  canvasPickKey,
  nextCanvasPick,
  type CanvasPick,
  type PickCycle,
} from '../ui/canvasPicking';
import type { CanvasSnapping } from '../ui/snapState';
import { wheelCanvasZoom } from '../ui/canvasZoom';
import { shapeAppearance } from '../model/shapeCatalog';
import { rotatePlacements, rotationStep } from '../model/rotation';
import { groupPlacementBounds, scalePlacements } from '../model/scaling';
import type { Bounds2, ItemRef } from '../model/selection';
import { avoidsLowerArea, collectionMode, cumulativeHeights } from '../model/project';
import { activeCuttersByTarget, isCuttingItem } from '../model/booleanEditing';
import {
  canvasItemVisible,
  isItemLocked,
  isItemVisible,
  selectionLocked,
} from '../model/layerEditing';
import {
  selectionEntries,
  selectionContains,
  toggleItemSelection,
  placementBounds,
} from '../model/selection';

type Props = {
  project: Project;
  template: TemplateData;
  face: Face;
  selection: Selection;
  font: Font | null;
  zoom: number;
  setZoom: (n: number) => void;
  select: (s: Selection) => void;
  multiSelect: boolean;
  snapping?: CanvasSnapping | null;
  autoSnap: boolean;
  showCutters: boolean;
  visibleCutterIds: ReadonlySet<string>;
  freeTransform: boolean;
  duplicateForDrag: (entries: DragEntry[]) => DragEntry[];
  begin: () => void;
  moveMany: (
    entries: Array<{ s: Selection; patch: Partial<TemplatePlacement> }>,
    record?: boolean,
  ) => void;
};
const sourceTransform = (o: TemplateObject, p: TemplatePlacement, boardHeight: number) => {
  const x = o.bounds[0],
    y = boardHeight - o.bounds[4],
    w = o.bounds[3] - o.bounds[0],
    h = o.bounds[4] - o.bounds[1];
  return `${placementSvgTransform(p)} scale(${p.width / w} ${p.height / h}) translate(${-x} ${-y})`;
};
export default function ArtworkCanvas({
  project,
  template,
  face,
  selection,
  font,
  zoom,
  setZoom,
  select,
  multiSelect,
  begin,
  moveMany,
  autoSnap,
  showCutters,
  visibleCutterIds,
  freeTransform,
  duplicateForDrag,
  snapping = null,
}: Props) {
  const centerX = template.width / 2,
    centerY = template.height / 2,
    padding = Math.max(8, Math.max(template.width, template.height) * 0.08);
  const viewWidth = template.width + padding * 2,
    viewHeight = template.height + padding * 2;
  const maskExtent = Math.max(100, template.width, template.height);
  const isBadge = project.format === 'badge-atelier';
  const svg = useRef<SVGSVGElement>(null);
  const [moving, setMoving] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pickCycle = useRef<PickCycle | null>(null);
  const [snapPointer, setSnapPointer] = useState<SnapPoint | null>(null);
  const [dragGuides, setDragGuides] = useState<DragGuide[]>([]);
  const [marqueeBounds, setMarqueeBounds] = useState<Bounds2 | null>(null);
  const marquee = useRef<{
    start: SnapPoint;
    pointerId: number;
    threshold: number;
    previous: ItemRef[];
    candidates: Array<{ ref: ItemRef; bounds: Bounds2 }>;
  } | null>(null);
  const cancelMarquee = () => {
    marquee.current = null;
    setMarqueeBounds(null);
  };
  const [rotationFeedback, setRotationFeedback] = useState<{
    angle: number;
    pivot: SnapPoint;
    pointer: SnapPoint;
    group: boolean;
  } | null>(null);
  const [scaleFeedback, setScaleFeedback] = useState<{
    x: number;
    y: number;
    pointer: SnapPoint;
  } | null>(null);
  const freeDrag = useRef<{
    entries: Array<{ s: Selection; p: TemplatePlacement }>;
    bounds: Bounds2 | null;
    handle: TransformHandle;
    start: SnapPoint;
    begun: boolean;
    axis: DragAxis;
    pointer: SnapPoint;
  } | null>(null);
  const rotationDrag = useRef<{
    entries: Array<{ s: Selection; p: TemplatePlacement }>;
    pivot: SnapPoint;
    start: SnapPoint;
    lastAngle: number;
    delta: number;
    begun: boolean;
  } | null>(null);
  const snapActive = !!snapping;
  const itemVisible = (item: DesignItem, collection?: Collection) =>
    canvasItemVisible(item, showCutters, collection, visibleCutterIds);
  const hiddenCutters = new Set(
    project.collections.flatMap((c) => c.items.filter(isCuttingItem).map((i) => i.id)),
  );
  const snapShapeVisible = (shape: SnapShape) =>
    shape.selection?.kind !== 'item' ||
    !hiddenCutters.has(shape.selection.id) ||
    (showCutters && visibleCutterIds.has(shape.selection.id));
  const snapGeometry = useMemo(() => {
    if (!snapActive) return { shapes: [] as SnapShape[], error: '' };
    try {
      return {
        shapes: makeSnapShapes(project, template, face, font ?? undefined).filter(snapShapeVisible),
        error: '',
      };
    } catch (e) {
      return {
        shapes: [] as SnapShape[],
        error: e instanceof Error ? e.message : '无法读取吸附轮廓',
      };
    }
  }, [snapActive, project, template, face, font, showCutters, visibleCutterIds]);
  const drag = useRef<{
    start: [number, number];
    entries: Array<{ s: Selection; p: TemplatePlacement }>;
    begun: boolean;
    clickSelection?: Selection;
    pickCycle?: PickCycle;
    shapes: SnapShape[];
    keys: Set<string>;
    scene: DragSnapScene;
    axis: DragAxis;
    copied: boolean;
    pointer: SnapPoint;
  } | null>(null);
  const panDrag = useRef<{
    start: [number, number];
    pan: { x: number; y: number };
    scale: [number, number];
  } | null>(null);
  const color = (id: string) => project.palette.find((c) => c.id === id)?.hex ?? '#ff69b4';
  const base = template.objects.find((o) => o.role === 'base');
  const label = template.objects.find((o) => o.role === 'editable-label');
  const panelObject = template.objects.find((o) => o.role === 'fixed-panel');
  const panel = panelPlacement(project, template);
  const labelPlacement = project.template.label;
  const decorationsInPreviewOrder = useMemo(() => previewDecorations(template), [template]);
  const labelPath = !labelPlacement
    ? ''
    : labelPlacement.useOriginal
      ? label?.outlinePath
      : font
        ? itemPath({ id: 'label', name: '标识', kind: 'text', ...labelPlacement }, font)
        : '';
  const labelTransform = !labelPlacement
    ? ''
    : labelPlacement.useOriginal && label
      ? sourceTransform(label, labelPlacement, template.height)
      : placementSvgTransform(labelPlacement);
  const currentPlacement = (): TemplatePlacement | undefined => {
    if (selectionLocked(project, selection)) return undefined;
    if (selection?.kind === 'item')
      return project.collections
        .find((c) => c.id === selection.collectionId)
        ?.items.find((i) => i.id === selection.id && itemVisible(i));
    if (selection?.kind === 'label') return labelPlacement ?? undefined;
    if (selection?.kind === 'panel' && panel.visible && face === 'front') return panel;
    if (selection?.kind === 'decoration') return project.template.decorations[selection.id];
    return undefined;
  };
  const pickPlacement = (s: CanvasPick): TemplatePlacement | undefined => {
    if (selectionLocked(project, s)) return;
    if (s.kind === 'item') {
      const c = project.collections.find((c) => c.id === s.collectionId && c.face === face);
      const item = c?.items.find((i) => i.id === s.id);
      return c && item && itemVisible(item, c) ? item : undefined;
    }
    if (face !== 'front') return;
    if (s.kind === 'label') return labelPlacement?.visible ? labelPlacement : undefined;
    if (s.kind === 'panel') return panel.visible ? panel : undefined;
    const decoration = project.template.decorations[s.id];
    return decoration?.visible ? decoration : undefined;
  };
  const selected = currentPlacement();
  const selectedFrame = selected ? artworkSelectionFrame(selected) : undefined;
  const selectedItems = selectionEntries(selection).flatMap((ref) => {
    const c = project.collections.find(
      (c) => c.id === ref.collectionId && c.face === face && c.visible,
    );
    const i = c?.items.find((i) => i.id === ref.id);
    return i &&
      c &&
      !isItemLocked(c, i) &&
      ((selection?.kind === 'items' && selection.folder) || itemVisible(i, c))
      ? [{ s: { kind: 'item' as const, ...ref }, p: i, frame: artworkSelectionFrame(i) }]
      : [];
  });
  const selectedGroupBounds =
    selectedItems.length && selection?.kind === 'items'
      ? groupPlacementBounds(selectedItems.map(({ frame }) => frame))
      : null;
  const movingShapes = snapGeometry.shapes.filter((shape) => {
    const ref = shape.selection;
    if (ref?.kind === 'item') return selectionContains(selection, ref);
    if (ref?.kind === 'label') return selection?.kind === 'label';
    if (ref?.kind === 'panel') return selection?.kind === 'panel';
    return (
      ref?.kind === 'decoration' && selection?.kind === 'decoration' && ref.id === selection.id
    );
  });
  const movingKeys = new Set(movingShapes.map((shape) => shape.key));
  const activeBasis =
    snapping?.phase === 'source' ? snapping.settings.sourceBasis : snapping?.settings.targetBasis;
  const activeKind =
    snapping?.phase === 'source' ? snapping.settings.sourceKind : snapping?.settings.targetKind;
  const features = useMemo(
    () =>
      snapActive && activeBasis && activeKind
        ? snapFeatures(
            snapGeometry.shapes.filter((shape) =>
              snapping?.phase === 'source' ? movingKeys.has(shape.key) : !movingKeys.has(shape.key),
            ),
            activeBasis,
            activeKind,
          )
        : [],
    [snapGeometry, snapActive, activeBasis, activeKind, snapping?.phase, selection],
  );
  const screenMatrix = svg.current?.getScreenCTM();
  const unitsPerPixel = 1 / (screenMatrix ? Math.hypot(screenMatrix.a, screenMatrix.b) : 8);
  const pickAt = (p: SnapPoint) => pickSnapFeature(features, p, 12 * unitsPerPixel);
  const candidate = snapPointer ? pickAt(snapPointer) : null;
  const snapPreview =
    snapping?.phase === 'target' && snapping.source && candidate && snapPointer
      ? resolveSnap(snapping.source, candidate.feature, snapPointer)
      : null;
  const chooseSnap = (p: SnapPoint) => {
    const pick = pickAt(p);
    if (!pick || !snapping) return;
    if (snapping.phase === 'source') snapping.chooseSource(pick);
    else if (snapping.source) snapping.commit(resolveSnap(snapping.source, pick.feature, p).delta);
  };
  useEffect(() => {
    pickCycle.current = null;
  }, [project, face, showCutters, zoom, pan.x, pan.y, snapActive, freeTransform]);
  useEffect(() => {
    if (pickCycle.current && canvasPickKey(selection) !== pickCycle.current.key)
      pickCycle.current = null;
  }, [selection]);
  useEffect(() => {
    if (snapActive) {
      cancelMarquee();
      drag.current = null;
      setDragGuides([]);
      setMoving(false);
      panDrag.current = null;
      rotationDrag.current = null;
      setRotationFeedback(null);

      freeDrag.current = null;
      setScaleFeedback(null);
    } else setSnapPointer(null);
  }, [snapActive]);
  useEffect(() => {
    rotationDrag.current = null;
    setRotationFeedback(null);

    freeDrag.current = null;
    setScaleFeedback(null);
  }, [face, selection]);
  useEffect(() => {
    cancelMarquee();
    drag.current = null;
    setDragGuides([]);
    setMoving(false);
  }, [face]);
  useEffect(() => {
    if (drag.current && drag.current.entries.some(({ s }) => selectionLocked(project, s))) {
      drag.current = null;
      setDragGuides([]);
      setMoving(false);
    }
  }, [project]);
  useEffect(() => {
    cancelMarquee();
    drag.current = null;
    freeDrag.current = null;

    rotationDrag.current = null;
    setMoving(false);
    setDragGuides([]);
    setRotationFeedback(null);
    setScaleFeedback(null);
  }, [freeTransform]);
  const visibleCollections = project.collections.filter((c) => c.face === face && c.visible);
  const backgroundItems = visibleCollections
    .filter((c) => collectionMode(c) === 'background')
    .flatMap((c) =>
      c.items
        .filter((i) => isItemVisible(c, i) && !isCuttingItem(i))
        .map((i) => ({ i, collectionId: c.id, mode: 'background' as const })),
    );
  const raisedItems = visibleCollections
    .filter((c) => collectionMode(c) === 'raised')
    .flatMap((c) =>
      c.items
        .filter((i) => isItemVisible(c, i) && !isCuttingItem(i))
        .map((i) => ({ i, collectionId: c.id, mode: 'raised' as const })),
    );
  const orderedItems = [...backgroundItems, ...raisedItems];
  const cuttingItems = visibleCollections.flatMap((c) =>
    c.items
      .filter((i) => isItemVisible(c, i) && isCuttingItem(i))
      .map((i) => ({ i, collectionId: c.id })),
  );
  const cutters = useMemo(() => activeCuttersByTarget(project), [project]);
  const heights = cumulativeHeights(project.collections);
  const needsLowerMask = (i: DesignItem) => avoidsLowerArea(i) || i.coversLower === false;
  const decorationMasks = useMemo(() => {
    const paths = new Map<string, string>();
    for (const { i, collectionId, mode } of orderedItems) {
      if (mode !== 'raised' || avoidsLowerArea(i) || i.coversLower !== false) continue;
      for (const o of template.objects.filter((o) => o.role === 'decoration'))
        paths.set(
          `${i.id}/${o.id}`,
          templateAbovePath(o, template.thickness + heights[collectionId], template.height),
        );
    }
    return paths;
  }, [project, template]);
  const safePath = (i: DesignItem) => {
    try {
      return itemPath(i, font ?? undefined);
    } catch {
      return '';
    }
  };
  const paintItemPath = (
    item: DesignItem,
    paint: string,
    props: React.SVGProps<SVGGElement> = {},
  ) => {
    return (
      <AppearancePath
        {...props}
        fillRule="nonzero"
        path={safePath(item)}
        paint={paint}
        width={item.width}
        height={item.height}
        appearance={item.kind === 'text' ? undefined : item}
      />
    );
  };
  const itemTransform = (i: DesignItem) => placementSvgTransform(i);
  const paintCutter = (tool: DesignItem, paint: string) => (
    <g key={tool.id} transform={itemTransform(tool)} fill={paint}>
      {tool.kind === 'paths'
        ? tool.regions?.map((r, n) => (
            <g key={n}>{paintItemPath({ ...tool, regions: [r] }, paint)}</g>
          ))
        : paintItemPath(tool, paint)}
    </g>
  );
  const selectionVisible =
    selection?.kind === 'item'
      ? project.collections.find((c) => c.id === selection.collectionId)?.visible !== false
      : true;
  const point = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return [0, 0] as [number, number];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y] as [number, number];
  };
  const marqueeBox = (start: SnapPoint, end: SnapPoint): Bounds2 => [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ];
  const startMarquee = (e: React.PointerEvent) => {
    if (
      !e.shiftKey ||
      e.button !== 0 ||
      !e.isPrimary ||
      (e.target as Element).closest(
        '.canvas-object, .rotation-handle, .resize-handle, .transform-handle',
      )
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    pickCycle.current = null;
    const start = point(e);
    marquee.current = {
      start,
      pointerId: e.pointerId,
      threshold: 2 * unitsPerPixel,
      previous: selectionEntries(selection),
      // Read bounds once; pointer movement only updates the selection rectangle.
      candidates: visibleCollections.flatMap((c) =>
        c.items
          .filter((i) => itemVisible(i, c) && !isItemLocked(c, i))
          .map((i) => ({
            ref: { collectionId: c.id, id: i.id },
            bounds: placementBounds(artworkSelectionFrame(i)),
          })),
      ),
    };
    setMarqueeBounds(marqueeBox(start, start));
    svg.current?.focus();
    svg.current?.setPointerCapture(e.pointerId);
  };
  const finishMarquee = (e: React.PointerEvent) => {
    const gesture = marquee.current;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const end = point(e);
    const bounds = marqueeBox(gesture.start, end);
    cancelMarquee();
    if (Math.hypot(end[0] - gesture.start[0], end[1] - gesture.start[1]) <= gesture.threshold)
      return;
    const hits = gesture.candidates
      .filter(
        ({ bounds: b }) =>
          b[0] <= bounds[2] && b[2] >= bounds[0] && b[1] <= bounds[3] && b[3] >= bounds[1],
      )
      .map(({ ref }) => ref);
    const unique = new Map<string, ItemRef>();
    for (const ref of [...gesture.previous, ...hits]) {
      const c = project.collections.find((c) => c.id === ref.collectionId && c.face === face);
      const item = c?.items.find((i) => i.id === ref.id);
      if (c && item && itemVisible(item, c) && !isItemLocked(c, item))
        unique.set(`${ref.collectionId}/${ref.id}`, ref);
    }
    const items = [...unique.values()];
    // Marquee selects individual members, never a parent folder.
    select(
      items.length > 1
        ? { kind: 'items', items }
        : items.length
          ? { kind: 'item', ...items[0] }
          : null,
    );
  };
  const rotationEntries = () =>
    selectedItems.length
      ? selectedItems.map(({ s, p }) => ({ s, p: { ...p } }))
      : selected && selected.visible
        ? [{ s: selection, p: { ...selected } }]
        : [];
  const rotationPivot = (): SnapPoint =>
    selectedGroupBounds
      ? [
          (selectedGroupBounds[0] + selectedGroupBounds[2]) / 2,
          (selectedGroupBounds[1] + selectedGroupBounds[3]) / 2,
        ]
      : [selectedFrame!.x + selectedFrame!.width / 2, selectedFrame!.y + selectedFrame!.height / 2];
  const startRotation = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 || snapping) return;
    const entries = rotationEntries();
    if (!entries.length) return;
    const pivot = rotationPivot(),
      start = point(e);
    rotationDrag.current = {
      entries,
      pivot,
      start,
      lastAngle: Math.atan2(start[1] - pivot[1], start[0] - pivot[0]),
      delta: 0,
      begun: false,
    };
    drag.current = null;
    panDrag.current = null;

    freeDrag.current = null;
    setScaleFeedback(null);
    svg.current?.setPointerCapture(e.pointerId);
  };
  const startFreeResize = (e: React.PointerEvent, handle: TransformHandle) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 || snapping) return;
    pickCycle.current = null;
    const entries = selectedGroupBounds
      ? selectedItems.map(({ s, p }) => ({ s, p: { ...p } }))
      : selected
        ? [{ s: selection, p: { ...selected } }]
        : [];
    if (!entries.length) return;
    freeDrag.current = {
      entries,
      bounds: selectedGroupBounds ? [...selectedGroupBounds] : null,
      handle,
      start: point(e),
      begun: false,
      axis: null,
      pointer: point(e),
    };
    drag.current = null;
    panDrag.current = null;

    rotationDrag.current = null;
    setMoving(false);
    setRotationFeedback(null);
    setScaleFeedback(null);
    svg.current?.setPointerCapture(e.pointerId);
  };
  const startGroupResize = (e: React.PointerEvent) => {
    if (selectedGroupBounds) startFreeResize(e, transformHandles[4]);
  };
  const rotationHandle = (x: number, y: number, angle = 0) => {
    const group = !!selectedGroupBounds;
    const pivot = rotationPivot();
    const radius = 10 * unitsPerPixel;
    const height = selectedGroupBounds
      ? selectedGroupBounds[3] - selectedGroupBounds[1]
      : selectedFrame!.height;
    const handleY = y - (freeTransform || height < 30 * unitsPerPixel ? 24 * unitsPerPixel : 0);
    return (
      <>
        {handleY !== y && (
          <line
            className="rotation-handle-connector"
            x1={x}
            y1={y}
            x2={x}
            y2={handleY}
            pointerEvents="none"
          />
        )}
        <g
          className="rotation-handle"
          transform={`translate(${x} ${handleY}) rotate(${-angle})`}
          role="button"
          aria-label={group ? '拖动旋转所选图案' : '拖动旋转图案'}
          tabIndex={0}
          data-pivot-x={pivot[0]}
          data-pivot-y={pivot[1]}
          data-angle={group ? 0 : selected!.rotation}
          onPointerDown={startRotation}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            const entries = rotationEntries();
            const patches = rotatePlacements(
              entries.map(({ p }) => p),
              pivot,
              (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 15 : 1),
            );
            moveMany(entries.map(({ s }, i) => ({ s, patch: patches[i] })));
          }}
        >
          <title>拖动旋转 · 按住 Shift 每 15° · 方向键微调</title>
          <circle className="rotation-hit-area" r={15 * unitsPerPixel} />
          <circle className="rotation-knob" r={radius} />
          <g transform={`scale(${unitsPerPixel})`} pointerEvents="none">
            <path className="rotation-icon" d="M4.5 -3.2A5.5 5.5 0 1 0 5.4 1.2M4.5 -6.3V-2.8H1" />
          </g>
          <g
            className="rotation-hint"
            transform={`translate(${-92 * unitsPerPixel} ${-31 * unitsPerPixel})`}
            pointerEvents="none"
          >
            <rect width={104 * unitsPerPixel} height={20 * unitsPerPixel} rx={5 * unitsPerPixel} />
            <text
              x={52 * unitsPerPixel}
              y={14 * unitsPerPixel}
              textAnchor="middle"
              fontSize={12 * unitsPerPixel}
            >
              拖动旋转 · Shift 15°
            </text>
          </g>
        </g>
      </>
    );
  };
  const start = (e: React.PointerEvent, s: Selection, p: TemplatePlacement) => {
    if (e.button !== 0 || selectionLocked(project, s)) return;
    e.stopPropagation();
    let cycle: PickCycle | undefined;
    let cycledSelection: CanvasPick | undefined;
    const ordinaryMultiSelection = selection?.kind === 'items' && !selection.folder;
    if (
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !multiSelect &&
      !ordinaryMultiSelection &&
      svg.current
    ) {
      const picked = nextCanvasPick(
        canvasHitStack(svg.current, [e.clientX, e.clientY], (hit) => !!pickPlacement(hit)),
        [e.clientX, e.clientY],
        selection,
        pickCycle.current,
      );
      const placement = picked && pickPlacement(picked.dragPick);
      if (picked && placement) {
        s = picked.dragPick;
        p = placement;
        cycle = picked.cycle;
        cycledSelection = picked.pick;
      }
    } else pickCycle.current = null;
    let next = s;
    let clickSelection: Selection | undefined;
    if (s?.kind === 'item') {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const alreadySelected = selectionContains(selection, s);
      // A folder picked in the list can still be dragged as a whole; a plain
      // canvas click enters its hit member instead of selecting the folder.
      if (alreadySelected && selection?.kind === 'items' && selection.folder) clickSelection = s;
      else if (alreadySelected && (additive || multiSelect) && !e.altKey)
        clickSelection = toggleItemSelection(selection, s, true);
      next = alreadySelected
        ? selection
        : toggleItemSelection(selection, s, additive || multiSelect);
      select(next);
      if (!selectionContains(next, s)) return;
    } else select(s);
    if (cycledSelection) clickSelection = cycledSelection;
    const entries =
      next?.kind === 'item' || next?.kind === 'items'
        ? selectionEntries(next).flatMap((ref) => {
            const c = project.collections.find((v) => v.id === ref.collectionId && v.visible);
            const item = c?.items.find((v) => v.id === ref.id);
            return item &&
              c &&
              !isItemLocked(c, item) &&
              ((next?.kind === 'items' && next.folder) || itemVisible(item, c))
              ? [{ s: { kind: 'item' as const, ...ref }, p: { ...item } }]
              : [];
          })
        : [{ s, p: { ...p } }];
    const keys = new Set(
      entries.flatMap(({ s }) =>
        s?.kind === 'item'
          ? [`item:${s.id}`]
          : s?.kind === 'label'
            ? ['label']
            : s?.kind === 'decoration'
              ? [`decoration:${s.id}`]
              : s?.kind === 'panel'
                ? [
                    'panel',
                    ...template.objects
                      .filter((o) => o.role === 'fixed-detail')
                      .map((o) => `fixed-detail:${o.id}`),
                  ]
                : [],
      ),
    );
    const shapes = makeSnapShapes(project, template, face, undefined, 'bounds').filter(
      snapShapeVisible,
    );
    const pointer = point(e);
    drag.current = {
      start: pointer,
      entries,
      begun: false,
      clickSelection,
      pickCycle: cycle,
      keys,
      shapes,
      scene: makeDragSnapScene(shapes, keys),
      axis: null,
      copied: false,
      pointer,
    };
    setDragGuides([]);
    setMoving(false);
    svg.current?.setPointerCapture(e.pointerId);
  };
  const startPan = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    pickCycle.current = null;
    select(null);
    const inverse = svg.current?.getScreenCTM()?.inverse();
    panDrag.current = {
      start: [e.clientX, e.clientY],
      pan,
      scale: [inverse?.a ?? 0.1, inverse?.d ?? 0.1],
    };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const updateMoveDrag = (
    pt: SnapPoint,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  ) => {
    const d = drag.current;
    if (!d) return;
    d.pointer = pt;
    const raw: SnapPoint = [pt[0] - d.start[0], pt[1] - d.start[1]];
    if (!d.begun && Math.hypot(...raw) > 2 * unitsPerPixel) {
      pickCycle.current = null;
      begin();
      d.begun = true;
      setMoving(true);
    }
    if (!d.begun) return;
    if (modifiers.altKey && !d.copied && d.entries.every(({ s }) => s?.kind === 'item')) {
      const copies = duplicateForDrag(d.entries);
      if (copies.length) {
        d.entries = copies;
        d.copied = true;
        d.scene = makeDragSnapScene(d.shapes, d.keys, true);
      }
    }
    d.axis = dragAxis(raw, modifiers.shiftKey, d.axis, 2 * unitsPerPixel);
    const result = resolveDragSnap(
      d.scene,
      raw,
      7 * unitsPerPixel,
      d.axis,
      !autoSnap || modifiers.ctrlKey || modifiers.metaKey,
    );
    moveMany(
      d.entries.map(({ s, p }) => ({
        s,
        patch: { x: p.x + result.delta[0], y: p.y + result.delta[1] },
      })),
      false,
    );
    setDragGuides(result.guides);
  };
  const updateResizeDrag = (
    pt: SnapPoint,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  ) => {
    const d = freeDrag.current;
    if (!d) return;
    d.pointer = pt;
    const delta: SnapPoint = [pt[0] - d.start[0], pt[1] - d.start[1]];
    const angle = d.bounds ? 0 : (d.entries[0].p.rotation * Math.PI) / 180;
    const local: SnapPoint = [
      delta[0] * Math.cos(angle) + delta[1] * Math.sin(angle),
      -delta[0] * Math.sin(angle) + delta[1] * Math.cos(angle),
    ];
    d.axis = dragAxis(local, modifiers.shiftKey, d.axis, 2 * unitsPerPixel);
    if (!d.begun && Math.hypot(...delta) > 2 * unitsPerPixel) {
      begin();
      d.begun = true;
    }
    if (!d.begun) return;
    const options = {
      free: modifiers.ctrlKey || modifiers.metaKey,
      centered: modifiers.altKey,
      axis: d.axis,
    };
    const patches = d.bounds
      ? resizeTransformGroup(
          d.entries.map(({ p }) => p),
          d.bounds,
          d.handle,
          delta,
          options,
        )
      : [resizeArtworkPlacement(d.entries[0].p, d.handle, delta, options)];
    moveMany(
      d.entries.map(({ s }, n) => ({ s, patch: patches[n] })),
      false,
    );
    const original = d.entries[0].p,
      patch = patches[0];
    setScaleFeedback({
      x:
        ((patch.width ?? original.width) / original.width) *
        (!!patch.mirrorX !== !!original.mirrorX ? -1 : 1),
      y:
        ((patch.height ?? original.height) / original.height) *
        (!!patch.mirrorY !== !!original.mirrorY ? -1 : 1),
      pointer: pt,
    });
  };
  useEffect(() => {
    const modifiersChanged = (e: KeyboardEvent) => {
      if (
        (!drag.current && !freeDrag.current) ||
        !['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)
      )
        return;
      if (e.key === 'Alt') e.preventDefault();
      if (freeDrag.current) updateResizeDrag(freeDrag.current.pointer, e);
      else if (drag.current) updateMoveDrag(drag.current.pointer, e);
    };
    window.addEventListener('keydown', modifiersChanged);
    window.addEventListener('keyup', modifiersChanged);
    return () => {
      window.removeEventListener('keydown', modifiersChanged);
      window.removeEventListener('keyup', modifiersChanged);
    };
  });
  const onMove = (e: React.PointerEvent) => {
    if (marquee.current) {
      if (e.pointerId === marquee.current.pointerId)
        setMarqueeBounds(marqueeBox(marquee.current.start, point(e)));
      return;
    }
    if (snapping) {
      setSnapPointer(point(e));
      return;
    }
    if (freeDrag.current) {
      updateResizeDrag(point(e), e);
      return;
    }
    if (rotationDrag.current) {
      const d = rotationDrag.current,
        pt = point(e);
      if (Math.hypot(pt[0] - d.pivot[0], pt[1] - d.pivot[1]) < unitsPerPixel) return;
      const angle = Math.atan2(pt[1] - d.pivot[1], pt[0] - d.pivot[0]);
      d.delta += rotationStep(d.lastAngle, angle);
      d.lastAngle = angle;
      const single = d.entries.length === 1;
      const original = single ? d.entries[0].p.rotation : 0;
      const desired = e.shiftKey
        ? Math.round((original + d.delta) / 15) * 15
        : +(original + d.delta).toFixed(1);
      const delta = desired - original;
      if (
        !d.begun &&
        Math.hypot(pt[0] - d.start[0], pt[1] - d.start[1]) > 2 * unitsPerPixel &&
        Math.abs(delta) > 0.05
      ) {
        begin();
        d.begun = true;
      }
      if (d.begun) {
        const patches = rotatePlacements(
          d.entries.map(({ p }) => p),
          d.pivot,
          delta,
        );
        moveMany(
          d.entries.map(({ s }, i) => ({ s, patch: patches[i] })),
          false,
        );
        setRotationFeedback({ angle: desired, pivot: d.pivot, pointer: pt, group: !single });
      }
      return;
    }
    if (drag.current) {
      updateMoveDrag(point(e), e);
    } else if (panDrag.current) {
      const d = panDrag.current;
      setPan({
        x: d.pan.x + (e.clientX - d.start[0]) * d.scale[0],
        y: d.pan.y + (e.clientY - d.start[1]) * d.scale[1],
      });
    }
  };
  const renderItem = (i: DesignItem, collectionId: string) => {
    if (!i.visible) return null;
    const transform = itemTransform(i);
    return (
      <g key={i.id} mask={needsLowerMask(i) ? `url(#item-coverage-${i.id})` : undefined}>
        <g mask={cutters.get(i.id)?.length ? `url(#cutout-${i.id})` : undefined}>
          <g
            className="canvas-object"
            data-pick-kind="item"
            data-item-id={i.id}
            data-collection-id={collectionId}
            pointerEvents={
              selectionLocked(project, { kind: 'item', collectionId, id: i.id })
                ? 'none'
                : undefined
            }
            transform={transform}
            onPointerDown={(e) => start(e, { kind: 'item', id: i.id, collectionId }, i)}
          >
            {i.kind === 'paths' && i.regions
              ? i.regions.map((r, n) => (
                  <g key={n}>{paintItemPath({ ...i, regions: [r] }, color(r.colorId))}</g>
                ))
              : paintItemPath(i, color(i.colorId))}
          </g>
        </g>
      </g>
    );
  };
  return (
    <svg
      ref={svg}
      className={`artwork-canvas${rotationFeedback ? ' is-rotating' : ''}${scaleFeedback ? ' is-scaling' : ''}${moving ? ' is-moving' : ''}${freeTransform ? ' is-free-transform' : ''}${marqueeBounds ? ' is-marquee' : ''}`}
      viewBox={`${centerX - viewWidth / 2 / zoom - pan.x} ${centerY - viewHeight / 2 / zoom - pan.y} ${viewWidth / zoom} ${viewHeight / zoom}`}
      role="img"
      aria-label={`${face === 'front' ? '正面' : '背面'}${isBadge ? '徽章' : '通行证'}编辑画布，Shift 拖动空白处框选，选择图案后可拖动位置、右上角旋转和右下角尺寸`}
      tabIndex={0}
      onPointerDownCapture={(e) => {
        if (!snapping) {
          startMarquee(e);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const p = point(e);
        setSnapPointer(p);
        chooseSnap(p);
      }}
      onPointerLeave={() => {
        if (snapping) setSnapPointer(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && marquee.current) {
          e.preventDefault();
          e.stopPropagation();
          cancelMarquee();
          return;
        }
        if (snapping && e.key === 'Enter' && snapPointer) {
          e.preventDefault();
          e.stopPropagation();
          chooseSnap(snapPointer);
        }
      }}
      onPointerDown={startPan}
      onPointerMove={onMove}
      onPointerUp={(e) => {
        finishMarquee(e);
        if (drag.current?.pickCycle && !drag.current.begun) {
          const cycle = drag.current.pickCycle;
          pickCycle.current =
            Math.hypot(e.clientX - cycle.screen[0], e.clientY - cycle.screen[1]) <= 4
              ? cycle
              : null;
        }
        if (drag.current && !drag.current.begun && drag.current.clickSelection !== undefined)
          select(drag.current.clickSelection);
        drag.current = null;
        setDragGuides([]);
        setMoving(false);
        panDrag.current = null;
        rotationDrag.current = null;
        setRotationFeedback(null);

        freeDrag.current = null;
        setScaleFeedback(null);
      }}
      onPointerCancel={() => {
        pickCycle.current = null;
        cancelMarquee();
        drag.current = null;
        setDragGuides([]);
        setMoving(false);
        panDrag.current = null;
        rotationDrag.current = null;
        setRotationFeedback(null);

        freeDrag.current = null;
        setScaleFeedback(null);
      }}
      onLostPointerCapture={() => {
        if (drag.current) pickCycle.current = null;
        cancelMarquee();
        drag.current = null;
        setDragGuides([]);
        setMoving(false);
        panDrag.current = null;
        rotationDrag.current = null;
        setRotationFeedback(null);

        freeDrag.current = null;
        setScaleFeedback(null);
      }}
      onWheel={(e) => {
        e.preventDefault();
        if (marquee.current || e.deltaY === 0 || !svg.current?.getScreenCTM()) return;
        const nextZoom = wheelCanvasZoom(zoom, e.deltaY, e.deltaMode);
        if (nextZoom === zoom) return;
        const anchor = point(e),
          ratio = zoom / nextZoom;
        // Move the view center towards the pointer so its canvas point stays fixed.
        setPan({
          x: centerX - anchor[0] - (centerX - pan.x - anchor[0]) * ratio,
          y: centerY - anchor[1] - (centerY - pan.y - anchor[1]) * ratio,
        });
        setZoom(nextZoom);
      }}
    >
      <defs>
        <filter id="paper-shadow" x="-50%" y="-30%" width="200%" height="170%">
          <feDropShadow
            dx="0"
            dy="1.2"
            stdDeviation="1.5"
            floodColor="#6a3851"
            floodOpacity=".14"
          />
        </filter>
        <clipPath id="card-outline">
          <path
            clipRule={isBadge ? 'evenodd' : undefined}
            fillRule={isBadge ? 'evenodd' : undefined}
            d={base?.outlinePath ?? `M0 0H${template.width}V${template.height}H0Z`}
            transform={face === 'back' ? `translate(${template.width} 0) scale(-1 1)` : undefined}
          />
        </clipPath>
        <mask id="protected-front">
          <rect
            x={-maskExtent}
            y={-maskExtent}
            width={maskExtent * 3}
            height={maskExtent * 3}
            fill="white"
          />
          {panel.visible && (
            <rect
              width={panel.width}
              height={panel.height}
              transform={placementSvgTransform(panel)}
              fill="black"
            />
          )}
          {labelPlacement?.visible && (
            <path d={labelPath} transform={labelTransform} fill="black" />
          )}
        </mask>
        {cuttingItems
          .filter(({ i }) => i.cutout!.keepInside)
          .map(({ i }) => (
            <mask
              key={`keep-${i.id}`}
              id={`cutout-keep-${i.id}`}
              maskUnits="userSpaceOnUse"
              x={-maskExtent}
              y={-maskExtent}
              width={maskExtent * 3}
              height={maskExtent * 3}
            >
              {paintCutter(i, 'white')}
            </mask>
          ))}
        {orderedItems
          .filter(({ i }) => cutters.get(i.id)?.length)
          .map(({ i }) => (
            <mask
              key={`cut-${i.id}`}
              id={`cutout-${i.id}`}
              maskUnits="userSpaceOnUse"
              x={-maskExtent}
              y={-maskExtent}
              width={maskExtent * 3}
              height={maskExtent * 3}
            >
              {cutters
                .get(i.id)!
                .filter((tool) => tool.cutout!.keepInside)
                .reduce<React.ReactNode>(
                  (content, tool) => (
                    <g key={tool.id} mask={`url(#cutout-keep-${tool.id})`}>
                      {content}
                    </g>
                  ),
                  <g>
                    <rect
                      x={-maskExtent}
                      y={-maskExtent}
                      width={maskExtent * 3}
                      height={maskExtent * 3}
                      fill="white"
                    />
                    {cutters
                      .get(i.id)!
                      .filter((tool) => !tool.cutout!.keepInside)
                      .map((tool) => paintCutter(tool, 'black'))}
                  </g>,
                )}
            </mask>
          ))}
        {orderedItems
          .filter(({ i }) => needsLowerMask(i))
          .map(({ i, mode, collectionId }) => {
            const index = orderedItems.findIndex((v) => v.i.id === i.id);
            return (
              <mask
                key={i.id}
                id={`item-coverage-${i.id}`}
                maskUnits="userSpaceOnUse"
                x={-maskExtent}
                y={-maskExtent}
                width={maskExtent * 3}
                height={maskExtent * 3}
              >
                <rect
                  x={-maskExtent}
                  y={-maskExtent}
                  width={maskExtent * 3}
                  height={maskExtent * 3}
                  fill="white"
                />
                {orderedItems
                  .slice(0, index)
                  .filter(
                    ({ mode: lowerMode, collectionId: lowerCollection }) =>
                      avoidsLowerArea(i) ||
                      mode === 'background' ||
                      (lowerMode === 'raised' && heights[lowerCollection] >= heights[collectionId]),
                  )
                  .map(({ i: lower }) => (
                    <g
                      key={lower.id}
                      mask={cutters.get(lower.id)?.length ? `url(#cutout-${lower.id})` : undefined}
                    >
                      {paintItemPath(lower, 'black', {
                        transform: itemTransform(lower),
                        mask: needsLowerMask(lower) ? `url(#item-coverage-${lower.id})` : undefined,
                      })}
                    </g>
                  ))}
                {mode === 'raised' &&
                  face === 'front' &&
                  template.objects
                    .filter((o) => o.role === 'decoration')
                    .map((o) => {
                      const p = project.template.decorations[o.id];
                      return p?.visible ? (
                        <path
                          key={o.id}
                          d={
                            avoidsLowerArea(i)
                              ? o.outlinePath
                              : decorationMasks.get(`${i.id}/${o.id}`)
                          }
                          transform={sourceTransform(o, p, template.height)}
                          fill="black"
                        />
                      ) : null;
                    })}
              </mask>
            );
          })}
      </defs>
      <g filter="url(#paper-shadow)" pointerEvents="none">
        <path
          fillRule={isBadge ? 'evenodd' : undefined}
          d={base?.outlinePath ?? `M0 0H${template.width}V${template.height}H0Z`}
          transform={face === 'back' ? `translate(${template.width} 0) scale(-1 1)` : undefined}
          fill={color(
            (face === 'front' ? project.template.frontColorId : project.template.backColorId) ??
              project.template.baseColorId,
          )}
        />
      </g>
      <g clipPath="url(#card-outline)">
        <g mask={face === 'front' ? 'url(#protected-front)' : undefined}>
          {backgroundItems.map(({ i, collectionId }) => renderItem(i, collectionId))}
        </g>
        {face === 'front' &&
          decorationsInPreviewOrder.map((o) => {
            const p = project.template.decorations[o.id];
            return (
              p?.visible && (
                <path
                  key={o.id}
                  className="canvas-object"
                  data-pick-kind="decoration"
                  data-pick-id={o.id}
                  d={o.outlinePath}
                  transform={sourceTransform(o, p, template.height)}
                  fill={color(p.colorId)}
                  pointerEvents={p.locked ? 'none' : undefined}
                  onPointerDown={(e) => start(e, { kind: 'decoration', id: o.id }, p)}
                />
              )
            );
          })}
        <g mask={face === 'front' ? 'url(#protected-front)' : undefined}>
          {raisedItems.map(({ i, collectionId }) => renderItem(i, collectionId))}
        </g>
        {face === 'front' && (
          <>
            {panel.visible &&
              panelObject &&
              template.objects
                .filter((o) => o.role === 'fixed-panel' || o.role === 'fixed-detail')
                .map((o) => (
                  <path
                    key={o.id}
                    className="canvas-object"
                    data-pick-kind="panel"
                    d={o.outlinePath}
                    transform={sourceTransform(panelObject, panel, template.height)}
                    fill={color(
                      o.role === 'fixed-panel'
                        ? project.template.panelColorId
                        : project.template.panelDetailColorId,
                    )}
                    pointerEvents={panel.locked ? 'none' : undefined}
                    onPointerDown={(e) => start(e, { kind: 'panel' }, panel)}
                  />
                ))}
            {labelPlacement?.visible && (
              <path
                className="canvas-object"
                data-pick-kind="label"
                d={labelPath}
                transform={labelTransform}
                fill={color(labelPlacement.colorId)}
                pointerEvents={labelPlacement.locked ? 'none' : undefined}
                onPointerDown={(e) => start(e, { kind: 'label' }, labelPlacement)}
              />
            )}
          </>
        )}
      </g>
      {isBadge && face === 'back' && (
        <g className="badge-slot-guides" pointerEvents="none" aria-label="背面安装槽轮廓">
          {project.badgeBase!.mounts.map((mount, i) => (
            <path
              key={mount.id}
              d={mountOutline(mount)}
              transform={placementSvgTransform(mountPlacement(mount))}
              fill="rgba(124,112,140,.22)"
              stroke="#927c97"
              strokeWidth=".22"
              strokeDasharray="1 .7"
            >
              <title>
                {i + 1}. 安装槽 · 深 {mount.depth} mm · 深度请查看 3D
              </title>
            </path>
          ))}
        </g>
      )}
      {showCutters &&
        cuttingItems
          .filter(({ i }) => visibleCutterIds.has(i.id))
          .map(({ i, collectionId }) => (
            <g
              key={i.id}
              className="canvas-object cutting-object"
              data-pick-kind="item"
              data-item-id={i.id}
              data-collection-id={collectionId}
              data-cutting-tool="true"
              transform={itemTransform(i)}
              onPointerDown={(e) => start(e, { kind: 'item', id: i.id, collectionId }, i)}
            >
              {i.kind !== 'text' &&
              (!shapeAppearance(i).shapeFill || shapeAppearance(i).shapeOutline)
                ? paintItemPath(i, '#c33f76', { opacity: 0.65 })
                : (i.kind === 'paths'
                    ? i.regions?.map((r) => safePath({ ...i, regions: [r] }))
                    : [safePath(i)]
                  )?.map((path, n) => (
                    <path
                      key={n}
                      d={path}
                      fill="rgba(207, 64, 117, 0.12)"
                      stroke="#c33f76"
                      strokeWidth="1.5"
                      strokeDasharray="5 3"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents={
                        selectionLocked(project, { kind: 'item', collectionId, id: i.id })
                          ? 'none'
                          : 'all'
                      }
                    />
                  ))}
            </g>
          ))}
      {selectedItems.length > 0 && selection?.kind === 'items' && (
        <g className="multi-selection-mark" pointerEvents="none">
          {selectedItems
            .filter(({ s, p }) => {
              const c = project.collections.find((c) => c.id === s.collectionId)!;
              return itemVisible(p as DesignItem, c);
            })
            .map(({ s, frame }) => (
              <rect
                key={s.id}
                x={frame.x}
                y={frame.y}
                width={frame.width}
                height={frame.height}
                transform={`rotate(${frame.rotation} ${frame.x + frame.width / 2} ${frame.y + frame.height / 2})`}
                fill="none"
                stroke="#bd356e"
                strokeWidth=".28"
                strokeDasharray="1.2 .7"
              />
            ))}
          {(() => {
            const bounds = selectedItems.map(({ frame }) => placementBounds(frame));
            const x = Math.min(...bounds.map((b) => b[0])),
              y = Math.min(...bounds.map((b) => b[1]));
            return (
              <rect
                x={x}
                y={y}
                width={Math.max(...bounds.map((b) => b[2])) - x}
                height={Math.max(...bounds.map((b) => b[3])) - y}
                fill="none"
                stroke="#bd356e"
                strokeWidth=".15"
                strokeDasharray=".5 .7"
              />
            );
          })()}
        </g>
      )}
      {!snapping &&
        selectedGroupBounds &&
        rotationHandle(selectedGroupBounds[2], selectedGroupBounds[1])}
      {!snapping && !freeTransform && selectedGroupBounds && (
        <g
          className="resize-handle group-resize-handle"
          transform={`translate(${selectedGroupBounds[2]} ${selectedGroupBounds[3]})`}
          role="button"
          aria-label="拖动缩放所选图案"
          tabIndex={0}
          data-anchor-x={selectedGroupBounds[0]}
          data-anchor-y={selectedGroupBounds[1]}
          data-width={selectedGroupBounds[2] - selectedGroupBounds[0]}
          data-height={selectedGroupBounds[3] - selectedGroupBounds[1]}
          onPointerDown={startGroupResize}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            const grow = e.key === 'ArrowRight' || e.key === 'ArrowUp';
            const step = e.shiftKey ? 1.1 : 1.01;
            const patches = scalePlacements(
              selectedItems.map(({ p }) => p),
              [selectedGroupBounds[0], selectedGroupBounds[1]],
              grow ? step : 1 / step,
            );
            moveMany(selectedItems.map(({ s }, i) => ({ s, patch: patches[i] })));
          }}
        >
          <title>默认等比 · Shift 单轴 · Alt 中心 · Ctrl 自由 · 方向键 1%</title>
          <circle className="resize-hit-area" r={15 * unitsPerPixel} />
          <circle className="group-resize-knob" r={9 * unitsPerPixel} />
          <g transform={`scale(${unitsPerPixel})`} pointerEvents="none">
            <path className="group-resize-icon" d="M-4 1V-4H1M-4 -4L4 4M-1 4H4V-1" />
          </g>
          <g
            className="resize-hint"
            transform={`translate(${-133 * unitsPerPixel} ${-35 * unitsPerPixel})`}
            pointerEvents="none"
          >
            <rect width={145 * unitsPerPixel} height={22 * unitsPerPixel} rx={5 * unitsPerPixel} />
            <text
              x={72.5 * unitsPerPixel}
              y={15 * unitsPerPixel}
              textAnchor="middle"
              fontSize={12 * unitsPerPixel}
            >
              拖动整体缩放 · 保持比例
            </text>
          </g>
        </g>
      )}
      {!snapping &&
        selected &&
        selected.visible &&
        selectionVisible &&
        selectedItems.length <= 1 && (
          <g
            className="selection-mark"
            transform={`translate(${selectedFrame!.x} ${selectedFrame!.y}) rotate(${selectedFrame!.rotation} ${selectedFrame!.width / 2} ${selectedFrame!.height / 2})`}
          >
            <rect
              width={selectedFrame!.width}
              height={selectedFrame!.height}
              fill="none"
              stroke="#bd356e"
              strokeWidth=".28"
              strokeDasharray="1.2 .7"
              pointerEvents="none"
            />
            {!freeTransform && (
              <>
                <circle
                  cx="0"
                  cy="0"
                  r=".75"
                  fill="white"
                  stroke="#bd356e"
                  strokeWidth=".25"
                  pointerEvents="none"
                />
                <circle
                  cx={selectedFrame!.width}
                  cy={selectedFrame!.height}
                  r="1.1"
                  fill="white"
                  stroke="#bd356e"
                  strokeWidth=".35"
                  className="resize-handle"
                  onPointerDown={(e) => startFreeResize(e, transformHandles[4])}
                />
              </>
            )}
            {rotationHandle(selectedFrame!.width, 0, selectedFrame!.rotation)}
          </g>
        )}
      {freeTransform &&
        !snapping &&
        (() => {
          const frame = selectedGroupBounds
            ? {
                x: selectedGroupBounds[0],
                y: selectedGroupBounds[1],
                width: selectedGroupBounds[2] - selectedGroupBounds[0],
                height: selectedGroupBounds[3] - selectedGroupBounds[1],
                rotation: 0,
              }
            : selectedFrame;
          if (!frame) return null;
          return (
            <g
              transform={`translate(${frame.x} ${frame.y}) rotate(${frame.rotation} ${frame.width / 2} ${frame.height / 2})`}
            >
              {transformHandles
                .filter((h) => !selectedGroupBounds || (h.x && h.y))
                .map((h) => (
                  <g
                    key={h.name}
                    className="transform-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={`${h.name}缩放`}
                    style={{
                      cursor: !h.x
                        ? 'ns-resize'
                        : !h.y
                          ? 'ew-resize'
                          : h.x === h.y
                            ? 'nwse-resize'
                            : 'nesw-resize',
                    }}
                    transform={`translate(${((h.x + 1) * frame.width) / 2} ${((h.y + 1) * frame.height) / 2})`}
                    onPointerDown={(e) => startFreeResize(e, h)}
                  >
                    <title>默认等比 · Shift 单轴 · Alt 中心 · Ctrl 自由</title>
                    <rect
                      className="transform-hit-area"
                      x={-12 * unitsPerPixel}
                      y={-12 * unitsPerPixel}
                      width={24 * unitsPerPixel}
                      height={24 * unitsPerPixel}
                    />
                    <rect
                      className="transform-knob"
                      x={-4 * unitsPerPixel}
                      y={-4 * unitsPerPixel}
                      width={8 * unitsPerPixel}
                      height={8 * unitsPerPixel}
                      rx={unitsPerPixel}
                    />
                  </g>
                ))}
            </g>
          );
        })()}
      {rotationFeedback && (
        <g className="rotation-overlay" pointerEvents="none">
          <line
            x1={rotationFeedback.pivot[0]}
            y1={rotationFeedback.pivot[1]}
            x2={rotationFeedback.pointer[0]}
            y2={rotationFeedback.pointer[1]}
          />
          <circle
            cx={rotationFeedback.pivot[0]}
            cy={rotationFeedback.pivot[1]}
            r={3 * unitsPerPixel}
          />
          <g
            className="rotation-readout"
            transform={`translate(${Math.max(centerX - viewWidth / 2 / zoom - pan.x + 3 * unitsPerPixel, Math.min(rotationFeedback.pointer[0] + 13 * unitsPerPixel, centerX + viewWidth / 2 / zoom - pan.x - 125 * unitsPerPixel))} ${Math.max(centerY - viewHeight / 2 / zoom - pan.y + 3 * unitsPerPixel, Math.min(rotationFeedback.pointer[1] + 13 * unitsPerPixel, centerY + viewHeight / 2 / zoom - pan.y - 30 * unitsPerPixel))})`}
          >
            <rect width={120 * unitsPerPixel} height={26 * unitsPerPixel} rx={6 * unitsPerPixel} />
            <text
              x={60 * unitsPerPixel}
              y={18 * unitsPerPixel}
              textAnchor="middle"
              fontSize={13 * unitsPerPixel}
            >
              {rotationFeedback.group ? '整体 ' : ''}
              {rotationFeedback.angle.toFixed(1)}°
            </text>
          </g>
        </g>
      )}
      {scaleFeedback && (
        <g
          className="scale-readout"
          pointerEvents="none"
          transform={`translate(${Math.max(centerX - viewWidth / 2 / zoom - pan.x + 3 * unitsPerPixel, Math.min(scaleFeedback.pointer[0] + 13 * unitsPerPixel, centerX + viewWidth / 2 / zoom - pan.x - 165 * unitsPerPixel))} ${Math.max(centerY - viewHeight / 2 / zoom - pan.y + 3 * unitsPerPixel, Math.min(scaleFeedback.pointer[1] + 13 * unitsPerPixel, centerY + viewHeight / 2 / zoom - pan.y - 30 * unitsPerPixel))})`}
        >
          <rect width={160 * unitsPerPixel} height={26 * unitsPerPixel} rx={6 * unitsPerPixel} />
          <text
            x={80 * unitsPerPixel}
            y={18 * unitsPerPixel}
            textAnchor="middle"
            fontSize={13 * unitsPerPixel}
          >
            {Math.abs(scaleFeedback.x - scaleFeedback.y) < 1e-6
              ? `等比 ${(scaleFeedback.x * 100).toFixed(1)}%`
              : `X ${(scaleFeedback.x * 100).toFixed(0)}% · Y ${(scaleFeedback.y * 100).toFixed(0)}%`}
          </text>
        </g>
      )}
      {dragGuides.length > 0 && (
        <g className="drag-snap-guides" pointerEvents="none" aria-hidden="true">
          {dragGuides.map((guide, index) =>
            'point' in guide ? (
              <circle key={index} cx={guide.point[0]} cy={guide.point[1]} r={4 * unitsPerPixel} />
            ) : (
              <line
                key={index}
                data-drag-guide={guide.axis}
                x1={guide.axis === 'x' ? guide.value : guide.span[0] - 3 * unitsPerPixel}
                y1={guide.axis === 'y' ? guide.value : guide.span[0] - 3 * unitsPerPixel}
                x2={guide.axis === 'x' ? guide.value : guide.span[1] + 3 * unitsPerPixel}
                y2={guide.axis === 'y' ? guide.value : guide.span[1] + 3 * unitsPerPixel}
              />
            ),
          )}
        </g>
      )}
      {snapping && (
        <g className="snap-overlay" pointerEvents="none">
          {movingShapes.map((shape) => (
            <path
              key={shape.key}
              d={contoursToPath(
                snapping.settings.sourceBasis === 'bounds' ? [shape.boundsContour] : shape.contours,
              )}
              className="snap-source-outline"
            />
          ))}
          {candidate &&
            snapping.phase === 'target' &&
            (() => {
              const shape = snapGeometry.shapes.find(
                (shape) => shape.key === candidate.feature.owner,
              );
              return shape ? (
                <path
                  d={contoursToPath(
                    activeBasis === 'bounds' ? [shape.boundsContour] : shape.contours,
                  )}
                  className="snap-target-outline"
                />
              ) : null;
            })()}
          {features
            .filter((feature) => {
              if (!feature.point) return false;
              return (
                features.length <= 100 ||
                (snapPointer &&
                  Math.hypot(feature.point[0] - snapPointer[0], feature.point[1] - snapPointer[1]) <
                    25 * unitsPerPixel)
              );
            })
            .slice(0, 100)
            .map((feature) => (
              <circle
                key={feature.id}
                cx={feature.point![0]}
                cy={feature.point![1]}
                r={3.3 * unitsPerPixel}
                className={snapping.phase === 'source' ? 'snap-source-dot' : 'snap-target-dot'}
                data-snap-owner={feature.owner}
                data-snap-kind={feature.kind}
                data-snap-x={feature.point![0]}
                data-snap-y={feature.point![1]}
              />
            ))}
          {features
            .filter(
              (feature) => feature.a && (feature.infinite || candidate?.feature.id === feature.id),
            )
            .slice(0, 80)
            .map((feature) => {
              let [a, b] = [feature.a!, feature.b!];
              if (feature.infinite) {
                const dx = b[0] - a[0],
                  dy = b[1] - a[1];
                a = [a[0] - dx * 250, a[1] - dy * 250];
                b = [b[0] + dx * 250, b[1] + dy * 250];
              }
              return (
                <line
                  key={feature.id}
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  className={snapping.phase === 'source' ? 'snap-source-line' : 'snap-target-line'}
                  data-snap-owner={feature.owner}
                  data-snap-kind={feature.kind}
                />
              );
            })}
          {snapping.source && (
            <circle
              cx={snapping.source.point[0]}
              cy={snapping.source.point[1]}
              r={6 * unitsPerPixel}
              className="snap-source-picked"
            />
          )}
          {snapPreview && (
            <>
              <g
                transform={`translate(${snapPreview.delta[0]} ${snapPreview.delta[1]})`}
                className="snap-ghost"
              >
                {movingShapes.map((shape) => (
                  <path
                    key={shape.key}
                    d={contoursToPath(
                      shape.contours.length ? shape.contours : [shape.boundsContour],
                    )}
                  />
                ))}
              </g>
              <line
                x1={snapPreview.source[0]}
                y1={snapPreview.source[1]}
                x2={snapPreview.target[0]}
                y2={snapPreview.target[1]}
                className="snap-travel-line"
              />
            </>
          )}
          {candidate && (
            <g
              data-snap-candidate={candidate.feature.id}
              data-snap-owner={candidate.feature.owner}
              data-snap-kind={candidate.feature.kind}
              data-snap-x={(snapPreview?.target ?? candidate.point)[0]}
              data-snap-y={(snapPreview?.target ?? candidate.point)[1]}
            >
              <circle
                cx={(snapPreview?.target ?? candidate.point)[0]}
                cy={(snapPreview?.target ?? candidate.point)[1]}
                r={7 * unitsPerPixel}
                className="snap-candidate"
              />
              <path
                d={`M${candidate.point[0] - 4 * unitsPerPixel} ${candidate.point[1]}h${8 * unitsPerPixel}M${candidate.point[0]} ${candidate.point[1] - 4 * unitsPerPixel}v${8 * unitsPerPixel}`}
                className="snap-candidate-cross"
              />
            </g>
          )}
          {(() => {
            const message =
              snapGeometry.error ||
              (features.length === 0
                ? '当前没有可选参照；文字轮廓加载后可选，或切换外接框。'
                : candidate?.feature.name);
            if (!message) return null;
            const left = centerX - viewWidth / 2 / zoom - pan.x,
              top = centerY - viewHeight / 2 / zoom - pan.y;
            const text = message.length > 30 ? message.slice(0, 30) + '…' : message;
            const width = (text.length * 8 + 22) * unitsPerPixel;
            const x = Math.max(
              left + 3 * unitsPerPixel,
              Math.min(
                (snapPointer?.[0] ?? 10) + 10 * unitsPerPixel,
                left + viewWidth / zoom - width - 3 * unitsPerPixel,
              ),
            );
            const y = Math.max(
              top + 45 * unitsPerPixel,
              Math.min(
                (snapPointer?.[1] ?? 30) + 12 * unitsPerPixel,
                top + viewHeight / zoom - 25 * unitsPerPixel,
              ),
            );
            return (
              <g transform={`translate(${x} ${y})`} className="snap-candidate-label">
                <rect width={width} height={25 * unitsPerPixel} rx={5 * unitsPerPixel} />
                <text x={9 * unitsPerPixel} y={17 * unitsPerPixel} fontSize={12 * unitsPerPixel}>
                  {text}
                </text>
              </g>
            );
          })()}
        </g>
      )}
      <g className="dimension-marks" pointerEvents="none">
        <path
          d={`M0 ${template.height + 3}H${template.width}M0 ${template.height + 2}v2M${template.width} ${template.height + 2}v2`}
        />
        <text x={centerX} y={template.height + 6} textAnchor="middle">
          {Number(template.width.toFixed(3))} mm
        </text>
        <path
          d={`M${template.width + 3} 0V${template.height}M${template.width + 2} 0h2M${template.width + 2} ${template.height}h2`}
        />
        <text
          x={template.width + 6}
          y={centerY}
          transform={`rotate(90 ${template.width + 6} ${centerY})`}
          textAnchor="middle"
        >
          {Number(template.height.toFixed(3))} mm
        </text>
      </g>
      {marqueeBounds && (
        <rect
          className="marquee-selection"
          x={marqueeBounds[0]}
          y={marqueeBounds[1]}
          width={marqueeBounds[2] - marqueeBounds[0]}
          height={marqueeBounds[3] - marqueeBounds[1]}
          pointerEvents="none"
          aria-hidden="true"
        />
      )}
    </svg>
  );
}

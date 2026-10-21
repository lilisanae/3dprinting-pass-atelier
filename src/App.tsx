import importArtworkPreview, {type ImportContent} from './components/ImportArtworkPreview';
import {silhouetteArtwork} from './artwork/silhouette';
import {flattenPath} from './artwork/paths';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { serializeProject } from './io/projectFile';
import useBrowserProgress from './ui/useBrowserProgress';
import { workshopFromLocation, workshopHref, workshopNames, projectWorkshop, type WorkshopKind } from './model/workshop';
import { saveBrowserProgress } from './io/browserProgress';
import useCutterView from './ui/useCutterView';
import { canvasZoomLimits, stepCanvasZoom } from './ui/canvasZoom';
import { collectionLayerSections } from './model/cutterView';
import type { TextFont as Font } from './artwork/font-pack';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  GripVertical,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileUp,
  FilePlus2,
  Heart,
  ImagePlus,
  Layers,
  LoaderCircle,
  LockKeyhole,
  UnlockKeyhole,
  Maximize2,
  Moon,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Pencil as PencilIcon,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Settings2,
  Sparkles,
  Sun,
  Square,
  Star,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  Collection,
  ColorCandidate,
  DesignItem,
  Face,
  Project,
  Selection,
  TemplateData,
  TemplatePlacement,
  ProjectFont,
  TextStyle,
} from './model/types';
import {
  avoidsLowerArea,
  createBlankProject,
  cumulativeHeights,
  collectionMode,
  collectionInlayDepth,
  backSurfaceDepth,
  maxBackInlayDepth,
  frontSurfaceDepth,
  DEFAULT_RAISED_THICKNESS,
  newCollection,
  newShape,
  uid,
  validateProject,
} from './model/project';
import type { NewProjectMode } from './model/project';
import {
  selectionEntries,
  selectionContains,
  toggleItemSelection,
  alignPlacements,
} from './model/selection';
import { loadProjectFont, projectText, projectFontChoices } from './artwork/font-loader';
import { warnBeforeUnload } from './ui/unsavedChanges';
import { isStarterProject } from './model/starterProject';
import NumberField from './components/NumberField';
import QuickStart, { markQuickStartSeen, shouldOpenQuickStart } from './components/QuickStart';
import NewProjectDialog from './components/NewProjectDialog';
import {
  badgeTemplate, createBadgeProject, validateBadgeBase, badgeArtworkColor,
  badgeLayers, badgeLayerLimits, setBadgeLayer, type BadgeBase, type BadgeLayers,
} from './model/badge';
const BadgeDesigner = lazy(() => import('./components/BadgeDesigner'));
import ShapeLibrary from './components/ShapeLibrary';
import ShapeAppearanceControls from './components/ShapeAppearanceControls';
import { defaultShapeAppearance, shapeAppearance } from './model/shapeCatalog';
import TextProperties from './components/TextProperties';
import { resizeTextContent } from './model/textEditing';
import { deleteTemplateElement, panelPlacement } from './model/templateEditing';
import BooleanProperties from './components/BooleanProperties';
import { copyArtwork, isCuttingItem, newCutter, pruneCutTargets } from './model/booleanEditing';
import { duplicateDragItems } from './model/dragEditing';
import type { DragEntry } from './model/dragEditing';
import {
  applyPlacementPatch,
  isItemLocked,
  isItemVisible,
  selectionLocked,
  unlockedSelection,
} from './model/layerEditing';
import { defaultImportOptions } from './artwork/import-options';
import type { ImportOptions, ImportResult, ArtworkImporter } from './artwork/import';
import ImportPreview from './components/ImportPreview';
import {
  insertImportedArtwork,
  lightestColorId,
  silhouetteCollection,
} from './model/importedArtwork';
import { groupPlacementBounds, scaleGroupAxis } from './model/scaling';
import { artworkSelectionFrame } from './model/artworkBounds';
import {
  adjacentCollection,
  faceCollections as orderedFaceCollections,
  moveItemToAdjacentCollection,
} from './model/collectionEditing';
import ArtworkCanvas from './components/ArtworkCanvas';
import ThreePreviewPanel from './components/ThreePreviewPanel';
import useGeometry from './ui/useGeometry';
import {
  prepareWorkbench,
  preparationSteps,
  type PreparedWorkbench,
  type PreparationProgress,
} from './ui/prepareWorkbench';
import SnapControls from './components/SnapControls';
import type { SnapPick } from './model/snapping';
import { defaultSnapSettings, snapKindLabels } from './ui/snapState';
import type { SnapPhase, SnapSettings } from './ui/snapState';
import useProject from './ui/useProject';
import { applyMergedArtwork, mergeReason } from './model/mergeEditing';
import { rotatePlacements } from './model/rotation';
import {
  folderSelection,
  groupingReason,
  groupLayers,
  dissolveFolder,
  leaveFolder,
  pruneFolders,
} from './model/folderEditing';
import { applyTheme, nextTheme, readTheme, type Theme } from './ui/theme';
import { dropLayerSelection, layerDragReason, layerDropReason } from './model/layerListEditing';
import useLayerListDrag from './ui/useLayerListDrag';
import { removePaletteColor } from './model/paletteEditing';
import PrintWarnings from './components/PrintWarnings';
import LineartBetaControls from './components/LineartBetaControls';
import { applyColorCorrections, removeColorFragment, setColorCorrection, type ColorCorrectionAction } from './model/colorCorrections';

const IconButton = ({
  label,
  children,
  onClick,
  disabled = false,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={`icon-button ${className}`}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);
const download = (data: Uint8Array | string, name: string, type: string) => {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob.size;
};
function Doodle() {
  return (
    <svg viewBox="0 0 110 82" className="brand-doodle" aria-hidden="true">
      <path
        d="M20 57C9 43 14 18 35 17C40 3 65 5 72 21C94 14 102 32 92 49C100 65 83 74 67 69C45 83 32 74 31 65Z"
        fill="#ffe6fa"
        stroke="#34313a"
        strokeWidth="2"
      />
      <path d="M43 37l-2 8m25-8l2 8" stroke="#34313a" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M48 53q8 7 15-1"
        fill="none"
        stroke="#34313a"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M14 11l4 4m67 50l7 2M91 3l-2 7m7-3l-10-1"
        stroke="#ff69b4"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="35" cy="51" r="4" fill="#ffb6c1" />
      <circle cx="75" cy="50" r="4" fill="#ffb6c1" />
    </svg>
  );
}

export default function App() {
  const [workshop] = useState(() => workshopFromLocation(window.location));
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === 'undefined' ? 'light' : readTheme(),
  );
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const [prepared, setPrepared] = useState<PreparedWorkbench | null>(null);
  const [progress, setProgress] = useState<PreparationProgress>({
    percent: 0,
    fractions: [0, 0],
    detail: '正在读取模板与设计…',
  });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setProgress({ percent: 0, fractions: [0, 0], detail: '正在读取模板与设计…' });
    prepareWorkbench(
      (p) => {
        if (active) setProgress(p);
      },
      () => !active,
      {},
      workshop,
    )
      .then((result) => {
        if (!active) {
          return;
        }
        setPrepared(result);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (!prepared)
    return (
      <div className="boot-screen">
        <button
          type="button"
          className="icon-button theme-toggle"
          title={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
          aria-label={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
          onClick={() => setTheme((t) => nextTheme(t))}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <section className="preparation-card" aria-busy={!error}>
          <Doodle />
          <span className="boot-eyebrow">{workshop === 'badge' ? 'BADGE' : 'PASS'} ATELIER</span>
          <h1>正在准备{workshopNames[workshop]}</h1>
          <p>把工具摆好，再开始制作。</p>
          <div className="preparation-meter">
            <progress aria-label="工作台准备进度" max={100} value={progress.percent} />
            <b>{progress.percent}%</b>
          </div>
          <ol className="preparation-steps">
            {preparationSteps.map((label, i) => (
              <li key={label} className={progress.fractions[i] === 1 ? 'done' : ''}>
                {progress.fractions[i] === 1 ? <Check size={15} /> : <span>{i + 1}</span>}
                {label}
              </li>
            ))}
          </ol>
          <p className="preparation-detail" role="status">
            {error || progress.detail}
          </p>
          {error && (
            <>
              <p className="preparation-note">准备失败不会修改你的项目文件，重新尝试即可。</p>
              <button className="primary-button" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCcw size={16} />
                重新尝试
              </button>
            </>
          )}
          {!error && <p className="preparation-note">模板与文字就绪后即可编辑，实体在后台准备。</p>}
        </section>
      </div>
    );
  return (
    <Editor
      template={prepared.template}
      initial={prepared.project}
      prepared={prepared}
      theme={theme}
      onToggleTheme={() => setTheme((t) => nextTheme(t))}
    />
  );
}

function Editor({
  template: sourceTemplate,
  initial,
  prepared,
  theme,
  onToggleTheme,
}: {
  template: TemplateData;
  initial: Project;
  prepared: PreparedWorkbench;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const {
    project,
    change: changeProject,
    replace,
    undo: undoProject,
    redo: redoProject,
    begin,
    beginTransaction,
    finishTransaction,
    canUndo,
    canRedo,
    current,
  } = useProject(initial);
  const isBadge = project.format === 'badge-atelier';
  const workshop = projectWorkshop(project);
  const baseName = isBadge ? '徽章底板' : '通行证底板';
  const template = useMemo(() => isBadge ? badgeTemplate(project.badgeBase!) : sourceTemplate, [isBadge, project.badgeBase, sourceTemplate]);
  useEffect(() => { document.title = isBadge ? '徽章工坊 · Sanae' : '通行证工坊 · Sanae'; }, [isBadge]);
  const change = (edit: (p: Project) => void, record = true) =>
    changeProject((p) => {
      edit(p);
      pruneFolders(p);
    }, record);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(() => new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [templateExpanded, setTemplateExpanded] = useState(false);
  const toggleExpanded = (id: string, folders = false) =>
    (folders ? setExpandedFolders : setExpandedCollections)((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [face, setFace] = useState<Face>('front');
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [selection, setSelection] = useState<Selection>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [freeTransform, setFreeTransform] = useState(false);
  const transformSession = useRef<{
    face: Face;
    selectionKey: string;
    selection: Selection;
  } | null>(null);
  const [alignmentMode, setAlignmentMode] = useState<'point' | 'center' | 'edge'>('center');
  const [alignmentReference, setAlignmentReference] = useState<'board' | 'last' | 'point'>('board');
  const [alignmentPoint, setAlignmentPoint] = useState({ x: template.width/2, y: template.height/2 });
  const [snapPhase, setSnapPhase] = useState<SnapPhase>('idle');
  const [snapSource, setSnapSource] = useState<SnapPick | null>(null);
  const [snapSettings, setSnapSettings] = useState<SnapSettings>(defaultSnapSettings);
  const [autoSnap, setAutoSnap] = useState(true);
  const [showCutters, setShowCutters] = useState(!isStarterProject(initial));
  const visibleCutterIds = useCutterView(project, face, selection);
  const [merging, setMerging] = useState(false);
  const [font, setFont] = useState<Font | null>(prepared.font);
  const [mobileSheet, updateMobileSheet] = useState<'peek' | 'layers' | 'props'>('peek');
  const sheetPanel = useRef<'layers' | 'props'>('layers');
  const setMobileSheet = (sheet: 'peek' | 'layers' | 'props') => {
    if (sheet !== 'peek') sheetPanel.current = sheet;
    updateMobileSheet(sheet);
  };
  const atelierRoot = useRef<HTMLDivElement>(null);
  const sheetGesture = useRef<{
    pointerId: number;
    startY: number;
    startOffset: number;
    maxOffset: number;
    offset: number;
  } | null>(null);
  const suppressSheetClick = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [canvasReset, setCanvasReset] = useState(0);
  const [recovery, setRecovery] = useState(0);
  const geometry = useGeometry(project, sourceTemplate, recovery, view === '3d');
  const { model, generatedProject, generating, error: geometryError } = geometry;
  const [toast, setToast] = useState('');
  const [savedProject, setSavedProject] = useState(initial);
  const saved = project === savedProject;
  const localProgress = useBrowserProgress(project, initial, prepared.localProgress);
  const safeToLeave = saved || localProgress.saved;
  const [recoveringLegacy, setRecoveringLegacy] = useState(false);
  const [legacyFound, setLegacyFound] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const exportWrap = useRef<HTMLDivElement>(null);
  const moreWrap = useRef<HTMLDivElement>(null);
  // Header pop-ups close on an outside press or Esc, like the shape library.
  useEffect(() => {
    if (!exportMenu && !moreMenu) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (exportMenu && !exportWrap.current?.contains(target)) setExportMenu(false);
      if (moreMenu && !moreWrap.current?.contains(target)) setMoreMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = (moreMenu ? moreWrap.current : exportWrap.current)?.querySelector('button');
      setExportMenu(false);
      setMoreMenu(false);
      trigger?.focus();
    };
    // Capture phase: the canvas stops propagation of its own pointer events.
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [exportMenu, moreMenu]);
  useEffect(() => {
    if (!moreMenu) return;
    const first = [...(moreWrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      .find(button => !button.disabled && button.getClientRects().length);
    first?.focus();
  }, [moreMenu]);
  const [flushRecommended, setFlushRecommended] = useState(false);
  const [shapeMenu, setShapeMenu] = useState(false);
  const [newShapeAppearance, setNewShapeAppearance] = useState({ ...defaultShapeAppearance });
  const [showHelp, setShowHelp] = useState(() => shouldOpenQuickStart(workshop));
  const [switchingWorkshop, setSwitchingWorkshop] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showBadgeDesigner, setShowBadgeDesigner] = useState(false);
  useEffect(() => {
    if (showHelp) markQuickStartSeen(workshop);
  }, [showHelp]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importSession = useRef<{ file: File; pending: Promise<ArtworkImporter> } | null>(null);
  const [importImage, setImportImage] = useState<{ file: File; url: string } | null>(null);
  const importUrl = importImage?.file === importFile ? importImage?.url : undefined;
  const [importOptions, setImportOptions] = useState<ImportOptions>({ ...defaultImportOptions });
  const [importContent, setImportContent] = useState<ImportContent>('artwork');
  const [importTarget, setImportTarget] = useState<'layer' | 'base'>('layer');
  const [importAppearance, setImportAppearance] = useState({ ...defaultShapeAppearance });
  const [importWidth, setImportWidth] = useState<number | undefined>();
  const [showImportOriginal, setShowImportOriginal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [artworkThickness, setArtworkThickness] = useState(String(DEFAULT_RAISED_THICKNESS));
  const [silhouetteColorId, setSilhouetteColorId] = useState(lightestColorId(initial.palette));
  const [importPreview, setImportPreview] = useState<{
    file: File;
    key: string;
    result?: ImportResult;
    error?: string;
  } | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null),
    artInput = useRef<HTMLInputElement>(null);
  const topHeights = cumulativeHeights(project.collections);
  const backDepth = backSurfaceDepth(project.collections, project);
  const frontDepth = frontSurfaceDepth(project);
  const baseLayers = isBadge ? badgeLayers(project.badgeBase!, backDepth) : undefined;
  const faceCollections = orderedFaceCollections(project, face);
  const isCurrent = generatedProject === project;
  const currentIssues = isCurrent ? (model?.issues ?? []) : [];
  const exportReady =
    isCurrent &&
    !generating &&
    !geometryError &&
    !!model &&
    !model.issues.some((i) => i.severity === 'error');
  const notice = (s: string) => setToast(s);
  const editBadgeLayer = (layer: keyof BadgeLayers, value: number) => {
    try {
      const p = current.current;
      if (p.format !== 'badge-atelier') return;
      const base = setBadgeLayer(p.badgeBase!, layer, value, backSurfaceDepth(p.collections));
      change((next) => { next.badgeBase = base; });
    } catch (reason) {
      notice(reason instanceof Error ? reason.message : '底板厚度暂时无法更新。');
    }
  };
  const badgeThicknessField = (layer: keyof BadgeLayers, label: string) =>
    baseLayers && (
      <NumberField
        label={label}
        value={baseLayers[layer]}
        {...badgeLayerLimits(project.badgeBase!, baseLayers, layer)}
        onChange={(value) => editBadgeLayer(layer, value)}
      />
    );
  const correctModelColor = (candidate: ColorCandidate, colorId: string) => {
    if (generatedProject !== current.current || generating) { notice('请等实体更新后再修色。'); return; }
    if (candidate.removalSourceKey) { notice('请先还原影响这个色块的相关剔除。'); return; }
    if (candidate.colorId === colorId && !candidate.removed) return;
    change(p => { setColorCorrection(p, candidate.componentKey, colorId, candidate.originalColorId, candidate.fragment); });
    notice('已修正这个色块，原高度保留；可撤销。');
  };
  const removeModelFragment = (candidate: ColorCandidate) => {
    if (generatedProject !== current.current || generating || candidate.removed || candidate.removalSourceKey) return;
    change(p => { removeColorFragment(p, candidate.componentKey, candidate.fragment); });
    notice(candidate.fragment ? '已剔除高亮的局部细条，其余实体保留；可撤销。' : '已剔除这根碎色柱及朝板子外侧、同范围的实体；可撤销。');
  };
  const batchProcessColors = (candidates: ColorCandidate[], action: ColorCorrectionAction, colorId?: string) => {
    if (generatedProject !== current.current || generating || geometryError) { notice('请等实体更新后再处理。'); return 0; }
    const draft = { ...current.current };
    const applied = applyColorCorrections(draft, candidates, action, colorId);
    if (!applied) { notice('这批处理未应用，请检查关联剔除或已有处理记录数量。'); return 0; }
    change(p => {
      if (draft.colorCorrections?.length) p.colorCorrections = draft.colorCorrections;
      else delete p.colorCorrections;
    });
    notice(`已${action === 'remove' ? '剔除' : action === 'restore' ? '还原' : '改色'} ${applied} 个色块，可一次撤销。`);
    return applied;
  };
  const deleteMaterial = (id: string) => {
    const color = current.current.palette.find((entry) => entry.id === id);
    if (!color || current.current.palette.length <= 1) return;
    change((p) => {
      const replacement = removePaletteColor(p, id);
      if (!replacement) return;
      setSilhouetteColorId((selected) => (selected === id ? replacement.id : selected));
      notice(`已删除「${color.name}」，使用处已换为「${replacement.name}」；可撤销。`);
    });
  };
  const textForFont = projectText(project);
  const fontChoices = projectFontChoices(project).join('|');
  useEffect(() => {
    let active = true;
    loadProjectFont(project)
      .then((value) => {
        if (active) {
          setFont(value);
          const entries = current.current.collections
            .filter((c) => c.visible)
            .flatMap((c) =>
              c.items.filter(
                (i) => isItemVisible(c, i) && i.kind === 'text' && i.textScaleX && i.textScaleY,
              ),
            );
          const label = current.current.template.label;
          const texts = [
            ...entries,
            ...(label?.visible && !label.useOriginal && label.textScaleX && label.textScaleY
              ? [label]
              : []),
          ];
          if (
            texts.some((i) => {
              const next = resizeTextContent({ ...i, text: i.text ?? '' }, i.text ?? '', value);
              return (
                Math.abs(i.width - next.width) > 1e-6 || Math.abs(i.height - next.height) > 1e-6
              );
            })
          )
            change((p) => {
              for (const c of p.collections)
                for (const i of c.items)
                  if (
                    c.visible &&
                    isItemVisible(c, i) &&
                    i.kind === 'text' &&
                    i.textScaleX &&
                    i.textScaleY
                  )
                    Object.assign(
                      i,
                      resizeTextContent({ ...i, text: i.text ?? '' }, i.text ?? '', value),
                    );
              const l = p.template.label;
              if (l?.visible && !l.useOriginal && l.textScaleX && l.textScaleY)
                Object.assign(l, resizeTextContent(l, l.text, value));
            }, false);
        }
      })
      .catch(() => {
        if (active) notice('字库暂时未读到，请点击「重新生成」重试，设计已保留。');
      });
    return () => {
      active = false;
    };
  }, [textForFont, fontChoices, project.fonts, recovery]);
  useEffect(() => {
    if (safeToLeave) return;
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [safeToLeave]);
  useEffect(() => {
    if (prepared.localProgress?.project)
      notice('已继续上次制作；本地进度自动精简保存，也可以下载项目备份。');
    else if (prepared.localProgress?.error)
      notice('本地进度暂时无法恢复，已打开案例；请下载项目备份，或点击本地保存提示重试。');
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!importFile) {
      setImportImage(null);
      return;
    }
    const url = URL.createObjectURL(importFile);
    setImportImage({ file: importFile, url });
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.import-dialog button')?.focus(),
    );
    return () => {
      URL.revokeObjectURL(url);
      cancelAnimationFrame(frame);
    };
  }, [importFile]);
  const collection =
    selection?.kind === 'collection'
      ? project.collections.find((c) => c.id === selection.id)
      : selection?.kind === 'item'
        ? project.collections.find((c) => c.id === selection.collectionId)
        : undefined;
  const item =
    selection?.kind === 'item' ? collection?.items.find((i) => i.id === selection.id) : undefined;
  const itemEntries = selectionEntries(selection).flatMap((ref) => {
    const c = project.collections.find((v) => v.id === ref.collectionId && v.face === face);
    const i = c?.items.find((v) => v.id === ref.id);
    return c && i && !isItemLocked(c, i) ? [{ ...ref, item: i, collection: c }] : [];
  });
  const decoration =
    selection?.kind === 'decoration' ? project.template.decorations[selection.id] : undefined;
  const panel = panelPlacement(project, template);
  const templateLabel = project.template.label;
  const templateDecorations = template.objects.filter(
    (o) => o.role === 'decoration' && project.template.decorations[o.id],
  );
  const templateCount =
    templateDecorations.length + Number(!!templateLabel) + Number(project.template.panel !== null);
  const placement =
    selection?.kind === 'label'
      ? project.template.label
      : selection?.kind === 'panel'
        ? panel
        : (item ?? decoration);
  const folderRef = selection?.kind === 'items' ? selection.folder : undefined;
  const textValue =
    item?.kind === 'text'
      ? { ...item, text: item.text ?? '' }
      : selection?.kind === 'label' && templateLabel
        ? {
            ...templateLabel,
            width: templateLabel.useOriginal ? templateLabel.height : templateLabel.width,
            height: templateLabel.useOriginal ? templateLabel.width : templateLabel.height,
          }
        : null;
  const folderCollection = folderRef
    ? project.collections.find((c) => c.id === folderRef.collectionId)
    : undefined;
  const selectedFolder = folderCollection?.folders?.find((f) => f.id === folderRef?.id);
  const selectedName =
    selection?.kind === 'label'
      ? '上方标识'
      : selection?.kind === 'panel'
        ? '侧边框'
        : selection?.kind === 'decoration'
          ? decorationName(selection.id)
          : selection?.kind === 'items'
            ? (selectedFolder?.name ?? `已选 ${itemEntries.length} 个图案`)
            : (item?.name ?? collection?.name);
  const selectedHint =
    selection?.kind === 'item' && collection
      ? collection.name
      : selection?.kind === 'collection'
        ? face === 'front'
          ? '正面集合'
          : '背面集合'
        : selection?.kind === 'items'
          ? selectedFolder
            ? '文件夹'
            : '多选'
          : selection
            ? '模板'
            : baseName;
  const canTransform =
    !selectionLocked(project, selection) &&
    (!!placement?.visible || itemEntries.length > 0) &&
    !(item && isCuttingItem(item) && !showCutters);
  const finishFreeTransform = (commit = true) => {
    const originalSelection = transformSession.current?.selection;
    finishTransaction(commit);
    if (!commit && originalSelection !== undefined) setSelection(originalSelection);
    transformSession.current = null;
    setFreeTransform(false);
  };
  const startFreeTransform = () => {
    if (freeTransform) {
      finishFreeTransform();
      return;
    }
    if (!canTransform) {
      notice('请先选择可编辑的图案、文件夹或模板装饰。');
      return;
    }
    cancelSnap();
    setView('2d');
    setShapeMenu(false);
    beginTransaction();
    transformSession.current = {
      face,
      selectionKey: JSON.stringify(selection),
      selection: structuredClone(selection),
    };
    setFreeTransform(true);
    setMobileSheet('peek');
  };
  const undo = () => (freeTransform ? finishFreeTransform(false) : undoProject());
  const redo = () => {
    if (freeTransform) finishFreeTransform();
    else redoProject();
  };
  useEffect(() => {
    const session = transformSession.current;
    if (
      freeTransform &&
      session &&
      (session.face !== face ||
        view !== '2d' ||
        snapPhase !== 'idle' ||
        session.selectionKey !== JSON.stringify(selection) ||
        !canTransform)
    )
      finishFreeTransform();
  }, [freeTransform, face, view, selection, canTransform, snapPhase]);
  useEffect(() => {
    if (freeTransform) document.querySelector<SVGSVGElement>('.artwork-canvas')?.focus();
  }, [freeTransform]);
  const isPhone = () => window.matchMedia('(max-width: 900px)').matches;
  const select = (s: Selection) => {
    if (freeTransform && JSON.stringify(s) !== transformSession.current?.selectionKey)
      finishFreeTransform();
    setSelection(unlockedSelection(current.current, s));
    if (
      selectionEntries(s).some((ref) =>
        current.current.collections
          .find((c) => c.id === ref.collectionId)
          ?.items.some((i) => i.id === ref.id && isCuttingItem(i)),
      )
    )
      setShowCutters(true);
    setShapeMenu(false);
    if (isPhone()) setMobileSheet(multiSelect ? 'layers' : s ? 'props' : 'peek');
    const refs = selectionEntries(s);
    if (s?.kind === 'collection') setExpandedCollections((old) => new Set(old).add(s.id));
    if (refs.length)
      setExpandedCollections((old) => new Set([...old, ...refs.map((r) => r.collectionId)]));
    if (s?.kind === 'label' || s?.kind === 'decoration' || s?.kind === 'panel')
      setTemplateExpanded(true);
  };
  const cancelSnap = () => {
    setSnapPhase('idle');
    setSnapSource(null);
  };
  const updateSnapSettings = (patch: Partial<SnapSettings>) => {
    setSnapSettings((s) => ({ ...s, ...patch }));
    if (snapPhase !== 'idle' && (patch.sourceBasis || patch.sourceKind)) {
      setSnapSource(null);
      setSnapPhase('source');
    }
  };
  const startSnap = () => {
    setSnapSource(null);
    setSnapPhase('source');
    setView('2d');
    setMobileSheet('peek');
  };
  useEffect(() => {
    setSnapPhase('idle');
    setSnapSource(null);
  }, [project, face, selection]);
  useEffect(() => {
    if (view === '3d') {
      setSnapPhase('idle');
      setSnapSource(null);
    }
  }, [view]);
  useEffect(() => {
    if (snapPhase !== 'idle') document.querySelector<SVGSVGElement>('.artwork-canvas')?.focus();
  }, [snapPhase]);
  const selectItem = (collectionId: string, id: string, additive = false) => {
    if (!additive && selection?.kind === 'item' && selection.id === id) return;
    select(toggleItemSelection(selection, { collectionId, id }, additive || multiSelect));
  };
  useEffect(() => {
    if (itemEntries.length < 2 && alignmentReference === 'last') setAlignmentReference('board');
  }, [itemEntries.length, alignmentReference]);
  useEffect(() => {
    if (selection?.kind === 'item' || selection?.kind === 'items') {
      const refs = selectionEntries(selection);
      const next = (
        folderRef
          ? folderCollection?.face !== face
          : refs.some(
              (ref) =>
                !project.collections.some((c) => c.id === ref.collectionId && c.face === face),
            )
      )
        ? null
        : unlockedSelection(project, selection);
      if (JSON.stringify(next) !== JSON.stringify(selection)) setSelection(next);
    } else if (
      selection?.kind === 'collection' &&
      !project.collections.some((c) => c.id === selection.id && c.face === face && !c.locked)
    )
      setSelection(null);
    else if (
      selection?.kind === 'decoration' &&
      (!project.template.decorations[selection.id]?.visible ||
        project.template.decorations[selection.id]?.locked)
    )
      setSelection(null);
    else if (selection?.kind === 'panel' && (panel.locked || !panel.visible || face !== 'front'))
      setSelection(null);
    else if (
      selection?.kind === 'label' &&
      (!templateLabel?.visible || templateLabel.locked || face !== 'front')
    )
      setSelection(null);
  }, [project, face, selection]);
  const moveMany = (
    entries: Array<{ s: Selection; patch: Partial<TemplatePlacement> }>,
    record = true,
  ) =>
    change((p) => {
      for (const { s, patch } of entries) applyPlacementPatch(p, s, patch, template);
    }, record);
  const editPlacement = (s: Selection, patch: Partial<TemplatePlacement>, record = true) =>
    change((p) => applyPlacementPatch(p, s, patch, template), record);
  const editItem = (patch: Partial<DesignItem>, record = true) => {
    if (selection?.kind !== 'item' || selectionLocked(current.current, selection)) return;
    change((p) => {
      const i = p.collections
        .find((c) => c.id === selection.collectionId)
        ?.items.find((i) => i.id === selection.id);
      if (i) Object.assign(i, patch);
      pruneCutTargets(p);
    }, record);
  };
  const setLabelText = (text: string) =>
    change((p) => {
      const l = p.template.label;
      if (!l || l.locked) return;
      if (l.useOriginal) {
        const width = l.width,
          height = l.height;
        l.x += (width - height) / 2;
        l.y += (height - width) / 2;
        l.width = height;
        l.height = width;
        l.rotation += 90;
        [l.mirrorX, l.mirrorY] = [l.mirrorY, l.mirrorX];
      }
      if (font) Object.assign(l, resizeTextContent(l, text.slice(0, 160), font));
      else l.text = text.slice(0, 160);
      l.useOriginal = false;
    });
  const restoreLabel = () =>
    change((p) => {
      const l = p.template.label;
      if (!l || l.locked) return;
      if (!l.useOriginal) {
        const width = l.width,
          height = l.height;
        l.x += (width - height) / 2;
        l.y += (height - width) / 2;
        l.width = height;
        l.height = width;
        l.rotation -= 90;
        [l.mirrorX, l.mirrorY] = [l.mirrorY, l.mirrorX];
      }
      l.text = 'MAIMAIDX';
      l.useOriginal = true;
      delete l.fontId;
      delete l.letterSpacing;
      delete l.lineHeight;
      delete l.textAlign;
      delete l.textScaleX;
      delete l.textScaleY;
    });
  const editTypography = (
    patch: TextStyle & Partial<TemplatePlacement>,
    added?: ProjectFont,
    loaded?: Font,
  ) => {
    const target = selection;
    if (selectionLocked(current.current, target)) return;
    if (loaded) setFont(loaded);
    change((p) => {
      if (added) p.fonts = [...(p.fonts ?? []), added];
      if (target?.kind === 'item') {
        const i = p.collections
          .find((c) => c.id === target.collectionId)
          ?.items.find((i) => i.id === target.id);
        if (i) Object.assign(i, patch);
      } else if (target?.kind === 'label') {
        const l = p.template.label;
        if (!l) return;
        if (l.useOriginal) {
          const width = l.width,
            height = l.height;
          l.x += (width - height) / 2;
          l.y += (height - width) / 2;
          l.width = height;
          l.height = width;
          l.rotation += 90;
          [l.mirrorX, l.mirrorY] = [l.mirrorY, l.mirrorX];
        }
        l.useOriginal = false;
        Object.assign(l, patch);
      }
    });
  };
  function decorationName(id: string) {
    return `模板装饰 ${String(template.objects.filter((o) => o.role === 'decoration').findIndex((o) => o.id === id) + 1).padStart(2, '0')}`;
  }
  const editCollection = (id: string, patch: Partial<Collection>) =>
    change((p) => {
      const c = p.collections.find((c) => c.id === id);
      if (
        c &&
        (!c.locked || Object.keys(patch).every((key) => ['locked', 'visible'].includes(key)))
      )
        Object.assign(c, patch);
    });
  const activeCollection = () => {
    let c: Collection | undefined;
    if (selection?.kind === 'collection')
      c = current.current.collections.find((c) => c.id === selection.id && c.face === face);
    if (selection?.kind === 'item')
      c = current.current.collections.find(
        (c) => c.id === selection.collectionId && c.face === face,
      );
    if (selection?.kind === 'items')
      c = current.current.collections.find(
        (c) =>
          c.id === (selection.folder?.collectionId ?? selection.items.at(-1)?.collectionId) &&
          c.face === face,
      );
    return c && !c.locked && c.visible
      ? c
      : current.current.collections.filter((c) => c.face === face && c.visible && !c.locked).at(-1);
  };
  const addItem = (i: DesignItem) => {
    if (isBadge && !i.cutout?.targetIds.length) {
      const ratio = Math.min(1, template.width*.65/i.width, template.height*.65/i.height);
      i = {...i, width:i.width*ratio, height:i.height*ratio,
        x:(template.width-i.width*ratio)/2, y:(template.height-i.height*ratio)/2,
        ...(i.textScaleX ? {textScaleX:i.textScaleX*ratio} : {}),
        ...(i.textScaleY ? {textScaleY:i.textScaleY*ratio} : {})};
    }
    let id = activeCollection()?.id;
    change((p) => {
      if (!id) {
        const c = newCollection(face, face === 'front' ? '新图案集合' : '背面图案', p);
        p.collections.push(c);
        id = c.id;
      }
      p.collections.find((c) => c.id === id)!.items.push(i);
    });
    setSelection({ kind: 'item', collectionId: id!, id: i.id });
    setShapeMenu(false);
    setView('2d');
    setMobileSheet('props');
    notice(`已添加「${i.name}」`);
  };
  const addCollection = (
    mode: 'raised' | 'background' = face === 'front' ? 'raised' : 'background',
  ) => {
    const c = newCollection(
      face,
      `新集合 ${project.collections.filter((c) => c.face === face).length + 1}`,
      project,
    );
    c.mode = mode;
    change((p) => p.collections.push(c));
    select({ kind: 'collection', id: c.id });
  };
  const removeTemplate = (target: Selection) => {
    if (selectionLocked(current.current, target)) return;
    change((p) => deleteTemplateElement(p, target));
    if (JSON.stringify(target) === JSON.stringify(selection)) select(null);
  };
  const removeSelection = () => {
    if (
      selectionLocked(current.current, selection) ||
      (collection &&
        collection.items.some((i) => isItemLocked(collection, i)) &&
        selection?.kind === 'collection')
    ) {
      notice('请先解锁要删除的图层。');
      return;
    }
    if (
      selectedFolder &&
      folderCollection?.items.some(
        (i) => i.folderId === selectedFolder.id && isItemLocked(folderCollection, i),
      )
    ) {
      notice('文件夹中有锁定的图层，请先解锁再删除整个文件夹。');
      return;
    }
    if (itemEntries.length)
      change((p) => {
        for (const c of p.collections)
          c.items = c.items.filter(
            (i) => !itemEntries.some((v) => v.collectionId === c.id && v.id === i.id),
          );
        pruneCutTargets(p);
      });
    else if (selection?.kind === 'collection')
      change((p) => {
        p.collections = p.collections.filter((c) => c.id !== selection.id);
        pruneCutTargets(p);
      });
    else if (
      selection?.kind === 'decoration' ||
      selection?.kind === 'panel' ||
      selection?.kind === 'label'
    )
      change((p) => deleteTemplateElement(p, selection));
    else return;
    select(null);
  };
  const duplicateForDrag = (entries: DragEntry[]): DragEntry[] => {
    let copies: DragEntry[] = [];
    change((p) => {
      copies = duplicateDragItems(p, entries, !!folderRef);
      if (selectedFolder && folderCollection && copies.length) {
        const c = p.collections.find((c) => c.id === folderCollection.id)!;
        const copy = { ...selectedFolder, id: uid('folder'), name: selectedFolder.name + ' 副本' };
        (c.folders ??= []).push(copy);
        for (const { s } of copies)
          if (s?.kind === 'item') c.items.find((i) => i.id === s.id)!.folderId = copy.id;
      }
    }, false);
    const refs = copies.flatMap(({ s }) =>
      s?.kind === 'item' ? [{ collectionId: s.collectionId, id: s.id }] : [],
    );
    if (refs.length) {
      const c = current.current.collections.find((c) => c.id === refs[0].collectionId)!;
      const copiedFolder = folderRef
        ? c.items.find((i) => i.id === refs[0].id)?.folderId
        : undefined;
      const next: Selection = copiedFolder
        ? folderSelection(c, copiedFolder)
        : refs.length > 1
          ? { kind: 'items', items: refs }
          : { kind: 'item', ...refs[0] };
      // Alt-drag switches selection to the copies inside the same transform.
      if (freeTransform && transformSession.current)
        transformSession.current.selectionKey = JSON.stringify(next);
      select(next);
    }
    return copies;
  };
  const mergeSelection = async () => {
    if (merging) return;
    const snapshot = current.current,
      selected = structuredClone(selection);
    const reason = mergeReason(snapshot, selected);
    if (reason) {
      notice(reason);
      return;
    }
    setMerging(true);
    try {
      const merged = await geometry.merge(snapshot, selected);
      if (current.current !== snapshot) {
        notice('设计已变化，请重新点击合并；原图层已保留。');
        return;
      }
      let next: Selection = null;
      change((p) => {
        next = applyMergedArtwork(p, selected, merged);
      });
      select(next);
      notice('已合并为一个图案，颜色和切割轮廓已保留，可一次撤销。');
    } catch (error) {
      notice(error instanceof Error ? error.message : '合并失败，原图层已保留。');
    } finally {
      setMerging(false);
    }
  };
  const duplicateSelection = () => {
    if (selectionLocked(current.current, selection)) return;
    if (itemEntries.length) {
      const copiedItems = copyArtwork(itemEntries.map((v) => v.item));
      const copies = itemEntries.map(({ collectionId, item: i }, index) => ({
        collectionId,
        item: { ...copiedItems[index], name: `${i.name} 副本`, x: i.x + 2, y: i.y + 2 },
      }));
      let next: Selection = null;
      change((p) => {
        for (const copy of copies)
          p.collections.find((c) => c.id === copy.collectionId)!.items.push(copy.item);
        if (selectedFolder && folderCollection) {
          const c = p.collections.find((c) => c.id === folderCollection.id)!;
          const f = { ...selectedFolder, id: uid('folder'), name: selectedFolder.name + ' 副本' };
          (c.folders ??= []).push(f);
          for (const copy of copies) copy.item.folderId = f.id;
          next = folderSelection(c, f.id);
        } else {
          const refs = copies.map((v) => ({ collectionId: v.collectionId, id: v.item.id }));
          next = refs.length > 1 ? { kind: 'items', items: refs } : { kind: 'item', ...refs[0] };
        }
      });
      select(next);
    } else if (collection) {
      const copy = {
        ...structuredClone(collection),
        id: uid('group'),
        name: `${collection.name} 副本`,
        items: copyArtwork(collection.items),
      };
      const folderIds = new Map((copy.folders ?? []).map((f) => [f.id, uid('folder')]));
      for (const f of copy.folders ?? []) f.id = folderIds.get(f.id)!;
      for (const i of copy.items) if (i.folderId) i.folderId = folderIds.get(i.folderId);
      change((p) =>
        p.collections.splice(p.collections.findIndex((c) => c.id === collection.id) + 1, 0, copy),
      );
      select({ kind: 'collection', id: copy.id });
    }
  };
  const reorderCollection = (id: string, dir: number) =>
    change((p) => {
      if (p.collections.find((c) => c.id === id)?.locked) return;
      const mode = collectionMode(p.collections.find((c) => c.id === id)!);
      const ids = p.collections
        .map((c, n) => ({ c, n }))
        .filter(({ c }) => c.face === face && collectionMode(c) === mode);
      const n = ids.findIndex(({ c }) => c.id === id),
        target = ids[n + dir];
      if (n < 0 || !target || target.c.locked) return;
      const from = ids[n].n,
        to = target.n;
      [p.collections[from], p.collections[to]] = [p.collections[to], p.collections[from]];
    });
  const moveToCollection = (target: string) => {
    if (!itemEntries.length || itemEntries.every((v) => target === v.collectionId)) return;
    if (
      selectedFolder &&
      folderCollection &&
      folderCollection.items.some(
        (i) => i.folderId === selectedFolder.id && isItemLocked(folderCollection, i),
      )
    ) {
      notice('请先解锁文件夹中的全部图层，再移动整个文件夹。');
      return;
    }
    const moving = itemEntries.map((v) => structuredClone(v.item));
    change((p) => {
      const destination = p.collections.find((c) => c.id === target && c.face === face);
      if (!destination || destination.locked) return;
      for (const c of p.collections)
        c.items = c.items.filter((i) => !moving.some((v) => v.id === i.id));
      if (selectedFolder) (destination.folders ??= []).push(structuredClone(selectedFolder));
      else for (const i of moving) delete i.folderId;
      destination.items.push(...moving);
    });
    select(
      selectedFolder
        ? folderSelection(
            current.current.collections.find((c) => c.id === target)!,
            selectedFolder.id,
          )
        : moving.length > 1
          ? { kind: 'items', items: moving.map((i) => ({ collectionId: target, id: i.id })) }
          : { kind: 'item', collectionId: target, id: moving[0].id },
    );
  };
  const moveItemCollection = (collectionId: string, itemId: string, direction: -1 | 1) => {
    const source = current.current.collections.find((c) => c.id === collectionId);
    if (
      !source ||
      source.locked ||
      !source.items.some((item) => item.id === itemId && !isItemLocked(source, item)) ||
      !adjacentCollection(current.current, collectionId, direction)
    )
      return;
    let next: Selection = null;
    change((p) => {
      next = moveItemToAdjacentCollection(p, collectionId, itemId, direction);
    });
    if (next) select(next);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (importFile || showHelp || showNewProject || showBadgeDesigner) return;
      if (e.key === 'Escape' && snapPhase !== 'idle') {
        e.preventDefault();
        cancelSnap();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        // Same as the header button, also from text fields: download a project file.
        e.preventDefault();
        if (!e.repeat && !importing && !merging) saveProject();
        return;
      }
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
        return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (!e.repeat) startFreeTransform();
        return;
      }
      if (freeTransform && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        finishFreeTransform(e.key === 'Enter');
        return;
      }
      if (freeTransform && (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        finishFreeTransform(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      if (snapPhase !== 'idle') return;
      if (e.key === 'Escape') select(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelection();
      }
      if (
        (placement || itemEntries.length) &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.2;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        if (itemEntries.length)
          moveMany(
            itemEntries.map((v) => ({
              s: { kind: 'item', collectionId: v.collectionId, id: v.id },
              patch: { x: v.item.x + dx, y: v.item.y + dy },
            })),
          );
        else if (placement) editPlacement(selection, { x: placement.x + dx, y: placement.y + dy });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const openProject = async (file: File) => {
    try {
      const p = validateProject(JSON.parse(await file.text()));
      if (projectWorkshop(p) !== workshop) {
        notice(`这是${workshopNames[projectWorkshop(p)]}的项目，请通过顶部入口进入对应工坊后打开；当前作品已保留。`);
        return;
      }
      replace(p);
      setSavedProject(p);
      select(null);
      notice(`已打开「${p.name}」`);
    } catch (e) {
      notice(e instanceof Error ? e.message : '项目文件无法读取');
    }
  };
  const switchWorkshop = async (event: React.MouseEvent<HTMLAnchorElement>, kind: WorkshopKind) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (kind === workshop || switchingWorkshop || importing || merging) return;
    setSwitchingWorkshop(true);
    try {
      if (freeTransform) finishFreeTransform();
      const snapshot = current.current;
      if (!(await localProgress.flush())) throw new Error('请先下载项目备份，或重试本地保存，再切换工坊。');
      await saveBrowserProgress(serializeProject(snapshot), workshop);
      if (current.current !== snapshot) throw new Error('作品刚刚有了新修改，请再点一次工坊入口。');
      window.removeEventListener('beforeunload', warnBeforeUnload);
      window.location.assign(workshopHref(kind, window.location));
    } catch (reason) {
      notice(reason instanceof Error ? reason.message : '进度暂时无法保存，当前作品已保留。');
      setSwitchingWorkshop(false);
    }
  };
  const startNewProject = () => {
    if (freeTransform) finishFreeTransform();
    cancelSnap();
    setShowNewProject(true);
  };
  const saveProject = () => {
    const bytes = download(
      serializeProject(project),
      `${project.name || (isBadge ? '徽章' : '通行证')}.${isBadge ? 'badge' : 'pass'}.json`,
      'application/json',
    );
    setSavedProject(project);
    localProgress.flush();
    const size =
      bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    notice(`项目已精简保存（${size}），图案和文字可继续编辑。`);
  };
  const createNewProject = (mode: NewProjectMode, saveCurrent: boolean, type: 'pass' | 'badge') => {
    if (importing || merging) return;
    try {
      if (saveCurrent)
        download(
          serializeProject(current.current),
          `${current.current.name || '作品'}.${current.current.format === 'badge-atelier' ? 'badge' : 'pass'}.json`,
          'application/json',
        );
      const next = type === 'badge' ? createBadgeProject() : createBlankProject(sourceTemplate, mode);
      replace(next);
      setSelection(null);
      setFace('front');
      setView('2d');
      setMultiSelect(false);
      setShowCutters(true);
      setExpandedCollections(new Set(next.collections.map((c) => c.id)));
      setExpandedFolders(new Set());
      setTemplateExpanded(false);
      setShapeMenu(false);
      setExportMenu(false);
      cancelSnap();
      setZoom(1);
      setCanvasReset((v) => v + 1);
      setMobileSheet('peek');
      setSilhouetteColorId(lightestColorId(next.palette));
      setShowNewProject(false);
      setShowBadgeDesigner(type === 'badge');
      setAlignmentPoint(type === 'badge' ? {x:next.badgeBase!.width/2,y:next.badgeBase!.height/2} : {x:sourceTemplate.width/2,y:sourceTemplate.height/2});
      notice(`已新建${type === 'badge' ? '徽章' : `${mode === 'normal' ? '普通' : '精简'}通行证`}，可撤销返回原项目。`);
    } catch (reason) {
      notice(reason instanceof Error ? reason.message : '新建失败，当前项目已保留。');
    }
  };
  const recoverLegacy = async () => {
    if (recoveringLegacy) return;
    setRecoveringLegacy(true);
    try {
      const { legacyRecovery } = await import('./model/legacyProject');
      const old = await legacyRecovery.read();
      if (!old) {
        notice('当前浏览器没有可找回的旧设计。');
        return;
      }
      download(serializeProject(old), `${old.name || '旧设计'}.pass.json`, 'application/json');
      setLegacyFound(true);
      notice('旧设计已精简下载，通过「打开项目文件」继续制作；确认文件保存后可清除旧副本。');
    } catch (reason) {
      notice(reason instanceof Error ? reason.message : '旧设计暂时无法读取。');
    } finally {
      setRecoveringLegacy(false);
    }
  };
  const applyBadgeBase = async (base: BadgeBase) => {
    const before = current.current;
    if (before.format !== 'badge-atelier') throw new Error('请先新建徽章作品。');
    validateBadgeBase(base);
    await geometry.validate({...before,badgeBase:base});
    if (current.current !== before) throw new Error('作品已经变化，请重新打开底板设计再应用。');
    change(p => { p.badgeBase = base; });
    setShowBadgeDesigner(false);
    select(null);
    setZoom(1);
    setCanvasReset(v => v+1);
    setAlignmentPoint({x:base.width/2,y:base.height/2});
    notice('徽章底板已更新，可继续排版图案，也可一次撤销。');
  };
  const importBadgeBase = async (file: File, base: BadgeBase): Promise<BadgeBase> => {
    const { readBadgeSvg } = await import('./artwork/badge-svg');
    const result = await geometry.normalizeBadgeOutline(await readBadgeSvg(file));
    const width = Number(
        Math.max(10, 10 * result.aspect, Math.min(base.width, 200, 200 * result.aspect)).toFixed(3),
      ),
      height = Number((width / result.aspect).toFixed(3));
    const next: BadgeBase = { ...base, width, height, shape: 'custom', contours: result.contours };
    delete next.outlineStyle;
    validateBadgeBase(next);
    return next;
  };
  const clearLegacy = async () => {
    if (!window.confirm('请先确认旧项目文件已下载保存。现在清除这个浏览器的旧设计副本吗？')) return;
    try {
      const { legacyRecovery } = await import('./model/legacyProject');
      await legacyRecovery.clear();
      setLegacyFound(false);
      notice('旧设计副本已清除，网页资源缓存继续保留。');
    } catch {
      notice('部分旧副本未能清除，可稍后重试；项目文件和当前画布未改变。');
    }
  };
  const exportModel = async (kind: '3mf' | 'stl') => {
    if (!exportReady || !model) return;
    try {
      const { export3mf, exportStlZip, recordModelExport } = await import('./export/index');
      const data = kind === '3mf' ? export3mf(model, project) : exportStlZip(model, project);
      download(
        data,
        `${project.name || '通行证'}.${kind === '3mf' ? '3mf' : 'stl.zip'}`,
        kind === '3mf'
          ? 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
          : 'application/zip',
      );
      recordModelExport(kind);
      setExportMenu(false);
      notice(
        kind === '3mf'
          ? '多色 3MF 已下载，已附作者的 A1 / 0.2 mm 打印预设。'
          : '按颜色拆分的 STL 压缩包已下载。',
      );
    } catch (e) {
      notice(e instanceof Error ? e.message : '导出失败');
    }
  };
  const importCollection = activeCollection();
  const silhouetteAllowed =
    face === 'front' && (!importCollection || collectionMode(importCollection) === 'raised');
  const importingBase = isBadge && importTarget === 'base';
  const effectiveImportContent: ImportContent = importingBase
    ? 'silhouette'
    : importContent === 'with-silhouette' && !silhouetteAllowed
      ? 'artwork'
      : importContent;
  const withSilhouette = effectiveImportContent === 'with-silhouette';
  const onlySilhouette = effectiveImportContent === 'silhouette';
  const traceSilhouette = withSilhouette || onlySilhouette;
  const lowerImportCollection = silhouetteCollection(project, importCollection?.id);
  const newArtworkCollection = !lowerImportCollection;
  const newArtworkThickness = Number(artworkThickness);
  const validUnderlayThickness =
    !newArtworkCollection ||
    (artworkThickness.trim() !== '' &&
      Number.isFinite(newArtworkThickness) &&
      newArtworkThickness > 0);
  const underlayColor = importingBase
    ? (project.template.frontColorId ?? project.template.baseColorId)
    : project.palette.some((c) => c.id === silhouetteColorId)
      ? silhouetteColorId
      : lightestColorId(project.palette);
  const showingImportOriginal =
    showImportOriginal && importOptions.mode === 'lineart' && importOptions.lineartBeta;
  const previewKey = JSON.stringify([
    { ...importOptions, silhouette: traceSilhouette },
    project.palette,
  ]);
  const currentPreview =
    importPreview?.file === importFile && importPreview?.key === previewKey ? importPreview : null;
  const previewing = !!importFile && !currentPreview;
  const importView = useMemo(() => {
    if (!currentPreview?.result) return {} as { result?: ImportResult; error?: string };
    try {
      return {
        result: onlySilhouette
          ? silhouetteArtwork(currentPreview.result, underlayColor)
          : currentPreview.result,
      };
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : '剪影生成失败。' };
    }
  }, [currentPreview, onlySilhouette, underlayColor]);
  const displayImportResult = importView.result;
  const automaticImportWidth = displayImportResult
    ? importingBase
      ? Math.min(
          project.badgeBase!.outlineStyle?.source.width ?? project.badgeBase!.width,
          200,
          (200 * displayImportResult.width) / displayImportResult.height,
        )
      : displayImportResult.width *
        Math.min(
          1,
          (isBadge ? template.width * 0.75 : 25) / displayImportResult.width,
          (isBadge ? template.height * 0.75 : 60) / displayImportResult.height,
        )
    : 25;
  const importedWidth = importWidth ?? automaticImportWidth;
  const importedHeight = displayImportResult
    ? (importedWidth * displayImportResult.height) / displayImportResult.width
    : importedWidth;
  const validImportSize =
    Number.isFinite(importedWidth) &&
    Number.isFinite(importedHeight) &&
    importedWidth > 0 &&
    importedHeight > 0 &&
    importedWidth <= (isBadge ? 200 : 150) &&
    importedHeight <= (isBadge ? 200 : 150) &&
    (!importingBase || (importedWidth >= 10 && importedHeight >= 10));
  useEffect(() => {
    if (!importFile) return;
    let closed = false;
    const pending = import('./artwork/import').then(({ ArtworkImporter }) => {
      if (closed) throw new DOMException('描图已取消。', 'AbortError');
      return new ArtworkImporter(importFile);
    });
    const entry = { file: importFile, pending };
    void pending.catch(() => {});
    importSession.current = entry;
    return () => {
      closed = true;
      if (importSession.current === entry) importSession.current = null;
      void pending.then((session) => session.dispose()).catch(() => {});
    };
  }, [importFile, previewRetry]);
  useEffect(() => {
    if (!importFile) {
      setImportPreview(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const session = importSession.current;
    if (!session || session.file !== importFile) return;
    setImportPreview(null);
    const timer = setTimeout(() => {
      void session.pending
        .then((session) =>
          session.trace(
            project.palette,
            { ...importOptions, silhouette: traceSilhouette },
            controller.signal,
          ),
        )
        .then((result) => {
          if (!cancelled) setImportPreview({ file: importFile, key: previewKey, result });
        })
        .catch((error) => {
          if (!cancelled)
            setImportPreview({
              file: importFile,
              key: previewKey,
              error: error instanceof Error ? error.message : '图案预览生成失败，请重试。',
            });
        });
    }, 220);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [importFile, traceSilhouette, importOptions, project.palette, previewKey, previewRetry]);

  const doImport = async () => {
    if (!importFile) return;
    if (withSilhouette && !validUnderlayThickness) {
      notice('新图案集合厚度需要填写有限正数。');
      return;
    }
    setImporting(true);
    try {
      const result = displayImportResult;
      if (!result) throw new Error('请等待当前图案预览完成后再添加。');
      if (!validImportSize)
        throw new Error('导入宽高超出可用范围；徽章底板两边均须为 10～200 mm。');
      const ratio = importedWidth / result.width;
      if (importingBase) {
        const normalized = await geometry.normalizeBadgeOutline([
          {
            contours: flattenPath(
              result.silhouettePath!,
              Math.max(0.02, (result.width / importedWidth) * 0.025),
            ).map((c) => c.map(([x, y]): [number, number] => [x, y])),
            fillRule: 'NonZero',
          },
        ]);
        const base: BadgeBase = {
          ...project.badgeBase!,
          width: importedWidth,
          height: importedHeight,
          shape: 'custom',
          contours: normalized.contours,
        };
        delete base.outlineStyle;
        await applyBadgeBase(await geometry.styleBadgeBase(base, importAppearance));
        setImportFile(null);
        return;
      }
      const imported: DesignItem = {
        id: uid(),
        name: importFile.name.replace(/\.[^.]+$/, ''),
        kind: 'paths',
        ...(!withSilhouette ? importAppearance : {}),
        visible: true,
        x: isBadge ? (template.width - result.width * ratio) / 2 : 12,
        y: isBadge ? (template.height - result.height * ratio) / 2 : 20,
        width: result.width * ratio,
        height: result.height * ratio,
        rotation: 0,
        colorId: onlySilhouette ? underlayColor : project.palette[0].id,
        regions: result.regions,
        sourceWidth: result.width,
        sourceHeight: result.height,
        sourceDataUrl: onlySilhouette ? undefined : result.sourceDataUrl,
        avoidsLower: false,
      };
      if (withSilhouette && !result.silhouettePath)
        throw new Error('未找到可生成剪影的轮廓，请调整图案选项。');
      let nextSelection: Selection = null;
      change((p) => {
        nextSelection = insertImportedArtwork(
          p,
          face,
          imported,
          importCollection?.id,
          withSilhouette
            ? {
                path: result.silhouettePath!,
                colorId: underlayColor,
                artworkThickness: newArtworkThickness,
                appearance: importAppearance,
              }
            : undefined,
        );
      });
      select(nextSelection);
      setShapeMenu(false);
      setView('2d');
      setMobileSheet('peek');
      notice(
        withSilhouette
          ? '已添加图案与剪影，已同时选中。'
          : onlySilhouette
            ? '已添加独立剪影，可继续调整填充与描边。'
            : `已添加「${imported.name}」`,
      );
      setImportFile(null);
      if (result.warnings.length)
        notice(
          `${withSilhouette ? '已添加图案与剪影，已同时选中。 ' : ''}${result.warnings.join(' ')}`,
        );
    } catch (e) {
      notice(e instanceof Error ? e.message : '图案导入失败');
    } finally {
      setImporting(false);
    }
  };
  const colorPicker = (id: string, onChange: (id: string) => void, label = '颜色') => (
    <div className="color-picker" role="group" aria-label={label}>
      {project.palette.map((c) => (
        <button
          key={c.id}
          type="button"
          style={{ background: c.hex }}
          className={c.id === id ? 'chosen' : ''}
          title={c.name}
          aria-label={`${label}：${c.name}`}
          aria-pressed={c.id === id}
          onClick={() => onChange(c.id)}
        >
          {c.id === id && (
            <Check size={15} style={{ color: c.id === 'black' ? 'white' : '#303039' }} />
          )}
        </button>
      ))}
    </div>
  );
  const statusText = geometryError
    ? '实体生成失败'
    : generating
      ? '正在生成实体'
      : model?.issues.some((i) => i.severity === 'error')
        ? '模型需要调整'
        : '实体已更新';
  const neededColors = isCurrent && model ? [...new Set(model.meshes.map((m) => m.colorId))] : [];
  const usedColors = neededColors.join('|');
  useEffect(() => {
    if (!exportMenu) return;
    let active = true;
    void import('./export/preset')
      .then(({ needsFlushRecalculation }) => {
        if (active)
          setFlushRecommended(
            needsFlushRecalculation(
              project.palette.filter((color) => neededColors.includes(color.id)),
            ),
          );
      })
      .catch(() => {
        if (active) setFlushRecommended(true);
      });
    return () => {
      active = false;
    };
  }, [exportMenu, project.palette, usedColors]);
  const selectedGroupBounds = groupPlacementBounds(
    itemEntries.map((v) => artworkSelectionFrame(v.item)),
  );
  const groupX = selectedGroupBounds?.[0] ?? 0;
  const groupY = selectedGroupBounds?.[1] ?? 0;
  const groupWidth = selectedGroupBounds ? selectedGroupBounds[2] - groupX : 0;
  const groupHeight = selectedGroupBounds ? selectedGroupBounds[3] - groupY : 0;
  const scaleSelected = (factor: number, axis: 'x' | 'y') => {
    if (!selectedGroupBounds || Math.abs(factor - 1) < 1e-10) return;
    try {
      const patches = scaleGroupAxis(
        itemEntries.map((v) => v.item),
        [groupX, groupY],
        factor,
        axis,
      );
      moveMany(
        itemEntries.map((v, i) => ({
          s: { kind: 'item', id: v.id, collectionId: v.collectionId },
          patch: patches[i],
        })),
      );
    } catch (e) {
      notice(e instanceof Error ? e.message : '缩放失败，请检查尺寸。');
    }
  };
  const moveSelected = (dx: number, dy: number) =>
    moveMany(
      itemEntries.map((v) => ({
        s: { kind: 'item', id: v.id, collectionId: v.collectionId },
        patch: { x: v.item.x + dx, y: v.item.y + dy },
      })),
    );
  const rotateSelected = (delta: number) => {
    if (!selectedGroupBounds) return;
    const patches = rotatePlacements(
      itemEntries.map((e) => e.item),
      [
        (selectedGroupBounds[0] + selectedGroupBounds[2]) / 2,
        (selectedGroupBounds[1] + selectedGroupBounds[3]) / 2,
      ],
      delta,
    );
    moveMany(
      itemEntries.map((e, n) => ({
        s: { kind: 'item', collectionId: e.collectionId, id: e.id },
        patch: patches[n],
      })),
    );
  };
  const applyAlignment = (alignment: Parameters<typeof alignPlacements>[1]['alignment']) => {
    const originals = itemEntries.length
      ? itemEntries.map((v) => v.item)
      : placement
        ? [{ id: 'template-element', ...placement }]
        : [];
    const placements = originals.map((p) => artworkSelectionFrame(p));
    const aligned = alignPlacements(placements, {
      reference: alignmentReference,
      width: template.width,
      height: template.height,
      alignment,
      point: alignmentPoint,
    });
    moveMany(
      aligned.map((p, i) => ({
        s: itemEntries.length
          ? {
              kind: 'item',
              collectionId: itemEntries.find((v) => v.id === p.id)!.collectionId,
              id: p.id,
            }
          : selection,
        patch: {
          x: originals[i].x + p.x - placements[i].x,
          y: originals[i].y + p.y - placements[i].y,
        },
      })),
    );
  };
  const alignmentControls = (placement || itemEntries.length > 0) && (
    <section className="property-section alignment-section quick-alignment">
      <h3>快速排版</h3>
      <div className="alignment-toolbar">
        <div className="segmented-control" role="group" aria-label="对齐方式">
          {(
            [
              ['point', '点'],
              ['center', '中线'],
              ['edge', '边缘'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              className={alignmentMode === mode ? 'active' : ''}
              onClick={() => setAlignmentMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="alignment-reference">
          对齐到
          <select
            aria-label="对齐参考"
            value={alignmentReference}
            onChange={(e) => setAlignmentReference(e.target.value as typeof alignmentReference)}
          >
            <option value="board">底板</option>
            <option value="last" disabled={itemEntries.length < 2}>
              最后选中图案
            </option>
            <option value="point">自定义点</option>
          </select>
        </label>
      </div>
      {alignmentReference === 'point' && (
        <div className="number-grid">
          <NumberField
            label="目标点 X"
            value={alignmentPoint.x}
            onChange={(x) => setAlignmentPoint((p) => ({ ...p, x }))}
          />
          <NumberField
            label="目标点 Y"
            value={alignmentPoint.y}
            onChange={(y) => setAlignmentPoint((p) => ({ ...p, y }))}
          />
        </div>
      )}
      {alignmentMode === 'point' ? (
        <div className="anchor-grid" role="group" aria-label="对齐锚点">
          {(
            [
              ['topLeft', '左上'],
              ['topCenter', '上中'],
              ['topRight', '右上'],
              ['centerLeft', '左中'],
              ['center', '中心'],
              ['centerRight', '右中'],
              ['bottomLeft', '左下'],
              ['bottomCenter', '下中'],
              ['bottomRight', '右下'],
            ] as const
          ).map(([alignment, label]) => (
            <button key={alignment} onClick={() => applyAlignment(alignment)}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <div className="alignment-buttons">
          {(alignmentMode === 'center'
            ? [
                ['centerX', '水平中线'],
                ['centerY', '垂直中线'],
              ]
            : [
                ['left', '左边缘'],
                ['right', '右边缘'],
                ['top', '上边缘'],
                ['bottom', '下边缘'],
              ]
          ).map(([alignment, label]) => (
            <button
              key={alignment}
              onClick={() =>
                applyAlignment(alignment as Parameters<typeof alignPlacements>[1]['alignment'])
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <p className="field-note">
        {alignmentReference === 'last'
          ? '其他图案对齐最后选中的图案。'
          : '多选整体移动，保留彼此间距。'}
      </p>
    </section>
  );
  const editFolder = (
    collectionId: string,
    id: string,
    patch: Partial<NonNullable<Collection['folders']>[number]>,
  ) =>
    change((p) => {
      const c = p.collections.find((c) => c.id === collectionId);
      const f = c?.folders?.find((f) => f.id === id);
      if (f && !c?.locked) Object.assign(f, patch);
    });
  const createFolder = () => {
    const reason = groupingReason(current.current, selection);
    if (reason) {
      notice(reason);
      return;
    }
    let next: Selection = null;
    change((p) => {
      next = groupLayers(p, selection);
    });
    select(next);
    setMultiSelect(false);
    notice('已组合为文件夹，展开后可单独编辑成员。');
  };
  const listDrag = useLayerListDrag({
    source: (source) => {
      const p = current.current;
      const c = p.collections.find((c) => c.id === source.collectionId);
      if (!c) return null;
      const next =
        source.kind === 'folder'
          ? folderSelection(c, source.id)
          : selectionContains(selection, { collectionId: c.id, id: source.id })
            ? selection
            : { kind: 'item' as const, collectionId: c.id, id: source.id };
      const reason = layerDragReason(p, next);
      if (reason) {
        notice(reason);
        return null;
      }
      return next;
    },
    allowed: (source, target) => !layerDropReason(current.current, source, target),
    begin: (source) => {
      if (freeTransform) finishFreeTransform();
      select(source);
      if (isPhone()) setMobileSheet('layers');
    },
    commit: (source, target) => {
      const draft = structuredClone(current.current);
      const next = dropLayerSelection(draft, source, target);
      if (!next) return;
      replace(draft);
      select(next);
      if (isPhone()) setMobileSheet('layers');
      setMultiSelect(false);
      setExpandedCollections((old) => new Set([...old, target.collectionId]));
      if (next.kind === 'items' && next.folder)
        setExpandedFolders((old) => new Set([...old, next.folder!.id]));
    },
    expand: (target) => {
      if (target.kind === 'collection')
        setExpandedCollections((old) =>
          old.has(target.collectionId) ? old : new Set([...old, target.collectionId]),
        );
      if (target.kind === 'folder')
        setExpandedFolders((old) => (old.has(target.id) ? old : new Set([...old, target.id])));
    },
  });
  const renderItemRow = (c: Collection, i: DesignItem) => (
    <div
      key={i.id}
      draggable={isItemVisible(c, i) && !isItemLocked(c, i)}
      data-layer-source={isItemVisible(c, i) && !isItemLocked(c, i) ? 'item' : undefined}
      data-layer-target="item"
      data-collection-id={c.id}
      data-layer-id={i.id}
      data-layer-name={i.name}
      className={`item-row ${selectionContains(selection, { collectionId: c.id, id: i.id }) ? 'active' : ''} ${selection?.kind === 'item' && selection.id === i.id ? 'has-item-actions' : ''} ${!isItemVisible(c, i) ? 'is-hidden' : ''} ${isItemLocked(c, i) ? 'is-locked' : ''}`}
    >
      <button
        type="button"
        className="layer-drag-handle"
        title="拖动排序或移到其他集合；多选后拖动任一成员"
        aria-label={`拖动${i.name}`}
        disabled={!isItemVisible(c, i) || isItemLocked(c, i)}
      >
        <GripVertical size={13} />
      </button>
      {multiSelect && (
        <input
          type="checkbox"
          className="item-select-check"
          aria-label={`选择${i.name}`}
          checked={selectionContains(selection, { collectionId: c.id, id: i.id })}
          disabled={!isItemVisible(c, i) || isItemLocked(c, i)}
          onChange={() => selectItem(c.id, i.id, true)}
        />
      )}
      <button
        className="row-select"
        disabled={!isItemVisible(c, i) || isItemLocked(c, i)}
        onClick={(e) => selectItem(c.id, i.id, e.shiftKey || e.ctrlKey || e.metaKey)}
      >
        <span
          className="item-kind"
          style={{
            color: isCuttingItem(i)
              ? 'var(--rose)'
              : project.palette.find((v) => v.id === i.colorId)?.hex,
          }}
        >
          {isCuttingItem(i) ? (
            <Scissors size={14} />
          ) : i.kind === 'text' ? (
            <Type size={14} />
          ) : i.kind === 'paths' ? (
            <ImagePlus size={14} />
          ) : i.shape === 'heart' ? (
            <Heart size={14} />
          ) : i.shape === 'star' ? (
            <Star size={14} />
          ) : (
            <Square size={14} />
          )}
        </span>
        <span>{i.name}</span>
      </button>
      <IconButton
        label={c.locked ? '集合已锁定' : i.locked ? '解锁图层' : '锁定图层'}
        disabled={c.locked || !!c.folders?.find((f) => f.id === i.folderId)?.locked}
        onClick={() =>
          editPlacement({ kind: 'item', collectionId: c.id, id: i.id }, { locked: !i.locked })
        }
      >
        {isItemLocked(c, i) ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}
      </IconButton>
      <IconButton
        label={i.visible ? '隐藏图案' : '显示图案'}
        onClick={() =>
          editPlacement({ kind: 'item', collectionId: c.id, id: i.id }, { visible: !i.visible })
        }
      >
        {i.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </IconButton>
      {selection?.kind === 'item' && selection.id === i.id && (
        <div className="item-collection-tools" aria-label="移动图案到相邻集合">
          <button
            type="button"
            disabled={
              !adjacentCollection(project, c.id, -1) ||
              adjacentCollection(project, c.id, -1)?.locked
            }
            onClick={() => moveItemCollection(c.id, i.id, -1)}
          >
            <ArrowDown size={12} /> 下移集合
          </button>
          <button
            type="button"
            disabled={
              !adjacentCollection(project, c.id, 1) || adjacentCollection(project, c.id, 1)?.locked
            }
            onClick={() => moveItemCollection(c.id, i.id, 1)}
          >
            <ArrowUp size={12} /> 上移集合
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div
      ref={atelierRoot}
      className={`atelier sheet-${mobileSheet} sheet-content-${sheetPanel.current}`}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol">
            <Sparkles size={21} />
          </span>
          <div>
            <b>
              {isBadge ? 'BADGE' : 'PASS'} <span>ATELIER</span>
            </b>
            <small>{isBadge ? '徽章工坊' : '通行证工坊'}</small>
          </div>
        </div>
        <nav className="workshop-nav" aria-label="选择工坊" aria-busy={switchingWorkshop}
          title={switchingWorkshop ? '正在保存并切换…' : '两个工坊各自保存制作进度'}>
          {(['pass', 'badge'] as const).map(kind => (
            <a key={kind} href={workshopHref(kind, window.location)}
              aria-current={workshop === kind ? 'page' : undefined}
              onClick={event => void switchWorkshop(event, kind)}>
              <span aria-hidden="true">{kind === 'badge' ? '✿' : '🎫'}</span>
              {workshopNames[kind].replace('工坊', '')}
              <span className="workshop-nav-suffix">工坊</span>
            </a>
          ))}
        </nav>
        <div className="project-name">
          <input
            value={project.name}
            aria-label="项目名称"
            onChange={(e) =>
              change((p) => {
                p.name = e.target.value.slice(0, 80);
              })
            }
          />
          <button
            type="button"
            className={`autosave progress-status ${localProgress.state === 'pending' || localProgress.state === 'error' ? 'unsaved' : ''} ${localProgress.state === 'error' ? 'failed' : ''}`}
            title={
              localProgress.state === 'error'
                ? `${localProgress.error} 点击保存当前进度到浏览器。`
                : '本地进度会自动精简保存；点「保存项目」（Ctrl+S）可另存一份备份文件。'
            }
            onClick={() =>
              localProgress.state === 'error' ? localProgress.retry() : localProgress.flush()
            }
          >
            <i />
            {localProgress.state === 'error'
              ? '本地保存失败 · 重试'
              : localProgress.saved
                ? '已自动保存'
                : localProgress.state === 'pending'
                  ? '保存中…'
                  : '自动保存'}
          </button>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="text-action wide-only"
            title="新建作品"
            aria-label="新建作品"
            disabled={importing || merging}
            onClick={startNewProject}
          >
            <FilePlus2 size={16} />
            <span>新建</span>
          </button>
          <button type="button" className="text-action wide-only" title="打开项目文件" onClick={() => fileInput.current?.click()}>
            <FileUp size={16} />
            <span>打开</span>
          </button>
          <button className={`save-button ${saved ? '' : 'dirty'}`} title="下载项目文件 Ctrl+S" onClick={saveProject}>
            <Save size={16} />
            <span>保存项目</span>
          </button>
          <div className="export-wrap" ref={exportWrap}>
            <button
              className="primary-button"
              disabled={!exportReady}
              aria-expanded={exportMenu}
              onClick={() => setExportMenu(!exportMenu)}
            >
              <Download size={17} />
              <span>导出打印文件</span>
              <ChevronDown size={14} />
            </button>
            {exportMenu && (
              <div className="export-menu">
                <button onClick={() => exportModel('3mf')}>
                  <b>多色 3MF</b>
                  <span>A1 · 0.2 mm 喷嘴 · 0.1 mm 层高</span>
                  <span>100% 填充 · PLA · 超粘板</span>
                </button>
                <button onClick={() => exportModel('stl')}>
                  <b>分色 STL 压缩包</b>
                  <span>每种材料一个独立实体</span>
                </button>
                <p className="export-preset-note">
                  3MF 沿用作者的打印预设。使用其他设备、耗材或打印板时，请在切片软件中切换。
                  {neededColors.length > 4 &&
                    ' 当前超过四色，请自行安排换料或选择支持更多材料的设备。'}
                  {flushRecommended &&
                    ' 当前配色有变化，已使用保守冲刷量；请在切片软件中重新计算。'}
                </p>
              </div>
            )}
          </div>
          <div className="more-wrap" ref={moreWrap}>
            <button
              type="button"
              title="更多：主题、帮助、找回旧设计"
              aria-label="更多：主题、帮助、找回旧设计"
              className={`icon-button ${moreMenu ? 'active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={moreMenu}
              aria-controls="workshop-more-menu"
              onClick={() => setMoreMenu(!moreMenu)}
            >
              <MoreHorizontal size={18} />
            </button>
            {moreMenu && (
              <div className="more-menu" id="workshop-more-menu" role="menu" aria-label="更多操作"
                onClick={() => setMoreMenu(false)}
                onKeyDown={event => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
                    .filter(button => !button.disabled && button.getClientRects().length);
                  const index = items.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                  items[next]?.focus();
                }}>
                <button type="button" role="menuitem" className="narrow-only"
                  disabled={importing || merging} onClick={startNewProject}>
                  <FilePlus2 size={15} />新建作品
                </button>
                <button type="button" role="menuitem" className="narrow-only"
                  onClick={() => fileInput.current?.click()}>
                  <FileUp size={15} />打开项目文件
                </button>
                <button type="button" role="menuitem" onClick={() => setShowHelp(true)}>
                  <MousePointer2 size={15} />快速上手
                </button>
                <button type="button" role="menuitem" onClick={onToggleTheme}>
                  {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                  {theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
                </button>
                {!isBadge && (
                  <button type="button" role="menuitem" disabled={recoveringLegacy}
                    onClick={() => void recoverLegacy()}>
                    <RotateCcw size={15} />
                    {recoveringLegacy ? '正在找回旧设计…' : '找回旧设计（下载文件）'}
                  </button>
                )}
                {legacyFound && (
                  <button type="button" role="menuitem" className="danger"
                    onClick={() => void clearLegacy()}>
                    <Trash2 size={15} />清除已下载的旧设计副本
                  </button>
                )}
                <p>快捷键：Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Ctrl+S 保存 · Ctrl+D 复制 · Ctrl+T 变换 · 方向键微移</p>
              </div>
            )}
          </div>
        </div>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept=".json,.pass.json,.badge.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openProject(f);
            e.target.value = '';
          }}
        />
      </header>
      <div className="workspace-grid">
        <aside className="left-panel" {...listDrag.handlers}>
          {listDrag.status &&
            createPortal(
              <div className="layer-drag-preview" ref={listDrag.ghost} role="status">
                <b>移动 {listDrag.status.count} 个图层</b>
                <span>{listDrag.status.label}</span>
              </div>,
              document.body,
            )}
          <div className="face-switch" role="group" aria-label="编辑面">
            <button
              className={face === 'front' ? 'active' : ''}
              aria-pressed={face === 'front'}
              title="正面：凸起集合与齐平背景"
              onClick={() => {
                setFace('front');
                select(null);
              }}
            >
              正面 <small>凸起 · 齐平</small>
            </button>
            <button
              className={face === 'back' ? 'active' : ''}
              aria-pressed={face === 'back'}
              title="背面：齐平背景"
              onClick={() => {
                setFace('back');
                select(null);
              }}
            >
              背面 <small>齐平</small>
            </button>
          </div>
          <button
            className={`layer-multiselect phone-only ${multiSelect ? 'active' : ''}`}
            aria-pressed={multiSelect}
            onClick={() => setMultiSelect(!multiSelect)}
          >
            <Check size={15} />
            {multiSelect ? '结束多选' : '多选图案'}
          </button>
          <div className="layer-list">
            <div className="layer-section-label">
              <span>{isBadge ? '徽章 · 自定义底板' : '模板 · 固定尺寸'}</span>
              <span>{template.width} × {template.height}</span>
            </div>
            <button
              className={`base-row ${selection === null ? 'active' : ''}`}
              onClick={() => select(null)}
            >
              <span
                className="layer-swatch"
                style={{
                  background: project.palette.find((c) => c.id === project.template.baseColorId)
                    ?.hex,
                }}
              />
              <div>
                <b>{baseName}</b>
                <small>{template.thickness.toFixed(3)} mm · {isBadge ? `${project.badgeBase!.mounts.length} 个安装槽` : '孔位保留'}</small>
              </div>
              <span className="locked-tag">{isBadge ? '可设计' : '固定'}</span>
            </button>
            {face === 'front' && !isBadge && (
              <>
                <button
                  type="button"
                  className="template-fold-heading"
                  aria-expanded={templateExpanded}
                  onClick={() => setTemplateExpanded(!templateExpanded)}
                >
                  <ChevronDown size={14} />
                  <Sparkles size={14} />
                  <span>模板装饰</span>
                  <small>{templateCount}</small>
                </button>
                {templateExpanded && (
                  <div className="template-members">
                    {templateLabel && (
                      <div
                        className={`template-row ${selection?.kind === 'label' ? 'active' : ''}`}
                      >
                        <button
                          className="row-select"
                          disabled={templateLabel.locked}
                          onClick={() => select({ kind: 'label' })}
                        >
                          <Type size={15} />
                          <span>上方标识</span>
                          <span className="row-mini">可改字</span>
                        </button>
                        <IconButton
                          label={templateLabel.locked ? '解锁标识' : '锁定标识'}
                          onClick={() =>
                            editPlacement({ kind: 'label' }, { locked: !templateLabel.locked })
                          }
                        >
                          {templateLabel.locked ? (
                            <LockKeyhole size={14} />
                          ) : (
                            <UnlockKeyhole size={14} />
                          )}
                        </IconButton>
                        <IconButton
                          label="删除上方标识"
                          disabled={templateLabel.locked}
                          onClick={() => removeTemplate({ kind: 'label' })}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )}
                    {project.template.panel !== null && (
                      <div
                        className={`template-row ${selection?.kind === 'panel' ? 'active' : ''} ${!panel.visible ? 'is-hidden' : ''}`}
                      >
                        <button
                          className="row-select"
                          disabled={panel.locked || !panel.visible}
                          onClick={() => select({ kind: 'panel' })}
                        >
                          <Square size={15} />
                          <span>侧边框</span>
                          <span className="row-mini">可移动</span>
                        </button>
                        <IconButton
                          label={panel.locked ? '解锁侧边框' : '锁定侧边框'}
                          onClick={() =>
                            editPlacement({ kind: 'panel' }, { locked: !panel.locked })
                          }
                        >
                          {panel.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                        </IconButton>
                        <IconButton
                          label={panel.visible ? '隐藏侧边框' : '显示侧边框'}
                          onClick={() =>
                            editPlacement({ kind: 'panel' }, { visible: !panel.visible })
                          }
                        >
                          {panel.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </IconButton>
                        <IconButton
                          label="删除侧边框"
                          disabled={panel.locked}
                          onClick={() => removeTemplate({ kind: 'panel' })}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )}
                    {templateDecorations.map((o) => {
                      const p = project.template.decorations[o.id];
                      return (
                        <div
                          key={o.id}
                          className={`template-row ${selection?.kind === 'decoration' && selection.id === o.id ? 'active' : ''} ${!p?.visible ? 'is-hidden' : ''}`}
                        >
                          <button
                            className="row-select"
                            disabled={p?.locked}
                            onClick={() => select({ kind: 'decoration', id: o.id })}
                          >
                            <Sparkles size={14} />
                            <span title={o.name}>{decorationName(o.id)}</span>
                          </button>
                          <IconButton
                            label={p?.locked ? '解锁装饰' : '锁定装饰'}
                            onClick={() =>
                              editPlacement({ kind: 'decoration', id: o.id }, { locked: !p.locked })
                            }
                          >
                            {p?.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                          </IconButton>
                          <IconButton
                            label={p?.visible ? '隐藏装饰' : '显示装饰'}
                            onClick={() =>
                              editPlacement(
                                { kind: 'decoration', id: o.id },
                                { visible: !p.visible },
                              )
                            }
                          >
                            {p?.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                          </IconButton>
                          <IconButton
                            label={`删除${decorationName(o.id)}`}
                            disabled={p.locked}
                            onClick={() => removeTemplate({ kind: 'decoration', id: o.id })}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <div className="layer-section-label collections-label">
              <span>{face === 'front' ? '正面集合 · 从上到下' : '背面集合 · 后者覆色'}</span>
              <IconButton label="添加集合" onClick={() => addCollection()}>
                <Plus size={15} />
              </IconButton>
            </div>
            {faceCollections.map((c, index, all) => (
              <div
                className={`collection-block ${!c.visible ? 'is-hidden' : ''} ${c.locked ? 'is-locked' : ''}`}
                key={c.id}
              >
                <div
                  className={`collection-row ${selection?.kind === 'collection' && selection.id === c.id ? 'active' : ''}`}
                  data-layer-target="collection"
                  data-collection-id={c.id}
                  data-layer-id={c.id}
                  data-layer-name={c.name}
                >
                  <button
                    type="button"
                    className="fold-toggle"
                    aria-label={expandedCollections.has(c.id) ? '收起集合' : '展开集合'}
                    aria-expanded={expandedCollections.has(c.id)}
                    onClick={() => toggleExpanded(c.id)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    className="row-select"
                    disabled={c.locked}
                    onClick={() => select({ kind: 'collection', id: c.id })}
                  >
                    <span className="collection-number">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <b>{c.name}</b>
                      <small>
                        {face === 'front' && collectionMode(c) === 'raised'
                          ? `顶高 ${(topHeights[c.id] ?? 0).toFixed(2)} mm`
                          : `齐平背景 · ${collectionInlayDepth(c, project).toFixed(2)} mm`}
                        {` · ${c.items.length} 图层`}
                        {!c.visible ? ' · 已隐藏' : ''}
                        {c.locked ? ' · 已锁定' : ''}
                      </small>
                    </div>
                  </button>
                  <IconButton
                    label={c.locked ? '解锁集合' : '锁定集合'}
                    onClick={() => editCollection(c.id, { locked: !c.locked })}
                  >
                    {c.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                  </IconButton>
                  <IconButton
                    label={c.visible ? '隐藏集合' : '显示集合'}
                    onClick={() => editCollection(c.id, { visible: !c.visible })}
                  >
                    {c.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </IconButton>
                </div>
                {expandedCollections.has(c.id) && (
                  <div className="collection-items">
                    {collectionLayerSections(c, face).map((section) => (
                      <section
                        key={section.kind}
                        className={`collection-layer-section ${section.kind}`}
                        aria-label={`${c.name} · ${section.label}`}
                      >
                        <h4 className="collection-layer-section-title">
                          {section.cutting ? <Scissors size={12} /> : <Layers size={12} />}
                          <span>{section.label}</span>
                          <small>
                            {section.units.reduce((sum, unit) => sum + unit.items.length, 0)}
                          </small>
                        </h4>
                        {section.units.map((unit) =>
                          unit.folder ? (
                            <div key={unit.folder.id} className="layer-folder">
                              <div
                                className={`folder-row ${folderRef?.id === unit.folder.id ? 'active' : ''} ${unit.folder.visible === false ? 'is-hidden' : ''} ${unit.folder.locked ? 'is-locked' : ''}`}
                                draggable={
                                  c.visible &&
                                  !c.locked &&
                                  !unit.folder.locked &&
                                  unit.folder.visible !== false
                                }
                                data-layer-source={
                                  c.visible &&
                                  !c.locked &&
                                  !unit.folder.locked &&
                                  unit.folder.visible !== false
                                    ? 'folder'
                                    : undefined
                                }
                                data-layer-target="folder"
                                data-collection-id={c.id}
                                data-layer-id={unit.folder.id}
                                data-layer-name={unit.folder.name}
                              >
                                <button
                                  type="button"
                                  className="layer-drag-handle"
                                  title="拖动整个文件夹排序或移到其他集合"
                                  aria-label={`拖动文件夹${unit.folder.name}`}
                                  disabled={
                                    !c.visible ||
                                    c.locked ||
                                    unit.folder.locked ||
                                    unit.folder.visible === false
                                  }
                                >
                                  <GripVertical size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="fold-toggle"
                                  aria-label={
                                    expandedFolders.has(unit.folder.id)
                                      ? '收起文件夹'
                                      : '展开文件夹'
                                  }
                                  aria-expanded={expandedFolders.has(unit.folder.id)}
                                  onClick={() => toggleExpanded(unit.folder!.id, true)}
                                >
                                  <ChevronDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="row-select"
                                  title={
                                    unit.items.length !== unit.totalItems
                                      ? '此文件夹在实体和切割块两区展示；选择或拖动文件夹会操作全部成员。'
                                      : undefined
                                  }
                                  disabled={
                                    !c.visible ||
                                    c.locked ||
                                    unit.folder.locked ||
                                    unit.folder.visible === false
                                  }
                                  onClick={() => select(folderSelection(c, unit.folder!.id))}
                                >
                                  {expandedFolders.has(unit.folder.id) ? (
                                    <FolderOpen size={15} />
                                  ) : (
                                    <Folder size={15} />
                                  )}
                                  <span>{unit.folder.name}</span>
                                  <small>{unit.items.length}</small>
                                </button>
                                <IconButton
                                  label={unit.folder.locked ? '解锁文件夹' : '锁定文件夹'}
                                  disabled={c.locked}
                                  onClick={() =>
                                    editFolder(c.id, unit.folder!.id, {
                                      locked: !unit.folder!.locked,
                                    })
                                  }
                                >
                                  {unit.folder.locked || c.locked ? (
                                    <LockKeyhole size={13} />
                                  ) : (
                                    <UnlockKeyhole size={13} />
                                  )}
                                </IconButton>
                                <IconButton
                                  label={
                                    unit.folder.visible === false ? '显示文件夹' : '隐藏文件夹'
                                  }
                                  onClick={() =>
                                    editFolder(c.id, unit.folder!.id, {
                                      visible: unit.folder!.visible === false,
                                    })
                                  }
                                >
                                  {unit.folder.visible === false ? (
                                    <EyeOff size={13} />
                                  ) : (
                                    <Eye size={13} />
                                  )}
                                </IconButton>
                              </div>
                              {expandedFolders.has(unit.folder.id) && (
                                <div className="folder-members">
                                  {(face === 'front'
                                    ? unit.items.slice().reverse()
                                    : unit.items
                                  ).map((i) => renderItemRow(c, i))}
                                </div>
                              )}
                            </div>
                          ) : (
                            renderItemRow(c, unit.items[0])
                          ),
                        )}
                      </section>
                    ))}
                    {!c.items.length && (
                      <button
                        className="empty-collection"
                        disabled={c.locked}
                        onClick={() => {
                          select({ kind: 'collection', id: c.id });
                          setShapeMenu(true);
                        }}
                      >
                        还空着呢，放一个图案 <Plus size={12} />
                      </button>
                    )}
                    <div
                      className="layer-list-end"
                      data-layer-target="collection"
                      data-collection-id={c.id}
                      data-layer-id={c.id}
                      data-layer-name={c.name}
                      data-layer-end="true"
                    >
                      拖到这里放在集合末尾
                    </div>
                  </div>
                )}
                {selection?.kind === 'collection' && selection.id === c.id && (
                  <div className="collection-tools">
                    <IconButton
                      label="降低集合顺序"
                      disabled={
                        (face === 'front'
                          ? all.filter((v) => collectionMode(v) === collectionMode(c)).at(-1)
                          : all.filter((v) => collectionMode(v) === collectionMode(c))[0]
                        )?.id === c.id
                      }
                      onClick={() => reorderCollection(c.id, -1)}
                    >
                      <ArrowDown size={14} />
                    </IconButton>
                    <IconButton
                      label="提高集合顺序"
                      disabled={
                        (face === 'front'
                          ? all.filter((v) => collectionMode(v) === collectionMode(c))[0]
                          : all.filter((v) => collectionMode(v) === collectionMode(c)).at(-1)
                        )?.id === c.id
                      }
                      onClick={() => reorderCollection(c.id, 1)}
                    >
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton label="复制集合" onClick={duplicateSelection}>
                      <Copy size={14} />
                    </IconButton>
                    <IconButton
                      label="删除集合与内容"
                      disabled={c.items.some((i) => isItemLocked(c, i))}
                      onClick={removeSelection}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="add-collection-row">
            <button
              className="add-collection"
              aria-label={`新建${face === 'front' ? '正面' : '背面'}集合`}
              onClick={() => addCollection()}
            >
              <Plus size={15} />
              {face === 'front' ? '凸起集合' : '新建背面集合'}
            </button>
            {face === 'front' && (
              <button
                className="add-collection background-add"
                aria-label="新建齐平背景集合"
                onClick={() => addCollection('background')}
              >
                <Plus size={15} />
                齐平背景
              </button>
            )}
          </div>
          <div className="layer-footnote">
            <Layers size={14} />
            <p>
              {face === 'front'
                ? '凸起集合厚度累加；齐平背景固定嵌入 0.7 mm。'
                : '背面嵌入深度可按集合修改，推荐 0.7 mm，孔位完整保留。'}
            </p>
          </div>
          <PrintWarnings issues={currentIssues} />
        </aside>
        <main className="canvas-panel">
          {freeTransform && (
            <div className="free-transform-bar" role="group" aria-label="自由变换操作">
              <span>自由变换 · 角点缩放 / 旋转</span>
              <button onClick={() => finishFreeTransform(false)}>
                <X size={14} />
                取消 <small>Esc</small>
              </button>
              <button onClick={() => finishFreeTransform()}>
                <Check size={14} />
                完成 <small>Enter</small>
              </button>
            </div>
          )}
          <div className="canvas-toolbar">
            <div className="add-tools">
              {isBadge && <button aria-label="设计底板" title="设计底板：形状、轮廓节点与背面安装槽" onClick={() => setShowBadgeDesigner(true)}><PencilIcon size={17}/><span>底板</span></button>}
              <div className="shape-wrap">
                <button
                  id="shape-menu-toggle"
                  aria-haspopup="dialog"
                  aria-expanded={shapeMenu}
                  aria-controls="shape-library"
                  onClick={() => setShapeMenu(!shapeMenu)}
                >
                  <ShapesIcon />
                  <span>图形</span>
                  <ChevronDown size={12} />
                </button>
                {shapeMenu && (
                  <ShapeLibrary
                    appearance={newShapeAppearance}
                    onAppearance={setNewShapeAppearance}
                    onClose={() => setShapeMenu(false)}
                    onAdd={(shape) =>
                      addItem(
                        newShape(
                          isBadge ? badgeArtworkColor(project,face) : project.palette.find((c) => c.id === 'white')?.id ?? project.palette[0].id,
                          shape,
                          newShapeAppearance,
                        ),
                      )
                    }
                  />
                )}
              </div>
              <button
                onClick={() =>
                  addItem({
                    id: uid(),
                    name: '新文字',
                    kind: 'text',
                    avoidsLower: false,
                    text: '你好！',
                    visible: true,
                    x: 14,
                    y: 35,
                    width: 23,
                    height: 8,
                    ...(font
                      ? resizeTextContent(
                          { text: '你好！', width: 23, height: 8, textScaleX: 8, textScaleY: 8 },
                          '你好！',
                          font,
                        )
                      : {}),
                    rotation: 0,
                    colorId:
                      isBadge ? badgeArtworkColor(project,face) : project.palette.find((c) => c.id === 'white')?.id ?? project.palette[0].id,
                  })
                }
              >
                <Type size={17} />
                <span>文字</span>
              </button>
              <button aria-label="导入图案" title="导入图案：PNG／JPG／WebP／SVG" onClick={() => artInput.current?.click()}>
                <ImagePlus size={17} />
                <span>导入</span>
              </button>
              <button
                aria-label="添加切割工具"
                title="添加切割工具：选中图案时自动指定为切割目标"
                onClick={() => {
                  setShowCutters(true);
                  if (item && !isCuttingItem(item)) addItem(newCutter(item));
                  else
                    addItem({
                      ...newShape(
                        project.palette.find((c) => c.id === 'white')?.id ?? project.palette[0].id,
                        'circle',
                      ),
                      name: '切割工具',
                      cutout: { targetIds: [] },
                    });
                }}
              >
                <Scissors size={17} />
                <span>切割</span>
              </button>
              <input
                hidden
                ref={artInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => {
                  setImportWidth(undefined);
                  setImportFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </div>
            {/* Mode toggles: pressed = on. Separate from the "add" group above. */}
            <div className="mode-tools" role="group" aria-label="编辑方式">
              <button
                type="button"
                className={`mode-toggle ${multiSelect ? 'active' : ''}`}
                aria-pressed={multiSelect}
                title="多选：点选多个图案一起移动、改色或组合（也可按住 Shift／Ctrl 点选）"
                onClick={() => setMultiSelect(!multiSelect)}
              >
                <Check size={15} />
                <span>多选</span>
              </button>
              <button
                type="button"
                className={`mode-toggle ${freeTransform ? 'active' : ''}`}
                aria-pressed={freeTransform}
                title="自由变换 Ctrl+T：拖角点缩放／旋转，Enter 完成，Esc 取消"
                disabled={!canTransform && !freeTransform}
                onClick={startFreeTransform}
              >
                <Maximize2 size={15} />
                <span>变换</span>
              </button>
              <button
                type="button"
                className={`mode-toggle ${showCutters ? 'active' : ''}`}
                aria-pressed={showCutters}
                aria-label="显示切割块轮廓"
                title={
                  showCutters
                    ? '正在显示所选图案关联的切割块轮廓，点击隐藏。隐藏轮廓不会暂停切割。'
                    : '切割块轮廓已隐藏（切割仍生效），点击显示所选图案关联的切割块。'
                }
                onClick={() => setShowCutters(!showCutters)}
              >
                <Scissors size={15} />
                <span>切割块</span>
              </button>
            </div>
            <div className="undo-tools">
              <IconButton label="撤销 Ctrl+Z" disabled={!canUndo} onClick={undo}>
                <Undo2 size={17} />
              </IconButton>
              <IconButton label="重做 Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
                <Redo2 size={17} />
              </IconButton>
            </div>
            <div className="view-switch">
              <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
                2D 编辑
              </button>
              <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
                3D 实体
              </button>
            </div>
          </div>
          <div
            className={`canvas-stage ${view === '3d' ? 'is-3d' : ''} ${snapPhase !== 'idle' ? 'is-snapping' : ''}`}
          >
            <div className="stage-caption">
              <span className="paper-label">{face === 'front' ? 'FRONT SIDE' : 'BACK SIDE'}</span>
              <span className="who-chip" title="当前编辑对象">
                <b>{selectedName ?? baseName}</b>
                {selectedHint !== (selectedName ?? baseName) && <small>{selectedHint}</small>}
              </span>
            </div>
            {view === '2d' ? (
              <ArtworkCanvas
                key={canvasReset}
                project={project}
                template={template}
                face={face}
                selection={selection}
                font={font}
                zoom={zoom}
                setZoom={setZoom}
                select={(s) => {
                  select(s);
                  if (isPhone()) setMobileSheet('peek');
                }}
                multiSelect={multiSelect}
                begin={begin}
                moveMany={moveMany}
                autoSnap={autoSnap}
                showCutters={showCutters}
                visibleCutterIds={visibleCutterIds}
                duplicateForDrag={duplicateForDrag}
                freeTransform={freeTransform}
                snapping={
                  snapPhase === 'idle'
                    ? null
                    : {
                        phase: snapPhase,
                        settings: snapSettings,
                        source: snapSource,
                        chooseSource: (pick) => {
                          setSnapSource(pick);
                          setSnapPhase('target');
                        },
                        commit: ([dx, dy]) => {
                          if (Math.hypot(dx, dy) > 1e-9) {
                            if (itemEntries.length) moveSelected(dx, dy);
                            else if (placement)
                              moveMany([
                                {
                                  s: selection,
                                  patch: { x: placement.x + dx, y: placement.y + dy },
                                },
                              ]);
                          }
                          cancelSnap();
                          notice('已吸附对齐');
                        },
                      }
                }
              />
            ) : (
              <ThreePreviewPanel
                key={project.format}
                model={model}
                palette={generatedProject?.palette ?? project.palette}
                face={face}
                project={project}
                current={isCurrent && !generating && !geometryError}
                inspectColors={geometry.inspectColors}
                onCorrectColor={correctModelColor}
                onRemoveFragment={removeModelFragment}
                onBatchProcess={batchProcessColors}
                onClearCorrections={() => change(p => { delete p.colorCorrections; })}
              />
            )}
            {snapPhase !== 'idle' && view === '2d' && (
              <div
                className="snap-canvas-bar"
                data-phase={snapPhase}
                role="group"
                aria-label="画布吸附工具"
              >
                <div className="snap-step-copy">
                  <b>
                    {snapPhase === 'source' ? '① ' : '② '}
                    <span className="snap-wide-label">
                      {snapPhase === 'source' ? '选择源参照' : '选择目标参照'}
                    </span>
                    <span className="snap-short-label">
                      {snapPhase === 'source' ? '选源' : '目标'}
                    </span>
                  </b>
                  <span>
                    {snapPhase === 'source'
                      ? '点击选中图案上的参照'
                      : '指向目标预览，点击完成 · Esc 取消'}
                  </span>
                </div>
                <div className="snap-canvas-options">
                  <select
                    aria-label="画布参照范围"
                    value={
                      snapPhase === 'source' ? snapSettings.sourceBasis : snapSettings.targetBasis
                    }
                    onChange={(e) =>
                      updateSnapSettings(
                        snapPhase === 'source'
                          ? { sourceBasis: e.target.value as SnapSettings['sourceBasis'] }
                          : { targetBasis: e.target.value as SnapSettings['targetBasis'] },
                      )
                    }
                  >
                    <option value="outline">实际轮廓</option>
                    <option value="bounds">外接框</option>
                  </select>
                  <select
                    aria-label="画布参照类型"
                    value={
                      snapPhase === 'source' ? snapSettings.sourceKind : snapSettings.targetKind
                    }
                    onChange={(e) =>
                      updateSnapSettings(
                        snapPhase === 'source'
                          ? { sourceKind: e.target.value as SnapSettings['sourceKind'] }
                          : { targetKind: e.target.value as SnapSettings['targetKind'] },
                      )
                    }
                  >
                    {Object.entries(snapKindLabels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <IconButton label="取消吸附" onClick={cancelSnap}>
                    <X size={16} />
                  </IconButton>
                </div>
              </div>
            )}
            <div className="canvas-bottom">
              <div className="mobile-history">
                <IconButton label="撤销" disabled={!canUndo} onClick={undo}>
                  <Undo2 size={16} />
                </IconButton>
                <IconButton label="重做" disabled={!canRedo} onClick={redo}>
                  <Redo2 size={16} />
                </IconButton>
              </div>
              <span className="stage-note">
                {view === '2d' ? '拖动移动 · 右上旋转 · 右下缩放 · 滚轮缩放画布' : '真实分色网格 · 拖动旋转'}
              </span>
              {view === '2d' && (
                <div className="zoom-tools">
                  <IconButton
                    label="缩小画布"
                    disabled={zoom <= canvasZoomLimits.min}
                    onClick={() => setZoom((v) => stepCanvasZoom(v, -1))}
                  >
                    <ZoomOut size={15} />
                  </IconButton>
                  <button
                    className="zoom-percent"
                    onClick={() => {
                      setZoom(1);
                      setCanvasReset((v) => v + 1);
                    }}
                    title="缩放范围 10%～2000%，点击恢复画布"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <IconButton
                    label="放大画布"
                    disabled={zoom >= canvasZoomLimits.max}
                    onClick={() => setZoom((v) => stepCanvasZoom(v, 1))}
                  >
                    <ZoomIn size={15} />
                  </IconButton>
                  <IconButton
                    label="画布适应窗口"
                    onClick={() => {
                      setZoom(1);
                      setCanvasReset((v) => v + 1);
                    }}
                  >
                    <Maximize2 size={14} />
                  </IconButton>
                </div>
              )}
            </div>
            {showHelp && <QuickStart kind={workshop} onDismiss={() => setShowHelp(false)} />}
            {showNewProject && (
              <NewProjectDialog
                initialType={isBadge ? 'badge' : 'pass'}
                onDismiss={() => setShowNewProject(false)}
                onCreate={createNewProject}
              />
            )}
            {showBadgeDesigner && isBadge && <Suspense fallback={<div className="toast" role="status">正在打开底板设计器…</div>}><BadgeDesigner base={project.badgeBase!} legacyBackDepth={backSurfaceDepth(project.collections)} onDismiss={() => setShowBadgeDesigner(false)} onApply={applyBadgeBase} onImport={importBadgeBase} onStyle={geometry.styleBadgeBase}/></Suspense>}
            {view === '3d' && !isCurrent && (
              <div className={`stale-banner ${geometryError ? 'error' : ''}`}>
                <LoaderCircle size={14} className={generating ? 'spinning' : ''} />
                {geometryError
                  ? model
                    ? '本次实体生成失败，当前显示上次模型。'
                    : '实体暂时没生成，请点击下方重新生成。'
                  : model
                    ? '正在更新，暂时显示上次模型。'
                    : '正在生成你的第一份实体…'}
              </div>
            )}
          </div>
          <div className="model-status">
            <span
              className={`status-dot ${geometryError ? 'error' : generating ? 'pending' : ''}`}
            />
            <span>{statusText}</span>
            {isCurrent && model && (
              <span className="model-stats">
                {model.stats.triangles.toLocaleString()} 面 · {model.stats.colors} 种材料 · 正面{' '}
                {model.stats.frontHeight.toFixed(2)} mm
              </span>
            )}
          </div>
          {geometryError && (
            <div className="geometry-message" role="alert">
              <span>{geometryError} · 设计已保留，当前暂停导出。</span>
              <button className="secondary-button" onClick={() => setRecovery((n) => n + 1)}>
                <RotateCcw size={14} />
                重新生成
              </button>
            </div>
          )}
          {currentIssues
            .filter((issue) => issue.severity === 'error')
            .map((issue, n) => (
              <div className="geometry-message" role="alert" key={n}>
                {issue.message}
              </div>
            ))}
        </main>
        <aside className={`right-panel ${selection ? 'is-inspecting' : ''}`} aria-label="图层属性">
          {selection && (
            <div className="property-heading inspector-heading">
              <div className="inspector-name-row">
                <label className="inspector-name">
                  <span>
                    {selectedFolder
                      ? '文件夹名称'
                      : selection.kind === 'collection'
                        ? '集合名称'
                        : item
                          ? '图案名称'
                          : '当前选择'}
                  </span>
                  {item ? (
                    <input
                      className="text-input"
                      aria-label="图案名称"
                      value={item.name}
                      onChange={(e) => editItem({ name: e.target.value.slice(0, 80) })}
                    />
                  ) : selection.kind === 'collection' && collection ? (
                    <input
                      className="text-input"
                      aria-label="集合名称"
                      value={collection.name}
                      onChange={(e) =>
                        editCollection(collection.id, { name: e.target.value.slice(0, 80) })
                      }
                    />
                  ) : selectedFolder && folderCollection ? (
                    <input
                      key={selectedFolder.id + selectedFolder.name}
                      className="text-input"
                      aria-label="文件夹名称"
                      defaultValue={selectedFolder.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== selectedFolder.name)
                          editFolder(folderCollection.id, selectedFolder.id, { name });
                        else e.target.value = selectedFolder.name;
                      }}
                    />
                  ) : (
                    <h2>{selectedName}</h2>
                  )}
                </label>
                <IconButton label="取消选择" onClick={() => select(null)}>
                  <X size={16} />
                </IconButton>
              </div>
              <div className="property-actions inspector-actions">
                {(item || selection.kind === 'items' || selection.kind === 'collection') && (
                  <button
                    onClick={duplicateSelection}
                    aria-label={
                      selection.kind === 'collection'
                        ? '复制集合'
                        : selection.kind === 'items'
                          ? '复制所选'
                          : '复制'
                    }
                  >
                    <Copy size={14} />
                    复制
                  </button>
                )}
                <button
                  aria-label={
                    selectedFolder
                      ? '锁定文件夹'
                      : selection.kind === 'collection'
                        ? '锁定集合'
                        : selection.kind === 'items'
                          ? '锁定所选'
                          : '锁定图层'
                  }
                  onClick={() => {
                    if (selectedFolder && folderCollection)
                      editFolder(folderCollection.id, selectedFolder.id, { locked: true });
                    else if (selection.kind === 'collection' && collection)
                      editCollection(collection.id, { locked: true });
                    else if (selection.kind === 'items')
                      change((p) => {
                        for (const ref of selectionEntries(selection))
                          applyPlacementPatch(p, { kind: 'item', ...ref }, { locked: true });
                      });
                    else editPlacement(selection, { locked: true });
                  }}
                >
                  <LockKeyhole size={14} />
                  锁定
                </button>
                <button
                  className="danger-action"
                  onClick={removeSelection}
                  aria-label={
                    selection.kind === 'collection'
                      ? '删除集合'
                      : selection.kind === 'items'
                        ? '删除所选'
                        : '删除'
                  }
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </div>
          )}
          {!selection && (
            <>
              {isBadge && (
                <section className="property-section badge-base-properties">
                  <h3>
                    徽章底板<span>自由设计</span>
                  </h3>
                  <p>预设形状、自由轮廓与节点编辑；背面可添加磁铁槽或胶粘别针定位槽。</p>
                  <button className="font-import-button" onClick={() => setShowBadgeDesigner(true)}>
                    <PencilIcon />
                    编辑底板与安装槽
                  </button>
                </section>
              )}
              <section className="property-section">
                <h3>
                  底板三层 <span>{isBadge ? '独立调厚 · 自动合计' : '总厚度固定'}</span>
                </h3>
                <div className="surface-color-row">
                  {!isBadge && (
                    <h4>
                      正面背景 <span>{frontDepth.toFixed(2)} mm</span>
                    </h4>
                  )}
                  {isBadge && badgeThicknessField('front', '正面背景厚度')}
                  {colorPicker(
                    project.template.frontColorId ?? project.template.baseColorId,
                    (id) =>
                      change((p) => {
                        p.template.frontColorId = id;
                      }),
                    '正面背景颜色',
                  )}
                </div>
                <div className="surface-color-row">
                  {!isBadge && (
                    <h4>
                      中心夹层{' '}
                      <span>{(template.thickness - frontDepth - backDepth).toFixed(3)} mm</span>
                    </h4>
                  )}
                  {isBadge && badgeThicknessField('core', '中心夹层厚度')}
                  {colorPicker(
                    project.template.baseColorId,
                    (id) =>
                      change((p) => {
                        p.template.baseColorId = id;
                      }),
                    '中心夹层颜色',
                  )}
                </div>
                <div className="surface-color-row">
                  {!isBadge && (
                    <h4>
                      背面背景 <span>{backDepth.toFixed(3)} mm</span>
                    </h4>
                  )}
                  {isBadge && badgeThicknessField('back', '背面背景厚度')}
                  {colorPicker(
                    project.template.backColorId ?? project.template.baseColorId,
                    (id) =>
                      change((p) => {
                        p.template.backColorId = id;
                      }),
                    '背面背景颜色',
                  )}
                </div>
                <dl className="spec-list">
                  <div>
                    <dt>宽 × 高</dt>
                    <dd>
                      {template.width} × {template.height} mm
                    </dd>
                  </div>
                  <div>
                    <dt>底板厚度</dt>
                    <dd>{template.thickness.toFixed(3)} mm</dd>
                  </div>
                  <div>
                    <dt>两面背景图案</dt>
                    <dd>嵌色后齐平</dd>
                  </div>
                </dl>
                <p className="field-note">
                  {isBadge
                    ? '三层厚度独立调整，总厚度自动相加（最多 20 mm）。每层至少 0.001 mm；有安装槽时，槽底仍须保留至少 0.8 mm。'
                    : '背面底色层随最深的可见背面集合对齐，中心夹层同步调整；没有可见背面集合时使用 0.7 mm，板子总厚度不变。'}
                </p>
              </section>
            </>
          )}
          {selection?.kind === 'collection' && collection && (
            <>
              {face === 'front' && (
                <section className="property-section">
                  <h3>图案形式</h3>
                  <div className="segmented-control" role="group" aria-label="集合图案形式">
                    <button
                      className={collectionMode(collection) === 'raised' ? 'active' : ''}
                      onClick={() => editCollection(collection.id, { mode: 'raised' })}
                    >
                      凸起图案
                    </button>
                    <button
                      className={collectionMode(collection) === 'background' ? 'active' : ''}
                      onClick={() => editCollection(collection.id, { mode: 'background' })}
                    >
                      齐平背景
                    </button>
                  </div>
                </section>
              )}
              <section className="property-section">
                <h3>{collectionMode(collection) === 'raised' ? '集合叠加厚度' : '背景嵌入深度'}</h3>
                {collectionMode(collection) === 'raised' ? (
                  <NumberField
                    label="叠加厚度"
                    value={collection.thickness}
                    min={0}
                    max={Infinity}
                    exclusiveMin
                    onChange={(thickness) => editCollection(collection.id, { thickness })}
                  />
                ) : collection.face === 'back' ? (
                  <NumberField
                    label="嵌入深度"
                    value={collectionInlayDepth(collection, project)}
                    min={0}
                    max={maxBackInlayDepth(template.thickness, project)}
                    exclusiveMin
                    onChange={(inlayDepth) => editCollection(collection.id, { inlayDepth })}
                  />
                ) : (
                  <div className="height-display">
                    {frontDepth.toFixed(2)}{' '}
                    <small>mm · {isBadge ? '跟随正面背景层' : '固定'}</small>
                  </div>
                )}
                <div className="height-diagram">
                  <span style={{ height: 18 }} />
                  <span
                    style={{
                      height: Math.min(
                        48,
                        (collectionMode(collection) === 'raised'
                          ? collection.thickness
                          : collectionInlayDepth(collection, project)) * 28,
                      ),
                    }}
                  />
                  <i>
                    ↑{' '}
                    {collectionMode(collection) === 'raised'
                      ? `${(topHeights[collection.id] ?? 0).toFixed(2)} mm 累计顶面`
                      : '与底板表面齐平'}
                  </i>
                </div>
                <p className="field-note">
                  {collectionMode(collection) === 'raised'
                    ? '累计顶面高度 = 本集合与下方可见集合的叠加厚度之和。对象高度继承自集合，模板装饰保留原高。'
                    : collection.face === 'back'
                      ? isBadge && project.badgeBase?.layers
                        ? `嵌入深度不超过背面背景层的 ${backDepth} mm；缩薄背景层时，过深的图案会限制在层内，原设置保留。填色后与背面齐平。`
                        : `推荐嵌入 0.7 mm；可填写大于 0、最多 ${maxBackInlayDepth(template.thickness)} mm 的深度。填色后与背面齐平，板子总厚度不变。`
                      : `图案嵌入正面的 ${frontDepth} mm 背景层，填色后齐平，不增加底板或凸起集合的厚度。`}
                </p>
                {collectionMode(collection) === 'raised' && collection.thickness < 0.1 && (
                  <p className="field-note accent-note">
                    厚度小于 0.1 mm；实体保留这个值，请在切片软件中确认能否打印。
                  </p>
                )}
                {!collection.items.length && (
                  <p className="field-note accent-note">
                    {collectionMode(collection) === 'raised'
                      ? '这个集合还没有图案，但可见时仍然计入高度。'
                      : '这个集合还没有背景图案。'}
                  </p>
                )}
              </section>
            </>
          )}
          {placement && (
            <>
              {(item?.kind === 'text' || selection?.kind === 'label') && (
                <section className="property-section">
                  <h3>文字内容</h3>
                  <textarea
                    className="text-input text-area"
                    value={item?.text ?? templateLabel?.text ?? ''}
                    aria-label="文字内容"
                    onChange={(e) => {
                      if (item)
                        editItem(
                          font
                            ? resizeTextContent(
                                { ...item, text: item.text ?? '' },
                                e.target.value.slice(0, 160),
                                font,
                              )
                            : { text: e.target.value.slice(0, 160) },
                        );
                      else setLabelText(e.target.value);
                    }}
                  />
                  {selection?.kind === 'label' && (
                    <button className="text-link" onClick={restoreLabel}>
                      恢复原版字标
                    </button>
                  )}
                </section>
              )}
              {textValue && (
                <TextProperties
                  key={item?.id ?? 'template-label'}
                  project={project}
                  target={selection}
                  font={font}
                  value={textValue}
                  onChange={editTypography}
                />
              )}
              {item && item.kind !== 'text' && (
                <section className="property-section appearance-section">
                  <h3>轮廓与填充</h3>
                  <ShapeAppearanceControls
                    value={shapeAppearance(item)}
                    onChange={editItem}
                    onBegin={() => {
                      if (!selectionLocked(current.current, selection)) begin();
                    }}
                  />
                </section>
              )}
              <section className="property-section transform-section">
                <h3>
                  尺寸与位置 <span>毫米</span>
                </h3>
                <div className="number-grid">
                  <NumberField
                    label="X 位置"
                    shortLabel="X"
                    value={placement.x}
                    onChange={(x) => editPlacement(selection, { x })}
                  />
                  <NumberField
                    label="Y 位置"
                    shortLabel="Y"
                    value={placement.y}
                    onChange={(y) => editPlacement(selection, { y })}
                  />
                  <NumberField
                    label="宽度"
                    shortLabel="宽"
                    value={placement.width * (placement.mirrorX ? -1 : 1)}
                    min={isBadge ? -200 : -150}
                    nonZero
                    max={isBadge ? 200 : 150}
                    onChange={(width) =>
                      editPlacement(selection, { width: Math.abs(width), mirrorX: width < 0 })
                    }
                  />
                  <NumberField
                    label="高度"
                    shortLabel="高"
                    value={placement.height * (placement.mirrorY ? -1 : 1)}
                    min={isBadge ? -200 : -150}
                    nonZero
                    max={isBadge ? 200 : 150}
                    onChange={(height) =>
                      editPlacement(selection, { height: Math.abs(height), mirrorY: height < 0 })
                    }
                  />
                </div>
                <div className="rotation-row">
                  <NumberField
                    label="旋转"
                    unit="°"
                    value={placement.rotation}
                    min={-360}
                    max={360}
                    onChange={(rotation) => editPlacement(selection, { rotation })}
                  />
                  <IconButton
                    label="逆时针旋转十五度"
                    onClick={() => editPlacement(selection, { rotation: placement.rotation - 15 })}
                  >
                    <RotateCcw size={16} />
                  </IconButton>
                  <IconButton
                    label="顺时针旋转十五度"
                    onClick={() => editPlacement(selection, { rotation: placement.rotation + 15 })}
                  >
                    <RotateCcw size={16} style={{ transform: 'scaleX(-1)' }} />
                  </IconButton>
                </div>
                <p className="field-note">宽／高填负数可镜像，不能为零。</p>
              </section>
              {item?.folderId && collection && (
                <section className="property-section">
                  <h3>所属文件夹</h3>
                  <p className="field-note">
                    {collection.folders?.find((f) => f.id === item.folderId)?.name}
                  </p>
                  <button
                    className="font-import-button"
                    onClick={() => change((p) => leaveFolder(p, collection.id, item.id))}
                  >
                    <FolderOpen size={14} />
                    移出文件夹
                  </button>
                </section>
              )}
              {item && (
                <BooleanProperties
                  project={project}
                  item={item}
                  face={face}
                  onChange={editItem}
                  onAdd={() => {
                    setShowCutters(true);
                    addItem(newCutter(item));
                  }}
                />
              )}
              {selection?.kind !== 'panel' && (!item || !isCuttingItem(item)) && (
                <section className="property-section layer-colors-section">
                  <h3>耗材颜色</h3>
                  {item?.kind === 'paths' && item.regions ? (
                    <div className="region-color-grid">
                      {item.regions.map((r, n) => (
                        <div className="region-color" key={n}>
                          <span>色块 {n + 1}</span>
                          <select
                            aria-label={`色块${n + 1}材料`}
                            value={r.colorId}
                            onChange={(e) =>
                              editItem({
                                regions: item.regions!.map((v, k) =>
                                  k === n ? { ...v, colorId: e.target.value } : v,
                                ),
                              })
                            }
                          >
                            {project.palette.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  ) : (
                    colorPicker(placement.colorId, (id) =>
                      editPlacement(selection, { colorId: id }),
                    )
                  )}
                </section>
              )}
              {item && collection && (
                <section className="property-section">
                  <h3>
                    所属集合{' '}
                    <span>
                      {collectionMode(collection) === 'raised'
                        ? `${(topHeights[collection.id] ?? 0).toFixed(2)} mm 累计顶面`
                        : `齐平背景 · ${collectionInlayDepth(collection, project).toFixed(2)} mm`}
                    </span>
                  </h3>
                  <select
                    className="text-input"
                    aria-label="图案所属集合"
                    value={collection.id}
                    onChange={(e) => moveToCollection(e.target.value)}
                  >
                    {project.collections
                      .filter((c) => c.face === face)
                      .map((c) => (
                        <option key={c.id} value={c.id} disabled={c.locked}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <p className="field-note">
                    {isCuttingItem(item)
                      ? '切割工具只使用形状和位置，贯穿指定图案的高度。'
                      : '高度随所属集合变化。'}
                  </p>
                </section>
              )}
              {item && !isCuttingItem(item) && (
                <section className="property-section">
                  <h3>叠放关系</h3>
                  <div className="effect-cards">
                    <label
                      className={`effect-card ${item.coversLower !== false && !avoidsLowerArea(item) ? 'on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.coversLower !== false}
                        disabled={avoidsLowerArea(item)}
                        onChange={(e) =>
                          editItem({ coversLower: e.target.checked, avoidsLower: false })
                        }
                      />
                      <span>
                        <b>覆盖底层图案</b>
                        <small>
                          {avoidsLowerArea(item)
                            ? '避让已开启，重叠区域会被完整裁掉。'
                            : item.coversLower !== false
                              ? '交叠处使用本图案颜色。'
                              : collection && collectionMode(collection) === 'background'
                                ? '保留下方背景，填充其余区域。'
                                : '保留下方颜色与高度，本图案继续凸起。'}
                        </small>
                      </span>
                    </label>
                    <label className={`effect-card ${avoidsLowerArea(item) ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={avoidsLowerArea(item)}
                        onChange={(e) => editItem({ avoidsLower: e.target.checked })}
                      />
                      <span>
                        <b>避让下方区域</b>
                        <small>裁掉与下方重叠的整块区域，含凸起。</small>
                      </span>
                    </label>
                  </div>
                </section>
              )}
            </>
          )}
          {selectedFolder && folderCollection && (
            <section className="property-section">
              <h3>
                文件夹{' '}
                <span>
                  {folderCollection.items.filter((i) => i.folderId === selectedFolder.id).length}{' '}
                  个成员
                </span>
              </h3>
              <div className="property-actions folder-actions">
                <button
                  onClick={() =>
                    editFolder(folderCollection.id, selectedFolder.id, { visible: false })
                  }
                >
                  <EyeOff size={14} />
                  隐藏文件夹
                </button>
                <button
                  onClick={() => {
                    const refs = selectionEntries(selection);
                    change((p) => dissolveFolder(p, folderCollection.id, selectedFolder.id));
                    select(
                      refs.length > 1
                        ? { kind: 'items', items: refs }
                        : refs.length
                          ? { kind: 'item', ...refs[0] }
                          : null,
                    );
                  }}
                >
                  <FolderOpen size={14} />
                  取消组合
                </button>
              </div>
              <p className="field-note">
                隐藏成员随组变换，锁定成员保留原位；在列表恢复显隐／锁定。
              </p>
            </section>
          )}
          {selection?.kind === 'items' && !selectedFolder && (
            <section className="property-section">
              <h3>组合为文件夹</h3>
              <button
                className="font-import-button"
                onClick={createFolder}
                disabled={!!groupingReason(project, selection)}
              >
                <Folder size={15} />
                组合所选图层
              </button>
              <p className="field-note">
                {groupingReason(project, selection) ||
                  '成员整理到最后选中图层的位置，保持彼此顺序；随时可取消组合。'}
              </p>
            </section>
          )}
          {selection?.kind === 'items' && itemEntries.length > 0 && (
            <>
              <section className="property-section transform-section">
                <h3>
                  尺寸与位置 <span>{itemEntries.length} 个图案</span>
                </h3>
                <div className="number-grid">
                  <NumberField
                    label="选区 X 位置"
                    shortLabel="X"
                    value={+groupX.toFixed(2)}
                    onChange={(x) => moveSelected(x - groupX, 0)}
                  />
                  <NumberField
                    label="选区 Y 位置"
                    shortLabel="Y"
                    value={+groupY.toFixed(2)}
                    onChange={(y) => moveSelected(0, y - groupY)}
                  />
                </div>
                <div className="number-grid grouped-size-fields">
                  <NumberField
                    label="选区宽度"
                    shortLabel="宽"
                    resetSign
                    value={+groupWidth.toFixed(2) || groupWidth}
                    min={-Infinity}
                    max={Infinity}
                    nonZero
                    onChange={(width) => scaleSelected(width / groupWidth, 'x')}
                  />
                  <NumberField
                    label="选区高度"
                    shortLabel="高"
                    resetSign
                    value={+groupHeight.toFixed(2) || groupHeight}
                    min={-Infinity}
                    max={Infinity}
                    nonZero
                    onChange={(height) => scaleSelected(height / groupHeight, 'y')}
                  />
                </div>
                <div className="grouped-rotation-field">
                  <NumberField
                    label="整体角度"
                    shortLabel="旋转"
                    unit="°"
                    value={itemEntries[0].item.rotation}
                    min={-Infinity}
                    max={Infinity}
                    onChange={(angle) => rotateSelected(angle - itemEntries[0].item.rotation)}
                  />
                </div>
                <p className="field-note">
                  宽／高负数可镜像；旋转以首个成员角度为准，绕选区中心一起转动。
                </p>
              </section>
              <section className="property-section">
                <h3>统一颜色</h3>
                {colorPicker(
                  itemEntries[0].item.colorId,
                  (id) =>
                    change((p) => {
                      for (const ref of itemEntries) {
                        const c = p.collections.find((c) => c.id === ref.collectionId)!;
                        const i = c.items.find((i) => i.id === ref.id)!;
                        if (isItemLocked(c, i)) continue;
                        i.colorId = id;
                        if (i.regions) i.regions = i.regions.map((r) => ({ ...r, colorId: id }));
                      }
                    }),
                  '所选图层统一颜色',
                )}
              </section>
              <section className="property-section">
                <h3>移到集合</h3>
                <select
                  className="text-input"
                  aria-label="多选图案所属集合"
                  value={
                    itemEntries.every((v) => v.collectionId === itemEntries[0].collectionId)
                      ? itemEntries[0].collectionId
                      : ''
                  }
                  onChange={(e) => moveToCollection(e.target.value)}
                >
                  <option value="" disabled>
                    来自不同集合
                  </option>
                  {project.collections
                    .filter((c) => c.face === face)
                    .map((c) => (
                      <option key={c.id} value={c.id} disabled={c.locked}>
                        {c.name} · {collectionMode(c) === 'raised' ? '凸起' : '背景'}
                      </option>
                    ))}
                </select>
              </section>
              <section className="property-section">
                <h3>合并图层</h3>
                <button
                  className="font-import-button"
                  onClick={mergeSelection}
                  disabled={merging || !!mergeReason(project, selection)}
                >
                  {merging ? <LoaderCircle size={15} className="spin" /> : <Layers size={15} />}
                  {merging ? '正在合并…' : '合并所选图层'}
                </button>
                <p className="field-note">
                  {mergeReason(project, selection) ||
                    '合并当前轮廓，保留颜色，固定切割和夹层遮挡效果；可一次撤销。'}
                </p>
              </section>
            </>
          )}
          {(placement || itemEntries.length > 0) && (
            <SnapControls
              automatic={autoSnap}
              setAutomatic={setAutoSnap}
              settings={snapSettings}
              update={updateSnapSettings}
              phase={snapPhase}
              source={snapSource}
              start={startSnap}
              cancel={cancelSnap}
            />
          )}
          {alignmentControls}
          {selection?.kind === 'panel' && (
            <>
              <div className="fixed-note">
                <Square size={28} />
                <p>
                  框体和细节一起移动
                  <br />
                  <b>
                    {panel.width.toFixed(2)} × {panel.height.toFixed(2)} mm
                  </b>
                </p>
              </div>
              <section className="property-section">
                <h3>框体颜色</h3>
                {colorPicker(project.template.panelColorId, (id) =>
                  change((p) => {
                    p.template.panelColorId = id;
                  }),
                )}
              </section>
              <section className="property-section">
                <h3>细节颜色</h3>
                {colorPicker(project.template.panelDetailColorId, (id) =>
                  change((p) => {
                    p.template.panelDetailColorId = id;
                  }),
                )}
                <p className="field-note">保护区域会跟随框体移动和变换，新增图案会自动避开。</p>
              </section>
            </>
          )}
          <section className="materials-section">
            <h3>
              耗材调色盘 <span>{project.palette.length} 色</span>
            </h3>
            <div className="material-list">
              {project.palette.map((c) => (
                <div className="material-row" key={c.id}>
                  <label className="material-swatch" title={`调整${c.name}`}>
                    <input
                      type="color"
                      value={c.hex}
                      aria-label={`${c.name}颜色`}
                      onChange={(e) =>
                        change((p) => {
                          p.palette.find((v) => v.id === c.id)!.hex = e.target.value;
                        })
                      }
                    />
                  </label>
                  <input
                    value={c.name}
                    aria-label={`材料${c.id}名称`}
                    onChange={(e) =>
                      change((p) => {
                        p.palette.find((v) => v.id === c.id)!.name = e.target.value.slice(0, 30);
                      })
                    }
                  />
                  <small>{c.hex.toUpperCase()}</small>
                  <IconButton
                    label={`删除耗材「${c.name}」`}
                    className="material-delete"
                    disabled={project.palette.length <= 1}
                    onClick={() => deleteMaterial(c.id)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
            <button
              className="add-color"
              onClick={() =>
                change((p) =>
                  p.palette.push({
                    id: uid('color'),
                    name: `新耗材 ${p.palette.length + 1}`,
                    hex: '#B9DAD0',
                  }),
                )
              }
            >
              <Plus size={14} />
              添加耗材色
            </button>
            <p className="field-note material-delete-note">
              {project.palette.length === 1
                ? '至少保留一种耗材颜色。'
                : '删除后，使用处自动换成前一个颜色；首个颜色换成后一个。'}
            </p>
            <div className="required-colors">
              <span>本次实际使用</span>
              {isCurrent && model ? (
                <div>
                  {neededColors.map((id) => (
                    <span
                      key={id}
                      title={project.palette.find((c) => c.id === id)?.name}
                      style={{ background: project.palette.find((c) => c.id === id)?.hex }}
                    />
                  ))}
                  <b>{neededColors.length} 种</b>
                </div>
              ) : (
                <small>{generating ? '计算中…' : '等待实体更新'}</small>
              )}
            </div>
          </section>
        </aside>
      </div>
      <div className="mobile-sheet" aria-label="图层与参数">
        <button
          type="button"
          className="sheet-grab"
          aria-label={mobileSheet === 'peek' ? '拉开工作台' : '收起工作台'}
          aria-expanded={mobileSheet !== 'peek'}
          onPointerDown={(e) => {
            if (e.button !== 0 || !atelierRoot.current) return;
            const root = atelierRoot.current;
            const sheet = e.currentTarget.parentElement!;
            const rect = sheet.getBoundingClientRect();
            const peek = 84 + parseFloat(getComputedStyle(sheet).paddingBottom || '0');
            const maxOffset = Math.max(0, rect.height - peek);
            const startOffset = Math.max(
              0,
              Math.min(maxOffset, rect.top - (window.innerHeight - rect.height)),
            );
            sheetGesture.current = {
              pointerId: e.pointerId,
              startY: e.clientY,
              startOffset,
              maxOffset,
              offset: startOffset,
            };
            suppressSheetClick.current = false;
            root.classList.add('sheet-dragging');
            root.style.setProperty('--sheet-offset', startOffset + 'px');
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const gesture = sheetGesture.current;
            if (!gesture || gesture.pointerId !== e.pointerId) return;
            const distance = e.clientY - gesture.startY;
            if (Math.abs(distance) > 5) suppressSheetClick.current = true;
            gesture.offset = Math.max(
              0,
              Math.min(gesture.maxOffset, gesture.startOffset + distance),
            );
            atelierRoot.current?.style.setProperty('--sheet-offset', gesture.offset + 'px');
          }}
          onPointerUp={(e) => {
            const gesture = sheetGesture.current;
            if (!gesture || gesture.pointerId !== e.pointerId) return;
            const distance = e.clientY - gesture.startY;
            const open =
              Math.abs(distance) > 72 ? distance < 0 : gesture.offset < gesture.maxOffset / 2;
            sheetGesture.current = null;
            setMobileSheet(open ? sheetPanel.current : 'peek');
            atelierRoot.current?.classList.remove('sheet-dragging');
            atelierRoot.current?.style.removeProperty('--sheet-offset');
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            sheetGesture.current = null;
            suppressSheetClick.current = true;
            atelierRoot.current?.classList.remove('sheet-dragging');
            atelierRoot.current?.style.removeProperty('--sheet-offset');
          }}
          onLostPointerCapture={() => {
            if (!sheetGesture.current) return;
            sheetGesture.current = null;
            atelierRoot.current?.classList.remove('sheet-dragging');
            atelierRoot.current?.style.removeProperty('--sheet-offset');
          }}
          onClick={(e) => {
            if (suppressSheetClick.current && e.detail > 0) {
              suppressSheetClick.current = false;
              return;
            }
            setMobileSheet(mobileSheet === 'peek' ? 'layers' : 'peek');
          }}
        >
          <i />
        </button>
        <div className="sheet-bar">
          <button
            type="button"
            className="sheet-current"
            onClick={() => setMobileSheet(selection ? 'props' : 'layers')}
          >
            <b>{selectedName ?? baseName}</b>
            <small>{selection ? selectedHint : '点这里选择图层'}</small>
          </button>
          <button
            type="button"
            className={`sheet-tab ${mobileSheet === 'layers' ? 'active' : ''}`}
            onClick={() => setMobileSheet(mobileSheet === 'layers' ? 'peek' : 'layers')}
          >
            <Layers size={16} />
            图层
          </button>
          <button
            type="button"
            className={`sheet-tab ${mobileSheet === 'props' ? 'active' : ''}`}
            onClick={() => setMobileSheet(mobileSheet === 'props' ? 'peek' : 'props')}
          >
            <Settings2 size={16} />
            参数
          </button>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {importFile && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importing) setImportFile(null);
          }}
        >
          <section
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !importing) {
                e.stopPropagation();
                setImportFile(null);
              }
              if (e.key === 'Tab') {
                const nodes = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),input:not(:disabled),select,textarea',
                  ),
                );
                const first = nodes[0],
                  last = nodes.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
            aria-labelledby="import-title"
          >
            <div className="dialog-title">
              <div>
                <span className="eyebrow">FROM IMAGE TO OBJECT</span>
                <h2 id="import-title">把图案变成轮廓</h2>
              </div>
              <IconButton label="关闭导入" disabled={importing} onClick={() => setImportFile(null)}>
                <X size={19} />
              </IconButton>
            </div>
            <div className="import-body">
              <ImportPreview
                key={importFile.name + ':' + importFile.lastModified}
                caption={
                  (showingImportOriginal
                    ? '原图 · '
                    : currentPreview?.result
                      ? onlySilhouette
                        ? '仅剪影 · '
                        : withSilhouette
                          ? '图案 + 剪影 · '
                          : '导入效果 · '
                      : '') + importFile.name
                }
                overlay={
                  previewing && (
                    <div className="silhouette-preview-loading" role="status">
                      <LoaderCircle size={18} className="spinning" /> 正在描摹图案…
                    </div>
                  )
                }
              >
                {displayImportResult && !showingImportOriginal ? (
                  importArtworkPreview({
                    result: displayImportResult,
                    palette: project.palette,
                    content: effectiveImportContent,
                    appearance: importAppearance,
                    colorId: underlayColor,
                    width: importedWidth,
                  })
                ) : (
                  <img
                    src={importUrl || undefined}
                    alt={showingImportOriginal ? '原图对照' : '待导入图案'}
                    draggable={false}
                  />
                )}
              </ImportPreview>
              <fieldset className="import-controls" aria-label="图案导入设置" disabled={importing}>
                {isBadge && (
                  <div className="segmented-control" role="group" aria-label="导入用途">
                    <button
                      aria-pressed={!importingBase}
                      className={!importingBase ? 'active' : ''}
                      onClick={() => {
                        setImportTarget('layer');
                        setImportWidth(undefined);
                      }}
                    >
                      图案图层
                    </button>
                    <button
                      aria-pressed={importingBase}
                      className={importingBase ? 'active' : ''}
                      onClick={() => {
                        setImportTarget('base');
                        setImportWidth(undefined);
                        setImportOptions((o) => ({ ...o, removeBackground: true }));
                      }}
                    >
                      徽章底板
                    </button>
                  </div>
                )}
                <div className="import-content-modes" role="group" aria-label="导入内容">
                  {(
                    [
                      ['artwork', '原图案'],
                      ['with-silhouette', '图案＋剪影'],
                      ['silhouette', '仅剪影'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      aria-pressed={effectiveImportContent === mode}
                      className={effectiveImportContent === mode ? 'active' : ''}
                      disabled={
                        (importingBase && mode !== 'silhouette') ||
                        (mode === 'with-silhouette' && !silhouetteAllowed)
                      }
                      onClick={() => {
                        setImportContent(mode);
                        setImportWidth(undefined);
                        if (mode === 'silhouette')
                          setImportOptions((o) => ({ ...o, removeBackground: true }));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <section className="import-outline-controls">
                  <h3>尺寸与圆滑描边{withSilhouette ? ' · 剪影垫层' : ''}</h3>
                  <div className="number-grid">
                    <NumberField
                      label="导入宽度"
                      value={Number(importedWidth.toFixed(3))}
                      min={importingBase ? 10 : 0.01}
                      max={isBadge ? 200 : 150}
                      onChange={setImportWidth}
                    />
                    <NumberField
                      label="导入高度"
                      value={Number(importedHeight.toFixed(3))}
                      min={importingBase ? 10 : 0.01}
                      max={isBadge ? 200 : 150}
                      onChange={(h) => {
                        if (displayImportResult)
                          setImportWidth(
                            (h * displayImportResult.width) / displayImportResult.height,
                          );
                      }}
                    />
                  </div>
                  <p className="field-note">
                    宽高联动保持比例，描边外扩另计。
                    {importingBase
                      ? '确认后替换底板，保留三层厚度及安装槽；不合适的槽会提示。'
                      : effectiveImportContent === 'artwork'
                        ? '彩色图案按色块分别描边；仅剪影使用整体外轮廓。'
                        : '剪影填满内部空隙，保留凹口与分开的图形。'}
                  </p>
                  <ShapeAppearanceControls
                    value={importAppearance}
                    onChange={setImportAppearance}
                  />
                  {onlySilhouette && !importingBase && (
                    <div>
                      <span className="silhouette-color-label">剪影耗材颜色</span>
                      {colorPicker(underlayColor, setSilhouetteColorId, '剪影耗材颜色')}
                    </div>
                  )}
                  {!validImportSize && (
                    <p className="field-note accent-note" role="alert">
                      宽高超出范围；徽章底板两边须为 10～200 mm。
                    </p>
                  )}
                </section>
                <div className="import-mode">
                  <button
                    className={importOptions.mode === 'lineart' ? 'active' : ''}
                    onClick={() => setImportOptions((o) => ({ ...o, mode: 'lineart' }))}
                  >
                    黑白线稿
                  </button>
                  <button
                    className={importOptions.mode === 'color' ? 'active' : ''}
                    onClick={() => setImportOptions((o) => ({ ...o, mode: 'color' }))}
                  >
                    彩色图案
                  </button>
                </div>
                {importOptions.mode === 'lineart' && (
                  <LineartBetaControls
                    options={importOptions}
                    onChange={setImportOptions}
                    original={showImportOriginal}
                    onCompare={setShowImportOriginal}
                  />
                )}
                <label className="number-field">
                  <span>细节精度</span>
                  <select
                    value={importOptions.quality ?? 'balanced'}
                    onChange={(e) =>
                      setImportOptions((o) => ({
                        ...o,
                        quality: e.target.value as ImportOptions['quality'],
                      }))
                    }
                  >
                    <option value="fast">快速 · 大轮廓</option>
                    <option value="balanced">均衡 · 日常图案</option>
                    <option value="fine">精细 · 细线与小字</option>
                  </select>
                </label>
                <p className="field-note">
                  精细保留更多原图细节，准备时间会稍长。滚轮或双指缩放预览，拖动查看；小位图不强行放大，SVG
                  按所选精度描摹。
                </p>
                <label className="range-field">
                  <span>
                    线稿阈值 <b>{importOptions.threshold}</b>
                  </span>
                  <input
                    type="range"
                    min="20"
                    max="245"
                    value={importOptions.threshold}
                    disabled={importOptions.mode === 'color'}
                    onChange={(e) =>
                      setImportOptions((o) => ({ ...o, threshold: Number(e.target.value) }))
                    }
                  />
                  <small>越高，保留的线条和细节越多。</small>
                </label>
                <label className="range-field">
                  <span>
                    轮廓简化 <b>{importOptions.simplify.toFixed(1)}</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.1"
                    value={importOptions.simplify}
                    onChange={(e) =>
                      setImportOptions((o) => ({ ...o, simplify: Number(e.target.value) }))
                    }
                  />
                  <small>向右减少轮廓节点；向左保留更多细节。</small>
                </label>
                <NumberField
                  label="最多颜色"
                  unit="种"
                  min={Math.min(2, project.palette.length)}
                  max={Math.min(8, project.palette.length)}
                  value={importOptions.maxColors}
                  onChange={(maxColors) => setImportOptions((o) => ({ ...o, maxColors }))}
                />
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={importOptions.removeBackground}
                    onChange={(e) =>
                      setImportOptions((o) => ({ ...o, removeBackground: e.target.checked }))
                    }
                  />
                  <span>去掉边缘相连的浅色背景</span>
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!importOptions.invert}
                    onChange={(e) => setImportOptions((o) => ({ ...o, invert: e.target.checked }))}
                  />
                  <span>反转黑白线稿</span>
                </label>
                <div className="silhouette-options">
                  {silhouetteAllowed ? (
                    <p className="field-note">
                      填满各自的封闭外轮廓，保留分开的图案。有开口的线条按实际轮廓生成。
                    </p>
                  ) : (
                    <p className="field-note">请在正面凸起集合中使用；齐平背景保持原有嵌色深度。</p>
                  )}
                  {withSilhouette && (
                    <div className="silhouette-parameters">
                      {newArtworkCollection ? (
                        <>
                          <label className="number-field">
                            <span>新图案集合厚度</span>
                            <div>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                aria-label="新图案集合厚度"
                                value={artworkThickness}
                                aria-invalid={!validUnderlayThickness}
                                aria-describedby="silhouette-thickness-note"
                                onChange={(e) => setArtworkThickness(e.target.value)}
                              />
                              <span>mm</span>
                            </div>
                          </label>
                          <p
                            id="silhouette-thickness-note"
                            className={`field-note ${!validUnderlayThickness ? 'silhouette-error' : ''}`}
                          >
                            {!validUnderlayThickness
                              ? '请输入大于 0 的有限厚度。'
                              : newArtworkThickness < 0.1
                                ? '新图案集合较薄，请按喷嘴与层高检查切片预览。'
                                : '推荐 0.4 mm，可按打印需求自由调整。'}
                          </p>
                        </>
                      ) : (
                        <p className="field-note">
                          剪影加入「{lowerImportCollection?.name}」，沿用集合厚度{' '}
                          {lowerImportCollection?.thickness} mm。
                          {!lowerImportCollection?.visible &&
                            '该集合当前隐藏，可在图层列表中显示。'}
                        </p>
                      )}
                      <div>
                        <span className="silhouette-color-label">剪影耗材颜色</span>
                        {colorPicker(underlayColor, setSilhouetteColorId, '剪影耗材颜色')}
                      </div>
                      <p className="field-note">
                        {newArtworkCollection
                          ? `剪影放入${importCollection ? `「${importCollection.name}」` : '新建的最底集合'}，图案放入新建的上层集合；更上方凸起集合的累计高度相应增加。`
                          : `图案导入「${importCollection?.name}」，剪影复用紧邻的下层集合，不新建集合或改变已有集合厚度。`}
                      </p>
                    </div>
                  )}
                </div>
                {(currentPreview?.error || importView.error) && (
                  <div className="silhouette-preview-error" role="alert">
                    <p>{currentPreview?.error || importView.error}</p>
                    <button type="button" onClick={() => setPreviewRetry((n) => n + 1)}>
                      <RotateCcw size={14} /> 重试预览
                    </button>
                  </div>
                )}
                <p className="field-note">
                  {!withSilhouette &&
                    `图案${importCollection ? `导入「${importCollection.name}」` : '将放入新建图案集合'}。`}
                  {onlySilhouette ? '剪影使用所选耗材颜色。' : '图案将映射到当前调色盘。'}透明
                  PNG、清晰线稿或 SVG 通常更利落；细小像素不会直接变成可打印细节。
                </p>
              </fieldset>
            </div>
            <div className="dialog-footer">
              <span>PNG · JPG · WEBP · SVG</span>
              <button
                className="primary-button"
                disabled={
                  importing ||
                  previewing ||
                  !!currentPreview?.error ||
                  !!importView.error ||
                  !displayImportResult ||
                  !validImportSize ||
                  (withSilhouette && !validUnderlayThickness)
                }
                onClick={() => void doImport()}
              >
                {importing ? <LoaderCircle size={17} className="spinning" /> : <Plus size={17} />}{' '}
                {importing
                  ? '正在提取轮廓…'
                  : importingBase
                    ? '应用为徽章底板'
                    : withSilhouette
                      ? '添加图案与剪影'
                      : onlySilhouette
                        ? '仅添加剪影'
                        : '添加到当前集合'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function ShapesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="8"
        height="8"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="11" cy="11" r="5" fill="var(--paper)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

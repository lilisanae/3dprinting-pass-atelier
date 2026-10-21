import type { ShapeKind, ShapeAppearance } from './shapeCatalog';
import type { BadgeBase } from './badge';
export type Face = 'front' | 'back';
export type CollectionMode = 'raised' | 'background';
export type Vec2 = [number, number];
export type PaletteColor = { id: string; name: string; hex: string };
export type ColorRegion = { path: string; colorId: string };
export type TextStyle = {
  /** Millimetres per em, retained while content changes (including empty text). */
  textScaleX?: number;
  textScaleY?: number;
  fontId?: string;
  /** Tracking in thousandths of an em, as in common type design tools. */
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right';
};
export type ProjectFont = { id: string; name: string; dataUrl: string };
export type ColorFragmentSelector = { parentKey: string; width: number };
export type ModelColorCorrection = { componentKey: string; fragment?: ColorFragmentSelector } & (
  | { mode?: 'recolor'; colorId: string }
  | { mode: 'remove'; colorId?: never }
);
export type DesignItem = {
  id: string;
  name: string;
  kind: 'shape' | 'text' | 'paths';
  visible: boolean;
  locked?: boolean;
  /** View/edit grouping; physical stacking remains in Collection.items. */
  folderId?: string;
  mirrorX?: boolean;
  mirrorY?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  colorId: string;
  /** Defaults to true. False preserves earlier physical volumes below this item. */
  coversLower?: boolean;
  /** Cuts the entire XY overlap. Missing on legacy coversLower:false means true. */
  avoidsLower?: boolean;
  /** Non-printing tool: cut named artwork; keepInside retains only its footprint. */
  cutout?: { targetIds: string[]; keepInside?: boolean };
  shape?: ShapeKind;
  text?: string;
  regions?: ColorRegion[];
  sourceDataUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
} & TextStyle &
  Partial<ShapeAppearance>;
export type LayerFolder = { id: string; name: string; visible?: boolean; locked?: boolean };
export type Collection = {
  id: string;
  name: string;
  face: Face;
  /** Front defaults to raised; back always stays flush with the board. */
  mode?: CollectionMode;
  visible: boolean;
  locked?: boolean;
  thickness: number;
  /** Back artwork depth in mm; missing in legacy projects means 0.7 mm. */
  inlayDepth?: number;
  items: DesignItem[];
  folders?: LayerFolder[];
};
export type TemplatePlacement = {
  visible: boolean;
  locked?: boolean;
  mirrorX?: boolean;
  mirrorY?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  colorId: string;
};
export type Project = {
  format: 'pass-atelier' | 'badge-atelier';
  version: 1;
  templateVersion: string;
  badgeBase?: BadgeBase;
  name: string;
  palette: PaletteColor[];
  fonts?: ProjectFont[];
  /** Explicit color/removal edits of exact final-volume components; source artwork stays editable. */
  colorCorrections?: ModelColorCorrection[];
  collections: Collection[];
  template: {
    baseColorId: string;
    frontColorId?: string;
    backColorId?: string;
    panelColorId: string;
    panelDetailColorId: string;
    /** Missing in legacy files uses the original frame; null means deleted. */
    panel?: Omit<TemplatePlacement, 'colorId'> | null;
    /** Null means deleted, rather than a hidden placement. */
    label: (TemplatePlacement & TextStyle & { text: string; useOriginal: boolean }) | null;
    decorations: Record<string, TemplatePlacement>;
  };
};
export type TemplateObject = {
  id: string;
  name: string;
  role: 'base' | 'fixed-panel' | 'fixed-detail' | 'editable-label' | 'decoration';
  colorId: string;
  positions: number[];
  indices: number[];
  outlinePath: string;
  bounds: [number, number, number, number, number, number];
  height: number;
};
export type TemplateData = {
  version: string;
  source: string;
  width: number;
  height: number;
  thickness: number;
  panelBounds: [number, number, number, number];
  objects: TemplateObject[];
};
export type Issue = { severity: 'warning' | 'error'; message: string; itemId?: string };
export type MeshPart = {
  name: string;
  colorId: string;
  positions: Float32Array;
  indices: Uint32Array;
  volume: number;
};
export type ColorCandidate = MeshPart & {
  face: Face;
  componentKey: string;
  /** A closed local sub-volume of a larger connected color component. */
  fragment?: ColorFragmentSelector;
  originalColorId: string;
  bounds: [number, number, number, number, number, number];
  area: number;
  corrected: boolean;
  removed: boolean;
  /** Another outward removal affects this component; restore that edit first. */
  removalSourceKey?: string;
  suggestedColorId?: string;
};
export type ColorInspection = {
  threshold: number;
  candidates: ColorCandidate[];
  total: number;
  scannedComponents: number;
  appliedCorrections: number;
  inactiveCorrections: number;
  skippedConnectedComponents?: number;
};
export type GeneratedModel = {
  meshes: MeshPart[];
  issues: Issue[];
  bounds: [number, number, number, number, number, number];
  stats: {
    triangles: number;
    volume: number;
    colors: number;
    frontHeight: number;
    coreThickness: number;
  };
  revision?: number;
  colorInspection?: ColorInspection;
  colorCorrectionStats?: { applied: number; inactive: number };
};
export type ItemSelection = { kind: 'item'; collectionId: string; id: string };
export type Selection =
  | { kind: 'collection'; id: string }
  | ItemSelection
  | {
      kind: 'items';
      items: Array<{ collectionId: string; id: string }>;
      folder?: { collectionId: string; id: string };
    }
  | { kind: 'label' }
  | { kind: 'panel' }
  | { kind: 'decoration'; id: string }
  | null;

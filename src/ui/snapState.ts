import type { SnapBasis, SnapKind, SnapPick } from '../model/snapping';

export type SnapSettings = {
  sourceBasis: SnapBasis;
  sourceKind: SnapKind;
  targetBasis: SnapBasis;
  targetKind: SnapKind;
};
export type SnapPhase = 'idle' | 'source' | 'target';
export type CanvasSnapping = {
  phase: Exclude<SnapPhase, 'idle'>;
  settings: SnapSettings;
  source: SnapPick | null;
  chooseSource: (pick: SnapPick) => void;
  commit: (delta: [number, number]) => void;
};
export const snapKindLabels: Record<SnapKind, string> = {
  vertex: '角点／端点',
  midpoint: '边中点',
  center: '对象中心',
  edge: '边缘／垂足',
  centerline: '水平／竖直中心线',
};

export const defaultSnapSettings: SnapSettings = {
  sourceBasis: 'outline',
  sourceKind: 'vertex',
  targetBasis: 'outline',
  targetKind: 'vertex',
};

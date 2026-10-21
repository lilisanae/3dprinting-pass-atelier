import type { ColorRegion } from '../model/types';

export type ImportQuality = 'fast' | 'balanced' | 'fine';
export type ImportOptions = {
  mode: 'lineart' | 'color';
  threshold: number;
  maxColors: number;
  simplify: number;
  removeBackground: boolean;
  invert?: boolean;
  silhouette?: boolean;
  quality?: ImportQuality;
  lineartBeta?: boolean;
  lineartSmooth?: number;
  lineartMinWidth?: number;
  lineartDespeckle?: number;
};
export type ImportResult = {
  regions: ColorRegion[];
  width: number;
  height: number;
  sourceDataUrl?: string;
  silhouettePath?: string;
  warnings: string[];
};
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

export const defaultImportOptions: ImportOptions = {
  mode: 'color',
  threshold: 170,
  maxColors: 4,
  simplify: 0.7,
  removeBackground: false,
  invert: false,
  silhouette: false,
  quality: 'balanced',
  lineartBeta: false,
  lineartSmooth: 1,
  lineartMinWidth: 0.2,
  lineartDespeckle: 0.01,
};

export function importDimensions(
  width: number,
  height: number,
  quality: ImportQuality = 'balanced',
  vector = false,
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new Error('图片尺寸无效。');
  const longest = quality === 'fast' ? 720 : quality === 'fine' ? 2048 : 1024;
  const scale = vector
    ? longest / Math.max(width, height)
    : Math.min(1, longest / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

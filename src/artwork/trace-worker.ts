import { traceRaster } from './raster-trace';
import type { Raster, ImportOptions } from './import-options';
import type { PaletteColor } from '../model/types';

let source: Raster | undefined;
self.onmessage = ({
  data,
}: MessageEvent<{
  id: number;
  source?: Raster;
  palette: PaletteColor[];
  options: Partial<ImportOptions>;
}>) => {
  try {
    if (data.source) source = data.source;
    if (!source) throw new Error('请重新选择图案文件。');
    self.postMessage({ id: data.id, result: traceRaster(source, data.palette, data.options) });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : '图案描摹失败。',
    });
  }
};

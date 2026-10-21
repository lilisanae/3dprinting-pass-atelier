import type { PaletteColor } from '../model/types';
import type { ImportOptions, ImportResult, Raster } from './import-options';

const cancelled = () => new DOMException('描图已取消。', 'AbortError');
type Pending = { id: number; finish: (error?: Error, result?: ImportResult) => void };

/** One import owns one lazy worker. Cancelling a busy job really stops its CPU work. */
export class TraceSession {
  private worker?: Worker;
  private source?: Raster;
  private pending?: Pending;
  private revision = 0;
  private disposed = false;
  constructor(
    private factory = () =>
      new Worker(new URL('./trace-worker.ts', import.meta.url), { type: 'module' }),
    private timeout = 60_000,
  ) {}
  private stop(error: Error) {
    this.worker?.terminate();
    this.worker = undefined;
    this.source = undefined;
    this.pending?.finish(error);
  }
  trace(
    raster: Raster,
    palette: PaletteColor[],
    options: Partial<ImportOptions>,
    signal?: AbortSignal,
  ) {
    if (this.disposed || signal?.aborted) return Promise.reject(cancelled());
    if (this.pending) this.stop(cancelled());
    return new Promise<ImportResult>((resolve, reject) => {
      const id = ++this.revision;
      const abort = () => this.stop(cancelled());
      const timer = setTimeout(
        () => this.stop(new Error('描图等待过久，请选择均衡精度或提高简化程度后重试。')),
        this.timeout,
      );
      const pending: Pending = {
        id,
        finish: (error, result) => {
          if (this.pending !== pending) return;
          this.pending = undefined;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (error) reject(error);
          else if (result) resolve(result);
          else reject(new Error('描图结果无效。'));
        },
      };
      this.pending = pending;
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const worker = (this.worker ??= this.factory());
        worker.onmessage = ({ data }) => {
          if (this.pending?.id !== data.id) return;
          pending.finish(data.error ? new Error(data.error) : undefined, data.result);
        };
        worker.onerror = () => {
          if (this.worker === worker) this.stop(new Error('后台描图未能完成，请重试。'));
        };
        worker.onmessageerror = () => {
          if (this.worker === worker) this.stop(new Error('描图数据未能读取，请重试。'));
        };
        let source: Raster | undefined;
        if (this.source !== raster)
          source = { width: raster.width, height: raster.height, data: raster.data.slice() };
        worker.postMessage({ id, source, palette, options }, source ? [source.data.buffer] : []);
        this.source = raster;
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error('浏览器无法启动后台描图。'));
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.stop(cancelled());
  }
}

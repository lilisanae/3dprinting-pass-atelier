import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceSession } from '../src/artwork/trace-session';
import { importDimensions } from '../src/artwork/import-options';
import { traceRaster } from '../src/artwork/raster-trace';
import { flattenPath } from '../src/artwork/paths';
import type { ImportResult, Raster } from '../src/artwork/import-options';

const result: ImportResult = { width: 25, height: 25, regions: [], warnings: [] };
const raster: Raster = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
class FakeWorker {
  onmessage?: Worker['onmessage'];
  onerror?: Worker['onerror'];
  onmessageerror?: Worker['onmessageerror'];
  jobs: Array<{ id: number; source?: Raster }> = [];
  stopped = false;
  postMessage(job: { id: number; source?: Raster }) {
    this.jobs.push(job);
  }
  terminate() {
    this.stopped = true;
  }
  finish() {
    this.onmessage?.call(
      this as unknown as Worker,
      { data: { id: this.jobs.at(-1)!.id, result } } as MessageEvent,
    );
  }
}
test('changing trace settings reuses pixels; abort really terminates busy work and late replies cannot win', async () => {
  const workers: FakeWorker[] = [];
  const session = new TraceSession(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const first = session.trace(raster, [], {});
  workers[0].finish();
  assert.equal(await first, result);
  const controller = new AbortController();
  const second = session.trace(raster, [], {}, controller.signal);
  assert.equal(workers[0].jobs[1].source, undefined);
  controller.abort();
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(workers[0].stopped, true);
  assert.equal(raster.data.byteLength, 4);
  const third = session.trace(raster, [], {});
  assert.ok(workers[1].jobs[0].source);
  workers[0].onerror?.call(workers[0] as unknown as Worker, {} as ErrorEvent);
  workers[0].finish();
  assert.equal(workers[1].stopped, false);
  workers[1].finish();
  assert.equal(await third, result);
  session.dispose();
  await assert.rejects(session.trace(raster, [], {}), { name: 'AbortError' });
});
test('a stalled tracing worker is released and the next attempt can recover', async () => {
  const workers: FakeWorker[] = [];
  const session = new TraceSession(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  }, 12);
  await assert.rejects(session.trace(raster, [], {}), /等待过久/);
  assert.equal(workers[0].stopped, true);
  const retry = session.trace(raster, [], {});
  workers[1].finish();
  assert.equal(await retry, result);
  session.dispose();
});
test('detail quality bounds sampling without enlarging small originals or stretching the aspect ratio', () => {
  assert.deepEqual(importDimensions(4096, 2048, 'fast'), { width: 720, height: 360 });
  assert.deepEqual(importDimensions(4096, 2048), { width: 1024, height: 512 });
  assert.deepEqual(importDimensions(4096, 2048, 'fine'), { width: 2048, height: 1024 });
  assert.deepEqual(importDimensions(80, 32, 'fine'), { width: 80, height: 32 });
  assert.deepEqual(importDimensions(80, 32, 'fine', true), { width: 2048, height: 819 });
  assert.throws(() => importDimensions(NaN, 8));
});
test('fine sampling keeps a one-pixel source line that coarse area sampling loses; high-resolution contours retain holes', () => {
  const palette = [{ id: 'black', name: '黑', hex: '#000000' }];
  const sampledLine = (width: number) => {
    const data = new Uint8ClampedArray(width * 16 * 4).fill(255);
    const shade = Math.round(255 * (1 - width / 4096));
    for (let y = 2; y < 14; y++)
      for (let k = 0; k < 3; k++) data[(y * width + width / 2) * 4 + k] = shade;
    return { width, height: 16, data };
  };
  assert.equal(traceRaster(sampledLine(720), palette, { mode: 'lineart' }).regions.length, 0);
  assert.equal(traceRaster(sampledLine(2048), palette, { mode: 'lineart' }).regions.length, 1);
  const width = 1200,
    data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        d = Math.hypot(x - 600, y - 600);
      data[i] = data[i + 1] = data[i + 2] = d >= 230 && d < 450 ? 0 : 255;
      data[i + 3] = 255;
    }
  const traced = traceRaster({ width, height: width, data }, palette, {
    mode: 'lineart',
    silhouette: true,
    simplify: 0.7,
  });
  assert.equal(flattenPath(traced.regions[0].path).length, 2);
  assert.equal(flattenPath(traced.silhouettePath!).length, 1);
  const area = (path: string) =>
    flattenPath(path, 0.002).reduce(
      (sum, p) =>
        sum +
        p.reduce((a, v, i) => {
          const q = p[(i + 1) % p.length];
          return a + v[0] * q[1] - q[0] * v[1];
        }, 0) /
          2,
      0,
    );
  const expected = Math.PI * (450 ** 2 - 230 ** 2) * (25 / width) ** 2;
  assert.ok(Math.abs(Math.abs(area(traced.regions[0].path)) - expected) / expected < 0.006);
});

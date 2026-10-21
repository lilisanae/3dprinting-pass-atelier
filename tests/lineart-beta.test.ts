import test from 'node:test';
import assert from 'node:assert/strict';
import { processLineartBeta } from '../src/artwork/lineart-beta';
import { traceRaster } from '../src/artwork/raster-trace';
import { flattenPath } from '../src/artwork/paths';
import type { Raster } from '../src/artwork/import-options';
const palette = [{ id: 'black', name: 'Black', hex: '#000000' }];
const raster = (width: number, height: number, ink: (x: number, y: number) => boolean): Raster => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = ink(x, y) ? 255 : 0;
  return { width, height, data };
};
const pixel = (image: Raster, x: number, y: number) =>
  image.data[(y * image.width + x) * 4 + 3] > 0;
test('beta disabled, zero controls, and color mode preserve existing tracing and source pixels', () => {
  const source = raster(100, 100, (x, y) => x >= 20 && x < 70 && y >= 20 && y < 70);
  const before = source.data.slice();
  const normal = traceRaster(source, palette, { mode: 'lineart' });
  assert.deepEqual(
    traceRaster(source, palette, {
      mode: 'lineart',
      lineartBeta: false,
      lineartSmooth: 3,
      lineartMinWidth: 0.6,
      lineartDespeckle: 0.1,
    }),
    normal,
  );
  assert.deepEqual(
    traceRaster(source, palette, {
      mode: 'lineart',
      lineartBeta: true,
      lineartSmooth: 0,
      lineartMinWidth: 0,
      lineartDespeckle: 0,
    }),
    normal,
  );
  assert.deepEqual(
    traceRaster(source, palette, { mode: 'color', lineartBeta: true }),
    traceRaster(source, palette, { mode: 'color' }),
  );
  assert.deepEqual(source.data, before);
});
test('scatter cleaning preserves connected thin strokes, diagonal components, and enclosed holes', () => {
  const image = raster(
    160,
    160,
    (x, y) =>
      (x >= 20 && x < 70 && y >= 20 && y < 70 && !(x >= 30 && x < 60 && y >= 30 && y < 60)) ||
      (x === 90 && y >= 20 && y < 70) ||
      (x === 110 && y === 110) ||
      (x >= 120 && x < 124 && y === x),
  );
  assert.equal(processLineartBeta(image, 16, 0, 0.04), 1);
  assert.equal(pixel(image, 110, 110), false);
  assert.equal(pixel(image, 90, 35), true);
  assert.equal(pixel(image, 122, 122), true);
  assert.equal(pixel(image, 45, 45), false);
});
test('thin strokes grow toward the target while existing thick strokes keep their boundaries', () => {
  const image = raster(
    180,
    160,
    (x, y) => (x === 40 && y >= 20 && y < 130) || (x >= 110 && x < 126 && y >= 20 && y < 130),
  );
  const before = image.data.slice();
  processLineartBeta(image, 18, 0.6, 0);
  const thinWidth = Array.from({ length: 80 }, (_, x) => Number(pixel(image, x, 75))).reduce(
    (a, b) => a + b,
    0,
  );
  assert.ok(thinWidth >= 6 && thinWidth <= 8, String(thinWidth));
  for (let y = 0; y < image.height; y++)
    for (let x = 90; x < image.width; x++)
      assert.equal(
        image.data[(y * image.width + x) * 4 + 3],
        before[(y * image.width + x) * 4 + 3],
      );
});
test('curve smoothing changes jagged contours while preserving holes and silhouette winding', () => {
  const source = raster(160, 160, (x, y) => {
    const r = Math.hypot(x - 80, y - 80);
    return r > 28 && r < 60;
  });
  const normal = traceRaster(source, palette, { mode: 'lineart', silhouette: true });
  const smooth = traceRaster(source, palette, {
    mode: 'lineart',
    silhouette: true,
    lineartBeta: true,
    lineartSmooth: 3,
    lineartMinWidth: 0,
    lineartDespeckle: 0,
  });
  assert.notEqual(smooth.regions[0].path, normal.regions[0].path);
  assert.ok(smooth.regions[0].path.includes('Q'));
  const contours = flattenPath(smooth.regions[0].path, 0.002);
  assert.equal(contours.length, 2);
  assert.equal(flattenPath(smooth.silhouettePath!).length, 1);
  assert.ok(contours.flat(2).every(Number.isFinite));
  const area = (path: string) =>
    Math.abs(
      flattenPath(path, 0.002).reduce(
        (total, p) =>
          total +
          p.reduce((sum, a, i) => {
            const b = p[(i + 1) % p.length];
            return sum + a[0] * b[1] - b[0] * a[1];
          }, 0) /
            2,
        0,
      ),
    );
  assert.ok(
    Math.abs(area(smooth.regions[0].path) - area(normal.regions[0].path)) /
      area(normal.regions[0].path) <
      0.02,
  );
});
test('combined processing removes speckles before reinforcement and rejects nonfinite control values safely', () => {
  const source = raster(
    256,
    256,
    (x, y) => (x === 80 && y >= 30 && y < 200) || (x === 200 && y === 200),
  );
  const result = traceRaster(source, palette, {
    mode: 'lineart',
    lineartBeta: true,
    lineartSmooth: 1,
    lineartMinWidth: 0.2,
    lineartDespeckle: 0.02,
  });
  assert.equal(flattenPath(result.regions[0].path).length, 1);
  assert.ok(result.warnings.some((text) => text.includes('1 处独立散点')));
  const invalid = traceRaster(source, palette, {
    mode: 'lineart',
    lineartBeta: true,
    lineartSmooth: NaN,
    lineartMinWidth: Infinity,
    lineartDespeckle: -1,
  });
  assert.ok(
    invalid.regions.length && invalid.regions.every((region) => !region.path.includes('NaN')),
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { flattenPath, itemPath, placementTransform } from '../src/artwork/paths';
import { removeConnectedBackground, traceRaster } from '../src/artwork/raster-trace';
import { validateSvgSource } from '../src/artwork/import';
import type { DesignItem, PaletteColor } from '../src/model/types';

const fontBytes = readFileSync(new URL('../resources/fonts/NotoSansSC-Bold.otf', import.meta.url));
const font = opentype.parse(
  fontBytes.buffer.slice(
    fontBytes.byteOffset,
    fontBytes.byteOffset + fontBytes.byteLength,
  ) as ArrayBuffer,
);
const signedArea = (points: number[][]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
const bounds = (contours: number[][][]) => {
  const points = contours.flat();
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
};
const palette: PaletteColor[] = [
  { id: 'black', name: '黑', hex: '#000000' },
  { id: 'white', name: '白', hex: '#ffffff' },
  { id: 'red', name: '红', hex: '#ff0000' },
];
const design = (extra: Partial<DesignItem>): DesignItem => ({
  id: 'test',
  name: '测试',
  kind: 'shape',
  shape: 'rect',
  visible: true,
  x: 0,
  y: 0,
  width: 20,
  height: 10,
  rotation: 0,
  colorId: 'black',
  ...extra,
});
const raster = (width: number, height: number, color: (x: number, y: number) => number[]) => ({
  width,
  height,
  data: new Uint8ClampedArray(
    Array.from({ length: width * height }, (_, i) =>
      color(i % width, Math.floor(i / width)),
    ).flat(),
  ),
});

test('closed contours retain winding and open / zero-area subpaths are rejected', () => {
  const contours = flattenPath('M0 0H10V10H0Z M2 2V8H8V2Z M12 0L14 0L14 2 M20 0L21 0L22 0Z');
  assert.equal(contours.length, 2);
  assert.equal(signedArea(contours[0]), 100);
  assert.equal(signedArea(contours[1]), -36);
  assert.equal(contours[0].length, 4);
});

test('SVG arcs, relative commands and reflected curve controls produce finite contours', () => {
  const circle = flattenPath('M0 10a10 10 0 1 0 20 0a10 10 0 1 0-20 0z', 0.005);
  assert.ok(Math.abs(Math.abs(signedArea(circle[0])) - Math.PI * 100) < 0.3);
  const curves = flattenPath('m0 0 c0 10 10 10 10 0 s10-10 10 0 q5 10 10 0 t10 0 v20 h-40 z', 0.01);
  assert.equal(curves.length, 1);
  assert.ok(curves[0].length > 40);
  assert.ok(curves.flat(2).every(Number.isFinite));
});

test('placement uses the already-scaled local width and height once', () => {
  const transformed = placementTransform(
    [
      [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
    ],
    { x: 30, y: 50, width: 20, height: 10, rotation: 90 },
  );
  const actual = bounds(transformed);
  const expected = [35, 45, 45, 65];
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-8));
});

test('each shape stays within its declared local millimetre bounds', () => {
  for (const shape of ['rect', 'circle', 'triangle', 'star', 'heart', 'arrow', 'stripe'] as const) {
    const contours = flattenPath(itemPath(design({ shape }), font), 0.01);
    assert.ok(contours.length, shape);
    const b = bounds(contours);
    assert.ok(
      Math.abs(b[0]) < 0.03 &&
        Math.abs(b[1]) < 0.03 &&
        Math.abs(b[2] - 20) < 0.03 &&
        Math.abs(b[3] - 10) < 0.03,
      `${shape}: ${b}`,
    );
  }
});

test('Chinese CFF font and mixed multiline text produce real bounded outlines', () => {
  assert.ok(font.charToGlyph('你').index > 0);
  assert.ok(font.charToGlyph('小').index > 0);
  const path = itemPath(design({ kind: 'text', text: '小G\n你好', width: 25, height: 12 }), font),
    contours = flattenPath(path, 0.01);
  assert.ok(contours.length > 8);
  const b = bounds(contours);
  assert.ok(
    Math.abs(b[0]) < 0.02 &&
      Math.abs(b[1]) < 0.02 &&
      Math.abs(b[2] - 25) < 0.02 &&
      Math.abs(b[3] - 12) < 0.02,
  );
  assert.equal(itemPath(design({ kind: 'text', text: ' \n ' }), font), '');
});

test('single-region paths resize against shared source dimensions without losing their offset', () => {
  const item = design({
    kind: 'paths',
    width: 40,
    height: 10,
    sourceWidth: 20,
    sourceHeight: 20,
    regions: [{ colorId: 'black', path: 'M5 4H10V8H5Z M6 5V7H9V5Z' }],
  });
  const contours = flattenPath(itemPath(item, font));
  assert.deepEqual(bounds(contours), [10, 2, 20, 4]);
  assert.ok(signedArea(contours[0]) * signedArea(contours[1]) < 0);
});

test('connected background removal preserves enclosed white artwork', () => {
  const image = raster(9, 9, (x, y) =>
    x >= 2 && x <= 6 && y >= 2 && y <= 6 && (x === 2 || x === 6 || y === 2 || y === 6)
      ? [0, 0, 0, 255]
      : [255, 255, 255, 255],
  );
  const result = removeConnectedBackground(image);
  assert.equal(result.removed, 56);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[(4 * 9 + 4) * 4 + 3], 255);
  const traced = traceRaster(
    raster(9, 9, (x, y) =>
      x >= 2 && x <= 6 && y >= 2 && y <= 6 && (x === 2 || x === 6 || y === 2 || y === 6)
        ? [0, 0, 0, 255]
        : [255, 255, 255, 255],
    ),
    palette,
    { removeBackground: true, maxColors: 2, simplify: 0 },
  );
  assert.deepEqual(new Set(traced.regions.map((r) => r.colorId)), new Set(['black', 'white']));
});

test('lineart tracing preserves donut holes and maps opaque regions to a palette color', () => {
  const image = raster(24, 24, (x, y) =>
    x >= 3 && x <= 20 && y >= 3 && y <= 20 && !(x >= 8 && x <= 15 && y >= 8 && y <= 15)
      ? [0, 0, 0, 255]
      : [255, 255, 255, 255],
  );
  const result = traceRaster(image, palette, { mode: 'lineart', threshold: 150, simplify: 0 });
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].colorId, 'black');
  const contours = flattenPath(result.regions[0].path);
  assert.equal(contours.length, 2);
  assert.ok(signedArea(contours[0]) * signedArea(contours[1]) < 0);
  assert.equal(result.width, 25);
  assert.equal(result.height, 25);
});

test('canvas-style ImageData getter dimensions survive raster tracing', () => {
  class CanvasImageData {
    data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    get width() {
      return 2;
    }
    get height() {
      return 2;
    }
  }
  const result = traceRaster(new CanvasImageData(), palette, { maxColors: 2, simplify: 0 });
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].colorId, 'red');
  assert.equal(result.width, 25);
  assert.equal(result.height, 25);
});

test('source color regions stay independently remappable when they initially match the same palette color', () => {
  const image = raster(24, 12, (x) => (x < 12 ? [180, 16, 16, 255] : [16, 16, 180, 255]));
  const result = traceRaster(image, palette.slice(0, 2), {
    mode: 'color',
    maxColors: 2,
    simplify: 0,
  });
  assert.equal(result.regions.length, 2);
  assert.equal(result.regions[0].colorId, 'black');
  assert.equal(result.regions[1].colorId, 'black');
  assert.notEqual(result.regions[0].path, result.regions[1].path);
});

test('SVG input rejects active content and external resources, accepts common static transforms', () => {
  assert.doesNotThrow(() =>
    validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="a" d="M0 0H1V1Z"/></defs><g transform="translate(2 3) scale(2) rotate(15)"><use href="#a" fill="url(#gradient)"/><circle cx="4" cy="4" r="2" stroke="red"/></g></svg>',
    ),
  );
  for (const content of [
    '<script>alert(1)</script>',
    '<foreignObject><div/></foreignObject>',
    '<path onload="alert(1)"/>',
    '<image href="https://example.com/a.png"/>',
    '<use href="javascript:alert(1)"/>',
    '<use href="&#x6a;avascript:alert(1)"/>',
    '<style>@import "https://example.com/a.css";</style>',
    '<rect fill="url(https://example.com/a.svg#x)"/>',
    '<g xml:base="https://example.com/"/>',
    '<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///test">]>',
  ]) {
    assert.throws(() => validateSvgSource(`<svg>${content}</svg>`), content);
  }
});

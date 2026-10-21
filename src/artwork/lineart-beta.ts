import type { Raster } from './import-options';

/** Exact squared Euclidean distance, with a one-pixel background frame. */
function distances(mask: Uint8Array, width: number, height: number, target: number) {
  const w = width + 2,
    h = height + 2,
    far = 1e12;
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const value = x && y && x < w - 1 && y < h - 1 ? mask[(y - 1) * width + x - 1] : 0;
      field[y * w + x] = value === target ? 0 : far;
    }
  const n = Math.max(w, h),
    f = new Float64Array(n),
    d = new Float64Array(n),
    sites = new Int32Array(n),
    cuts = new Float64Array(n + 1);
  const line = (length: number) => {
    let k = 0;
    sites[0] = 0;
    cuts[0] = -Infinity;
    cuts[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s = (f[q] + q * q - (f[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
      while (s <= cuts[k]) {
        k--;
        s = (f[q] + q * q - (f[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
      }
      sites[++k] = q;
      cuts[k] = s;
      cuts[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (cuts[k + 1] < q) k++;
      d[q] = (q - sites[k]) ** 2 + f[sites[k]];
    }
  };
  for (let y = 0; y < h; y++) {
    f.set(field.subarray(y * w, (y + 1) * w));
    line(w);
    for (let x = 0; x < w; x++) field[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = field[y * w + x];
    line(h);
    for (let y = 0; y < h; y++) field[y * w + x] = d[y];
  }
  return field;
}

/** Only isolated foreground components are removed; interior holes are never filled. */
function removeSpeckles(mask: Uint8Array, width: number, height: number, limit: number) {
  if (limit <= 1) return 0;
  const queue = new Uint32Array(mask.length);
  let removed = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    let head = 0,
      tail = 1;
    queue[0] = i;
    mask[i] = 2;
    while (head < tail) {
      const at = queue[head++],
        x = at % width,
        y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] === 1) {
            mask[next] = 2;
            queue[tail++] = next;
          }
        }
    }
    const discard = tail < limit;
    if (discard) removed++;
    for (let j = 0; j < tail; j++) mask[queue[j]] = discard ? 0 : 3;
  }
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 1 : 0;
  return removed;
}

/** Reinforce thin medial ridges, preserving the boundaries of already-wide strokes. */
function reinforce(mask: Uint8Array, width: number, height: number, minimumPixels: number) {
  if (minimumPixels <= 1) return;
  const inside = distances(mask, width, height, 0),
    w = width + 2;
  const seeds = new Uint8Array(mask.length);
  let count = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        at = (y + 1) * w + x + 1,
        radius = inside[at];
      if (!mask[i] || 2 * Math.sqrt(radius) - 1 >= minimumPixels) continue;
      let ridge = true;
      for (let dy = -1; dy <= 1 && ridge; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inside[at + dy * w + dx] > radius) {
            ridge = false;
            break;
          }
      if (ridge) {
        seeds[i] = 1;
        count++;
      }
    }
  if (!count) return;
  const near = distances(seeds, width, height, 1);
  const radiusSquared = ((minimumPixels + 1) / 2) ** 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (near[(y + 1) * w + x + 1] <= radiusSquared) mask[y * width + x] = 1;
}

/** The input is already thresholded. Edits affect only this fresh tracing raster. */
export function processLineartBeta(
  image: Raster,
  physicalWidth: number,
  minimumWidth: number,
  speckleArea: number,
) {
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i++) mask[i] = image.data[i * 4 + 3] >= 128 ? 1 : 0;
  const mmPerPixel = physicalWidth / image.width;
  const removed = removeSpeckles(mask, image.width, image.height, speckleArea / mmPerPixel ** 2);
  reinforce(mask, image.width, image.height, minimumWidth / mmPerPixel);
  for (let i = 0; i < mask.length; i++) image.data[i * 4 + 3] = mask[i] ? 255 : 0;
  return removed;
}

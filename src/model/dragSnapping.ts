import type { SnapPoint, SnapShape } from './snapping';

export type DragAxis = 'x' | 'y' | null;
type Anchor = { value: number; span: [number, number] };
type References = { points: SnapPoint[]; x: Anchor[]; y: Anchor[] };
export type DragSnapScene = { source: References; target: References };
export type DragGuide =
  | { point: SnapPoint }
  | { axis: 'x' | 'y'; value: number; span: [number, number] };

/** Lock the dominant direction once per Shift hold, ignoring click jitter. */
export function dragAxis(
  delta: SnapPoint,
  shift: boolean,
  previous: DragAxis,
  threshold: number,
): DragAxis {
  if (!shift) return null;
  if (previous) return previous;
  if (Math.hypot(...delta) < threshold) return null;
  return Math.abs(delta[0]) >= Math.abs(delta[1]) ? 'x' : 'y';
}

function references(shapes: SnapShape[]): References {
  const result: References = { points: [], x: [], y: [] };
  for (const shape of shapes) {
    const corners = shape.boundsContour;
    if (!corners.length) continue;
    const xs = corners.map((p) => p[0]),
      ys = corners.map((p) => p[1]);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      top = Math.min(...ys),
      bottom = Math.max(...ys);
    result.points.push(
      shape.center,
      ...corners,
      ...corners.map((p, i): SnapPoint => {
        const next = corners[(i + 1) % corners.length];
        return [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2];
      }),
    );
    // Center first gives a stable preference when distances tie.
    for (const value of [shape.center[0], left, right])
      result.x.push({ value, span: [top, bottom] });
    for (const value of [shape.center[1], top, bottom])
      result.y.push({ value, span: [left, right] });
  }
  return result;
}

/** Capture references once at pointer-down; pointer moves never parse fonts/paths. */
export function makeDragSnapScene(
  shapes: SnapShape[],
  movingKeys: Set<string>,
  copies = false,
): DragSnapScene {
  const moving = shapes.filter((shape) => movingKeys.has(shape.key));
  const source = references(moving);
  if (moving.length > 1) {
    const corners = moving.flatMap((shape) => shape.boundsContour);
    const left = Math.min(...corners.map((p) => p[0])),
      right = Math.max(...corners.map((p) => p[0]));
    const top = Math.min(...corners.map((p) => p[1])),
      bottom = Math.max(...corners.map((p) => p[1]));
    const group = references([
      {
        key: 'group',
        name: '',
        selection: null,
        contours: [],
        center: [(left + right) / 2, (top + bottom) / 2],
        boundsContour: [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ],
      },
    ]);
    source.points.unshift(...group.points);
    source.x.unshift(...group.x);
    source.y.unshift(...group.y);
  }
  const target = references(shapes.filter((shape) => copies || !movingKeys.has(shape.key)));
  target.points.sort((a, b) => a[0] - b[0]);
  target.x.sort((a, b) => a.value - b.value);
  target.y.sort((a, b) => a.value - b.value);
  return { source, target };
}

function lowerBound<T>(list: T[], value: number, coordinate: (entry: T) => number): number {
  let low = 0,
    high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (coordinate(list[mid]) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** One shared translation preserves all selected objects' relative positions. */
export function resolveDragSnap(
  scene: DragSnapScene,
  raw: SnapPoint,
  tolerance: number,
  axis: DragAxis = null,
  bypass = false,
): { delta: SnapPoint; guides: DragGuide[] } {
  const delta: SnapPoint = [axis === 'y' ? 0 : raw[0], axis === 'x' ? 0 : raw[1]];
  if (bypass || tolerance <= 0) return { delta, guides: [] };
  let nearest: { correction: SnapPoint; point: SnapPoint } | null = null;
  let distance = tolerance * tolerance;
  for (const source of scene.source.points) {
    const x = source[0] + delta[0],
      y = source[1] + delta[1];
    const index = lowerBound(scene.target.points, x - tolerance, (p) => p[0]);
    for (
      let i = index;
      i < scene.target.points.length && scene.target.points[i][0] <= x + tolerance;
      i++
    ) {
      const target = scene.target.points[i];
      const correction: SnapPoint = [target[0] - x, target[1] - y];
      if (
        (axis === 'x' && Math.abs(correction[1]) > 1e-8) ||
        (axis === 'y' && Math.abs(correction[0]) > 1e-8)
      )
        continue;
      const next = correction[0] ** 2 + correction[1] ** 2;
      if (next <= distance && (!nearest || next < distance)) {
        distance = next;
        nearest = { correction, point: target };
      }
    }
  }
  if (nearest)
    return {
      delta: [
        delta[0] + (axis === 'y' ? 0 : nearest.correction[0]),
        delta[1] + (axis === 'x' ? 0 : nearest.correction[1]),
      ],
      guides: [{ point: nearest.point }],
    };
  const matches: Array<{ axis: 'x' | 'y'; source: Anchor; target: Anchor }> = [];
  for (const direction of ['x', 'y'] as const) {
    if (axis && direction !== axis) continue;
    const coordinate = direction === 'x' ? 0 : 1;
    let match: { source: Anchor; target: Anchor; correction: number } | null = null;
    let closest = tolerance;
    for (const source of scene.source[direction]) {
      const value = source.value + delta[coordinate],
        targets = scene.target[direction];
      const index = lowerBound(targets, value, (a) => a.value);
      for (const i of [index - 1, index]) {
        const target = targets[i];
        if (!target) continue;
        const correction = target.value - value;
        if (Math.abs(correction) <= closest && (!match || Math.abs(correction) < closest)) {
          closest = Math.abs(correction);
          match = { source, target, correction };
        }
      }
    }
    if (match) {
      delta[coordinate] += match.correction;
      matches.push({ axis: direction, source: match.source, target: match.target });
    }
  }
  return {
    delta,
    guides: matches.map(({ axis, source, target }) => {
      const other = axis === 'x' ? 1 : 0;
      return {
        axis,
        value: target.value,
        span: [
          Math.min(source.span[0] + delta[other], target.span[0]),
          Math.max(source.span[1] + delta[other], target.span[1]),
        ],
      };
    }),
  };
}

/** View scale only; artwork dimensions and saved project data are unchanged. */
export const canvasZoomLimits = { min: 0.1, max: 20 } as const;

function clampCanvasZoom(zoom: number): number {
  return Math.min(canvasZoomLimits.max, Math.max(canvasZoomLimits.min, zoom));
}

export function stepCanvasZoom(zoom: number, direction: 1 | -1): number {
  return clampCanvasZoom(zoom * 1.2 ** direction);
}

export function wheelCanvasZoom(zoom: number, deltaY: number, deltaMode: number): number {
  // Normalize line/page events; small touchpad deltas stay smooth at every scale.
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  const delta = Math.max(-240, Math.min(240, pixels));
  return clampCanvasZoom(zoom * Math.exp(-delta * 0.0015));
}

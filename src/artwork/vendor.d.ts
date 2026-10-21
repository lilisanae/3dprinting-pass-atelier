declare module 'svg-path-parser' {
  export type SVGCommand = {
    code: string;
    command: string;
    relative?: boolean;
    x?: number;
    y?: number;
    x0?: number;
    y0?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    rx?: number;
    ry?: number;
    xAxisRotation?: number;
    largeArc?: boolean;
    sweep?: boolean;
  };
  function parseSVG(path: string): SVGCommand[];
  namespace parseSVG {
    function makeAbsolute(commands: SVGCommand[]): SVGCommand[];
  }
  export default parseSVG;
}

declare module 'imagetracerjs' {
  export type TraceColor = { r: number; g: number; b: number; a: number };
  export type TracePath = {
    segments: Array<{
      type: 'L' | 'Q';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3?: number;
      y3?: number;
    }>;
    holechildren: number[];
    isholepath: boolean;
  };
  export type TraceData = {
    width: number;
    height: number;
    palette: TraceColor[];
    layers: TracePath[][];
  };
  export type TraceOptions = Record<string, number | boolean | TraceColor[]>;
  export type TraceNodes = {
    points: Array<{ x: number; y: number; linesegment: number }>;
  };
  const ImageTracer: {
    imagedataToTracedata(
      image: { width: number; height: number; data: Uint8ClampedArray },
      options?: TraceOptions,
    ): TraceData;
    svgpathstring(data: TraceData, layer: number, path: number, options: TraceOptions): string;
    checkoptions(options: TraceOptions): TraceOptions;
    pathscan(nodes: Uint8Array[], omit: number): unknown[];
    internodes(paths: unknown[], options: TraceOptions): TraceNodes[];
    getdirection(x1: number, y1: number, x2: number, y2: number): number;
    batchtracepaths(nodes: unknown[], lineError: number, curveError: number): TracePath[];
  };
  export default ImageTracer;
}

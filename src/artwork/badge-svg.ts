import { sanitizeSvgSource } from './import';
import { flattenPath } from './paths';
import type { BadgeVectorShape } from '../model/badge';
import type { Vec2 } from '../model/types';

/** Read actual vector fills and transforms. No raster tracing or external resources. */
export async function readBadgeSvg(file: File): Promise<BadgeVectorShape[]> {
  if (file.size > 2_000_000) throw new Error('底板 SVG 请控制在 2 MB 以内。');
  const { source } = sanitizeSvgSource(await file.text());
  const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
  if (root.querySelector('image,text,tspan,use,mask,clipPath,filter,pattern'))
    throw new Error('请先将文字、描边和裁切效果转换成填充路径，再导入底板 SVG。');
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;pointer-events:none;width:1000px;height:1000px';
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  svg.style.width = '1000px';
  svg.style.height = '1000px';
  host.append(svg);
  document.body.append(host);
  try {
    const shapes: BadgeVectorShape[] = [];
    for (const element of svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline')) {
      if (element.closest('defs')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        continue;
      let hidden = false;
      for (
        let parent = element.parentElement;
        parent && host.contains(parent);
        parent = parent.parentElement
      ) {
        const inherited = getComputedStyle(parent);
        if (
          inherited.display === 'none' ||
          inherited.visibility === 'hidden' ||
          Number(inherited.opacity) === 0
        ) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      if (style.stroke !== 'none' && Number.parseFloat(style.strokeWidth) > 0)
        throw new Error('SVG 含有描边，请先将描边转换成填充路径。');
      if (style.fill === 'none' || Number(style.fillOpacity) === 0) continue;
      const geometry = element as SVGGeometryElement,
        matrix = geometry.getCTM();
      if (!matrix) continue;
      const transform = ([x, y]: number[]): Vec2 => {
        const p = new DOMPoint(x, y).matrixTransform(matrix);
        return [p.x, p.y];
      };
      let contours: Vec2[][];
      const lengthScale = Math.max(
        Math.hypot(matrix.a, matrix.b),
        Math.hypot(matrix.c, matrix.d),
        0.000001,
      );
      if (element.localName === 'path')
        contours = flattenPath(element.getAttribute('d') ?? '', 0.2 / lengthScale).map((c) =>
          c.map(transform),
        );
      else if (element.localName === 'rect') {
        const r = element as SVGRectElement,
          x = r.x.baseVal.value,
          y = r.y.baseVal.value,
          w = r.width.baseVal.value,
          h = r.height.baseVal.value;
        const rx = Math.min(w / 2, r.rx.baseVal.value || r.ry.baseVal.value),
          ry = Math.min(h / 2, r.ry.baseVal.value || r.rx.baseVal.value);
        const path =
          rx && ry
            ? `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
            : `M${x},${y}H${x + w}V${y + h}H${x}Z`;
        contours = flattenPath(path, 0.2 / lengthScale).map((c) => c.map(transform));
      } else if (element.localName === 'polygon' || element.localName === 'polyline') {
        const points = (element as SVGPolygonElement).points;
        contours = [
          Array.from({ length: points.numberOfItems }, (_, i) => {
            const p = points.getItem(i);
            return transform([p.x, p.y]);
          }),
        ];
      } else {
        const length = geometry.getTotalLength(),
          count = Math.min(384, Math.max(32, Math.ceil((length * lengthScale) / 5)));
        const contour = Array.from({ length: count }, (_, i) => {
          const p = geometry.getPointAtLength((i * length) / count);
          return transform([p.x, p.y]);
        });
        contours = [contour];
      }
      contours = contours.filter((c) => c.length >= 3);
      if (contours.some((c) => c.some((p) => !p.every(Number.isFinite))))
        throw new Error('SVG 轮廓含有无效坐标。');
      if (contours.length)
        shapes.push({ contours, fillRule: style.fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero' });
    }
    if (!shapes.length) throw new Error('SVG 没有可用的填充轮廓。');
    return shapes;
  } finally {
    host.remove();
  }
}

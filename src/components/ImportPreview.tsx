import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Position = { x: number; y: number; zoom: number };
const start: Position = { x: 0, y: 0, zoom: 1 };
export default function ImportPreview({
  children,
  caption,
  overlay,
}: {
  children: ReactNode;
  caption: string;
  overlay?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const current = useRef(start);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [position, setPosition] = useState(start);
  const vector =
    isValidElement<{ viewBox?: string }>(children) && children.type === 'svg'
      ? children
      : undefined;
  const box = vector?.props.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  let preview = children;
  if (
    vector &&
    box?.length === 4 &&
    box.every(Number.isFinite) &&
    box[2] > 0 &&
    box[3] > 0 &&
    size.width > 0 &&
    size.height > 0
  ) {
    const scale = Math.min(size.width / box[2], size.height / box[3]) * position.zoom;
    const width = size.width / scale,
      height = size.height / scale;
    const x = box[0] + box[2] / 2 - position.x / scale - width / 2;
    const y = box[1] + box[3] / 2 - position.y / scale - height / 2;
    // Change the SVG camera instead of magnifying a cached compositor bitmap.
    preview = cloneElement(vector, { viewBox: `${x} ${y} ${width} ${height}` });
  }
  const update = (value: Position) => {
    current.current = value;
    setPosition(value);
  };
  const zoom = (factor: number, x = 0, y = 0) => {
    const old = current.current;
    const next = Math.min(12, Math.max(0.5, old.zoom * factor));
    const ratio = next / old.zoom;
    update({ zoom: next, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio });
  };
  useEffect(() => {
    const element = content.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = container.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(
        Math.exp(-delta * 0.0015),
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return (
    <div
      className="import-preview"
      ref={container}
      tabIndex={0}
      aria-label="图案预览：滚轮缩放，拖动查看；手机可双指缩放"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('.import-preview-tools')) return;
        if (event.key === '+' || event.key === '=') zoom(1.25);
        else if (event.key === '-') zoom(0.8);
        else if (event.key === '0') update(start);
        else if (event.key.startsWith('Arrow')) {
          update({
            ...current.current,
            x:
              current.current.x +
              (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0),
            y:
              current.current.y +
              (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0),
          });
        } else return;
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('.import-preview-tools'))
          return;
        event.preventDefault();
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        const previous = [...pointers.current.values()].slice(0, 2);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = [...pointers.current.values()].slice(0, 2);
        const old = current.current;
        if (next.length === 1)
          update({
            ...old,
            x: old.x + next[0].x - previous[0].x,
            y: old.y + next[0].y - previous[0].y,
          });
        else {
          const distance = (p: typeof next) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          const rect = event.currentTarget.getBoundingClientRect();
          const before = {
            x: (previous[0].x + previous[1].x) / 2 - rect.left - rect.width / 2,
            y: (previous[0].y + previous[1].y) / 2 - rect.top - rect.height / 2,
          };
          const after = {
            x: (next[0].x + next[1].x) / 2 - rect.left - rect.width / 2,
            y: (next[0].y + next[1].y) / 2 - rect.top - rect.height / 2,
          };
          const scale = Math.min(
            12,
            Math.max(0.5, (old.zoom * distance(next)) / Math.max(1, distance(previous))),
          );
          update({
            zoom: scale,
            x: after.x - ((before.x - old.x) * scale) / old.zoom,
            y: after.y - ((before.y - old.y) * scale) / old.zoom,
          });
        }
      }}
      onPointerUp={(event) => pointers.current.delete(event.pointerId)}
      onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
      onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
    >
      <div
        className="import-preview-content"
        ref={content}
        style={
          vector
            ? undefined
            : { transform: `translate(${position.x}px, ${position.y}px) scale(${position.zoom})` }
        }
      >
        {preview}
      </div>
      {overlay}
      <div className="import-preview-tools" aria-label="预览缩放">
        <button type="button" onClick={() => zoom(0.8)} aria-label="缩小预览">
          −
        </button>
        <span>{Math.round(position.zoom * 100)}%</span>
        <button type="button" onClick={() => zoom(1.25)} aria-label="放大预览">
          ＋
        </button>
        <button type="button" onClick={() => update(start)} aria-label="复位预览">
          复位
        </button>
      </div>
      <span>{caption}</span>
    </div>
  );
}

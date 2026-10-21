import AppearancePath from './AppearancePath';
import { outlineDistances } from '../model/shapeCatalog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { itemPath } from '../artwork/paths';
import {
  shapeCatalog,
  shapeGroups,
  shapeDimensions,
  type ShapeAppearance,
  type ShapeKind,
} from '../model/shapeCatalog';
import type { DesignItem } from '../model/types';
import ShapeAppearanceControls from './ShapeAppearanceControls';

const thumbnails = new Map<ShapeKind, { path: string; width: number; height: number }>();
function thumbnail(kind: ShapeKind) {
  let preview = thumbnails.get(kind);
  if (!preview) {
    const [width, height] = shapeDimensions(kind);
    const item: DesignItem = {
      id: kind,
      name: kind,
      kind: 'shape',
      shape: kind,
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      colorId: '',
      visible: true,
    };
    preview = { path: itemPath(item), width, height };
    thumbnails.set(kind, preview);
  }
  return preview;
}
export default function ShapeLibrary({
  appearance,
  onAppearance,
  onAdd,
  onClose,
}: {
  appearance: ShapeAppearance;
  onAppearance: (style: ShapeAppearance) => void;
  onAdd: (shape: ShapeKind) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState<(typeof shapeGroups)[number] | '全部'>('全部');
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 100, room: 600 });
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.getElementById('shape-menu-toggle')?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(420, innerWidth - 24);
      const left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12));
      const top = Math.max(12, Math.min(anchor.bottom + 8, innerHeight - 250));
      const room = innerHeight - top - 12;
      setPosition((old) =>
        old.left === left && old.top === top && old.room === room ? old : { left, top, room },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, []);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('.shape-category')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!root.current?.contains(target) && !target.closest('#shape-menu-toggle'))
        latestClose.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return createPortal(
    <div
      className="shape-menu shape-library-popover"
      id="shape-library"
      role="dialog"
      aria-label="预设图形"
      ref={root}
      style={{ left: position.left, top: position.top, maxHeight: Math.min(650, position.room) }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          document.getElementById('shape-menu-toggle')?.focus();
        }
      }}
    >
      <header className="shape-library-heading">
        <div>
          <b>图形素材</b>
          <small>{shapeCatalog.length} 款 · 给喜欢加一点形状</small>
        </div>
        <button
          type="button"
          className="shape-library-close"
          aria-label="关闭预设图形"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="shape-categories" role="group" aria-label="图形分类">
        {(['全部', ...shapeGroups] as const).map((name) => (
          <button
            type="button"
            className="shape-category"
            key={name}
            aria-pressed={group === name}
            onClick={() => setGroup(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="shape-library-grid">
        {shapeCatalog
          .filter((shape) => group === '全部' || shape.group === group)
          .map((shape) => {
            const preview = thumbnail(shape.id);
            const padding = Math.max(0.5, outlineDistances(appearance).outside + 0.2);
            return (
              <button
                type="button"
                className="shape-preset"
                key={shape.id}
                aria-label={`添加${shape.name}`}
                onClick={() => onAdd(shape.id)}
              >
                <svg
                  viewBox={`${-padding} ${-padding} ${preview.width + 2 * padding} ${preview.height + 2 * padding}`}
                  aria-hidden="true"
                >
                  <AppearancePath
                    path={preview.path}
                    paint="currentColor"
                    appearance={appearance}
                    width={preview.width}
                    height={preview.height}
                  />
                </svg>
                <span>{shape.name}</span>
              </button>
            );
          })}
      </div>
      <footer className="shape-library-footer">
        <b>新图形的轮廓与填充</b>
        <ShapeAppearanceControls value={appearance} onChange={onAppearance} />
      </footer>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent } from 'react';
import type { Selection } from '../model/types';
import type { LayerDropTarget } from '../model/layerListEditing';
import { selectionEntries } from '../model/selection';

export type LayerDragSource = { collectionId: string; kind: 'item' | 'folder'; id: string };
type Options = {
  source: (source: LayerDragSource) => Selection;
  allowed: (source: Selection, target: LayerDropTarget) => boolean;
  commit: (source: Selection, target: LayerDropTarget) => void;
  begin: (source: Selection) => void;
  expand: (target: LayerDropTarget) => void;
};

/** Shared drop zones for mouse HTML dragging and touch/pen handle dragging. */
export default function useLayerListDrag(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const root = useRef<HTMLElement | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const source = useRef<Selection>(null);
  const hover = useRef<{
    element: HTMLElement;
    target: LayerDropTarget;
    since: number;
    expanded: boolean;
  } | null>(null);
  const pointer = useRef<{ id: number; start: [number, number]; active: boolean } | null>(null);
  const location = useRef<[number, number]>([0, 0]);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const [status, setStatus] = useState<{ count: number; label: string } | null>(null);

  const clearHover = () => {
    if (hover.current) delete hover.current.element.dataset.dropPosition;
    hover.current = null;
  };
  const cancel = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    clearHover();
    if (root.current) delete root.current.dataset.layerDragging;
    const pointerId = pointer.current?.id;
    source.current = null;
    pointer.current = null;
    if (pointerId !== undefined && root.current?.hasPointerCapture(pointerId))
      root.current.releasePointerCapture(pointerId);
    setStatus(null);
  };
  const identify = (element: HTMLElement, attribute: 'layerSource' | 'layerTarget') => {
    const kind = element.dataset[attribute];
    const collectionId = element.dataset.collectionId;
    const id = element.dataset.layerId;
    return kind && collectionId && id ? { kind, collectionId, id } : null;
  };
  const updateHover = (x: number, y: number) => {
    location.current = [x, y];
    if (ghost.current) ghost.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-layer-target]');
    const row =
      element && root.current?.contains(element) ? identify(element, 'layerTarget') : null;
    if (!element || !row) {
      clearHover();
      setStatus((old) =>
        old && old.label !== '拖到图层边缘或目标集合'
          ? { ...old, label: '拖到图层边缘或目标集合' }
          : old,
      );
      return;
    }
    let position: LayerDropTarget['position'] = 'inside';
    if (row.kind === 'collection') {
      position = element.dataset.layerEnd ? 'after' : 'inside';
    } else {
      // Selected rows have extra action buttons: only the main row is the drop hit area.
      const rect = element.getBoundingClientRect();
      const mainHeight =
        element.querySelector('.row-select')?.getBoundingClientRect().height ?? rect.height;
      const height = Math.min(rect.height, Math.max(30, mainHeight + 6));
      const fraction = (y - rect.top) / height;
      position = fraction < 0.28 ? 'before' : fraction > 0.72 ? 'after' : 'inside';
    }
    const target = { ...row, kind: row.kind as LayerDropTarget['kind'], position };
    if (!latest.current.allowed(source.current, target)) {
      clearHover();
      setStatus((old) =>
        old && old.label !== '这里无法放置' ? { ...old, label: '这里无法放置' } : old,
      );
      return;
    }
    const previous = hover.current;
    if (previous?.element === element && previous.target.position === position) return;
    clearHover();
    element.dataset.dropPosition = position;
    hover.current = { element, target, since: performance.now(), expanded: false };
    const name = element.dataset.layerName ?? '';
    const label =
      row.kind === 'collection'
        ? `移入「${name}」${position === 'after' ? '末尾' : ''}`
        : position === 'inside'
          ? `${row.kind === 'folder' || element.closest('.folder-members') ? '移入文件夹' : '组合图层'} · ${name}`
          : `插入「${name}」${position === 'before' ? '上方' : '下方'}`;
    setStatus((old) => (old ? { ...old, label } : old));
  };
  const tick = () => {
    if (!source.current || !root.current) return;
    const [x, y] = location.current;
    if (ghost.current)
      ghost.current.style.transform = `translate(${Math.max(8, Math.min(x + 12, window.innerWidth - ghost.current.offsetWidth - 8))}px, ${Math.max(8, Math.min(y + 12, window.innerHeight - ghost.current.offsetHeight - 8))}px)`;
    const bounds = root.current.getBoundingClientRect();
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      const distance =
        y < bounds.top + 40
          ? y - bounds.top - 40
          : y > bounds.bottom - 40
            ? y - bounds.bottom + 40
            : 0;
      if (distance) {
        const before = root.current.scrollTop;
        root.current.scrollTop += Math.sign(distance) * Math.min(12, Math.abs(distance) * 0.35);
        if (before !== root.current.scrollTop) updateHover(x, y);
      }
    }
    const target = hover.current;
    if (
      target &&
      !target.expanded &&
      target.target.position === 'inside' &&
      performance.now() - target.since > 650
    ) {
      target.expanded = true;
      latest.current.expand(target.target);
    }
    frame.current = requestAnimationFrame(tick);
  };
  const activate = () => {
    if (!source.current || !root.current) return;
    root.current.dataset.layerDragging = 'true';
    latest.current.begin(source.current);
    setStatus({ count: selectionEntries(source.current).length, label: '拖到图层边缘或目标集合' });
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
  };
  const readSource = (target: EventTarget | null, panel: HTMLElement) => {
    const element =
      target instanceof Element ? target.closest<HTMLElement>('[data-layer-source]') : null;
    const row = element && panel.contains(element) ? identify(element, 'layerSource') : null;
    return row && (row.kind === 'item' || row.kind === 'folder')
      ? latest.current.source(row as LayerDragSource)
      : null;
  };
  const finish = () => {
    const selected = source.current;
    const target = hover.current?.target;
    cancel();
    if (selected && target && latest.current.allowed(selected, target))
      latest.current.commit(selected, target);
  };

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && source.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      cancelAnimationFrame(frame.current);
      clearHover();
    };
  }, []);

  return {
    status,
    ghost,
    handlers: {
      onDragStart: (e: DragEvent<HTMLElement>) => {
        if (
          pointer.current ||
          (e.target instanceof Element &&
            e.target.closest('.icon-button, .fold-toggle, input, .item-collection-tools'))
        ) {
          e.preventDefault();
          return;
        }
        source.current = readSource(e.target, e.currentTarget);
        if (!source.current) {
          e.preventDefault();
          return;
        }
        root.current = e.currentTarget;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(
          'application/x-pass-atelier-layers',
          JSON.stringify(selectionEntries(source.current)),
        );
        location.current = [e.clientX, e.clientY];
        activate();
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!source.current || pointer.current) return;
        e.preventDefault();
        updateHover(e.clientX, e.clientY);
        e.dataTransfer.dropEffect = hover.current ? 'move' : 'none';
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        if (!source.current || pointer.current) return;
        e.preventDefault();
        e.stopPropagation();
        updateHover(e.clientX, e.clientY);
        finish();
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearHover();
      },
      onDragEnd: cancel,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (
          e.button !== 0 ||
          !(e.target instanceof Element) ||
          !e.target.closest('.layer-drag-handle')
        )
          return;
        source.current = readSource(e.target, e.currentTarget);
        if (!source.current) return;
        e.preventDefault();
        root.current = e.currentTarget;
        pointer.current = { id: e.pointerId, start: [e.clientX, e.clientY], active: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const drag = pointer.current;
        if (!drag || drag.id !== e.pointerId) return;
        if (!drag.active && Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) < 6)
          return;
        if (!drag.active) {
          drag.active = true;
          activate();
        }
        e.preventDefault();
        updateHover(e.clientX, e.clientY);
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        if (pointer.current?.id !== e.pointerId) return;
        if (pointer.current.active) {
          suppressClick.current = true;
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          updateHover(e.clientX, e.clientY);
          finish();
        } else cancel();
      },
      onPointerCancel: cancel,
      onLostPointerCapture: () => {
        if (pointer.current) cancel();
      },
      onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}

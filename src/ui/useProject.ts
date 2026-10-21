import { useCallback, useRef, useState } from 'react';
import type { Project } from '../model/types';

export default function useProject(initial: Project) {
  const [project, setProject] = useState(initial);
  const current = useRef(initial);
  const history = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const transaction = useRef<{
    before: Project;
    history: Project[];
    future: Project[];
    recorded: boolean;
  } | null>(null);
  const [, refresh] = useState(0);
  // Published projects are immutable: edits clone first, and replace callers
  // publish a new snapshot. History can retain those snapshots without copying
  // every vector outline and embedded font a second time.
  const recordHistory = () => {
    const pending = transaction.current;
    if (pending?.recorded) return;
    history.current.push(pending?.before ?? current.current);
    if (history.current.length > 60) history.current.shift();
    future.current = [];
    if (pending) pending.recorded = true;
  };
  const replace = useCallback((next: Project, record = true) => {
    if (record || transaction.current) recordHistory();
    const previousFonts = current.current.fonts;
    if (
      next.fonts &&
      previousFonts &&
      next.fonts.length === previousFonts.length &&
      next.fonts.every(
        (font, i) =>
          font.id === previousFonts[i].id &&
          font.name === previousFonts[i].name &&
          font.dataUrl === previousFonts[i].dataUrl,
      )
    )
      next.fonts = previousFonts;
    current.current = next;
    setProject(next);
    refresh((v) => v + 1);
  }, []);
  const change = useCallback(
    (fn: (draft: Project) => void, record = true) => {
      const next = structuredClone(current.current);
      fn(next);
      replace(next, record);
    },
    [replace],
  );
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(current.current);
    current.current = prev;
    setProject(prev);
    refresh((v) => v + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(current.current);
    current.current = next;
    setProject(next);
    refresh((v) => v + 1);
  }, []);
  const begin = useCallback(() => {
    recordHistory();
    refresh((v) => v + 1);
  }, []);
  const beginTransaction = useCallback(() => {
    if (transaction.current) return;
    transaction.current = {
      before: current.current,
      history: history.current.slice(),
      future: future.current.slice(),
      recorded: false,
    };
  }, []);
  const finishTransaction = useCallback((commit = true) => {
    const pending = transaction.current;
    if (!pending) return;
    transaction.current = null;
    if (!commit) {
      history.current = pending.history;
      future.current = pending.future;
      current.current = pending.before;
      setProject(pending.before);
    }
    refresh((v) => v + 1);
  }, []);
  return {
    project,
    change,
    replace,
    undo,
    redo,
    begin,
    beginTransaction,
    finishTransaction,
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
    current,
  };
}

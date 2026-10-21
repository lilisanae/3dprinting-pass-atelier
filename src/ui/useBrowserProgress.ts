import { useEffect, useRef, useState } from 'react';
import { serializeProject } from '../io/projectFile';
import { saveBrowserProgress } from '../io/browserProgress';
import type { BrowserProgress } from '../io/browserProgress';
import type { Project } from '../model/types';
import { projectWorkshop } from '../model/workshop';

/** Coalesce edits, then persist compact JSON asynchronously. No geometry on this path. */
export default function useBrowserProgress(
  project: Project,
  initial: Project,
  restored?: BrowserProgress,
) {
  const live = useRef(project);
  live.current = project;
  const persisted = useRef<Project | undefined>(
    restored?.project && !restored.migrated ? initial : undefined,
  );
  const blocked = useRef(!!restored?.error);
  const lastJson = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Project | undefined>(undefined);
  const edited = useRef(!!restored?.migrated);
  const writing = useRef(false);
  const writingTask = useRef<Promise<boolean>>(Promise.resolve(true));
  const active = useRef(true);
  const [state, setState] = useState<'idle' | 'pending' | 'saved' | 'error'>(
    restored?.error ? 'error' : persisted.current ? 'saved' : 'idle',
  );
  const [error, setError] = useState(restored?.error ?? '');
  const [savedProject, setSavedProject] = useState(persisted.current);
  const report = (value: typeof state, message = '') => {
    if (!active.current) return;
    setState(value);
    setError(message);
  };
  const flush = () => {
    clearTimeout(timer.current);
    if (blocked.current) return Promise.resolve(false);
    if (live.current === persisted.current && !writing.current) return Promise.resolve(true);
    pending.current = live.current;
    report('pending');
    if (writing.current) return writingTask.current;
    writing.current = true;
    writingTask.current = (async () => {
      try {
        while (pending.current) {
          const snapshot = pending.current;
          pending.current = undefined;
          const json = serializeProject(snapshot);
          if (json !== lastJson.current) await saveBrowserProgress(json, projectWorkshop(snapshot));
          lastJson.current = json;
          persisted.current = snapshot;
          if (active.current) setSavedProject(snapshot);
          report(live.current === snapshot ? 'saved' : 'pending');
        }
        return true;
      } catch (reason) {
        pending.current = undefined;
        report(
          'error',
          reason instanceof Error ? reason.message : '本地保存失败，请下载项目备份。',
        );
        return false;
      } finally {
        writing.current = false;
      }
    })();
    return writingTask.current;
  };
  const latestFlush = useRef(flush);
  latestFlush.current = flush;
  useEffect(() => {
    if (blocked.current) return;
    if (project !== initial) edited.current = true;
    if (project === persisted.current) {
      // An in-flight edit would otherwise overwrite an undo to the saved snapshot.
      if (writing.current) pending.current = project;
      report(writing.current ? 'pending' : 'saved');
      return;
    }
    if (!edited.current && !persisted.current) return;
    report('pending');
    timer.current = setTimeout(() => latestFlush.current(), 800);
    return () => clearTimeout(timer.current);
  }, [project]);
  useEffect(() => {
    active.current = true;
    const hidden = () => {
      if (document.visibilityState === 'hidden') latestFlush.current();
    };
    const leaving = () => latestFlush.current();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leaving);
    };
  }, []);
  return {
    state,
    error,
    saved: project === savedProject && state === 'saved',
    retry: () => {
      blocked.current = false;
      report('pending');
      latestFlush.current();
    },
    flush,
  };
}

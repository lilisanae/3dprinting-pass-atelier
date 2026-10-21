import type { BadgeBase } from '../model/badge';
import type { ShapeAppearance } from '../model/shapeCatalog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GeometrySession } from '../geometry/session';
import type { GeneratedModel, Project, Selection, TemplateData } from '../model/types';
import type { BadgeVectorShape } from '../model/badge';

export default function useGeometry(
  project: Project,
  template: TemplateData,
  recovery: number,
  urgent: boolean,
) {
  const session = useRef<GeometrySession | null>(null);
  const getSession = () => (session.current ??= new GeometrySession(template));
  const inspectColors = useCallback(
    (snapshot: Project, width: number) => getSession().inspectColors(snapshot, width),
    [],
  );
  const [model, setModel] = useState<GeneratedModel | null>(null);
  const [generatedProject, setGeneratedProject] = useState<Project | null>(null);
  const [generating, setGenerating] = useState(true);
  const [error, setError] = useState('');
  const recovered = useRef(recovery);
  useEffect(
    () => () => {
      session.current?.dispose();
      session.current = null;
    },
    [],
  );
  useEffect(() => {
    if (generatedProject === project && recovered.current === recovery) {
      // Undo can return to the last completed snapshot while a newer task is pending.
      setGenerating(false);
      setError('');
      return;
    }
    let active = true,
      idle: number | undefined;
    setGenerating(true);
    setError('');
    const run = () => {
      if (!active) return;
      void getSession()
        .generate(project)
        .then((value) => {
          if (!active) return;
          recovered.current = recovery;
          setModel(value);
          setGeneratedProject(project);
          setGenerating(false);
        })
        .catch((reason) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setGenerating(false);
        });
    };
    const timer = setTimeout(
      () => {
        if (!urgent && typeof window.requestIdleCallback === 'function')
          idle = window.requestIdleCallback(run, { timeout: 1200 });
        else run();
      },
      urgent ? 0 : 260,
    );
    return () => {
      active = false;
      clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [project, template, recovery, urgent]);
  return {
    model,
    generatedProject,
    generating,
    error,
    inspectColors,
    validate: (snapshot: Project) => getSession().generate(snapshot),
    styleBadgeBase: (base: BadgeBase, appearance: ShapeAppearance) =>
      getSession().styleBadgeBase(base, appearance),
    normalizeBadgeOutline: (shapes: BadgeVectorShape[]) =>
      getSession().normalizeBadgeOutline(shapes),
    merge: (snapshot: Project, selected: Selection) => getSession().merge(snapshot, selected),
  };
}

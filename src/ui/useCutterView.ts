import { useEffect, useMemo, useRef } from 'react';
import { cutterViewScope } from '../model/cutterView';
import type { Face, Project, Selection } from '../model/types';

/** Keep the edited target while selection moves from its artwork to a tool. */
export default function useCutterView(project: Project, face: Face, selection: Selection) {
  const context = useRef<{ face: Face; targets: Set<string> }>({ face, targets: new Set() });
  const scope = useMemo(
    () =>
      cutterViewScope(
        project,
        face,
        selection,
        context.current.face === face ? context.current.targets : undefined,
      ),
    [project, face, selection],
  );
  useEffect(() => {
    context.current = { face, targets: scope.targetIds };
  }, [face, scope]);
  return scope.cutterIds;
}

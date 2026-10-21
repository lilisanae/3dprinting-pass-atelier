import type { ColorCandidate, ColorFragmentSelector, Project } from './types';

export type ColorCorrectionAction = 'recolor' | 'remove' | 'restore';

/** A deliberate output-color edit; does not rewrite artwork, height or transforms. */
export function setColorCorrection(
  project: Project,
  componentKey: string,
  colorId: string,
  originalColorId: string,
  fragment?: ColorFragmentSelector,
) {
  if (
    !/^[a-f0-9]{16}$/.test(componentKey) ||
    !project.palette.some((color) => color.id === colorId)
  )
    return false;
  const entries = project.colorCorrections ?? [];
  const old = entries.find((entry) => entry.componentKey === componentKey);
  if (
    (!old && colorId === originalColorId) ||
    (old?.colorId === colorId && colorId !== originalColorId)
  )
    return false;
  const next = entries.filter((entry) => entry.componentKey !== componentKey);
  if (colorId !== originalColorId)
    next.push({ componentKey, colorId, ...(fragment ? { fragment: { ...fragment } } : {}) });
  if (next.length > 1000) return false;
  if (next.length) project.colorCorrections = next;
  else delete project.colorCorrections;
  return true;
}

/** Remove the selected XY column outward from the plate, including supported caps. */
export function removeColorFragment(
  project: Project,
  componentKey: string,
  fragment?: ColorFragmentSelector,
) {
  if (!/^[a-f0-9]{16}$/.test(componentKey)) return false;
  const entries = project.colorCorrections ?? [],
    old = entries.find((entry) => entry.componentKey === componentKey);
  if (old?.mode === 'remove') return false;
  const next = entries.filter((entry) => entry.componentKey !== componentKey);
  if (next.length >= 1000) return false;
  project.colorCorrections = [
    ...next,
    { componentKey, mode: 'remove', ...(fragment ? { fragment: { ...fragment } } : {}) },
  ];
  return true;
}

/** Plan the entire batch before committing, so a record limit cannot apply only half of it. */
export function applyColorCorrections(
  project: Project,
  candidates: ColorCandidate[],
  action: ColorCorrectionAction,
  colorId?: string,
) {
  if (action === 'recolor' && !project.palette.some((color) => color.id === colorId)) return 0;
  const chosen = new Map(candidates.map((candidate) => [candidate.componentKey, candidate]));
  const draft: Project = {
    ...project,
    colorCorrections: project.colorCorrections?.map((entry) => ({ ...entry })),
  };
  let count = 0;
  for (const candidate of chosen.values()) {
    if (
      candidate.removalSourceKey &&
      (action === 'remove' || !chosen.has(candidate.removalSourceKey))
    )
      continue;
    if (action === 'remove' && candidate.removed) continue;
    if (action === 'restore' && !candidate.corrected) continue;
    if (action === 'recolor' && !candidate.removed && candidate.colorId === colorId) continue;
    const changed =
      action === 'remove'
        ? removeColorFragment(draft, candidate.componentKey, candidate.fragment)
        : setColorCorrection(
            draft,
            candidate.componentKey,
            action === 'restore' ? candidate.originalColorId : colorId!,
            candidate.originalColorId,
            candidate.fragment,
          );
    if (!changed) return 0;
    count++;
  }
  if (count) {
    if (draft.colorCorrections?.length) project.colorCorrections = draft.colorCorrections;
    else delete project.colorCorrections;
  }
  return count;
}

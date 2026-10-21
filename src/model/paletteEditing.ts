import type { PaletteColor, Project } from './types';

/** Mutates the editor's draft, replacing every reference before removing the color. */
export function removePaletteColor(project: Project, id: string): PaletteColor | undefined {
  const index = project.palette.findIndex((color) => color.id === id);
  if (index < 0 || project.palette.length <= 1) return;
  const replacement = project.palette[index > 0 ? index - 1 : 1];
  for (const key of [
    'baseColorId',
    'frontColorId',
    'backColorId',
    'panelColorId',
    'panelDetailColorId',
  ] as const)
    if (project.template[key] === id) project.template[key] = replacement.id;
  const label = project.template.label;
  if (label?.colorId === id) label.colorId = replacement.id;
  for (const decoration of Object.values(project.template.decorations))
    if (decoration.colorId === id) decoration.colorId = replacement.id;
  // Hidden and locked artwork must keep valid references when it is shown again.
  for (const collection of project.collections)
    for (const item of collection.items) {
      if (item.colorId === id) item.colorId = replacement.id;
      for (const region of item.regions ?? [])
        if (region.colorId === id) region.colorId = replacement.id;
    }
  for (const entry of project.colorCorrections ?? [])
    if (entry.colorId === id) entry.colorId = replacement.id;
  project.palette.splice(index, 1);
  return replacement;
}

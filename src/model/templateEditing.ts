import type { Project, Selection, TemplateData, TemplatePlacement } from './types';

export function defaultPanelPlacement(template: TemplateData): Omit<TemplatePlacement, 'colorId'> {
  const panel = template.objects.find((o) => o.role === 'fixed-panel');
  const bounds = panel
    ? [
        panel.bounds[0],
        template.height - panel.bounds[4],
        panel.bounds[3] - panel.bounds[0],
        panel.bounds[4] - panel.bounds[1],
      ]
    : template.panelBounds;
  return {
    x: bounds[0],
    y: bounds[1],
    width: bounds[2],
    height: bounds[3],
    rotation: 0,
    visible: true,
  };
}

/** One frame for the panel, details, preview, snap references and print protection. */
export function panelPlacement(project: Project, template: TemplateData): TemplatePlacement {
  return {
    ...(project.template.panel ?? defaultPanelPlacement(template)),
    // An inert frame keeps shared coordinate helpers simple, without restoring
    // any deleted placement to the document or rendering its meshes.
    ...(project.template.panel === null ? { visible: false } : {}),
    colorId: project.template.panelColorId,
  };
}

/** Remove editable template records. Visibility remains a separate reversible toggle. */
export function deleteTemplateElement(project: Project, selection: Selection): void {
  if (selection?.kind === 'label' && !project.template.label?.locked) project.template.label = null;
  else if (selection?.kind === 'panel' && !project.template.panel?.locked)
    project.template.panel = null;
  else if (selection?.kind === 'decoration' && !project.template.decorations[selection.id]?.locked)
    delete project.template.decorations[selection.id];
}

/** Low surfaces paint first. Source order breaks ties as in the CSG originals. */
export function previewDecorations(template: TemplateData) {
  return template.objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => object.role === 'decoration')
    .sort((a, b) => a.object.bounds[5] - b.object.bounds[5] || b.index - a.index)
    .map(({ object }) => object);
}

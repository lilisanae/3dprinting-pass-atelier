import type { DesignItem, Project } from '../model/types';

/** The editable vectors are authoritative; embedded tracing images are redundant.
 * Serialize without copying or mutating the live project, and preserve every
 * coordinate, path, font, color and reference exactly. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, function (this: Partial<DesignItem>, key, value) {
    if (
      key === 'sourceDataUrl' &&
      this.kind === 'paths' &&
      Array.isArray(this.regions) &&
      this.regions.some((region) => typeof region.path === 'string' && region.path.trim())
    )
      return undefined;
    return value;
  });
}

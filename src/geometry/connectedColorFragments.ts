import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';

type Own = <T extends { delete(): void }>(value: T) => T;
const Z_EPSILON = 1e-5;

/** Find narrow sub-volumes even when a wider body touches them at the same or another height. */
export function connectedColorFragments(
  runtime: ManifoldToplevel,
  component: Manifold,
  width: number,
  own: Own,
): { fragments: Manifold[]; skipped: boolean } {
  const temporaries: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(value: T): T => {
    temporaries.push(value);
    return value;
  };
  try {
    const box = component.boundingBox(),
      mesh = component.getMesh();
    const levels = [box.min[2], box.max[2]];
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const vertices = [0, 1, 2].map((j) => {
        const v = mesh.triVerts[i + j] * mesh.numProp;
        return [mesh.vertProperties[v], mesh.vertProperties[v + 1], mesh.vertProperties[v + 2]];
      });
      const zs = vertices.map((v) => v[2]);
      if (Math.max(...zs) - Math.min(...zs) > Z_EPSILON) continue;
      const [a, b, c] = vertices;
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) < 1e-8) continue;
      levels.push(zs.reduce((sum, z) => sum + z, 0) / 3);
    }
    const sorted = levels
      .sort((a, b) => a - b)
      .filter((z, i, all) => !i || z - all[i - 1] > Z_EPSILON);
    // Imported curved meshes may have thousands of separate horizontal facets.
    // Keep an explicit limit instead of blocking the editor or approximating a whole body.
    if (sorted.length > 65) return { fragments: [], skipped: true };
    const parts: Manifold[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const bottom = sorted[i - 1],
        top = sorted[i];
      if (top - bottom <= 0.02) continue;
      const section = keep(component.slice((bottom + top) / 2));
      for (const island of keepSections(section.decompose())) {
        const core = keep(island.offset(-width / 2, 'Round', 2, 12));
        let masks: CrossSection[];
        if (core.isEmpty()) masks = [island];
        else {
          // Miter restoration preserves ordinary sharp corners; only tails and necks remain.
          const restored = keep(
            runtime.CrossSection.intersection(island, keep(core.offset(width / 2, 'Miter', 2, 12))),
          );
          const residual = keep(runtime.CrossSection.difference(island, restored));
          const beyondJunction = keep(
            runtime.CrossSection.difference(island, keep(core.offset(width, 'Miter', 2, 12))),
          );
          masks = keepSections(residual.decompose()).filter((mask) => {
            const b = mask.bounds();
            return (
              Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) >= width &&
              keep(runtime.CrossSection.intersection(mask, beyondJunction)).area() > 1e-8
            );
          });
        }
        for (const mask of masks) {
          if (mask.area() <= 1e-9) continue;
          // Cover the few microns lost by cross-section quantization, then clip
          // back to the exact parent. This avoids leaving a detached needle at
          // an existing curved edge when the result is converted to float meshes.
          const stableMask = keep(mask.offset(0.00002, 'Miter', 2, 12));
          const column = keep(keep(stableMask.extrude(top - bottom)).translate([0, 0, bottom]));
          const part = keep(runtime.Manifold.intersection(component, column));
          if (part.volume() > 1e-7) parts.push(part);
        }
      }
    }
    if (!parts.length) return { fragments: [], skipped: false };
    const fragments = parts.flatMap((part) => part.decompose());
    const total = component.volume();
    const accepted: Manifold[] = [];
    for (const fragment of fragments) {
      const bounds = fragment.boundingBox(),
        volume = fragment.volume();
      if (volume > 1e-7 && volume < total - 1e-7 && bounds.max[2] - bounds.min[2] > 0.02)
        accepted.push(own(fragment));
      else fragment.delete();
    }
    return { fragments: accepted, skipped: false };

    function keepSections(sections: CrossSection[]) {
      return sections.map(keep);
    }
  } finally {
    temporaries.reverse().forEach((value) => value.delete());
  }
}

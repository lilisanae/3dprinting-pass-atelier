import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type {
  ColorCandidate,
  ColorInspection,
  ColorFragmentSelector,
  MeshPart,
  ModelColorCorrection,
} from '../model/types';
import { connectedColorFragments } from './connectedColorFragments';

export type ColorBody = { name: string; colorId: string; solid: Manifold };
type Own = <T extends { delete(): void }>(value: T) => T;

export function meshPart(solid: Manifold, colorId: string, name: string): MeshPart {
  const mesh = solid.getMesh(),
    positions = new Float32Array(mesh.numVert * 3);
  for (let v = 0; v < mesh.numVert; v++)
    for (let axis = 0; axis < 3; axis++)
      positions[v * 3 + axis] = mesh.vertProperties[v * mesh.numProp + axis];
  return {
    name,
    colorId,
    positions,
    indices: new Uint32Array(mesh.triVerts),
    volume: solid.volume(),
  };
}

/** Canonical triangle coordinates, independent of vertex numbering, material and traversal order. */
export function componentKey(solid: Manifold): string {
  const mesh = solid.getMesh();
  const vertices = Array.from({ length: mesh.numVert }, (_, v) =>
    [0, 1, 2]
      .map((axis) => Math.round(mesh.vertProperties[v * mesh.numProp + axis] * 100000))
      .join(','),
  );
  const triangles: string[] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3)
    triangles.push(
      [vertices[mesh.triVerts[i]], vertices[mesh.triVerts[i + 1]], vertices[mesh.triVerts[i + 2]]]
        .sort()
        .join('/'),
    );
  let a = 2166136261,
    b = 0x9e3779b9;
  for (const triangle of triangles.sort()) {
    for (let i = 0; i < triangle.length; i++) {
      a = Math.imul(a ^ triangle.charCodeAt(i), 16777619);
      b = Math.imul(b ^ triangle.charCodeAt(i), 2246822519);
    }
    a = Math.imul(a ^ 59, 16777619);
    b = Math.imul(b ^ 59, 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Analyze only on request. Color corrections always transfer entire closed volumes, never paint triangles. */
export function processColorBodies(
  runtime: ManifoldToplevel,
  bodies: ColorBody[],
  corrections: ModelColorCorrection[] | undefined,
  threshold: number | undefined,
  own: Own,
  plateMidpoint = 0,
): { bodies: ColorBody[]; inspection?: ColorInspection; applied: number; inactive: number } {
  if (!corrections?.length && threshold === undefined) return { bodies, applied: 0, inactive: 0 };
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 2))
    throw new Error('细小色块检查宽度须在 0.05–2 mm 之间。');
  const edits = new Map(corrections?.map((entry) => [entry.componentKey, entry]));
  const matched = new Set<string>(),
    candidates: ColorCandidate[] = [];
  const projections = new Map<string, CrossSection>();
  const componentSolids = new Map<string, Manifold>();
  const output = new Map(
    bodies.map((body) => [
      body.colorId,
      { ...body, add: [] as Manifold[], subtract: [] as Manifold[] },
    ]),
  );
  const removalColumns: Manifold[] = [];
  const removals = new Map<string, Manifold>();
  const top = Math.max(...bodies.map((body) => body.solid.boundingBox().max[2])) + 1;
  const bottom = Math.min(...bodies.map((body) => body.solid.boundingBox().min[2])) - 1;
  const localEdits = new Map<string, ModelColorCorrection[]>();
  for (const edit of corrections ?? []) {
    if (!edit.fragment) continue;
    const siblings = localEdits.get(edit.fragment.parentKey) ?? [];
    siblings.push(edit);
    localEdits.set(edit.fragment.parentKey, siblings);
  }
  let scannedComponents = 0,
    skippedConnectedComponents = 0;
  for (const body of bodies) {
    const components = body.solid.decompose().map(own);
    for (const component of components) {
      scannedComponents++;
      const bounds = component.boundingBox(),
        volume = component.volume();
      let projection: CrossSection | undefined,
        area = 0,
        small = false;
      if (threshold !== undefined && volume > 1e-7 && bounds.max[2] - bounds.min[2] > 0.02) {
        projection = own(component.project());
        area = projection.area();
        // Erosion handles diagonal threads and holes, unlike an axis-aligned box alone.
        if (area > 1e-9) small = own(projection.offset(-threshold / 2, 'Round', 2, 12)).isEmpty();
      }
      const key = edits.size || threshold !== undefined ? componentKey(component) : '';
      const wholeEdit = edits.get(key);
      const saved = localEdits.get(key) ?? [];
      if ((wholeEdit && !wholeEdit.fragment) || (small && !saved.length)) {
        visit(component, key, wholeEdit?.fragment ? undefined : wholeEdit);
        continue;
      }
      if (volume <= 1e-7 || bounds.max[2] - bounds.min[2] <= 0.02) continue;
      type Target = {
        solid: Manifold;
        fragment: ColorFragmentSelector;
        edit?: ModelColorCorrection;
        show: boolean;
      };
      const targets = new Map<string, Target>();
      const widths = new Set(saved.map((edit) => edit.fragment!.width));
      if (threshold !== undefined && !small) widths.add(threshold);
      for (const width of widths) {
        const found = connectedColorFragments(runtime, component, width, own);
        if (found.skipped && width === threshold) skippedConnectedComponents++;
        for (const solid of found.fragments) {
          const fragmentKey = componentKey(solid);
          const edit = saved.find(
            (entry) => entry.componentKey === fragmentKey && entry.fragment!.width === width,
          );
          if (!edit && width !== threshold) continue;
          const previous = targets.get(fragmentKey);
          targets.set(fragmentKey, {
            solid,
            fragment: edit?.fragment ?? previous?.fragment ?? { parentKey: key, width },
            edit: edit ?? previous?.edit,
            show: width === threshold || !!edit || !!previous?.show,
          });
        }
      }
      // Historic widths remain recoverable. Don't offer overlapping new masks or
      // apply overlapping saved edits twice after the user changes the slider.
      const accepted: Target[] = [];
      for (const edit of saved) {
        const target = targets.get(edit.componentKey);
        if (!target?.edit || accepted.some((other) => overlaps(target.solid, other.solid)))
          continue;
        accepted.push(target);
        visit(target.solid, edit.componentKey, edit, target.fragment);
      }
      if (threshold !== undefined)
        for (const [fragmentKey, target] of targets) {
          if (
            target.edit ||
            !target.show ||
            accepted.some((other) => overlaps(target.solid, other.solid))
          )
            continue;
          visit(target.solid, fragmentKey, undefined, target.fragment);
        }

      function overlaps(a: Manifold, b: Manifold) {
        const x = a.boundingBox(),
          y = b.boundingBox();
        if (
          [0, 1, 2].some(
            (axis) => x.max[axis] <= y.min[axis] + 1e-6 || y.max[axis] <= x.min[axis] + 1e-6,
          )
        )
          return false;
        return own(runtime.Manifold.intersection(a, b)).volume() > 1e-7;
      }
    }

    function visit(
      component: Manifold,
      key: string,
      edit?: ModelColorCorrection,
      fragment?: ColorFragmentSelector,
    ) {
      const bounds = component.boundingBox(),
        removed = edit?.mode === 'remove';
      const face = (bounds.min[2] + bounds.max[2]) / 2 < plateMidpoint ? 'back' : 'front';
      const target = edit && !removed ? edit.colorId! : body.colorId;
      if (edit) matched.add(key);
      if (removed) {
        if (fragment) output.get(body.colorId)!.subtract.push(component);
        else {
          const projection = own(component.project());
          const start = face === 'back' ? bottom : bounds.min[2];
          const height = face === 'back' ? bounds.max[2] - bottom : top - start;
          if (!projection.isEmpty()) {
            const column = own(own(projection.extrude(height)).translate([0, 0, start]));
            removalColumns.push(column);
            removals.set(key, column);
          }
        }
      }
      if (edit && !removed && target !== body.colorId) {
        output.get(body.colorId)!.subtract.push(component);
        let entry = output.get(target);
        if (!entry) {
          entry = {
            colorId: target,
            name: body.name,
            solid: own(runtime.Manifold.union([])),
            add: [],
            subtract: [],
          };
          output.set(target, entry);
        }
        entry.add.push(component);
      }
      if (threshold === undefined) return;
      const projection = own(component.project()),
        area = projection.area();
      const candidate: ColorCandidate = {
        ...meshPart(component, target, body.name),
        componentKey: key,
        ...(fragment ? { fragment } : {}),
        face,
        originalColorId: body.colorId,
        bounds: [...bounds.min, ...bounds.max],
        area,
        corrected: !!edit,
        removed,
      };
      candidates.push(candidate);
      projections.set(key, projection!);
      componentSolids.set(key, component);
    }
  }
  const applied = matched.size,
    inactive = edits.size - applied;
  const removal = removalColumns.length ? own(runtime.Manifold.union(removalColumns)) : undefined;
  const result = applied
    ? [...output]
        .map(([colorId, entry]) => {
          // Reuse untouched bodies. Reuniting every decomposed component can amplify
          // micron-scale seams in imported artwork after conversion to float meshes.
          let solid = entry.solid;
          if (entry.subtract.length)
            solid = own(
              runtime.Manifold.difference(solid, own(runtime.Manifold.union(entry.subtract))),
            );
          if (entry.add.length) solid = own(runtime.Manifold.union([solid, ...entry.add]));
          if (removal && !solid.isEmpty()) {
            const intersection = own(runtime.Manifold.intersection(solid, removal));
            if (intersection.volume() > 1e-9)
              solid = own(runtime.Manifold.difference(solid, removal));
          }
          return { colorId, name: entry.name, solid };
        })
        .filter((body) => !body.solid.isEmpty())
    : bodies;
  if (threshold === undefined) return { bodies: result, applied, inactive };
  const removalBounds = new Map([...removals].map(([key, column]) => [key, column.boundingBox()]));
  for (const candidate of candidates) {
    for (const [key, column] of removals) {
      if (key === candidate.componentKey) continue;
      const box = removalBounds.get(key)!;
      if (
        [0, 1, 2].some(
          (axis) =>
            candidate.bounds[axis + 3] <= box.min[axis] || candidate.bounds[axis] >= box.max[axis],
        )
      )
        continue;
      if (
        own(
          runtime.Manifold.intersection(componentSolids.get(candidate.componentKey)!, column),
        ).volume() > 1e-9
      ) {
        candidate.removalSourceKey = key;
        break;
      }
    }
  }
  const order = new Map(corrections?.map((entry, index) => [entry.componentKey, index]));
  const treated = (candidate: ColorCandidate) =>
    candidate.corrected || !!candidate.removalSourceKey;
  const sorted = candidates.sort((a, b) => {
    const state = Number(treated(a)) - Number(treated(b));
    if (state) return state;
    if (treated(a)) {
      const sequence =
        (order.get(a.removalSourceKey ?? a.componentKey) ?? Infinity) -
        (order.get(b.removalSourceKey ?? b.componentKey) ?? Infinity);
      if (sequence) return sequence;
      const related = Number(!!a.removalSourceKey) - Number(!!b.removalSourceKey);
      if (related) return related;
    }
    return a.area - b.area || a.componentKey.localeCompare(b.componentKey);
  });
  // Keep every already-treated item reachable for restore even when connected
  // inspection discovers more than one page of untreated candidates.
  const shown = [
    ...sorted.filter((candidate) => !treated(candidate)).slice(0, 500),
    ...sorted.filter(treated),
  ];
  const slices = new Map<string, CrossSection>();
  for (const candidate of shown) {
    if (treated(candidate)) continue;
    const z = (candidate.bounds[2] + candidate.bounds[5]) / 2;
    const expanded = own(
      projections
        .get(candidate.componentKey)!
        .offset(Math.max(0.03, threshold / 2), 'Round', 2, 12),
    );
    let best = 0;
    for (const body of result) {
      if (body.colorId === candidate.colorId) continue;
      const bounds = body.solid.boundingBox();
      if (z <= bounds.min[2] + 1e-6 || z >= bounds.max[2] - 1e-6) continue;
      const sliceKey = `${body.colorId}:${z.toFixed(6)}`;
      let slice = slices.get(sliceKey);
      if (!slice) {
        slice = own(body.solid.slice(z));
        slices.set(sliceKey, slice);
      }
      const contact = own(runtime.CrossSection.intersection(expanded, slice)).area();
      if (contact > best + 1e-9) {
        best = contact;
        candidate.suggestedColorId = body.colorId;
      }
    }
    if (!candidate.suggestedColorId) {
      let distance = Math.max(0.5, threshold);
      for (const body of result) {
        if (body.colorId === candidate.colorId) continue;
        const gap = componentSolids.get(candidate.componentKey)!.minGap(body.solid, distance);
        if (gap < distance - 1e-6) {
          distance = gap;
          candidate.suggestedColorId = body.colorId;
        }
      }
    }
  }
  return {
    bodies: result,
    applied,
    inactive,
    inspection: {
      threshold,
      candidates: shown,
      total: sorted.length,
      scannedComponents,
      appliedCorrections: applied,
      inactiveCorrections: inactive,
      ...(skippedConnectedComponents ? { skippedConnectedComponents } : {}),
    },
  };
}

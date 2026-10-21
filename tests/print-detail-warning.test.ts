import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newShape } from '../src/model/project';
import { getManifoldRuntime, generateGeometry } from '../src/geometry/engine';
import type { Project, TemplateData } from '../src/model/types';
test('shape, outline, and imported contour warnings start strictly below 0.2 mm', async () => {
  const runtime = await getManifoldRuntime(),
    cube = runtime.Manifold.cube([50, 100, 2.3]),
    mesh = cube.getMesh();
  cube.delete();
  const template: TemplateData = {
    version: 'maimai-template-v1',
    source: 'warning test',
    width: 50,
    height: 100,
    thickness: 2.3,
    panelBounds: [0, 0, 1, 1],
    objects: [
      {
        id: 'base',
        name: 'base',
        role: 'base',
        colorId: 'black',
        positions: Array.from(mesh.vertProperties),
        indices: Array.from(mesh.triVerts),
        outlinePath: 'M0 0H50V100H0Z',
        bounds: [0, 0, 0, 50, 100, 2.3],
        height: 2.3,
      },
    ],
  };
  const items = [0.199, 0.2, 0.25].flatMap((width, i) => [
    {
      ...newShape('black', 'rect'),
      id: `shape-${width}`,
      name: `shape-${width}`,
      x: 3 + i * 12,
      y: 5,
      width,
      height: 3,
    },
    {
      ...newShape('black', 'rect'),
      id: `outline-${width}`,
      name: `outline-${width}`,
      x: 3 + i * 12,
      y: 15,
      width: 5,
      height: 5,
      shapeFill: false,
      shapeOutline: true,
      shapeOutlineWidth: width,
    },
    {
      ...newShape('black', 'rect'),
      id: `path-${width}`,
      name: `path-${width}`,
      kind: 'paths' as const,
      x: 3 + i * 12,
      y: 25,
      width: 1,
      height: 3,
      sourceWidth: 1,
      sourceHeight: 3,
      regions: [{ colorId: 'black', path: `M0 0H${width}V3H0Z` }],
    },
  ]);
  const project: Project = {
    format: 'pass-atelier',
    version: 1,
    templateVersion: template.version,
    name: 'Warnings',
    palette: [{ id: 'black', name: 'Black', hex: '#000000' }],
    template: {
      baseColorId: 'black',
      panelColorId: 'black',
      panelDetailColorId: 'black',
      panel: null,
      label: null,
      decorations: {},
    },
    collections: [
      { id: 'front', name: 'Front', face: 'front', visible: true, thickness: 0.4, items },
    ],
  };
  const bytes = readFileSync(new URL('../public/assets/pass-font-core-v1.woff', import.meta.url));
  const model = await generateGeometry(
    project,
    template,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  assert.deepEqual(
    model.issues.filter((issue) => issue.severity === 'error'),
    [],
  );
  assert.deepEqual(
    model.issues
      .filter((issue) => issue.itemId)
      .map((issue) => issue.itemId)
      .sort(),
    ['shape-0.199', 'outline-0.199', 'path-0.199'].sort(),
  );
  assert.ok(model.issues.every((issue) => !issue.message.includes('0.3 mm')));
});

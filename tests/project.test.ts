import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, cumulativeHeights, validateProject } from '../src/model/project';
import type { TemplateData } from '../src/model/types';
const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;
test('editable project roundtrip includes all collection settings and assets without rounding thickness', () => {
  const p = createProject(template);
  p.collections[0].thickness = 0.037125;
  p.collections[1].visible = false;
  p.collections[0].items.push({
    id: 'embedded-art',
    name: '素材',
    kind: 'paths',
    visible: true,
    x: 10,
    y: 20,
    width: 20,
    height: 10,
    rotation: 12,
    colorId: 'white',
    sourceWidth: 20,
    sourceHeight: 10,
    sourceDataUrl: 'data:image/png;base64,aGVsbG8=',
    regions: [
      { path: 'M0 0H10V10H0Z', colorId: 'white' },
      { path: 'M10 0H20V10H10Z', colorId: 'black' },
    ],
  });
  p.collections.push({
    id: 'empty',
    name: 'empty',
    face: 'front',
    visible: true,
    thickness: 0.8125,
    items: [],
  });
  const q = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(q, p);
  assert.notEqual(q, p);
  assert.equal(cumulativeHeights(q.collections).empty, 0.849625);
});
test('malformed imported structures, unknown shapes and broken source sizes are rejected before editing', () => {
  for (const mutate of [
    (p: any) => (p.palette = [null]),
    (p: any) => delete p.template.decorations,
    (p: any) => (p.collections[0].items = [null]),
    (p: any) => (p.collections[0].items[0].shape = 'invalid'),
    (p: any) => (p.collections[0].items[0].sourceWidth = 0),
    (p: any) => (p.collections[0].items[0].sourceDataUrl = 'https://remote/image.png'),
    (p: any) => (p.collections[1].id = p.collections[0].id),
    (p: any) => (p.collections[0].thickness = Infinity),
  ]) {
    const p = createProject(template);
    mutate(p);
    assert.throws(() => validateProject(p));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, validateProject } from '../src/model/project';
import { removePaletteColor } from '../src/model/paletteEditing';
import { serializeProject } from '../src/io/projectFile';
import type { TemplateData } from '../src/model/types';

const template = JSON.parse(
  readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
) as TemplateData;

test('deleting a used material preserves artwork and leaves every saved color reference valid', () => {
  const project = createProject(template);
  Object.assign(project.template, {
    baseColorId: 'black',
    frontColorId: 'black',
    backColorId: 'black',
    panelColorId: 'black',
    panelDetailColorId: 'black',
  });
  project.template.label.colorId = 'black';
  project.template.label.text = 'black';
  for (const decoration of Object.values(project.template.decorations))
    decoration.colorId = 'black';
  for (const collection of project.collections) {
    collection.visible = false;
    collection.locked = true;
    for (const item of collection.items) item.colorId = 'black';
  }
  project.collections[0].items.push({
    id: 'imported',
    name: 'black',
    kind: 'paths',
    visible: false,
    locked: true,
    x: 8,
    y: 9,
    width: 14,
    height: 12,
    rotation: 25,
    colorId: 'black',
    regions: [
      { path: 'M0 0H14V12H0Z', colorId: 'black' },
      { path: 'M1 1H4V4H1Z', colorId: 'accent' },
    ],
    sourceDataUrl: 'data:image/png;base64,AAAA',
  });
  const withoutColors = (value: unknown) =>
    JSON.stringify(value, (key, entry) =>
      key === 'palette' || key === 'colorId' || key.endsWith('ColorId') ? undefined : entry,
    );
  const artworkBefore = withoutColors(project);
  assert.equal(removePaletteColor(project, 'black')?.id, 'white');
  assert.deepEqual(
    project.palette.map((color) => color.id),
    ['pink', 'white', 'accent'],
  );
  assert.equal(withoutColors(project), artworkBefore);
  const saved = JSON.parse(serializeProject(project));
  assert.doesNotThrow(() => validateProject(saved));
  assert.equal(saved.template.label.text, 'black');
  const refs: string[] = [];
  JSON.stringify(saved, (key, value) => {
    if (key === 'colorId' || key.endsWith('ColorId')) refs.push(value);
    return value;
  });
  assert.ok(refs.includes('white') && refs.includes('accent'));
  assert.ok(!refs.includes('black'));
});

test('first and unused colors can be removed, while the last color and missing IDs are protected', () => {
  const project = createProject(template);
  const before = serializeProject(project);
  assert.equal(removePaletteColor(project, 'missing'), undefined);
  assert.equal(serializeProject(project), before);
  project.palette.push({ id: 'unused', name: 'Unused', hex: '#123456' });
  assert.equal(removePaletteColor(project, 'unused')?.id, 'accent');
  assert.equal(serializeProject(project), before);
  delete project.template.frontColorId;
  delete project.template.backColorId;
  assert.equal(removePaletteColor(project, 'pink')?.id, 'white');
  assert.equal(project.template.baseColorId, 'white');
  assert.equal(project.template.frontColorId, undefined);
  assert.equal(project.template.backColorId, undefined);
  assert.equal(removePaletteColor(project, 'white')?.id, 'black');
  assert.equal(removePaletteColor(project, 'black')?.id, 'accent');
  const singleColor = serializeProject(project);
  assert.equal(removePaletteColor(project, 'accent'), undefined);
  assert.equal(serializeProject(project), singleColor);
  assert.equal(project.palette.length, 1);
  assert.doesNotThrow(() => validateProject(JSON.parse(singleColor)));
});

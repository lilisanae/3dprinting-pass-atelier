import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFontPack } from '../src/artwork/font-pack';
import { itemPath, flattenPath } from '../src/artwork/paths';
import { activeCutters, activeCuttersByTarget } from '../src/model/booleanEditing';
import { createProject } from '../src/model/project';
import type { DesignItem, TemplateData } from '../src/model/types';

const bytes = readFileSync(new URL('../public/assets/pass-font-core-v1.woff', import.meta.url));
const buffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;
const item: DesignItem = {
  id: 'cache-text',
  name: '文字',
  kind: 'text',
  text: 'AAAA\nA',
  width: 20,
  height: 10,
  x: 0,
  y: 0,
  rotation: 0,
  visible: true,
  colorId: 'pink',
};

test('moving or recoloring reuses outlines; typography, size and font changes invalidate them', () => {
  const font = parseFontPack(buffer);
  const getPath = font.getPath.bind(font);
  let calls = 0;
  font.getPath = (...args) => {
    calls += 1;
    return getPath(...args);
  };
  const path = itemPath(item, font),
    firstCalls = calls;
  assert.ok(firstCalls > 0);
  assert.equal(
    itemPath({ ...structuredClone(item), x: 13, rotation: 45, colorId: 'mint' }, font),
    path,
  );
  assert.equal(calls, firstCalls);
  for (const patch of [
    { width: 30 },
    { letterSpacing: 300 },
    { lineHeight: 2 },
    { textAlign: 'right' as const },
    { text: 'AB\nAA' },
  ]) {
    const before = calls;
    assert.notEqual(itemPath({ ...item, ...patch }, font), path);
    assert.ok(calls > before);
  }
  const second = parseFontPack(buffer);
  let otherCalls = 0;
  const otherPath = second.getPath.bind(second);
  second.getPath = (...args) => {
    otherCalls += 1;
    return otherPath(...args);
  };
  assert.equal(itemPath(item, second), path);
  assert.ok(otherCalls > 0);
});

test('resized imported regions retain offsets and holes; changed source paths are never stale', () => {
  const imported: DesignItem = {
    ...item,
    kind: 'paths',
    width: 40,
    height: 10,
    sourceWidth: 20,
    sourceHeight: 20,
    regions: [{ colorId: 'pink', path: 'M5 4H10V8H5Z M6 5V7H9V5Z' }],
  };
  const first = itemPath(imported),
    contours = flattenPath(first);
  assert.equal(contours.length, 2);
  assert.deepEqual(contours[0], [
    [10, 2],
    [20, 2],
    [20, 4],
    [10, 4],
  ]);
  assert.equal(itemPath({ ...imported, x: 35, colorId: 'mint' }), first);
  assert.notEqual(
    itemPath({ ...imported, regions: [{ colorId: 'pink', path: 'M1 1H3V3H1Z' }] }),
    first,
  );
});

test('one-pass cutter lookup preserves per-target order, visibility and face boundaries', () => {
  const template = JSON.parse(
    readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8'),
  ) as TemplateData;
  const project = createProject(template);
  project.collections = [
    {
      id: 'front',
      name: '正面',
      face: 'front',
      visible: true,
      thickness: 0.4,
      items: [
        { ...item, id: 'a' },
        { ...item, id: 'b' },
        { ...item, id: 'cut1', cutout: { targetIds: ['a', 'a', 'b', 'back'] } },
        { ...item, id: 'cut2', cutout: { targetIds: ['a'] } },
        { ...item, id: 'hidden', visible: false, cutout: { targetIds: ['a'] } },
      ],
    },
    {
      id: 'back',
      name: '背面',
      face: 'back',
      visible: true,
      thickness: 0.4,
      items: [
        { ...item, id: 'back' },
        { ...item, id: 'cut3', cutout: { targetIds: ['a', 'back'] } },
      ],
    },
    {
      id: 'hidden',
      name: '隐藏',
      face: 'front',
      visible: false,
      thickness: 0.4,
      items: [{ ...item, id: 'cut4', cutout: { targetIds: ['a'] } }],
    },
  ];
  const index = activeCuttersByTarget(project);
  for (const id of ['a', 'b', 'back', 'missing'])
    assert.deepEqual(index.get(id) ?? [], activeCutters(project, id));
  assert.deepEqual(
    index.get('a')?.map((item) => item.id),
    ['cut1', 'cut2'],
  );
});

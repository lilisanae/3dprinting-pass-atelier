import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { fontFiles, fontTier, loadFontBuffer, projectText } from '../src/artwork/font-loader';
import { packFonts, parseFontPack } from '../src/artwork/font-pack';
import { packSizes } from '../src/artwork/font-coverage';
import { createProject } from '../src/model/project';
import type { TemplateData } from '../src/model/types';

function font(name: string) {
  const directory = name.endsWith('.otf') ? '../resources/fonts/' : '../public/assets/';
  const bytes = readFileSync(new URL(`${directory}${name}`, import.meta.url));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
test('small font packs retain the original printing outlines, including rare text', () => {
  const original = font('NotoSansSC-Bold.otf');
  for (const [tier, text] of [['core', 'YOUR PASS 早苗'], ['common', '上海打印'], ['full', '髙龘']]) {
    const packed = font(`pass-font-${tier}-v1.woff`);
    assert.deepEqual(packed.getPath(text, 0, 0, 100).commands, original.getPath(text, 0, 0, 100).commands);
  }
  assert.equal(fontTier('YOUR\nPASS'), 'core');
  assert.equal(fontTier('上海打印'), 'common');
  assert.equal(fontTier('髙龘'), 'full');
  assert.ok(readFileSync(new URL('../public/assets/pass-font-core-v1.woff', import.meta.url)).length < 60000);
});
test('transient downloads retry; shared downloads are reused; failure can recover later', async () => {
  const oldFetch = globalThis.fetch;
  const urls: string[] = [];
  let failures = 1;
  let failChunks = false;
  globalThis.fetch = async input => {
    urls.push(String(input));
    if (failChunks && String(input).includes('common')) throw new TypeError('Failed to fetch');
    if (failures-- > 0) throw new TypeError('Failed to fetch');
    return new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    const [a, b] = await Promise.all([loadFontBuffer('ABC'), loadFontBuffer('YOUR')]);
    assert.equal(a, b);
    assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.endsWith('pass-font-core-v1.woff')));
    failChunks = true;
    await assert.rejects(loadFontBuffer('打印'));
    failChunks = false;
    const retry = await loadFontBuffer('打印');
    assert.ok(retry.byteLength > 3);
    assert.ok(urls.length >= 5);
    assert.ok(urls.slice(2).every(url => !url.endsWith('pass-font-common-v1.woff')));
  } finally { globalThis.fetch = oldFetch; }
});

test('common text only loads small required packs and preserves mixed text outlines and kerning', () => {
  const original = font('NotoSansSC-Bold.otf');
  const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : v));
  for (const text of ['上海打印', '新文字', '欢迎 AV 通行证 ffi 你好', 'A早苗V', '我的名字是小明']) {
    const names = fontFiles(text);
    const buffers = names.map(name => {
      const b = readFileSync(new URL(`../public/assets/${name}`, import.meta.url));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
    const loaded = parseFontPack(packFonts(buffers));
    assert.ok(names.every(name => name.includes('core') || (packSizes[name] && packSizes[name] < 140000)));
    assert.deepEqual(normalize(loaded.getPath(text, 3, 4, 100).commands), normalize(original.getPath(text, 3, 4, 100).commands));
    assert.deepEqual(normalize(loaded.getPath(text, 3, 4, 100, { kerning: false }).commands), normalize(original.getPath(text, 3, 4, 100, { kerning: false }).commands));
  }
});
test('hidden text and the original template lettering do not trigger a full font', () => {
  const template = JSON.parse(readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8')) as TemplateData;
  const project = createProject(template);
  project.template.label.text = '髙';
  project.collections[0].items.push({ ...project.collections[1].items.find(i => i.kind === 'text')!, text: '龘', visible: false });
  assert.equal(fontTier(projectText(project)), 'core');
  project.template.label.useOriginal = false;
  assert.equal(fontTier(projectText(project)), 'full');
});

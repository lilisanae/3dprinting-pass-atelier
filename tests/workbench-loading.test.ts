import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareWorkbench, type PreparationProgress } from '../src/ui/prepareWorkbench';
import { previewDeadline } from '../src/ui/loadPreview';
import { createProject } from '../src/model/project';
import type { TemplateData, GeneratedModel } from '../src/model/types';
import GeometryClient from '../src/geometry/client';
import { downloadBuffer } from '../src/io/download';

const template = JSON.parse(readFileSync(new URL('../public/assets/template.json', import.meta.url), 'utf8')) as TemplateData;
const project = createProject(template);
const model = { meshes: [] } as unknown as GeneratedModel;
const font = { unitsPerEm: 1000 } as Awaited<ReturnType<typeof import('../src/artwork/font-loader').loadFont>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('editing waits for accurate glyphs but no longer waits for 3D or geometry', async () => {
  const glyphs = deferred<typeof font>();
  const updates: PreparationProgress[] = [];
  let opened = false;
  const pending = prepareWorkbench(p => updates.push(p), () => false, {
    template: async () => template, restore: () => project,
    font: async (_, report) => { report?.({ loaded: 50, total: 100 }); return glyphs.promise; },
  }).then(result => { opened = true; return result; });
  await new Promise(r => setImmediate(r));
  assert.equal(opened, false);
  glyphs.resolve(font);
  const ready = await pending;
  assert.equal(ready.project, project);
  assert.equal(ready.font, font);
  assert.equal(opened, true);
  assert.equal('model' in ready || 'client' in ready, false);
  assert.equal(updates.at(-1)!.percent, 100);
  assert.ok(updates.every((p, i) => i === 0 || p.percent >= updates[i - 1].percent));
});

test('download failure leaves the design intact and a new preparation attempt can recover', async () => {
  const snapshot = JSON.stringify(project);
  let failures = 1;
  const dependencies = {
    template: async () => template, restore: () => project,
    font: async () => { if (failures-- > 0) throw new Error('字库下载中断'); return font; },
  };
  await assert.rejects(prepareWorkbench(() => {}, () => false, dependencies), /字库下载中断/);
  assert.equal(JSON.stringify(project), snapshot);
  const ready = await prepareWorkbench(() => {}, () => false, dependencies);
  assert.equal(ready.project, project);
});

test('streaming downloads report actual byte progress and propagate interrupted reads', async () => {
  const original = globalThis.fetch;
  const progress: number[] = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close(); },
  }), { headers: { 'Content-Length': '3' } });
  try {
    const data = await downloadBuffer('/font', '字库', 3, p => progress.push(p.loaded));
    assert.deepEqual([...new Uint8Array(data)], [1, 2, 3]);
    assert.ok(progress.includes(2));
    assert.equal(progress.at(-1), 3);
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection lost')); } }));
    await assert.rejects(downloadBuffer('/font', '字库'), /connection lost/);
  } finally { globalThis.fetch = original; }
});

test('stalled 3D downloads fail explicitly instead of leaving the progress bar forever', async () => {
  await assert.rejects(previewDeadline(new Promise(() => {}), 5), /三维预览下载暂时没有响应/);
  assert.equal(await previewDeadline(Promise.resolve('ready'), 5), 'ready');
});

test('stalled generation closes its worker and a retry creates a working worker', async () => {
  const oldWorker = globalThis.Worker, oldFetch = globalThis.fetch;
  let workers = 0, terminated = 0;
  class FakeWorker {
    number = ++workers;
    onmessage?: (event: unknown) => void;
    postMessage(message: { type: string; id: number }) {
      if (this.number > 1 && message.type === 'generate') queueMicrotask(() => this.onmessage?.({ data: { id: message.id, model } }));
    }
    terminate() { terminated++; }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
  const client = new GeometryClient(template, 5);
  try {
    await assert.rejects(client.generate(project), /生成引擎暂时没有响应/);
    assert.ok(terminated >= 1);
    const result = await client.generate(project);
    assert.equal(result.revision, 2);
    assert.equal(workers, 2);
  } finally { client.dispose(); globalThis.Worker = oldWorker; globalThis.fetch = oldFetch; }
});

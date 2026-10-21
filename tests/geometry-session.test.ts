import test from 'node:test';
import assert from 'node:assert/strict';
import { GeometrySession } from '../src/geometry/session';
import type GeometryClient from '../src/geometry/client';
import type { GeneratedModel, Project, TemplateData } from '../src/model/types';

const template = {} as TemplateData, project = {} as Project;
test('geometry is lazy, shared by model and merge, and loading failures retry', async () => {
  let loads = 0;
  const model = {} as GeneratedModel;
  const session = new GeometrySession(template, async () => {
    if (++loads === 1) throw new Error('download failed');
    return { generate: async () => model, merge: async () => ({ id: 'merged' }), dispose() {} } as unknown as GeometryClient;
  });
  assert.equal(loads, 0);
  await assert.rejects(session.generate(project), /download failed/);
  const [result, merged] = await Promise.all([session.generate(project), session.merge(project, null)]);
  assert.equal(result, model); assert.equal(merged.id, 'merged'); assert.equal(loads, 2);
  session.dispose();
  await assert.rejects(session.generate(project), /已关闭/);
});

test('closing while a module loads disposes its late worker without generating', async () => {
  let resolve!: (client: GeometryClient) => void, disposed = 0, generated = 0;
  const session = new GeometrySession(template, () => new Promise((r) => { resolve = r; }));
  const job = session.generate(project);
  session.dispose();
  resolve({ generate() { generated++; }, dispose() { disposed++; } } as unknown as GeometryClient);
  await assert.rejects(job, /已关闭/);
  assert.equal(disposed, 1); assert.equal(generated, 0);
});

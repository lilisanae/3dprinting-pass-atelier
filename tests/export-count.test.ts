import test from 'node:test';
import assert from 'node:assert/strict';
import { recordModelExport } from '../src/io/exportCount';

test('export telemetry sends only a format and can never break a download', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalFetch = globalThis.fetch;
  try {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'beatsanae.cn' },
    });
    const sent: Array<{ input: unknown; options?: RequestInit }> = [];
    globalThis.fetch = async (input, options) => {
      sent.push({ input, options });
      return new Response(null, { status: 204 });
    };
    recordModelExport('3mf');
    recordModelExport('stl');
    assert.deepEqual(
      sent.map(({ options }) => JSON.parse(String(options?.body))),
      [{ kind: '3mf' }, { kind: 'stl' }],
    );
    assert.equal(sent[0].options?.credentials, 'omit');
    assert.equal(sent[0].options?.keepalive, true);
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: '127.0.0.1' },
    });
    recordModelExport('3mf');
    assert.equal(sent.length, 2);
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'beatsanae.cn' },
    });
    globalThis.fetch = () => {
      throw new Error('offline');
    };
    assert.doesNotThrow(() => recordModelExport('3mf'));
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

type CacheEntry = { url: string; size: number; sha256: string };
type Manifest = { generation: string; builtAt?: number; entries: CacheEntry[] };
type EventHandler = (event: unknown) => void;

type CacheRequest = Request | string;
const requestKey = (request: CacheRequest) =>
  typeof request === 'string' ? request : request.url;

class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(request: CacheRequest) {
    const entry = this.entries.get(requestKey(request));
    return entry ? entry.clone() : undefined;
  }
  async put(request: CacheRequest, response: Response) {
    this.entries.set(requestKey(request), response.clone());
  }
  async delete(request: CacheRequest) {
    return this.entries.delete(requestKey(request));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async keys() {
    return [...this.caches.keys()];
  }
  async open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
  async match(
    request: CacheRequest,
    options?: { cacheName?: string; ignoreVary?: boolean },
  ) {
    const names = options?.cacheName ? [options.cacheName] : [...this.caches.keys()];
    for (const name of names) {
      const response = await this.caches.get(name)?.match(request);
      if (response) return response;
    }
    return undefined;
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
}

type WorkerHarness = { handlers: Map<string, EventHandler>; caches: FakeCacheStorage };

function loadWorker(
  manifest: Manifest,
  options: {
    scope?: string;
    fetch: (request: Request) => Promise<Response>;
    caches?: FakeCacheStorage;
  },
): WorkerHarness {
  const source = readFileSync(
    new URL('../public/workshop-cache-worker.js', import.meta.url),
    'utf8',
  );
  const startMarker = '/*__WORKSHOP_CACHE_MANIFEST_START__*/';
  const endMarker = '/*__WORKSHOP_CACHE_MANIFEST_END__*/';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'worker manifest markers');
  const code =
    source.slice(0, start) + JSON.stringify(manifest) + source.slice(end + endMarker.length);
  const handlers = new Map<string, EventHandler>();
  const storage = options.caches ?? new FakeCacheStorage();
  const self = {
    registration: { scope: options.scope ?? 'https://example.test/pass/' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener(type: string, handler: EventHandler) {
      handlers.set(type, handler);
    },
  };
  const context = vm.createContext({
    self,
    caches: storage,
    fetch: options.fetch,
    Response,
    Request,
    Headers,
    URL,
    crypto: webcrypto,
    console,
  });
  vm.runInContext(code, context);
  return { handlers, caches: storage };
}

async function dispatch(worker: WorkerHarness, url: string, init?: RequestInit) {
  const state: { response?: Promise<Response> } = {};
  const waits: Promise<unknown>[] = [];
  const event = {
    request: new Request(url, init),
    respondWith(value: Promise<Response>) {
      state.response = value;
    },
    waitUntil(value: Promise<unknown>) {
      waits.push(value);
    },
  };
  worker.handlers.get('fetch')?.(event);
  const response = state.response ? await state.response : undefined;
  await Promise.all(waits);
  return { response, intercepted: Boolean(state.response) };
}

async function activate(worker: WorkerHarness) {
  const waits: Promise<unknown>[] = [];
  worker.handlers.get('activate')?.({
    waitUntil(value: Promise<unknown>) {
      waits.push(value);
    },
  });
  await Promise.all(waits);
}

function cacheEntry(url: string, body: string): CacheEntry {
  const bytes = Buffer.from(body);
  return {
    url,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const PASS_ORIGIN = 'https://example.test/pass/';
const APP_URL = `${PASS_ORIGIN}assets/app.js`;
const APP_BODY = 'console.log("workshop")';
const cacheName = (generation: string) => `workshop-static-v1:/pass/:${generation}`;

test('cache hit is served without any network request', async () => {
  const item = cacheEntry('assets/app.js', APP_BODY);
  const manifest: Manifest = { generation: 'g1', entries: [item] };
  const storage = new FakeCacheStorage();
  const cache = await storage.open(cacheName('g1'));
  await cache.put(
    new Request(APP_URL),
    new Response(APP_BODY, { headers: { 'x-workshop-cache-hash': item.sha256 } }),
  );
  let requests = 0;
  const worker = loadWorker(manifest, {
    caches: storage,
    fetch: async () => {
      requests++;
      return new Response('network');
    },
  });
  const { response, intercepted } = await dispatch(worker, APP_URL);
  assert.equal(intercepted, true);
  assert.equal(requests, 0);
  assert.equal(response?.headers.get('x-workshop-cache'), 'hit');
  assert.equal(await response?.text(), APP_BODY);
});

test('first network response is verified, cached and reused', async () => {
  const item = cacheEntry('assets/app.js', APP_BODY);
  const manifest: Manifest = { generation: 'g1', entries: [item] };
  const storage = new FakeCacheStorage();
  let requests = 0;
  const worker = loadWorker(manifest, {
    caches: storage,
    fetch: async () => {
      requests++;
      return new Response(APP_BODY, {
        headers: {
          'content-type': 'application/javascript',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    },
  });
  const first = await dispatch(worker, APP_URL);
  assert.equal(await first.response?.text(), APP_BODY);
  const cache = storage.caches.get(cacheName('g1'));
  assert.ok(cache);
  const stored = await cache.match(new Request(APP_URL));
  assert.equal(stored?.headers.get('x-workshop-cache-hash'), item.sha256);
  assert.equal(await stored?.text(), APP_BODY);

  const second = await dispatch(worker, APP_URL);
  assert.equal(requests, 1);
  assert.equal(second.response?.headers.get('x-workshop-cache'), 'hit');
  assert.equal(await second.response?.text(), APP_BODY);
});

test('wrong, truncated or hash-mismatched responses are never cached', async () => {
  const expected = '0123456789';
  const item = cacheEntry('assets/font.woff', expected);
  const manifest: Manifest = { generation: 'g1', entries: [item] };
  const storage = new FakeCacheStorage();
  let requests = 0;
  const bodies = ['short', 'abcdefghij', expected];
  const worker = loadWorker(manifest, {
    caches: storage,
    fetch: async () => {
      requests++;
      return new Response(bodies[Math.min(requests - 1, bodies.length - 1)]);
    },
  });
  for (let index = 0; index < 2; index++) await dispatch(worker, APP_URL.replace('app.js', 'font.woff'));
  const cache = storage.caches.get(cacheName('g1'));
  assert.equal(cache?.entries.size ?? 0, 0);

  const accepted = await dispatch(worker, APP_URL.replace('app.js', 'font.woff'));
  assert.equal(await accepted.response?.text(), expected);
  assert.equal(requests, 3);
  assert.equal(cache?.entries.size, 1);
});

test('a previous generation with an identical URL and hash is reused and promoted', async () => {
  const body = 'large-font-bytes';
  const item = cacheEntry('assets/font.woff', body);
  const manifest: Manifest = { generation: '000000000000002-new', entries: [item] };
  const storage = new FakeCacheStorage();
  const old = await storage.open(cacheName('000000000000001-old'));
  await old.put(
    new Request(`${PASS_ORIGIN}assets/font.woff`),
    new Response(body, { headers: { 'x-workshop-cache-hash': item.sha256 } }),
  );
  let requests = 0;
  const worker = loadWorker(manifest, {
    caches: storage,
    fetch: async () => {
      requests++;
      return new Response('network');
    },
  });
  const { response } = await dispatch(worker, `${PASS_ORIGIN}assets/font.woff`);
  assert.equal(requests, 0);
  assert.equal(response?.headers.get('x-workshop-cache'), 'hit');
  assert.equal(await response?.text(), body);

  const current = storage.caches.get(cacheName('000000000000002-new'));
  assert.ok(current);
  const promoted = await current.match(new Request(`${PASS_ORIGIN}assets/font.woff`));
  assert.equal(promoted?.headers.get('x-workshop-cache-hash'), item.sha256);
  assert.equal(await promoted?.text(), body);
});

test('activation keeps the current and one previous generation only', async () => {
  const item = cacheEntry('assets/app.js', APP_BODY);
  const manifest: Manifest = { generation: '000000000000003-current', entries: [item] };
  const storage = new FakeCacheStorage();
  await storage.open(cacheName('000000000000000-oldest'));
  await storage.open(cacheName('000000000000001-old'));
  await storage.open(cacheName('000000000000003-current'));
  const worker = loadWorker(manifest, {
    caches: storage,
    fetch: async () => new Response(APP_BODY),
  });
  await activate(worker);
  assert.deepEqual((await storage.keys()).sort(), [
    cacheName('000000000000001-old'),
    cacheName('000000000000003-current'),
  ]);
});

test('cache storage failure and quota errors fall back to the network', async () => {
  const item = cacheEntry('assets/app.js', APP_BODY);
  const manifest: Manifest = { generation: 'g1', entries: [item] };
  const broken = {
    keys: async () => {
      throw new Error('storage denied');
    },
    open: async () => {
      throw new Error('storage denied');
    },
    match: async () => {
      throw new Error('storage denied');
    },
    delete: async () => {
      throw new Error('storage denied');
    },
  } as unknown as FakeCacheStorage;
  const worker = loadWorker(manifest, {
    caches: broken,
    fetch: async () => new Response(APP_BODY),
  });
  const { response } = await dispatch(worker, APP_URL);
  assert.equal(await response?.text(), APP_BODY);

  const storage = new FakeCacheStorage();
  const cache = await storage.open(cacheName('g1'));
  cache.put = async () => {
    throw new Error('quota exceeded');
  };
  const quotaWorker = loadWorker(manifest, {
    caches: storage,
    fetch: async () => new Response(APP_BODY),
  });
  const fallback = await dispatch(quotaWorker, APP_URL);
  assert.equal(await fallback.response?.text(), APP_BODY);
});

test('only exact manifest URLs inside the worker scope are intercepted', async () => {
  const item = cacheEntry('assets/app.js', APP_BODY);
  const template = cacheEntry('assets/template.json?v=build-1', '{}');
  const manifest: Manifest = { generation: 'g1', entries: [item, template] };
  const worker = loadWorker(manifest, {
    fetch: async () => new Response(APP_BODY),
  });
  for (const url of [
    'https://example.test/assets/app.js',
    'https://example.test/pass/api/site-stats/export',
    'https://example.test/pass/index.html',
    'https://example.test/pass/assets/other.js',
    'https://other.test/pass/assets/app.js',
    'https://example.test/pass/assets/template.json?v=old-build',
  ]) {
    const { intercepted } = await dispatch(worker, url);
    assert.equal(intercepted, false, url);
  }
  assert.equal((await dispatch(worker, APP_URL)).intercepted, true);
  assert.equal(
    (await dispatch(worker, 'https://example.test/pass/assets/template.json?v=build-1'))
      .intercepted,
    true,
  );
});

test('root deployments use root-relative manifest entries', async () => {
  const item = cacheEntry('assets/app.js', APP_BODY);
  const manifest: Manifest = { generation: 'g1', entries: [item] };
  let requests = 0;
  const worker = loadWorker(manifest, {
    scope: 'https://example.test/',
    fetch: async () => {
      requests++;
      return new Response(APP_BODY);
    },
  });
  const { intercepted, response } = await dispatch(worker, 'https://example.test/assets/app.js');
  assert.equal(intercepted, true);
  assert.equal(await response?.text(), APP_BODY);
  assert.equal(requests, 1);
});

test('the inline registration derives the exact worker URL and scope from the page prefix', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((code) => code.includes('workshop-cache-worker.js'));
  assert.ok(script, 'inline registration script');
  const registrationsFor = (pathname: string) => {
    const registrations: Array<{ url: string; scope: unknown }> = [];
    const context = vm.createContext({
      window: { isSecureContext: true },
      location: { pathname },
      navigator: {
        serviceWorker: {
          register(url: string, options: { scope?: unknown }) {
            registrations.push({ url, scope: options.scope });
            return Promise.resolve({});
          },
        },
      },
      Promise,
      console,
    });
    vm.runInContext(script!, context);
    return registrations;
  };
  assert.deepEqual(registrationsFor('/pass/'), [
    { url: '/pass/workshop-cache-worker.js', scope: '/pass/' },
  ]);
  assert.deepEqual(registrationsFor('/pass'), [
    { url: '/pass/workshop-cache-worker.js', scope: '/pass/' },
  ]);
  assert.deepEqual(registrationsFor('/atelier/badge/'), [
    { url: '/atelier/badge/workshop-cache-worker.js', scope: '/atelier/badge/' },
  ]);
  assert.deepEqual(registrationsFor('/'), [
    { url: '/workshop-cache-worker.js', scope: '/' },
  ]);
  assert.deepEqual(registrationsFor('/blog/'), []);
});

test('the built worker embeds every cacheable asset and no documents or APIs', {
  skip: !existsSync(new URL('../dist/workshop-cache-worker.js', import.meta.url)),
}, () => {
  const worker = readFileSync(new URL('../dist/workshop-cache-worker.js', import.meta.url), 'utf8');
  const match = worker.match(/const MANIFEST = (\{[\s\S]*?\});\s*const ENTRIES/);
  assert.ok(match, 'generated manifest');
  const manifest = JSON.parse(match[1]) as Manifest;
  assert.ok(manifest.entries.length > 0);
  const assets = new URL('../dist/assets/', import.meta.url);
  for (const name of readdirSync(assets).filter((file) =>
    /\.(?:js|mjs|css|woff2?|wasm|json)$/.test(file),
  )) {
    const url =
      name === 'template.json'
        ? manifest.entries.find((entry) => entry.url.startsWith('assets/template.json?v='))?.url
        : `assets/${name}`;
    assert.ok(
      url && manifest.entries.some((entry) => entry.url === url),
      `missing ${name}`,
    );
  }
  assert.ok(
    manifest.entries.every(
      (entry) =>
        /^[a-f0-9]{64}$/.test(entry.sha256) &&
        entry.size > 0 &&
        !entry.url.endsWith('.html') &&
        !entry.url.includes('/api/') &&
        entry.url !== 'workshop-cache-worker.js',
    ),
  );
  const headers = readFileSync(new URL('../dist/_headers', import.meta.url), 'utf8');
  assert.match(headers, /\/workshop-cache-worker\.js\n\s+Cache-Control: no-cache/);
});

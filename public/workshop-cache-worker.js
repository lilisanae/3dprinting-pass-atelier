/*
 * Workshop static-asset cache.
 *
 * The build replaces the manifest block below with an exact allow-list of
 * public program assets (JS/CSS/workers/WASM/fonts/template) plus their sizes
 * and SHA-256 digests. Everything else, especially HTML, APIs, feedback,
 * analytics and user files, is never intercepted.
 */
'use strict';

const MANIFEST = /*__WORKSHOP_CACHE_MANIFEST_START__*/{
  generation: 'dev',
  builtAt: 0,
  entries: [],
}/*__WORKSHOP_CACHE_MANIFEST_END__*/;

const ENTRIES = new Map((MANIFEST.entries || []).map((entry) => [entry.url, entry]));
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/')
  ? SCOPE_URL.pathname
  : SCOPE_URL.pathname + '/';
// Cache Storage is shared by the whole origin, so keep each workshop prefix in
// its own namespace. /pass/ never sees or prunes /badge/ or /atelier/pass/.
const CACHE_PREFIX = `workshop-static-v1:${SCOPE_PATH}:`;
const CURRENT_CACHE = CACHE_PREFIX + (MANIFEST.generation || 'dev');

function entryFor(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.origin !== SCOPE_URL.origin) return null;
  if (!target.pathname.startsWith(SCOPE_PATH)) return null;
  const relative = target.pathname.slice(SCOPE_PATH.length) + target.search;
  return (relative && ENTRIES.get(relative)) || null;
}

function requestFor(entry) {
  return new Request(new URL(entry.url, SCOPE_URL).href);
}

function isValid(response, entry) {
  return (
    !!response &&
    response.status === 200 &&
    response.headers.get('x-workshop-cache-hash') === entry.sha256
  );
}

function markHit(response) {
  const headers = new Headers(response.headers);
  headers.set('x-workshop-cache', 'hit');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function oldCaches(keys) {
  return keys
    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CURRENT_CACHE)
    .sort();
}

async function pruneCaches() {
  if (!ENTRIES.size) return;
  const keys = oldCaches(await caches.keys());
  // Keep exactly one previous generation so unchanged fingerprinted assets
  // (notably the large font subsets) survive a deployment without a refetch.
  while (keys.length > 1) await caches.delete(keys.shift());
}

async function cachedResponse(entry, event) {
  const request = requestFor(entry);
  try {
    const current = await caches.open(CURRENT_CACHE);
    const response = await current.match(request, { ignoreVary: true });
    if (isValid(response, entry)) return markHit(response);
    if (response) await current.delete(request);
  } catch {
    // Cache Storage can be unavailable or over quota; fall through to network.
  }
  try {
    for (const name of oldCaches(await caches.keys())) {
      const response = await caches.match(request, { cacheName: name, ignoreVary: true });
      if (!isValid(response, entry)) continue;
      // Promote a still-identical asset into the current generation. This keeps
      // it available after the previous generation is eventually pruned.
      try {
        const current = await caches.open(CURRENT_CACHE);
        const task = current.put(request, response.clone()).catch(() => {});
        try {
          event.waitUntil(task);
        } catch {
          // A completed fetch event can ignore promotion.
        }
      } catch {
        // Serving the old-generation copy is still correct.
      }
      return markHit(response);
    }
  } catch {
    // Ignore storage failures and continue with the network request.
  }
  return null;
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function store(response, entry) {
  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    return;
  }
  if (buffer.byteLength !== entry.size) return;
  if ((await sha256(buffer)) !== entry.sha256) return;
  const headers = new Headers(response.headers);
  // The stored body is the decoded file. Remove transport metadata so a cached
  // response is not decoded twice and can be validated by the app.
  for (const name of ['content-encoding', 'transfer-encoding', 'content-range', 'accept-ranges']) {
    headers.delete(name);
  }
  headers.set('content-length', String(buffer.byteLength));
  headers.set('x-workshop-cache-hash', entry.sha256);
  headers.set('x-workshop-cache-size', String(entry.size));
  try {
    const cache = await caches.open(CURRENT_CACHE);
    await cache.put(
      requestFor(entry),
      new Response(buffer, { status: 200, statusText: 'OK', headers }),
    );
  } catch {
    // Quota or storage failures must never block the network response.
  }
}

async function respond(event, entry) {
  const hit = await cachedResponse(entry, event);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.status !== 200 || response.type === 'opaque') return response;
  const task = store(response.clone(), entry).catch(() => {});
  try {
    event.waitUntil(task);
  } catch {
    // The response still reaches the page even if its lifetime cannot be extended.
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch {
        // Existing pages may still be controlled on their next visit.
      }
      try {
        await pruneCaches();
      } catch {
        // Storage cleanup is best effort.
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range') || request.headers.has('authorization')) return;
  const entry = entryFor(request.url);
  if (!entry) return;
  event.respondWith(respond(event, entry));
});

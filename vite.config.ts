import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// A new id per build versions the cache generation. The unhashed template URL
// uses its content hash instead, so an unchanged template is reused across deploys.
const WORKSHOP_BUILD_ID = String(Date.now());
const TEMPLATE_VERSION = createHash('sha256')
  .update(readFileSync(resolve('public/assets/template.json')))
  .digest('hex')
  .slice(0, 16);
const CACHEABLE_ASSET = /^assets\/[^/]+\.(?:js|mjs|css|woff2?|wasm|json)$/i;

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function workshopCacheManifest(): Plugin {
  return {
    name: 'workshop-cache-manifest',
    apply: 'build',
    writeBundle(options) {
      const outDir = resolve(options.dir ?? 'dist');
      const workerFile = join(outDir, 'workshop-cache-worker.js');
      const source = readFileSync(workerFile, 'utf8');
      const startMarker = '/*__WORKSHOP_CACHE_MANIFEST_START__*/';
      const endMarker = '/*__WORKSHOP_CACHE_MANIFEST_END__*/';
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker);
      if (start < 0 || end < start)
        throw new Error('workshop-cache-worker.js is missing its manifest markers');
      const entries = walkFiles(outDir)
        .map((file) => relative(outDir, file).replace(/\\/g, '/'))
        .filter((name) => CACHEABLE_ASSET.test(name))
        .map((name) => {
          const buffer = readFileSync(join(outDir, name));
          return {
            url:
              name === 'assets/template.json'
                ? `${name}?v=${TEMPLATE_VERSION}`
                : name,
            size: buffer.byteLength,
            sha256: createHash('sha256').update(buffer).digest('hex'),
          };
        })
        .sort((a, b) => a.url.localeCompare(b.url));
      const generationHash = createHash('sha256')
        .update(entries.map((entry) => `${entry.url}\0${entry.size}\0${entry.sha256}`).join('\n'))
        .digest('hex')
        .slice(0, 16);
      const manifest = {
        generation: `${WORKSHOP_BUILD_ID}-${generationHash}`,
        builtAt: new Date().toISOString(),
        entries,
      };
      writeFileSync(
        workerFile,
        source.slice(0, start) +
          JSON.stringify(manifest, null, 2) +
          source.slice(end + endMarker.length),
      );
    },
  };
}

export default defineConfig({
  define: {
    __WORKSHOP_TEMPLATE_VERSION__: JSON.stringify(TEMPLATE_VERSION),
  },
  plugins: [
    react(),
    {
      name: 'versioned-asset-cache',
      writeBundle(options, bundle) {
        const longCache = '  Cache-Control: public, max-age=31536000, immutable';
        const hashed = Object.keys(bundle).filter((name) =>
          /-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(name),
        );
        const worker = [
          '/workshop-cache-worker.js',
          '/pass/workshop-cache-worker.js',
          '/badge/workshop-cache-worker.js',
          '/atelier/pass/workshop-cache-worker.js',
          '/atelier/badge/workshop-cache-worker.js',
        ].map((path) => `${path}\n  Cache-Control: no-cache, must-revalidate`);
        const rules = [
          '/\n  Cache-Control: public, max-age=0, must-revalidate',
          '/index.html\n  Cache-Control: public, max-age=0, must-revalidate',
          ...worker,
          ...['template.json', 'pass-reference.jpg'].map(
            (name) =>
              `/assets/${name}\n  Cache-Control: public, max-age=3600, stale-while-revalidate=86400`,
          ),
          ...['pass-font-*', 'text-sans-regular-*', 'text-serif-regular-*'].map(
            (name) => `/assets/${name}\n${longCache}`,
          ),
          ...hashed.map((name) => `/${name}\n${longCache}`),
        ];
        writeFileSync(resolve(options.dir!, '_headers'), rules.join('\n\n') + '\n');
      },
    },
    workshopCacheManifest(),
  ],
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          ui: ['react', 'react-dom', 'react-dom/client'],
          typography: ['opentype.js', 'svg-path-parser'],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/.qa/**', '**/output/**'] } },
});

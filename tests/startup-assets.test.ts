import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dist = new URL('../dist/', import.meta.url);
test('editing entry excludes 3D, worker, legacy recovery and print settings; compact progress stays available', { skip: !existsSync(new URL('index.html', dist)) }, () => {
  const html = readFileSync(new URL('index.html', dist), 'utf8');
  const entry = html.match(/src="([^"]+\.js)"/)![1].replace(/^\.\//, '');
  const visited = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const code = readFileSync(new URL(name, dist), 'utf8');
    // Current compact IndexedDB progress is needed to restore either project type.
    assert.doesNotMatch(code, /filament_loading_speed/);
    for (const match of code.matchAll(/\bfrom\s*["'](\.\/[^"']+\.js)["']/g))
      visit(path.posix.join(path.posix.dirname(name), match[1]));
  }
  visit(entry);
  assert.ok([...visited].every((name) => !/ThreePreview|worker-|client-|legacyProject|preset-/.test(name)));
  assert.equal(existsSync(new URL('assets/NotoSansSC-Bold.otf', dist)), false);
  const rules = readFileSync(new URL('_headers', dist), 'utf8').trim().split(/\n\s*\n/).map((block) => {
    const [pattern, header] = block.split('\n');
    return { pattern, header, regex: new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*') + '$') };
  });
  assert.ok(rules.length <= 100);
  for (const name of readdirSync(new URL('assets/', dist)).filter((name) => /\.js$|\.css$|\.wasm$|\.woff$/.test(name))) {
    const matching = rules.filter((rule) => rule.regex.test(`/assets/${name}`));
    assert.equal(matching.length, 1, name);
    assert.match(matching[0].header, /31536000, immutable/);
  }
  assert.match(rules.find((rule) => rule.pattern === '/')!.header, /must-revalidate/);
});

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const output = join(root, 'release');
mkdirSync(output, { recursive: true });
const read = (f) => new Uint8Array(readFileSync(join(root, f)));
function collect(dir, prefix = '') {
  const files = {};
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const f = dir + '/' + e.name;
    if (e.isDirectory()) Object.assign(files, collect(f, prefix + e.name + '/'));
    else files[prefix + e.name] = read(f);
  }
  return files;
}
const web = collect('dist');
Object.assign(web, collect('examples', 'examples/'));
web['preview.cjs'] = read('scripts/preview.cjs');
web['start-preview.cmd'] = read('start-preview.cmd');
web['LICENSE'] = read('LICENSE');
web['THIRD_PARTY.md'] = read('THIRD_PARTY.md');
web['使用说明.txt'] = new TextEncoder().encode(
  '完整解压后，通过HTTP(S)运行。安装Node.js后双击start-preview.cmd，或运行node preview.cjs . 并打开本机网址。\n作品会自动保存在当前浏览器；请下载.pass.json / .badge.json备份。三维模型下载为3MF或分色STL，需自行切片与试打。完整部署应包括workshop-cache-worker.js和assets。\n',
);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const source = {};
for (const f of tracked) {
  if (
    /(^|\/)(?:\.env(?:\..*)?|HANDOFF\.md|node_modules|\.qa|\.git|release|dist|output)(?:\/|$)/i.test(
      f,
    )
  )
    throw Error('Unexpected source publication path: ' + f);
  source[f] = read(f);
}
const manifest = [];
for (const [kind, files] of [
  ['web', web],
  ['source', source],
]) {
  const name = 'pass-atelier-' + kind + '-v' + version + '.zip';
  const bytes = zipSync(files, { level: 6 });
  writeFileSync(join(output, name), bytes);
  manifest.push({
    file: name,
    bytes: bytes.length,
    entries: Object.keys(files).length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
const exampleName = 'yurisaki.pass.json';
const exampleBytes = read('examples/' + exampleName);
writeFileSync(join(output, exampleName), exampleBytes);
manifest.push({
  file: exampleName,
  bytes: exampleBytes.length,
  entries: 1,
  sha256: createHash('sha256').update(exampleBytes).digest('hex'),
});
writeFileSync(
  join(output, 'checksums.sha256'),
  manifest.map((x) => x.sha256 + '  ' + x.file).join('\n') + '\n',
);
console.log(JSON.stringify(manifest, null, 2));

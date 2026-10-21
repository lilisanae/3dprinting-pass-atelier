import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sections = [
  'Pass Atelier · Third-party runtime notices\nFont licenses: assets/FONT-LICENSE.txt, assets/text-sans-regular-LICENSE.txt, assets/text-serif-regular-LICENSE.txt\n',
];
for (const name of Object.keys(project.dependencies)) {
  const directory = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  sections.push(
    `\n======== ${name} ${metadata.version} (${JSON.stringify(metadata.license)}) ========\n`,
  );
  const entries = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && /^(license|notice|copying)(\.|$)/i.test(entry.name),
  );
  for (const entry of entries)
    sections.push(await readFile(path.join(directory, entry.name), 'utf8'));
}
await writeFile(path.join(root, 'public/assets/THIRD-PARTY-NOTICES.txt'), sections.join('\n'));

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  'DevAdmin!2026',
  'DevStarter!2026',
  'DevPro!2026',
  'DevUltra!2026'
];

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(target);
    return statSync(target).isFile() ? [target] : [];
  });
}

const roots = [path.join(root, 'src'), path.join(root, 'dist')];
const hits = [];
for (const file of roots.flatMap(filesUnder)) {
  const content = readFileSync(file, 'utf8');
  for (const credential of forbidden) {
    if (content.includes(credential)) {
      hits.push(`${path.relative(root, file)}:${credential}`);
    }
  }
}

if (hits.length > 0) {
  console.error(`Bundled development credentials found:\n${hits.join('\n')}`);
  process.exit(1);
}

console.log('Credential hygiene OK: 4 forbidden development passwords absent from frontend src/dist');

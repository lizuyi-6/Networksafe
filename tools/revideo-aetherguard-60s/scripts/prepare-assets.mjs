import {copyFileSync, mkdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(projectDir, '..', '..');
const assetsDir = path.join(projectDir, 'public', 'assets');
const fontsDir = path.join(projectDir, 'public', 'fonts');
const audioDir = path.join(projectDir, 'public', 'audio');
const outputDir = path.join(projectDir, 'output');

const assets = [
  ['frontend/public/aetherguard-logo-512.png', 'aetherguard-logo.png'],
  ['docs/screenshots/02-dashboard.png', 'dashboard.png'],
  ['docs/screenshots/06-traffic.png', 'traffic.png'],
  ['docs/screenshots/05-agent-monitor.png', 'agent-monitor.png'],
  ['docs/screenshots/15-history.png', 'history.png'],
  ['frontend/src/assets/landing-workshop/appliance-assembly.png', 'appliance.png'],
];

const fonts = [
  ['frontend/public/fonts/HarmonyOS_Sans_Regular.ttf', 'HarmonyOS_Sans_Regular.ttf'],
];

for (const dir of [assetsDir, fontsDir, audioDir, outputDir]) {
  mkdirSync(dir, {recursive: true});
}

const copied = [];
for (const [source, target] of [...assets.map((item) => [item[0], path.join('assets', item[1])]), ...fonts.map((item) => [item[0], path.join('fonts', item[1])])]) {
  const sourcePath = path.join(repoRoot, source);
  const targetPath = path.join(projectDir, 'public', target);
  const sourceStat = statSync(sourcePath);
  if (!sourceStat.isFile()) throw new Error(`Not a file: ${source}`);
  copyFileSync(sourcePath, targetPath);
  copied.push({source, target: `public/${target.replaceAll('\\', '/')}`, bytes: sourceStat.size});
}

writeFileSync(
  path.join(assetsDir, 'manifest.json'),
  `${JSON.stringify({generatedAt: new Date().toISOString(), copied}, null, 2)}\n`,
);

for (const entry of copied) {
  console.log(`asset ${entry.source} -> ${entry.target} (${entry.bytes} bytes)`);
}

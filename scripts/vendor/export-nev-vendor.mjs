import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), '..', '..');
const templateRoot = resolve(repoRoot, 'vendor-templates', 'networksafe-nev-vendor');

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const force = args.includes('--force');
if (targetIndex === -1 || !args[targetIndex + 1]) {
  console.error('Usage: node scripts/vendor/export-nev-vendor.mjs --target <path> [--force]');
  process.exit(1);
}

const targetRoot = resolve(process.cwd(), args[targetIndex + 1]);
if (existsSync(targetRoot)) {
  if (!force) {
    console.error(`Target already exists: ${targetRoot}`);
    process.exit(1);
  }
  await rm(targetRoot, { recursive: true, force: true });
}

await mkdir(dirname(targetRoot), { recursive: true });
await cp(templateRoot, targetRoot, { recursive: true, filter: (source) => !source.includes(`${resolve(templateRoot, 'node_modules')}`) });

function runGit(argsToRun) {
  if (process.platform === 'win32') {
    try {
      return execFileSync('git.exe', argsToRun, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
    } catch {
      return execFileSync('cmd.exe', ['/d', '/s', '/c', `git ${argsToRun.join(' ')}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
    }
  }
  return execFileSync('git', argsToRun, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
}

let commit = 'unknown';
let dirty = 'unknown';
try {
  commit = runGit(['rev-parse', 'HEAD']);
  dirty = runGit(['status', '--porcelain']) ? 'dirty' : 'clean';
} catch {
  commit = 'unavailable';
  dirty = 'unavailable';
}

const manifest = [
  '# Export Manifest',
  '',
  `- Exported at: ${new Date().toISOString()}`,
  `- Source repo: ${repoRoot}`,
  `- Source commit: ${commit}`,
  `- Source worktree state: ${dirty}`,
  `- Template root: ${templateRoot}`,
  '- Stable interface roots: contracts/, mock-control-plane/, reference-companion/, acceptance-tests/',
  '- Hardware CAD excluded: yes',
  '- Internal control-plane modules excluded: yes',
  '',
  '## Review Reminder',
  '',
  '- This export is for the restricted vendor repository only.',
  '- Re-check that no production secrets or unrelated modules were added after export.',
  '- Confirm the export does not contain proto board CAD, KiCad, or internal hardware release files.',
  '- Recreate repository hosting and permissions outside the internal monorepo before sharing.'
].join('\n');

await writeFile(resolve(targetRoot, 'EXPORT_MANIFEST.md'), manifest, 'utf8');

const readmePath = resolve(targetRoot, 'README.md');
const readme = await readFile(readmePath, 'utf8');
await writeFile(readmePath, `${readme}\n\n## Export Metadata\n\nSee [EXPORT_MANIFEST.md](./EXPORT_MANIFEST.md) before sharing this repository.\n`, 'utf8');

console.log(`Exported vendor template to ${targetRoot}`);

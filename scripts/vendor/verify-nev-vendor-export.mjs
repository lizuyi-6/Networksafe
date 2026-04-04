import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), '..', '..');
const exportScript = resolve(repoRoot, 'scripts', 'vendor', 'export-nev-vendor.mjs');
const tempRoot = mkdtempSync(join(tmpdir(), 'networksafe-nev-vendor-'));
const exportTarget = resolve(tempRoot, 'networksafe-nev-vendor');
const keepTemp = process.env.KEEP_VENDOR_VERIFY_TMP === '1';

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
}

function runNode(args, cwd) {
  run(process.execPath, args, cwd);
}

function runNpm(args, cwd) {
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], cwd);
    return;
  }
  run('npm', args, cwd);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPathExists(path, description) {
  assert(existsSync(path), `${description} is missing: ${path}`);
}

function assertPathMissing(path, description) {
  assert(!existsSync(path), `${description} must not be exported: ${path}`);
}

try {
  runNode([exportScript, '--target', exportTarget], repoRoot);

  const requiredPaths = [
    ['README.md', 'exported README'],
    ['EXPORT_MANIFEST.md', 'export manifest'],
    ['contracts/device-types.ts', 'device contract'],
    ['contracts/command-envelope.md', 'command contract'],
    ['contracts/serial-protocol.md', 'serial protocol contract'],
    ['mock-control-plane/server.ts', 'mock control plane'],
    ['reference-companion/src/index.ts', 'reference companion'],
    ['acceptance-tests/run.ts', 'acceptance suite'],
    ['deliverables/README.md', 'deliverables guide']
  ];

  for (const [relativePath, description] of requiredPaths) {
    assertPathExists(resolve(exportTarget, relativePath), description);
  }

  const forbiddenPaths = [
    ['backend', 'internal backend sources'],
    ['frontend', 'internal frontend sources'],
    ['deployment', 'deployment bundle assets'],
    ['hardware', 'hardware CAD or proto board assets'],
    ['docs', 'internal docs tree']
  ];

  for (const [relativePath, description] of forbiddenPaths) {
    assertPathMissing(resolve(exportTarget, relativePath), description);
  }

  const manifest = readFileSync(resolve(exportTarget, 'EXPORT_MANIFEST.md'), 'utf8');
  assert(manifest.includes('Source commit:'), 'export manifest must record the source commit');
  assert(manifest.includes('Source worktree state:'), 'export manifest must record worktree cleanliness');
  assert(manifest.includes('Hardware CAD excluded:'), 'export manifest must record the hardware boundary');

  runNpm(['install', '--no-package-lock'], exportTarget);
  runNpm(['run', 'typecheck'], exportTarget);
  runNpm(['run', 'test:acceptance'], exportTarget);

  process.stdout.write(`verify-nev-vendor-export: ok (${exportTarget})\n`);

  if (!keepTemp) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
} catch (error) {
  process.stderr.write(`verify-nev-vendor-export: failed (${exportTarget})\n`);
  process.stderr.write(`${String(error.stack || error)}\n`);
  process.exitCode = 1;
}

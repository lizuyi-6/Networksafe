/**
 * Symlink-escape regression tests for LocalArtifactStore.
 *
 * These tests use the REAL filesystem (no fs mock) because symlink resolution
 * must be exercised through fs.realpath against actual symlinks. The string
 * containment check added in commit f046f5e cannot see symlinks, so a symlink
 * inside baseDir pointing outside would pass it and leak via fs.readFile.
 * This file verifies the real-path containment layer added on top.
 *
 * Symlink creation requires privilege on some platforms (Windows without
 * Developer Mode, or restricted Linux accounts). The suite fails in beforeAll
 * when that capability is unavailable so these security tests cannot silently
 * disappear from the executed test count.
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// We instantiate LocalArtifactStore directly against a temp dir, bypassing
// the S3/platform-config wiring that artifactStoreService (the singleton)
// goes through. Import the class via the module's internal default export shape.
// The module exports `artifactStoreService` (singleton); the LocalArtifactStore
// class is not exported, so we reach it by constructing through the same factory
// the singleton uses. Simplest: require the module and call writeText/readText
// on the singleton, but point its baseDir at a temp dir via env before require.
//
// To keep this hermetic, we instead re-implement the small surface we need by
// importing the module after setting ARTIFACTS_DIR, then asserting on the
// singleton. But the singleton's baseDir is resolved at first require. So we
// set the env var BEFORE requiring, and run in a child-process-free jest path.

// ---- helpers ----
async function makeTempBase(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ag-symlink-test-'));
}

async function canCreateSymlink(): Promise<boolean> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-symlink-probe-'));
  const src = path.join(dir, 'src.txt');
  const lnk = path.join(dir, 'lnk.txt');
  await fs.writeFile(src, 'x');
  try {
    await fs.symlink(src, lnk);
    return true;
  } catch (error: any) {
    if (['EPERM', 'ENOTSUP', 'EEXIST', 'EROFS'].includes(error.code)) {
      return false;
    }
    throw error;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('artifactStoreService symlink-escape prevention', () => {
  beforeAll(async () => {
    expect(await canCreateSymlink()).toBe(true);
  });

  // We need a LocalArtifactStore instance bound to a temp baseDir. The module
  // exports only the singleton, so we require it fresh per test after pointing
  // ARTIFACTS_DIR at our temp dir. Jest caches requires, so we resetModules.
  async function createStore(base: string): Promise<any> {
    jest.resetModules();
    process.env.ARTIFACTS_DIR = base;
    // Force local mode.
    jest.doMock('../../services/platform-config.service', () => ({
      platformConfigService: {
        getConfig: jest.fn().mockResolvedValue({ artifactStore: { mode: 'local' } })
      }
    }));
    jest.doMock('../../utils/logger', () => ({
      __esModule: true,
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));
    const mod = require('../../services/artifact-store.service');
    return mod.artifactStoreService;
  }

  it(
    'readText rejects a symlink that escapes the artifact base directory',
    async () => {
      const base = await makeTempBase();
      try {
        // Outside secret
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-outside-'));
        const outsideSecret = path.join(outsideDir, 'secret.txt');
        await fs.writeFile(outsideSecret, 'OUTSIDE_SECRET');
        // Symlink inside base pointing outside
        const evilLink = path.join(base, 'evil.json');
        await fs.symlink(outsideSecret, evilLink);

        const store = await createStore(base);
        await expect(
          store.readText('artifact://local/evil.json')
        ).rejects.toThrow('backend.artifact_path_escape_detected');

        await fs.rm(outsideDir, { recursive: true, force: true });
      } finally {
        delete process.env.ARTIFACTS_DIR;
        await fs.rm(base, { recursive: true, force: true });
      }
    }
  );

  it(
    'readText fallbackLocation rejects a symlink escaping the base directory',
    async () => {
      const base = await makeTempBase();
      try {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-outside-fb-'));
        const outsideSecret = path.join(outsideDir, 'secret.txt');
        await fs.writeFile(outsideSecret, 'OUTSIDE_SECRET');
        const evilLink = path.join(base, 'evil-fb.json');
        await fs.symlink(outsideSecret, evilLink);

        const store = await createStore(base);
        await expect(
          store.readText('artifact://s3/unused', evilLink)
        ).rejects.toThrow('backend.artifact_path_escape_detected');

        await fs.rm(outsideDir, { recursive: true, force: true });
      } finally {
        delete process.env.ARTIFACTS_DIR;
        await fs.rm(base, { recursive: true, force: true });
      }
    }
  );

  it(
    'writeText rejects when the target dir is a symlink escaping the base directory',
    async () => {
      const base = await makeTempBase();
      try {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-outside-write-'));
        // A symlinked "scope" directory inside base pointing OUTSIDE base
        const symlinkedScope = path.join(base, 'escaped-scope');
        await fs.symlink(outsideDir, symlinkedScope);

        const store = await createStore(base);
        await expect(
          store.writeText('escaped-scope', 'payload.json', '{}')
        ).rejects.toThrow('backend.artifact_path_escape_detected');

        // And confirm nothing got written into the outside dir
        const written = await fs.readdir(outsideDir);
        expect(written).toEqual([]);

        await fs.rm(outsideDir, { recursive: true, force: true });
      } finally {
        delete process.env.ARTIFACTS_DIR;
        await fs.rm(base, { recursive: true, force: true });
      }
    }
  );

  it(
    'readText allows a benign internal symlink (points inside baseDir)',
    async () => {
      const base = await makeTempBase();
      try {
        // Real target inside base
        const realTarget = path.join(base, 'real.json');
        await fs.writeFile(realTarget, '{"ok":true}');
        // Symlink inside base pointing to another file inside base
        const link = path.join(base, 'link.json');
        await fs.symlink(realTarget, link);

        const store = await createStore(base);
        const content = await store.readText('artifact://local/link.json');
        expect(content).toContain('"ok":true');
      } finally {
        delete process.env.ARTIFACTS_DIR;
        await fs.rm(base, { recursive: true, force: true });
      }
    }
  );

  it('symlink capability probe reports without throwing', async () => {
    // Smoke test: the probe itself never throws (it catches EPERM etc).
    const result = await canCreateSymlink();
    expect(typeof result).toBe('boolean');
  });
});

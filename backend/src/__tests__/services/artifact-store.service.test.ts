/**
 * Artifact Store Service Tests
 *
 * Tests for S3/local artifact storage.
 * Note: jest.doMock factory runs at module load (hoisted), before const declarations.
 * Use a shared object to bridge factory capture → test access.
 */

export {};

// Shared object — set by factories, read by tests
const mocks = {
  send: null as jest.Mock | null,
  mkdir: null as jest.Mock | null,
  writeFile: null as jest.Mock | null,
  readFile: null as jest.Mock | null,
  pathJoin: null as jest.Mock | null,
  fsExistsSync: null as jest.Mock | null,
};

// Populate mocks BEFORE jest.doMock runs (they are at file level)
mocks.send = jest.fn();
mocks.mkdir = jest.fn();
mocks.writeFile = jest.fn();
mocks.readFile = jest.fn();
mocks.pathJoin = jest.fn((...args: string[]) => args.join('/'));
mocks.fsExistsSync = jest.fn().mockReturnValue(true);

let artifactStoreService: any;

beforeAll(() => {
  // jest.doMock factory is hoisted to file top, but mocks.* are set above,
  // so they are available when the factory runs.
  jest.doMock('@aws-sdk/client-s3', () => ({
    __esModule: true,
    S3Client: jest.fn().mockImplementation(() => ({ send: mocks.send })),
    PutObjectCommand: jest.fn().mockImplementation((params: any) => ({ input: params })),
    GetObjectCommand: jest.fn(),
    HeadObjectCommand: jest.fn().mockImplementation((params: any) => ({ input: params })),
    CreateBucketCommand: jest.fn(),
    HeadBucketCommand: jest.fn()
  }));

  jest.doMock('../../services/platform-config.service', () => ({
    platformConfigService: {
      getConfig: jest.fn().mockResolvedValue({
        artifactStore: {
          mode: 'local',
          bucket: 'test-artifacts'
        }
      })
    }
  }));

  jest.doMock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  jest.doMock('path', () => ({
    ...jest.requireActual('path'),
    join: mocks.pathJoin
  }));

  jest.doMock('fs/promises', () => ({
    __esModule: true,
    default: {
      mkdir: mocks.mkdir,
      writeFile: mocks.writeFile,
      readFile: mocks.readFile,
      // realpath is exercised by the symlink-aware containment layer.
      // For the string-traversal tests in THIS file (which use virtual
      // paths that do not exist on disk), resolve to an absolute path so
      // the containment comparison behaves like the real realpath would
      // (real realpath always returns absolute). The genuine
      // symlink-following behavior is covered separately in
      // artifact-store.symlink.test.ts against the real fs.
      realpath: jest.fn(async (p: string) => jest.requireActual('path').resolve(p))
    }
  }));

  jest.doMock('fs', () => ({
    existsSync: mocks.fsExistsSync,
    __esModule: true,
    default: { existsSync: mocks.fsExistsSync }
  }));

  artifactStoreService = require('../../services/artifact-store.service').artifactStoreService;
});

beforeEach(() => {
  jest.clearAllMocks();
  mocks.mkdir!.mockReset();
  mocks.writeFile!.mockReset();
  mocks.readFile!.mockReset();
  mocks.mkdir!.mockResolvedValue(undefined);
  mocks.writeFile!.mockResolvedValue(undefined);
});

describe('artifactStoreService', () => {
  describe('writeText', () => {
    it('stores text artifact locally', async () => {
      const result = await artifactStoreService.writeText('scans', 'report-001.json', '{ "id": 1 }', 'application/json');

      expect(result.artifactRef).toMatch(/^artifact:\/\/local\/scans\/report-001\.json$/);
      expect(result.location).toBeDefined();
      expect(mocks.mkdir).toHaveBeenCalled();
      expect(mocks.writeFile).toHaveBeenCalled();
    });

    it('rejects traversal in text artifact keys before writing', async () => {
      await expect(
        artifactStoreService.writeText('scans', '../../../../tmp/pwned', 'payload')
      ).rejects.toThrow('backend.artifact_path_escape_detected');

      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it('stores text artifact with subdirectory', async () => {
      const result = await artifactStoreService.writeText('scans/sub', 'report-002.json', '{ "id": 2 }');

      expect(result.artifactRef).toContain('scans');
    });

    it('sanitizes scope to remove invalid characters', async () => {
      const result = await artifactStoreService.writeText('scope/..', 'file.txt', 'content');

      expect(result.artifactRef).not.toContain('..');
    });
  });

  describe('writeJson', () => {
    it('serializes object to JSON', async () => {
      const result = await artifactStoreService.writeJson('reports', 'data.json', { key: 'value' });

      expect(result.artifactRef).toMatch(/^artifact:\/\/local\/reports\/data\.json\.json$/);
      expect(mocks.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"key"'),
        'utf8'
      );
    });
  });

  describe('readText', () => {
    it('reads text from local artifact ref', async () => {
      mocks.readFile!.mockResolvedValue('test content from artifact');

      const result = await artifactStoreService.readText('artifact://local/scans/test.txt');

      expect(mocks.readFile).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'utf8');
      expect(result).toBe('test content from artifact');
    });

    it('rejects traversal in local artifact refs before reading', async () => {
      await expect(
        artifactStoreService.readText('artifact://local/../../../../etc/passwd')
      ).rejects.toThrow('backend.artifact_path_escape_detected');

      expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('rejects fallback locations outside the artifact base directory', async () => {
      await expect(
        artifactStoreService.readText('artifact://unsupported/ref', '../../../../etc/passwd')
      ).rejects.toThrow('backend.artifact_path_escape_detected');

      expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('throws for non-local artifact refs without fallback', async () => {
      await expect(
        artifactStoreService.readText('artifact://s3/bucket/file.txt')
      ).rejects.toThrow('backend.unsupported_local_artifact_ref');
    });
  });

  describe('writeBinary', () => {
    it('stores binary buffer', async () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02]);
      const result = await artifactStoreService.writeBinary('binaries', 'data.bin', buffer);

      expect(result.artifactRef).toContain('binaries');
      expect(mocks.writeFile).toHaveBeenCalledWith(expect.any(String), buffer);
    });

    it('rejects traversal in binary artifact keys before writing', async () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02]);

      await expect(
        artifactStoreService.writeBinary('binaries', '../../../../tmp/pwned', buffer)
      ).rejects.toThrow('backend.artifact_path_escape_detected');

      expect(mocks.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('describe()', () => {
    it('returns storage mode description', async () => {
      const description = await artifactStoreService.describe();

      expect(description).toHaveProperty('requestedMode');
      expect(description).toHaveProperty('activeMode');
    });
  });
});

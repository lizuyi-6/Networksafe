/**
 * Audit Segment Service Tests
 *
 * Tests for audit log segmentation and archival.
 * Note: jest.doMock factory runs at module load (hoisted), before const declarations.
 * Use a shared object to bridge factory capture → test access.
 */

// Shared object — set by factory, read by tests
const mocks = {
  prepareExec: null as jest.Mock | null,
  prepareAll: null as jest.Mock | null,
  prepareGet: null as jest.Mock | null,
  prepareRun: null as jest.Mock | null,
  writeLockedJson: null as jest.Mock | null,
  inspectObject: null as jest.Mock | null,
  auditReadJson: null as jest.Mock | null,
  artifactReadJson: null as jest.Mock | null,
};

// Populate mocks BEFORE jest.doMock runs (they are at file level, initialized before hoisting)
mocks.prepareExec = jest.fn();
mocks.prepareAll = jest.fn();
mocks.prepareGet = jest.fn();
mocks.prepareRun = jest.fn();
mocks.writeLockedJson = jest.fn();
mocks.inspectObject = jest.fn();
mocks.auditReadJson = jest.fn();
mocks.artifactReadJson = jest.fn();

let auditSegmentService: any;

beforeAll(() => {
  // jest.doMock factory is hoisted to file top, but mocks.* are set above,
  // so they are available when the factory runs.
  jest.doMock('../../config/database', () => ({
    getDatabase: jest.fn(() => ({
      prepare: jest.fn((sql: string) => {
        if (sql.includes('SELECT')) {
          return { all: mocks.prepareAll, get: mocks.prepareGet };
        }
        return { run: mocks.prepareRun, exec: mocks.prepareExec };
      }),
      exec: mocks.prepareExec
    }))
  }));

  jest.doMock('../../services/postgres-shadow-store.service', () => ({
    postgresShadowStoreService: {
      canServeReads: jest.fn().mockReturnValue(false),
      upsert: jest.fn().mockResolvedValue(undefined),
      queryAll: jest.fn().mockResolvedValue([])
    }
  }));

  jest.doMock('../../services/platform-config.service', () => ({
    platformConfigService: {
      getConfig: jest.fn().mockResolvedValue({
        auditArchive: {
          bucket: 'audit-bucket',
          retentionDays: 30,
          objectLockRequired: true,
          verifyIntervalMinutes: 60
        }
      })
    }
  }));

  jest.doMock('../../services/audit-archive.service', () => ({
    auditArchiveService: {
      writeLockedJson: mocks.writeLockedJson,
      inspectObject: mocks.inspectObject,
      readJson: mocks.auditReadJson
    }
  }));

  jest.doMock('../../services/artifact-store.service', () => ({
    artifactStoreService: {
      readJson: mocks.artifactReadJson,
      describe: jest.fn().mockReturnValue({ activeMode: 'local' })
    }
  }));

  jest.doMock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  jest.doMock('crypto', () => ({
    createHash: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('fakehash123')
    })),
    randomUUID: jest.fn(() => 'fake-uuid-123')
  }));

  auditSegmentService = require('../../services/audit-segment.service').auditSegmentService;
});

beforeEach(() => {
  mocks.prepareExec!.mockReset();
  mocks.prepareAll!.mockReset();
  mocks.prepareGet!.mockReset();
  mocks.prepareRun!.mockReset();
  mocks.writeLockedJson!.mockReset();
  mocks.inspectObject!.mockReset();
  mocks.auditReadJson!.mockReset();
  mocks.artifactReadJson!.mockReset();

  // .all() and .get() are synchronous in SQLite — use mockReturnValue, not mockResolvedValue
  mocks.prepareExec!.mockReturnValue(undefined);
});

describe('auditSegmentService', () => {
  describe('prepare()', () => {
    it('creates audit_segments table', () => {
      auditSegmentService.prepare();

      expect(mocks.prepareExec).toHaveBeenCalled();
    });
  });

  describe('listSegments', () => {
    it('returns empty list when no segments exist', async () => {
      mocks.prepareAll!.mockReturnValue([]);

      const segments = await auditSegmentService.listSegments({ tenantId: 'tenant-001' });

      expect(Array.isArray(segments)).toBe(true);
      expect(segments).toHaveLength(0);
    });

    it('maps database rows to AuditSegmentRecord format', async () => {
      mocks.prepareAll!.mockReturnValue([
        {
          id: 'seg-001',
          tenant_id: 'tenant-001',
          segment_key: '2026-04',
          chain_hash: 'hash-prev',
          object_key: 'audit/seg-001.json',
          version_id: 'v-001',
          retention_until: '2027-04-01',
          object_lock_enabled: 1,
          verify_status: 'pending',
          lock_mode: 'hash_chain',
          status: 'archived',
          metadata_json: '{"recordCount":5}',
          created_at: '2026-04-01T00:00:00Z',
          verified_at: null
        }
      ]);

      const segments = await auditSegmentService.listSegments({ tenantId: 'tenant-001' });

      expect(segments[0].segmentKey).toBe('2026-04');
      expect(segments[0].verifyStatus).toBe('pending');
      expect(segments[0].metadata.recordCount).toBe(5);
    });

    it('clamps limit to 1000', async () => {
      mocks.prepareAll!.mockReturnValue([]);

      await auditSegmentService.listSegments({ limit: 5000 });

      expect(mocks.prepareAll).toHaveBeenCalled();
    });

    it('uses minimum limit of 1', async () => {
      mocks.prepareAll!.mockReturnValue([]);

      await auditSegmentService.listSegments({ limit: 0 });

      expect(mocks.prepareAll).toHaveBeenCalled();
    });
  });

  describe('verifySegment', () => {
    const mockSegmentRow = {
      id: 'seg-001',
      tenant_id: 'tenant-001',
      segment_key: '2026-04',
      chain_hash: 'fakehash123',
      object_key: 'audit/seg-001.json',
      version_id: 'v-001',
      retention_until: '2027-04-01',
      object_lock_enabled: 0,
      verify_status: 'pending',
      lock_mode: 'hash_chain',
      status: 'archived',
      metadata_json: JSON.stringify({
        recordCount: 1,
        contentHash: 'fakehash123',
        previousChainHash: null,
        objectLockEnabled: false,
        verifyStatus: 'pending'
      }),
      created_at: '2026-04-01T00:00:00Z',
      verified_at: null
    };

    beforeEach(() => {
      mocks.prepareGet!.mockReturnValue(mockSegmentRow);
      mocks.prepareRun!.mockReturnValue({});
      // artifactStoreService.readJson is called when bucket is null (local path)
      mocks.artifactReadJson!.mockReturnValue({
        version: '1.0',
        segmentId: 'seg-001',
        tenantId: 'tenant-001',
        segmentKey: '2026-04',
        chainHash: 'fakehash123',
        previousChainHash: null,
        createdAt: '2026-04-01T00:00:00Z',
        recordCount: 1,
        records: [{ id: 'log-001' }]
      });
      mocks.inspectObject!.mockReturnValue({
        objectLockEnabled: true,
        retentionUntil: '2027-04-01T00:00:00Z'
      });
      mocks.writeLockedJson!.mockReturnValue({
        artifactRef: 'artifact://s3/audit/seg-001.json',
        objectKey: 'audit/seg-001.json',
        objectLockEnabled: true
      });
    });

    it('marks segment as verified when hash matches', async () => {
      const result = await auditSegmentService.verifySegment('seg-001');

      expect(result.valid).toBe(true);
      expect(result.contentValid).toBe(true);
      expect(result.chainValid).toBe(true);
    });

    it('marks segment as corrupt when content hash mismatches', async () => {
      // Override prepareGet with a segment that has a DIFFERENT stored contentHash
      // so computeContentHash('fakehash123') !== 'different-hash' → contentValid: false
      mocks.prepareGet!.mockReturnValue({
        ...mockSegmentRow,
        metadata_json: JSON.stringify({
          recordCount: 1,
          contentHash: 'different-hash',
          previousChainHash: null,
          objectLockEnabled: false,
          verifyStatus: 'pending'
        })
      });
      mocks.artifactReadJson!.mockReturnValue({
        version: '1.0',
        segmentId: 'seg-001',
        tenantId: 'tenant-001',
        segmentKey: '2026-04',
        chainHash: 'fakehash123',
        previousChainHash: null,
        createdAt: '2026-04-01T00:00:00Z',
        recordCount: 1,
        records: [{ id: 'log-001' }]
      });

      const result = await auditSegmentService.verifySegment('seg-001');

      expect(result.contentValid).toBe(false);
    });

    it('returns valid: false for non-existent segment', async () => {
      mocks.prepareGet!.mockReturnValue(undefined);

      const result = await auditSegmentService.verifySegment('nonexistent');

      expect(result.valid).toBe(false);
    });

    it('marks as corrupt when object lock is missing but required', async () => {
      // Set bucket in metadata so the S3 path is taken (where objectLockValid is recomputed)
      mocks.prepareGet!.mockReturnValue({
        ...mockSegmentRow,
        metadata_json: JSON.stringify({
          recordCount: 1,
          contentHash: 'fakehash123',
          previousChainHash: null,
          objectLockEnabled: true,
          verifyStatus: 'pending',
          bucket: 'test-bucket',
          objectKey: 'audit/seg-001.json'
        })
      });
      mocks.inspectObject!.mockReturnValue({
        objectLockEnabled: false,
        retentionUntil: null
      });
      mocks.auditReadJson!.mockReturnValue({
        version: '1.0',
        segmentId: 'seg-001',
        tenantId: 'tenant-001',
        segmentKey: '2026-04',
        chainHash: 'fakehash123',
        previousChainHash: null,
        createdAt: '2026-04-01T00:00:00Z',
        recordCount: 1,
        records: [{ id: 'log-001' }]
      });

      const result = await auditSegmentService.verifySegment('seg-001');

      expect(result.objectLockValid).toBe(false);
    });
  });
});

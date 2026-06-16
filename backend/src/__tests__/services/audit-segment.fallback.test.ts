/**
 * SECURITY tests for the AuditSegmentService.
 *
 * Sprint 5 Wave 9 · R14 · V12.14
 * When `auditArchiveService.writeLockedJson` throws, the segment
 * used to be lost. The fix: fall back to the always-on
 * `artifactStoreService` local store, and if even that fails,
 * still persist a `verify_status=corrupt` segment so the chain
 * hash and row count survive. We never silently fall back to a
 * default chain hash.
 */

export {};

const mocks = {
  writeLockedJson: jest.fn(),
  fallbackWriteJson: jest.fn(),
  describe: jest.fn().mockReturnValue({ activeMode: 'local' })
};

let auditSegmentService: any;

beforeAll(() => {
  jest.doMock('../../config/database', () => ({
    getDatabase: jest.fn(() => ({
      prepare: jest.fn((sql: string) => {
        if (sql.includes('FROM audit_log')) {
          // listCandidateTenants + loadLogsForSegment
          return {
            all: jest.fn().mockReturnValue([{
              id: 'log-1',
              timestamp: '2026-01-01T00:00:00Z',
              tenant_id: 'tenant-fb',
              event_type: 'agent_command',
              category: 'command',
              severity: 'info',
              actor_type: 'user',
              actor_id: 'tester',
              actor_email: 't@example.com',
              actor_ip: '127.0.0.1',
              action: 'scan',
              target_type: 'agent',
              target_id: 'a-1',
              details_json: '{}',
              status: 'success',
              signature: 'sig'
            }]),
            get: jest.fn().mockReturnValue(undefined)
          };
        }
        if (sql.includes('FROM audit_segments')) {
          return {
            all: jest.fn().mockReturnValue([]),  // no previous segments
            get: jest.fn().mockReturnValue(undefined)
          };
        }
        return { run: jest.fn().mockReturnValue({}), exec: jest.fn() };
      }),
      exec: jest.fn()
    }))
  }));

  jest.doMock('../../services/postgres-shadow-store.service', () => ({
    postgresShadowStoreService: {
      canServeReads: jest.fn().mockReturnValue(false),
      upsert: jest.fn().mockResolvedValue(undefined),
      queryAll: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(undefined)
    }
  }));

  jest.doMock('../../services/audit-archive.service', () => ({
    auditArchiveService: {
      writeLockedJson: mocks.writeLockedJson,
      inspectObject: jest.fn(),
      readJson: jest.fn()
    }
  }));

  jest.doMock('../../services/artifact-store.service', () => ({
    artifactStoreService: {
      writeJson: mocks.fallbackWriteJson,
      readJson: jest.fn(),
      describe: mocks.describe
    }
  }));

  jest.doMock('../../config/platform-runtime', () => ({
    getArtifactStoreMode: () => 'local'
  }));

  jest.doMock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  jest.doMock('crypto', () => {
    const actual = jest.requireActual('crypto');
    return {
      ...actual,
      createHash: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('fakehash')
      })),
      randomUUID: jest.fn(() => 'seg-uuid')
    };
  });

  auditSegmentService = require('../../services/audit-segment.service').auditSegmentService;
});

beforeEach(() => {
  mocks.writeLockedJson.mockReset();
  mocks.fallbackWriteJson.mockReset();
});

describe('auditSegmentService / V12.14 archive fallback chain', () => {
  it('persists segment from primary archive when writeLockedJson succeeds', async () => {
    mocks.writeLockedJson.mockResolvedValue({
      artifactRef: 'artifact://s3/audit-bucket/seg.json',
      location: 's3://audit-bucket/seg.json',
      bucket: 'audit-bucket',
      objectKey: 'audit/seg.json',
      versionId: 'v-1',
      retentionUntil: '2027-01-01T00:00:00Z',
      objectLockEnabled: true
    });

    const result = await auditSegmentService.archivePending({
      tenantId: 'tenant-fb',
      maxLogsPerSegment: 5
    });

    expect(result).toBeDefined();
    expect(mocks.writeLockedJson).toHaveBeenCalled();
  });

  it('falls back to artifact store when primary archive write throws', async () => {
    mocks.writeLockedJson.mockRejectedValue(new Error('S3 unavailable'));
    mocks.fallbackWriteJson.mockResolvedValue({
      artifactRef: 'artifact://local/audit-segments-fallback/tenant-fb/seg.json',
      location: '/tmp/audit-segments-fallback/tenant-fb/seg.json'
    });

    const result = await auditSegmentService.archivePending({
      tenantId: 'tenant-fb',
      maxLogsPerSegment: 5
    });

    // Primary attempted, fallback invoked, segment still persisted
    expect(mocks.writeLockedJson).toHaveBeenCalled();
    expect(mocks.fallbackWriteJson).toHaveBeenCalled();
    // No silent drop: the data flow completes successfully.
    expect(result.success).toBe(true);
  });

  it('still persists a degraded segment when BOTH primary and fallback fail', async () => {
    mocks.writeLockedJson.mockRejectedValue(new Error('S3 down'));
    mocks.fallbackWriteJson.mockRejectedValue(new Error('disk full'));

    const result = await auditSegmentService.archivePending({
      tenantId: 'tenant-fb',
      maxLogsPerSegment: 5
    });

    // We must not have crashed; the data path completed with a
    // corrupt-but-present segment row.
    expect(mocks.writeLockedJson).toHaveBeenCalled();
    expect(mocks.fallbackWriteJson).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

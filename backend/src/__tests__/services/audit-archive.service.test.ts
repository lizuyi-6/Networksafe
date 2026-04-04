/**
 * Audit Archive Service Tests
 *
 * Tests for S3-based audit archive storage.
 * Mock getClient() directly on the service instance to avoid
 * S3Client constructor mocking complexities.
 */

// Set up S3 environment variables BEFORE any mocking
process.env.S3_ENDPOINT = 'https://s3.example.com';
process.env.S3_ACCESS_KEY = 'test-access-key';
process.env.S3_SECRET_KEY = 'test-secret-key';
process.env.S3_REGION = 'us-east-1';

// Shared mock send function
const mockSend = jest.fn();

let auditArchiveService: any;

beforeAll(() => {
  jest.doMock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  jest.doMock('../../services/platform-config.service', () => ({
    platformConfigService: {
      getConfig: jest.fn().mockResolvedValue({
        auditArchive: {
          bucket: 'test-audit-bucket',
          retentionDays: 30,
          objectLockRequired: false,
          verifyIntervalMinutes: 60
        }
      })
    }
  }));

  // Get the real service, then override getClient
  const mod = require('../../services/audit-archive.service');
  auditArchiveService = mod.auditArchiveService;
  // Directly override getClient to intercept all S3 calls
  auditArchiveService.getClient = jest.fn(() => ({
    send: mockSend
  }));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ VersionId: 'v-001' });
});

describe('auditArchiveService', () => {
  describe('writeLockedJson', () => {
    it('writes JSON to S3 and returns artifact ref', async () => {
      mockSend.mockResolvedValue({ VersionId: 'v-001' });

      const result = await auditArchiveService.writeLockedJson(
        'tenant-001',
        'audit',
        'segment-001.json',
        { records: [{ id: 'log-001' }] }
      );

      expect(result.artifactRef).toContain('test-audit-bucket');
      expect(result.artifactRef).toContain('audit');
      expect(result.objectKey).toMatch(/^audit\//);
    });

    it('returns versionId from S3 response', async () => {
      mockSend.mockResolvedValue({ VersionId: 'v-version-abc' });

      const result = await auditArchiveService.writeLockedJson(
        'tenant-002',
        'compliance',
        'audit-log.json',
        { logs: [] }
      );

      expect(result.versionId).toBe('v-version-abc');
    });

    it('sets retention until date based on config', async () => {
      mockSend.mockResolvedValue({ VersionId: 'v-001' });

      const result = await auditArchiveService.writeLockedJson(
        'tenant-001',
        'audit',
        'segment.json',
        {}
      );

      expect(result.retentionUntil).toBeDefined();
      expect(new Date(result.retentionUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it('returns artifact ref with bucket scope', async () => {
      mockSend.mockResolvedValue({ VersionId: 'v-xyz' });

      const result = await auditArchiveService.writeLockedJson(
        'tenant-xyz',
        'compliance',
        'audit.json',
        { entries: [] }
      );

      expect(result.artifactRef).toContain('test-audit-bucket');
    });
  });

  describe('inspectObject', () => {
    it('returns object metadata from S3 HeadObjectCommand', async () => {
      mockSend.mockResolvedValue({
        ContentLength: 2048,
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: new Date('2027-04-01T00:00:00Z'),
        LastModified: '2026-04-01T00:00:00Z',
        VersionId: 'v-inspected-001'
      });

      const result = await auditArchiveService.inspectObject('my-bucket', 'audit/segment.json', 'v-inspected-001');

      expect(mockSend).toHaveBeenCalled();
      expect(result.objectLockEnabled).toBe(true);
      expect(result.retentionUntil).toBe('2027-04-01T00:00:00.000Z');
    });

    it('returns objectLockEnabled false when no lock metadata', async () => {
      mockSend.mockResolvedValue({
        ContentLength: 512,
        LastModified: '2026-04-01T00:00:00Z'
      });

      const result = await auditArchiveService.inspectObject('my-bucket', 'audit/plain.json');

      expect(result.objectLockEnabled).toBe(false);
    });

    it('includes versionId in result', async () => {
      mockSend.mockResolvedValue({
        ContentLength: 100,
        VersionId: 'v-specific'
      });

      const result = await auditArchiveService.inspectObject('bucket', 'key.json', 'v-specific');

      expect(result.versionId).toBe('v-specific');
    });
  });
});

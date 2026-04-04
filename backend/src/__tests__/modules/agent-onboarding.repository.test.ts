/**
 * Agent Onboarding Repository Tests
 */

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../config/platform-runtime', () => ({
  getDatabaseMode: jest.fn(),
  isSqliteFallbackEnabled: jest.fn(),
}));

jest.mock('../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    canServeReads: jest.fn(),
    execute: jest.fn(),
    queryOne: jest.fn(),
    queryAll: jest.fn(),
    upsert: jest.fn(),
  },
}));

import {
  saveAgentOnboardingCode,
  saveAgentCredentialAudit,
  getAgentOnboardingCodeByHash,
  listAgentOnboardingCodes,
  getLatestAgentRegistration,
  AgentOnboardingCodeRow,
  AgentCredentialAuditRow,
} from '../../modules/agent-onboarding/agent-onboarding.repository';
import { getDatabase } from '../../config/database';
import { getDatabaseMode, isSqliteFallbackEnabled } from '../../config/platform-runtime';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const mockGetDatabaseMode = getDatabaseMode as jest.MockedFunction<typeof getDatabaseMode>;
const mockIsSqliteFallbackEnabled = isSqliteFallbackEnabled as jest.MockedFunction<typeof isSqliteFallbackEnabled>;
const mockPostgresShadowStore = postgresShadowStoreService as jest.Mocked<typeof postgresShadowStoreService>;

describe('Agent Onboarding Repository', () => {
  let mockDb: any;
  let mockPrepare: jest.Mock;
  let mockRun: jest.Mock;
  let mockGet: jest.Mock;
  let mockAll: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun = jest.fn();
    mockGet = jest.fn();
    mockAll = jest.fn();
    mockPrepare = jest.fn().mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });
    mockDb = {
      prepare: mockPrepare,
    };
    mockGetDatabase.mockReturnValue(mockDb);
  });

  describe('saveAgentOnboardingCode', () => {
    const mockRow: AgentOnboardingCodeRow = {
      id: 'code-1',
      code_hash: 'hash123',
      tenant_id: 'tenant-1',
      created_by: 'user-1',
      max_uses: 5,
      used_count: 0,
      status: 'active',
      expected_hostname: 'host-1',
      expected_tags_json: '{"env":"prod"}',
      expires_at: '2024-12-31T23:59:59Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should save to postgres when in postgres mode', async () => {
      mockGetDatabaseMode.mockReturnValue('postgres');
      mockIsSqliteFallbackEnabled.mockReturnValue(false);

      await saveAgentOnboardingCode(mockRow);

      expect(mockPostgresShadowStore.execute).toHaveBeenCalled();
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('should save to sqlite when in sqlite mode', async () => {
      mockGetDatabaseMode.mockReturnValue('sqlite');
      mockIsSqliteFallbackEnabled.mockReturnValue(true);

      await saveAgentOnboardingCode(mockRow);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
    });

    it('should save to both when sqlite fallback enabled', async () => {
      mockGetDatabaseMode.mockReturnValue('postgres');
      mockIsSqliteFallbackEnabled.mockReturnValue(true);

      await saveAgentOnboardingCode(mockRow);

      expect(mockPostgresShadowStore.execute).toHaveBeenCalled();
      expect(mockPrepare).toHaveBeenCalled();
    });

    it('should upsert to shadow store when not in postgres mode', async () => {
      mockGetDatabaseMode.mockReturnValue('sqlite');
      mockIsSqliteFallbackEnabled.mockReturnValue(false);

      await saveAgentOnboardingCode(mockRow);

      expect(mockPostgresShadowStore.upsert).toHaveBeenCalledWith(
        'agent_onboarding_codes',
        expect.any(Object)
      );
    });

    it('should handle null values correctly', async () => {
      mockGetDatabaseMode.mockReturnValue('sqlite');
      mockIsSqliteFallbackEnabled.mockReturnValue(true);

      const rowWithNulls: AgentOnboardingCodeRow = {
        ...mockRow,
        tenant_id: null,
        expected_hostname: null,
        expected_tags_json: null,
        used_at: null,
        used_by_agent_id: null,
      };

      await saveAgentOnboardingCode(rowWithNulls);

      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[2]).toBeNull(); // tenant_id
      expect(callArgs[7]).toBeNull(); // expected_hostname
      expect(callArgs[8]).toBeNull(); // expected_tags_json
      expect(callArgs[11]).toBeNull(); // used_at
      expect(callArgs[12]).toBeNull(); // used_by_agent_id
    });
  });

  describe('saveAgentCredentialAudit', () => {
    const mockAuditRow: AgentCredentialAuditRow = {
      id: 'audit-1',
      agent_id: 'agent-1',
      action: 'rotate',
      operator_id: 'user-1',
      reason: 'scheduled',
      metadata_json: '{"source":"api"}',
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should save audit to postgres', async () => {
      mockGetDatabaseMode.mockReturnValue('postgres');
      mockIsSqliteFallbackEnabled.mockReturnValue(false);

      await saveAgentCredentialAudit(mockAuditRow);

      expect(mockPostgresShadowStore.execute).toHaveBeenCalled();
    });

    it('should save audit to sqlite', async () => {
      mockGetDatabaseMode.mockReturnValue('sqlite');
      mockIsSqliteFallbackEnabled.mockReturnValue(true);

      await saveAgentCredentialAudit(mockAuditRow);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
    });

    it('should use default metadata_json', async () => {
      mockGetDatabaseMode.mockReturnValue('sqlite');
      mockIsSqliteFallbackEnabled.mockReturnValue(true);

      const rowWithoutMetadata: AgentCredentialAuditRow = {
        ...mockAuditRow,
        metadata_json: undefined,
      };

      await saveAgentCredentialAudit(rowWithoutMetadata);

      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[5]).toBe('{}'); // metadata_json defaults to '{}'
    });
  });

  describe('getAgentOnboardingCodeByHash', () => {
    const mockCode: AgentOnboardingCodeRow = {
      id: 'code-1',
      code_hash: 'hash123',
      tenant_id: 'tenant-1',
      created_by: 'user-1',
      max_uses: 5,
      used_count: 0,
      status: 'active',
      expires_at: '2024-12-31T23:59:59Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should query from postgres when available', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryOne.mockResolvedValue(mockCode);

      const result = await getAgentOnboardingCodeByHash('hash123');

      expect(mockPostgresShadowStore.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT *'),
        ['hash123']
      );
      expect(result).toEqual(mockCode);
    });

    it('should query from sqlite when postgres not available', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue(mockCode);

      const result = await getAgentOnboardingCodeByHash('hash123');

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('hash123');
      expect(result).toEqual(mockCode);
    });

    it('should return null when code not found', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue(null);

      const result = await getAgentOnboardingCodeByHash('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listAgentOnboardingCodes', () => {
    const mockCodes: AgentOnboardingCodeRow[] = [
      {
        id: 'code-1',
        code_hash: 'hash1',
        tenant_id: 'tenant-1',
        created_by: 'user-1',
        max_uses: 5,
        used_count: 0,
        status: 'active',
        expires_at: '2024-12-31T23:59:59Z',
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('should list codes from postgres with status filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryAll.mockResolvedValue(mockCodes);

      const result = await listAgentOnboardingCodes('tenant-1', 'admin', 'active', 10);

      expect(mockPostgresShadowStore.queryAll).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['active', 'tenant-1', 'admin', 10]
      );
      expect(result).toEqual(mockCodes);
    });

    it('should list codes from postgres without status filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryAll.mockResolvedValue(mockCodes);

      const result = await listAgentOnboardingCodes('tenant-1', 'admin', '', 10);

      expect(mockPostgresShadowStore.queryAll).toHaveBeenCalledWith(
        expect.not.stringContaining('status ='),
        ['tenant-1', 'admin', 10]
      );
    });

    it('should list codes from sqlite with status filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockAll.mockReturnValue(mockCodes);

      const result = await listAgentOnboardingCodes('tenant-1', 'admin', 'active', 10);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalledWith('active', 'tenant-1', 'admin', 10);
      expect(result).toEqual(mockCodes);
    });

    it('should handle invalid status filter gracefully', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryAll.mockResolvedValue(mockCodes);

      await listAgentOnboardingCodes('tenant-1', 'user', 'invalid-status', 10);

      // Should not include status filter for invalid status
      expect(mockPostgresShadowStore.queryAll).toHaveBeenCalled();
    });
  });

  describe('getLatestAgentRegistration', () => {
    it('should return registration from database', () => {
      const mockRegistration = {
        agent_id: 'agent-1',
        hostname: 'server-1',
        status: 'active',
      };
      mockGet.mockReturnValue(mockRegistration);

      const result = getLatestAgentRegistration('agent-1');

      expect(mockPrepare).toHaveBeenCalled();
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('agent_registrations');
      expect(mockGet).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual(mockRegistration);
    });

    it('should return null when no registration found', () => {
      mockGet.mockReturnValue(null);

      const result = getLatestAgentRegistration('nonexistent');

      expect(result).toBeNull();
    });
  });
});

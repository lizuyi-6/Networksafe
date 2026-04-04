/**
 * Deployment Profile Repository Tests
 *
 * Tests for CRUD operations and database interactions.
 */

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
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
  DeploymentProfileRow,
  ensureDeploymentProfileSchema,
  getDeploymentProfile,
  listDeploymentProfiles,
  getNextDeploymentProfileVersion,
  saveDeploymentProfile,
} from '../../modules/deployments/deployment-profile.repository';
import { getDatabase } from '../../config/database';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const mockPostgresShadowStore = postgresShadowStoreService as jest.Mocked<typeof postgresShadowStoreService>;

describe('Deployment Profile Repository', () => {
  let mockDb: any;
  let mockPrepare: jest.Mock;
  let mockRun: jest.Mock;
  let mockGet: jest.Mock;
  let mockAll: jest.Mock;
  let mockExec: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun = jest.fn();
    mockGet = jest.fn();
    mockAll = jest.fn();
    mockExec = jest.fn();
    mockPrepare = jest.fn().mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });
    mockDb = {
      prepare: mockPrepare,
      exec: mockExec,
    };
    mockGetDatabase.mockReturnValue(mockDb);
  });

  describe('ensureDeploymentProfileSchema', () => {
    it('should create table if not exists', () => {
      ensureDeploymentProfileSchema();

      expect(mockExec).toHaveBeenCalled();
      const sql = mockExec.mock.calls[0][0];
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS deployment_profiles');
      expect(sql).toContain('id TEXT PRIMARY KEY');
      expect(sql).toContain('tenant_id TEXT NOT NULL');
      expect(sql).toContain('server_type TEXT NOT NULL');
    });

    // Note: Testing the caching behavior (second call should not execute)
    // requires module-level state reset which is not easily testable.
    // The caching logic is: if (schemaReady) return;
  });

  describe('getDeploymentProfile', () => {
    const mockProfile: DeploymentProfileRow = {
      id: 'profile-1',
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      server_type: 'web-server',
      name: 'Web Server Profile',
      profile_json: '{}',
      config_text: 'config',
      env_snippet: 'env',
      checksum: 'abc123',
      version: 1,
      created_by: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should query from postgres when available', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryOne.mockResolvedValue(mockProfile);

      const result = await getDeploymentProfile('profile-1', 'tenant-1');

      expect(mockPostgresShadowStore.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT *'),
        ['profile-1', 'tenant-1']
      );
      expect(result).toEqual(mockProfile);
    });

    it('should query from sqlite when postgres not available', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue(mockProfile);

      const result = await getDeploymentProfile('profile-1', 'tenant-1');

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('profile-1', 'tenant-1');
      expect(result).toEqual(mockProfile);
    });

    it('should return null when profile not found', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue(null);

      const result = await getDeploymentProfile('nonexistent', 'tenant-1');

      expect(result).toBeNull();
    });

    it('should handle null site_id', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      const profileWithNullSite = { ...mockProfile, site_id: null };
      mockGet.mockReturnValue(profileWithNullSite);

      const result = await getDeploymentProfile('profile-1', 'tenant-1');

      expect(result?.site_id).toBeNull();
    });
  });

  describe('listDeploymentProfiles', () => {
    const mockProfiles: DeploymentProfileRow[] = [
      {
        id: 'profile-1',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        server_type: 'web-server',
        name: 'Web Server Profile',
        profile_json: '{}',
        config_text: 'config',
        env_snippet: 'env',
        checksum: 'abc123',
        version: 1,
        created_by: 'user-1',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'profile-2',
        tenant_id: 'tenant-1',
        site_id: null,
        server_type: 'database',
        name: 'Database Profile',
        profile_json: '{}',
        config_text: 'config',
        env_snippet: 'env',
        checksum: 'def456',
        version: 2,
        created_by: 'user-2',
        created_at: '2024-01-02T00:00:00Z',
      },
    ];

    it('should list profiles from postgres with site filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryAll.mockResolvedValue(mockProfiles);

      const result = await listDeploymentProfiles('tenant-1', 'site-1', 10);

      expect(mockPostgresShadowStore.queryAll).toHaveBeenCalledWith(
        expect.stringContaining('site_id = $2'),
        ['tenant-1', 'site-1', 10]
      );
      expect(result).toEqual(mockProfiles);
    });

    it('should list profiles from postgres without site filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryAll.mockResolvedValue(mockProfiles);

      const result = await listDeploymentProfiles('tenant-1', null, 10);

      expect(mockPostgresShadowStore.queryAll).toHaveBeenCalledWith(
        expect.not.stringContaining('site_id ='),
        ['tenant-1', 10]
      );
      expect(result).toEqual(mockProfiles);
    });

    it('should list profiles from sqlite with site filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockAll.mockReturnValue(mockProfiles);

      const result = await listDeploymentProfiles('tenant-1', 'site-1', 10);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalledWith('tenant-1', 'site-1', 10);
      expect(result).toEqual(mockProfiles);
    });

    it('should list profiles from sqlite without site filter', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockAll.mockReturnValue(mockProfiles);

      const result = await listDeploymentProfiles('tenant-1', null, 10);

      expect(mockAll).toHaveBeenCalledWith('tenant-1', 10);
      expect(result).toEqual(mockProfiles);
    });

    it('should return empty array when no profiles found', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockAll.mockReturnValue([]);

      const result = await listDeploymentProfiles('tenant-1', null, 10);

      expect(result).toEqual([]);
    });
  });

  describe('getNextDeploymentProfileVersion', () => {
    it('should return next version from postgres', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);
      mockPostgresShadowStore.queryOne.mockResolvedValue({ maxVersion: 5 });

      const result = await getNextDeploymentProfileVersion('tenant-1', 'web-server', 'site-1');

      expect(mockPostgresShadowStore.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('MAX(version)'),
        ['tenant-1', 'web-server', 'site-1']
      );
      expect(result).toBe(6);
    });

    it('should return next version from sqlite', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue({ maxVersion: 3 });

      const result = await getNextDeploymentProfileVersion('tenant-1', 'database', null);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('tenant-1', 'database', null, null);
      expect(result).toBe(4);
    });

    it('should return version 1 when no existing profiles', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue({ maxVersion: null });

      const result = await getNextDeploymentProfileVersion('tenant-1', 'new-type', null);

      expect(result).toBe(1);
    });

    it('should return version 1 when maxVersion is undefined', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue(undefined);

      const result = await getNextDeploymentProfileVersion('tenant-1', 'new-type', null);

      expect(result).toBe(1);
    });

    it('should handle zero maxVersion correctly', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      mockGet.mockReturnValue({ maxVersion: 0 });

      const result = await getNextDeploymentProfileVersion('tenant-1', 'type', null);

      expect(result).toBe(1);
    });
  });

  describe('saveDeploymentProfile', () => {
    const mockProfile: DeploymentProfileRow = {
      id: 'profile-1',
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      server_type: 'web-server',
      name: 'Web Server Profile',
      profile_json: '{"key":"value"}',
      config_text: 'config content',
      env_snippet: 'env content',
      checksum: 'abc123',
      version: 1,
      created_by: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should save to postgres when available', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(true);

      await saveDeploymentProfile(mockProfile);

      expect(mockPostgresShadowStore.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deployment_profiles'),
        expect.arrayContaining([
          'profile-1',
          'tenant-1',
          'site-1',
          'web-server',
          'Web Server Profile',
          '{"key":"value"}',
          'config content',
          'env content',
          'abc123',
          1,
          'user-1',
          '2024-01-01T00:00:00Z',
        ])
      );
    });

    it('should save to sqlite when postgres not available', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);

      await saveDeploymentProfile(mockProfile);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO deployment_profiles')
      );
      expect(mockRun).toHaveBeenCalledWith(
        'profile-1',
        'tenant-1',
        'site-1',
        'web-server',
        'Web Server Profile',
        '{"key":"value"}',
        'config content',
        'env content',
        'abc123',
        1,
        'user-1',
        '2024-01-01T00:00:00Z'
      );
    });

    it('should upsert to shadow store when not in postgres mode', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);

      await saveDeploymentProfile(mockProfile);

      expect(mockPostgresShadowStore.upsert).toHaveBeenCalledWith(
        'deployment_profiles',
        expect.objectContaining({
          id: 'profile-1',
          tenant_id: 'tenant-1',
          server_type: 'web-server',
        })
      );
    });

    it('should handle null site_id', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      const profileWithNullSite = { ...mockProfile, site_id: null };

      await saveDeploymentProfile(profileWithNullSite);

      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[2]).toBeNull();
    });

    it('should handle null name', async () => {
      mockPostgresShadowStore.canServeReads.mockReturnValue(false);
      const profileWithNullName = { ...mockProfile, name: null };

      await saveDeploymentProfile(profileWithNullName);

      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[4]).toBeNull();
    });
  });
});

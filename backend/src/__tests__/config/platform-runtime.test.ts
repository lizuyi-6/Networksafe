/**
 * Tests for platform-runtime.ts
 *
 * The module does not import logger directly, but we mock it as a safety net
 * in case transitive imports bring it in.  We use jest.doMock inside beforeAll
 * so that the module re-resolution picks up mocks before any imports.
 */

jest.doMock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.doMock('../../config/database', () => ({ getDatabase: jest.fn() }));

describe('platform-runtime', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Reset module cache so env changes are picked up
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /** Helper: fresh import of the module under test */
  function load() {
    return require('../../config/platform-runtime');
  }

  // ---------------------------------------------------------------------------
  // getArtifactStoreMode
  // ---------------------------------------------------------------------------
  describe('getArtifactStoreMode', () => {
    it('returns "s3" when ARTIFACT_STORE=s3', () => {
      process.env.ARTIFACT_STORE = 's3';
      const { getArtifactStoreMode } = load();
      expect(getArtifactStoreMode()).toBe('s3');
    });

    it('returns "local" when ARTIFACT_STORE=local', () => {
      process.env.ARTIFACT_STORE = 'local';
      const { getArtifactStoreMode } = load();
      expect(getArtifactStoreMode()).toBe('local');
    });

    it('defaults to "local" when ARTIFACT_STORE is unset', () => {
      delete process.env.ARTIFACT_STORE;
      const { getArtifactStoreMode } = load();
      expect(getArtifactStoreMode()).toBe('local');
    });

    it('falls back to "local" for invalid values', () => {
      process.env.ARTIFACT_STORE = 'gcs';
      const { getArtifactStoreMode } = load();
      expect(getArtifactStoreMode()).toBe('local');
    });
  });

  // ---------------------------------------------------------------------------
  // getDatabaseMode
  // ---------------------------------------------------------------------------
  describe('getDatabaseMode', () => {
    it('returns "postgres" when DB_MODE=postgres', () => {
      process.env.DB_MODE = 'postgres';
      delete process.env.PROFILE;
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      process.env.NODE_ENV = 'test';
      const { getDatabaseMode } = load();
      expect(getDatabaseMode()).toBe('postgres');
    });

    it('returns "sqlite" when DB_MODE=sqlite', () => {
      process.env.DB_MODE = 'sqlite';
      delete process.env.PROFILE;
      delete process.env.APP_PROFILE;
      const { getDatabaseMode } = load();
      expect(getDatabaseMode()).toBe('sqlite');
    });

    it('defaults to "postgres" in prod profile when DB_MODE is unset', () => {
      delete process.env.DB_MODE;
      process.env.PROFILE = 'prod';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { getDatabaseMode } = load();
      expect(getDatabaseMode()).toBe('postgres');
    });

    it('defaults to "sqlite" in dev profile when DB_MODE is unset', () => {
      delete process.env.DB_MODE;
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { getDatabaseMode } = load();
      expect(getDatabaseMode()).toBe('sqlite');
    });
  });

  // ---------------------------------------------------------------------------
  // getRuntimeProfile
  // ---------------------------------------------------------------------------
  describe('getRuntimeProfile', () => {
    it('returns profile from PROFILE env', () => {
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      const { getRuntimeProfile } = load();
      expect(getRuntimeProfile()).toBe('dev');
    });

    it('returns profile from APP_PROFILE env', () => {
      delete process.env.PROFILE;
      process.env.APP_PROFILE = 'demo';
      const { getRuntimeProfile } = load();
      expect(getRuntimeProfile()).toBe('demo');
    });

    it('falls back to APP_MODE=demo when profile envs are unset', () => {
      delete process.env.PROFILE;
      delete process.env.APP_PROFILE;
      process.env.APP_MODE = 'demo';
      const { getRuntimeProfile } = load();
      expect(getRuntimeProfile()).toBe('demo');
    });

    it('returns "prod" when NODE_ENV=production and no profile set', () => {
      delete process.env.PROFILE;
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      process.env.NODE_ENV = 'production';
      const { getRuntimeProfile } = load();
      expect(getRuntimeProfile()).toBe('prod');
    });

    it('returns "dev" when nothing is set', () => {
      delete process.env.PROFILE;
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      delete process.env.NODE_ENV;
      const { getRuntimeProfile } = load();
      expect(getRuntimeProfile()).toBe('dev');
    });

    it('falls back to "dev" for invalid profile value', () => {
      process.env.PROFILE = 'staging';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      process.env.NODE_ENV = 'development';
      const { getRuntimeProfile } = load();
      expect(getRuntimeProfile()).toBe('dev');
    });
  });

  // ---------------------------------------------------------------------------
  // isSqliteFallbackEnabled
  // ---------------------------------------------------------------------------
  describe('isSqliteFallbackEnabled', () => {
    it('defaults to true in non-prod profile', () => {
      delete process.env.SQLITE_FALLBACK_ENABLED;
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isSqliteFallbackEnabled } = load();
      expect(isSqliteFallbackEnabled()).toBe(true);
    });

    it('defaults to false in prod profile', () => {
      delete process.env.SQLITE_FALLBACK_ENABLED;
      process.env.PROFILE = 'prod';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isSqliteFallbackEnabled } = load();
      expect(isSqliteFallbackEnabled()).toBe(false);
    });

    it('explicitly enabled via SQLITE_FALLBACK_ENABLED=true', () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'true';
      process.env.PROFILE = 'prod';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isSqliteFallbackEnabled } = load();
      expect(isSqliteFallbackEnabled()).toBe(true);
    });

    it('explicitly disabled via SQLITE_FALLBACK_ENABLED=false', () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'false';
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isSqliteFallbackEnabled } = load();
      expect(isSqliteFallbackEnabled()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isRuntimeEmulatorEnabled
  // ---------------------------------------------------------------------------
  describe('isRuntimeEmulatorEnabled', () => {
    it('returns false by default (not requested)', () => {
      delete process.env.ENABLE_RUNTIME_EMULATOR;
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isRuntimeEmulatorEnabled } = load();
      expect(isRuntimeEmulatorEnabled()).toBe(false);
    });

    it('returns true when requested in non-prod', () => {
      process.env.ENABLE_RUNTIME_EMULATOR = 'true';
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isRuntimeEmulatorEnabled } = load();
      expect(isRuntimeEmulatorEnabled()).toBe(true);
    });

    it('returns false even when requested in prod', () => {
      process.env.ENABLE_RUNTIME_EMULATOR = 'true';
      process.env.PROFILE = 'prod';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;
      const { isRuntimeEmulatorEnabled } = load();
      expect(isRuntimeEmulatorEnabled()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Role checks
  // ---------------------------------------------------------------------------
  describe('role checks', () => {
    it('hasApiRole: true for "all" and "api"', () => {
      const { hasApiRole } = load();
      expect(hasApiRole('all')).toBe(true);
      expect(hasApiRole('api')).toBe(true);
      expect(hasApiRole('gateway')).toBe(false);
    });

    it('hasGatewayRole: true for "all" and "gateway"', () => {
      const { hasGatewayRole } = load();
      expect(hasGatewayRole('all')).toBe(true);
      expect(hasGatewayRole('gateway')).toBe(true);
      expect(hasGatewayRole('worker')).toBe(false);
    });

    it('hasWorkerRole: true for "all" and "worker"', () => {
      const { hasWorkerRole } = load();
      expect(hasWorkerRole('all')).toBe(true);
      expect(hasWorkerRole('worker')).toBe(true);
      expect(hasWorkerRole('scheduler')).toBe(false);
    });

    it('hasSchedulerRole: true for "all" and "scheduler"', () => {
      const { hasSchedulerRole } = load();
      expect(hasSchedulerRole('all')).toBe(true);
      expect(hasSchedulerRole('scheduler')).toBe(true);
      expect(hasSchedulerRole('api')).toBe(false);
    });

    it('hasControlPlaneRole: true for any specific role', () => {
      const { hasControlPlaneRole } = load();
      expect(hasControlPlaneRole('api')).toBe(true);
      expect(hasControlPlaneRole('gateway')).toBe(true);
      expect(hasControlPlaneRole('worker')).toBe(true);
      expect(hasControlPlaneRole('scheduler')).toBe(true);
      expect(hasControlPlaneRole('all')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getRuntimeDescriptor
  // ---------------------------------------------------------------------------
  describe('getRuntimeDescriptor', () => {
    it('returns a complete descriptor with all expected keys', () => {
      delete process.env.APP_ROLE;
      delete process.env.ARTIFACT_STORE;
      delete process.env.DB_MODE;
      delete process.env.SQLITE_FALLBACK_ENABLED;
      delete process.env.ENABLE_RUNTIME_EMULATOR;
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;

      const { getRuntimeDescriptor } = load();
      const desc = getRuntimeDescriptor();

      expect(desc).toHaveProperty('role');
      expect(desc).toHaveProperty('profile', 'dev');
      expect(desc).toHaveProperty('dbMode');
      expect(desc).toHaveProperty('artifactStore');
      expect(desc).toHaveProperty('sqliteFallbackEnabled');
      expect(desc).toHaveProperty('emulatorEnabled');
      expect(desc).toHaveProperty('apiEnabled');
      expect(desc).toHaveProperty('gatewayEnabled');
      expect(desc).toHaveProperty('workerEnabled');
      expect(desc).toHaveProperty('schedulerEnabled');
    });

    it('reflects a specific APP_ROLE in the descriptor', () => {
      process.env.APP_ROLE = 'api';
      process.env.PROFILE = 'dev';
      delete process.env.APP_PROFILE;
      delete process.env.APP_MODE;

      const { getRuntimeDescriptor } = load();
      const desc = getRuntimeDescriptor();

      expect(desc.role).toBe('api');
      expect(desc.apiEnabled).toBe(true);
      expect(desc.gatewayEnabled).toBe(false);
      expect(desc.workerEnabled).toBe(false);
      expect(desc.schedulerEnabled).toBe(false);
    });
  });
});

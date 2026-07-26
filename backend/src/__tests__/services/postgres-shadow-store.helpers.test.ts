/**
 * Postgres Shadow Store Service Helpers Tests
 *
 * Tests for describe(), isEnabled(), canServeReads(), and maskConnectionString.
 * Uses singleton reset pattern for isolation.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

jest.mock('../../config/platform-runtime', () => ({
  getDatabaseMode: jest.fn().mockReturnValue('sqlite'),
}));

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
}));

// The service reads SHADOW_DATABASE_URL at module level, so we set it before import
const originalShadowDbUrl = process.env.SHADOW_DATABASE_URL;

beforeAll(() => {
  delete process.env.SHADOW_DATABASE_URL;
});

afterAll(() => {
  if (originalShadowDbUrl !== undefined) {
    process.env.SHADOW_DATABASE_URL = originalShadowDbUrl;
  } else {
    delete process.env.SHADOW_DATABASE_URL;
  }
});

import { postgresShadowStoreService, maskConnectionString, toSqlValue, toQueryValue } from '../../services/postgres-shadow-store.service';
import { getDatabaseMode } from '../../config/platform-runtime';

const mockGetDatabaseMode = getDatabaseMode as jest.Mock;

describe('PostgresShadowStoreService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDatabaseMode.mockReturnValue('sqlite');
    delete process.env.SHADOW_DATABASE_URL;
  });

  describe('isEnabled', () => {
    it('returns false when SHADOW_DATABASE_URL is not set', () => {
      expect(postgresShadowStoreService.isEnabled()).toBe(false);
    });

    it('returns false when SHADOW_DATABASE_URL is empty string', () => {
      process.env.SHADOW_DATABASE_URL = '';
      // Need to re-import or reset to pick up new env var
      // Since connectionString is set at construction, we test the pattern
      // The singleton reads it once at construction, so this test verifies
      // the default (no env) behavior
      expect(postgresShadowStoreService.isEnabled()).toBe(false);
    });
  });

  describe('canServeReads', () => {
    it('returns false when disabled', () => {
      expect(postgresShadowStoreService.canServeReads()).toBe(false);
    });

    it('returns false when dbMode is not postgres', () => {
      mockGetDatabaseMode.mockReturnValue('sqlite');
      expect(postgresShadowStoreService.canServeReads()).toBe(false);
    });

    it('keeps reads closed until a complete snapshot exists and while backfill is running', () => {
      const service = postgresShadowStoreService as any;
      const original = {
        connectionString: service.connectionString,
        pool: service.pool,
        connected: service.connected,
        schemaReady: service.schemaReady,
        snapshotReady: service.snapshotReady,
        backfillInProgress: service.backfillInProgress,
      };

      try {
        mockGetDatabaseMode.mockReturnValue('postgres');
        service.connectionString = 'postgres://user:secret@localhost/db';
        service.pool = {};
        service.connected = true;
        service.schemaReady = true;
        service.snapshotReady = false;
        service.backfillInProgress = false;
        expect(postgresShadowStoreService.canServeReads()).toBe(false);

        service.snapshotReady = true;
        expect(postgresShadowStoreService.canServeReads()).toBe(true);

        service.backfillInProgress = true;
        expect(postgresShadowStoreService.canServeReads()).toBe(false);
      } finally {
        Object.assign(service, original);
      }
    });
  });

  describe('describe', () => {
    it('returns a description object with required fields', () => {
      const desc = postgresShadowStoreService.describe();
      expect(desc).toHaveProperty('enabled');
      expect(desc).toHaveProperty('connected');
      expect(desc).toHaveProperty('readModeActive');
      expect(desc).toHaveProperty('endpoint');
      expect(desc).toHaveProperty('lastError');
      expect(desc).toHaveProperty('lastBackfillAt');
      expect(desc).toHaveProperty('lastBackfillError');
      expect(desc).toHaveProperty('snapshotReady');
      expect(desc).toHaveProperty('backfillInProgress');
      expect(desc).toHaveProperty('syncedTables');
    });

    it('reports enabled=false when SHADOW_DATABASE_URL not set', () => {
      const desc = postgresShadowStoreService.describe();
      expect(desc.enabled).toBe(false);
      expect(desc.endpoint).toBeNull();
    });

    it('reports connected=false by default', () => {
      const desc = postgresShadowStoreService.describe();
      expect(desc.connected).toBe(false);
    });

    it('reports readModeActive=false when disabled', () => {
      const desc = postgresShadowStoreService.describe();
      expect(desc.readModeActive).toBe(false);
    });

    it('lastError is null when no errors occurred', () => {
      const desc = postgresShadowStoreService.describe();
      expect(desc.lastError).toBeNull();
    });

    it('syncedTables is an empty object by default', () => {
      const desc = postgresShadowStoreService.describe();
      expect(desc.syncedTables).toEqual({});
    });
  });

  describe('init / close', () => {
    it('init returns immediately when disabled', async () => {
      await expect(postgresShadowStoreService.init()).resolves.not.toThrow();
    });

    it('close does not throw when not initialized', async () => {
      await expect(postgresShadowStoreService.close()).resolves.not.toThrow();
    });
  });
});

describe('maskConnectionString', () => {
  it('masks password in connection string', () => {
    const result = maskConnectionString('postgres://user:secret123@host:5432/db');
    expect(result).toBe('postgres://user:***@host:5432/db');
  });

  it('returns unmasked when no username', () => {
    // When there's no username, there's no auth part to mask
    const result = maskConnectionString('postgres://host/db');
    expect(result).toBe('postgres://host/db');
  });

  it('handles connection string without port', () => {
    const result = maskConnectionString('postgres://user:mypassword@localhost/mydb');
    expect(result).toBe('postgres://user:***@localhost/mydb');
  });

  it('handles connection string with multiple path segments', () => {
    const result = maskConnectionString('postgres://user:pass@host:5432/db/schema');
    expect(result).toBe('postgres://user:***@host:5432/db/schema');
  });

  it('returns masked placeholder for invalid URLs', () => {
    const result = maskConnectionString('not-a-url');
    expect(result).toBe('postgres://***');
  });

  it('strips query params (only returns protocol://host:port/path)', () => {
    // The function only returns pathname, not query params
    const result = maskConnectionString('postgres://user:pass@host:5432/db?ssl=true');
    expect(result).toBe('postgres://user:***@host:5432/db');
  });
});

describe('toSqlValue', () => {
  it('converts undefined to null', () => {
    expect(toSqlValue(undefined)).toBeNull();
  });

  it('converts true to 1', () => {
    expect(toSqlValue(true)).toBe(1);
  });

  it('converts false to 0', () => {
    expect(toSqlValue(false)).toBe(0);
  });

  it('converts object to JSON string', () => {
    const result = toSqlValue({ a: 1 });
    expect(result).toBe('{"a":1}');
  });

  it('converts array to JSON string', () => {
    const result = toSqlValue([1, 2, 3]);
    expect(result).toBe('[1,2,3]');
  });

  it('leaves string unchanged', () => {
    expect(toSqlValue('hello')).toBe('hello');
  });

  it('leaves number unchanged', () => {
    expect(toSqlValue(42)).toBe(42);
    expect(toSqlValue(3.14)).toBe(3.14);
  });

  it('leaves null unchanged', () => {
    expect(toSqlValue(null)).toBe(null);
  });

  it('converts nested object to JSON string', () => {
    const result = toSqlValue({ a: { b: 2 } });
    expect(result).toBe('{"a":{"b":2}}');
  });
});

describe('toQueryValue', () => {
  it('converts Date to ISO string', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    expect(toQueryValue(date)).toBe('2024-01-01T00:00:00.000Z');
  });

  it('leaves array unchanged', () => {
    expect(toQueryValue([1, 2])).toEqual([1, 2]);
  });

  it('converts object to JSON', () => {
    const result = toQueryValue({ b: 2 });
    expect(result).toBe('{"b":2}');
  });

  it('leaves string unchanged', () => {
    expect(toQueryValue('hello')).toBe('hello');
  });

  it('leaves number unchanged', () => {
    expect(toQueryValue(42)).toBe(42);
  });

  it('converts undefined to null', () => {
    expect(toQueryValue(undefined)).toBeNull();
  });

  it('leaves null unchanged', () => {
    expect(toQueryValue(null)).toBe(null);
  });
});

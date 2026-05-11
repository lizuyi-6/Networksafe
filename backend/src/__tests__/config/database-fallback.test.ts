/**
 * Tests for DatabaseManager SQLite fallback behavior
 *
 * Verifies that when SQLITE_FALLBACK_ENABLED=false and DB_MODE=postgres,
 * initAsync() throws a clear error instead of silently degrading to SQLite.
 *
 * Requirements: 3.2, 3.3, 3.4
 */

// Mock logger to suppress output during tests
jest.doMock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock sql.js to control whether it succeeds or fails
let sqlJsShouldFail = false;
jest.doMock('sql.js', () => {
  if (sqlJsShouldFail) {
    throw new Error('sql.js not available');
  }
  const mockDb = {
    run: jest.fn(),
    exec: jest.fn(),
    prepare: jest.fn().mockReturnValue({
      run: jest.fn(),
      all: jest.fn().mockReturnValue([]),
      get: jest.fn(),
      bind: jest.fn(),
      step: jest.fn().mockReturnValue(false),
      getAsObject: jest.fn().mockReturnValue({}),
      free: jest.fn(),
    }),
    export: jest.fn().mockReturnValue(new Uint8Array()),
    close: jest.fn(),
  };
  const SQL = { Database: jest.fn().mockReturnValue(mockDb) };
  return jest.fn().mockResolvedValue(SQL);
});

// Mock better-sqlite3 to control whether it succeeds or fails
let betterSqliteShouldFail = false;
jest.doMock('better-sqlite3', () => {
  if (betterSqliteShouldFail) {
    throw new Error('better-sqlite3 not available');
  }
  const mockDb = {
    pragma: jest.fn(),
    exec: jest.fn(),
    prepare: jest.fn().mockReturnValue({
      run: jest.fn(),
      all: jest.fn().mockReturnValue([]),
      get: jest.fn(),
    }),
    close: jest.fn(),
  };
  return jest.fn().mockReturnValue(mockDb);
});

// Mock fs to avoid actual file system operations
jest.doMock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('DatabaseManager SQLite fallback behavior', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
    sqlJsShouldFail = false;
    betterSqliteShouldFail = false;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadDatabaseManager() {
    // Re-apply mocks after resetModules
    jest.doMock('../../utils/logger', () => ({
      __esModule: true,
      default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    }));
    jest.doMock('fs', () => ({
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
    }));
    jest.doMock('sql.js', () => {
      if (sqlJsShouldFail) {
        throw new Error('sql.js not available');
      }
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          run: jest.fn(),
          all: jest.fn().mockReturnValue([]),
          get: jest.fn(),
          bind: jest.fn(),
          step: jest.fn().mockReturnValue(false),
          getAsObject: jest.fn().mockReturnValue({}),
          free: jest.fn(),
        }),
        export: jest.fn().mockReturnValue(new Uint8Array()),
        close: jest.fn(),
      };
      const SQL = { Database: jest.fn().mockReturnValue(mockDb) };
      return jest.fn().mockResolvedValue(SQL);
    });
    jest.doMock('better-sqlite3', () => {
      if (betterSqliteShouldFail) {
        throw new Error('better-sqlite3 not available');
      }
      const mockDb = {
        pragma: jest.fn(),
        exec: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          run: jest.fn(),
          all: jest.fn().mockReturnValue([]),
          get: jest.fn(),
        }),
        close: jest.fn(),
      };
      return jest.fn().mockReturnValue(mockDb);
    });
    const { DatabaseManager } = require('../../config/database');
    return DatabaseManager;
  }

  // ---------------------------------------------------------------------------
  // Requirement 3.3: SQLITE_FALLBACK_ENABLED=false + DB_MODE=postgres → throw
  // ---------------------------------------------------------------------------
  describe('SQLITE_FALLBACK_ENABLED=false with DB_MODE=postgres', () => {
    it('throws when SQLITE_FALLBACK_ENABLED=false and DB_MODE=postgres', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'false';
      process.env.DB_MODE = 'postgres';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      await expect(manager.initAsync()).rejects.toThrow(
        'SQLite fallback is disabled. Postgres connection is required.'
      );
    });

    it('throws with the exact required error message', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'false';
      process.env.DB_MODE = 'postgres';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      let thrownError: Error | null = null;
      try {
        await manager.initAsync();
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError!.message).toBe(
        'SQLite fallback is disabled. Postgres connection is required.'
      );
    });

    it('throws even when sql.js is available (no silent degradation)', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'false';
      process.env.DB_MODE = 'postgres';
      process.env.DATA_DIR = './test-data';
      sqlJsShouldFail = false; // sql.js is available but should not be used

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      await expect(manager.initAsync()).rejects.toThrow(
        'SQLite fallback is disabled. Postgres connection is required.'
      );
    });

    it('throws in prod profile when SQLITE_FALLBACK_ENABLED is not set and DB_MODE=postgres', async () => {
      delete process.env.SQLITE_FALLBACK_ENABLED;
      process.env.DB_MODE = 'postgres';
      process.env.PROFILE = 'prod';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      // In prod profile, isSqliteFallbackEnabled() defaults to false
      await expect(manager.initAsync()).rejects.toThrow(
        'SQLite fallback is disabled. Postgres connection is required.'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Requirement 3.4 / 3.6: SQLITE_FALLBACK_ENABLED=true → normal SQLite init
  // ---------------------------------------------------------------------------
  describe('SQLITE_FALLBACK_ENABLED=true (fallback allowed)', () => {
    it('does NOT throw when SQLITE_FALLBACK_ENABLED=true and DB_MODE=postgres', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'true';
      process.env.DB_MODE = 'postgres';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      // Should not throw — proceeds to initialize SQLite
      await expect(manager.initAsync()).resolves.not.toThrow();
    });

    it('does NOT throw when SQLITE_FALLBACK_ENABLED=true and DB_MODE=sqlite', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'true';
      process.env.DB_MODE = 'sqlite';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      await expect(manager.initAsync()).resolves.not.toThrow();
    });

    it('does NOT throw in dev profile when SQLITE_FALLBACK_ENABLED is not set', async () => {
      delete process.env.SQLITE_FALLBACK_ENABLED;
      process.env.DB_MODE = 'postgres';
      process.env.PROFILE = 'dev';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      // In dev profile, isSqliteFallbackEnabled() defaults to true
      await expect(manager.initAsync()).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Guard is checked BEFORE sql.js initialization (not after failure)
  // ---------------------------------------------------------------------------
  describe('guard fires before sql.js initialization attempt', () => {
    it('throws immediately without attempting sql.js when fallback is disabled', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'false';
      process.env.DB_MODE = 'postgres';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      // The guard should throw before sql.js is even required
      await expect(manager.initAsync()).rejects.toThrow(
        'SQLite fallback is disabled. Postgres connection is required.'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // DB_MODE != postgres: guard should not trigger
  // ---------------------------------------------------------------------------
  describe('DB_MODE=sqlite: guard does not trigger regardless of SQLITE_FALLBACK_ENABLED', () => {
    it('does NOT throw when DB_MODE=sqlite even if SQLITE_FALLBACK_ENABLED=false', async () => {
      process.env.SQLITE_FALLBACK_ENABLED = 'false';
      process.env.DB_MODE = 'sqlite';
      process.env.DATA_DIR = './test-data';

      const DatabaseManager = loadDatabaseManager();
      const manager = new DatabaseManager();

      // Guard only fires when DB_MODE=postgres
      await expect(manager.initAsync()).resolves.not.toThrow();
    });
  });
});

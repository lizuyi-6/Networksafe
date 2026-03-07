import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';

// Type for sql.js database
interface SqlJsDatabase {
  run(sql: string, params?: any[]): void;
  exec(sql: string): void;
  prepare(sql: string): any;
  export(): Uint8Array;
  close(): void;
}

// Type for better-sqlite3 database
type BetterSqliteDatabase = any;

let SqlJs: any = null;
let useSqlJs = false;

/**
 * Database Manager
 * Handles SQLite database operations using sql.js (fallback) or better-sqlite3
 */
export class DatabaseManager {
  private db: BetterSqliteDatabase | SqlJsDatabase | null = null;
  private dbPath: string;
  private saveInterval: NodeJS.Timeout | null = null;

  constructor() {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.dbPath = path.join(dataDir, 'newsecurity.db');
    this.ensureDataDir(dataDir);
  }

  /**
   * Initialize database - tries sql.js first, falls back to better-sqlite3
   */
  public async initAsync(): Promise<void> {
    // Try sql.js first
    try {
      SqlJs = require('sql.js');
      const initSqlJs = SqlJs;
      const SQL = await initSqlJs();

      // Load existing database or create new one
      let data: Buffer | undefined;
      if (fs.existsSync(this.dbPath)) {
        data = fs.readFileSync(this.dbPath);
      }

      this.db = new SQL.Database(data);
      useSqlJs = true;

      logger.info(`Database opened with sql.js: ${this.dbPath}`);

      // Save to disk every 30 seconds for persistence
      this.saveInterval = setInterval(() => {
        this.save();
      }, 30000);
      if (typeof this.saveInterval.unref === 'function') {
        this.saveInterval.unref();
      }

      this.initSchema();
      return;
    } catch (sqlJsError: any) {
      logger.warn('sql.js not available, trying better-sqlite3', { error: sqlJsError.message });
    }

    // Fall back to better-sqlite3
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(this.dbPath);
      (this.db as BetterSqliteDatabase).pragma('journal_mode = WAL');
      (this.db as BetterSqliteDatabase).pragma('foreign_keys = ON');
      useSqlJs = false;

      logger.info(`Database opened with better-sqlite3: ${this.dbPath} (WAL mode enabled)`);

      this.initSchema();
    } catch (betterError: any) {
      logger.error('Failed to initialize database', { error: betterError.message });
      throw betterError;
    }
  }

  /**
   * Synchronous init for backward compatibility (tries sql.js)
   */
  public init(): void {
    // This is now async - but we need to call initAsync synchronously for compatibility
    // The actual initialization happens in the async version
    // For now, we'll handle this in the initDatabase function
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created data directory: ${dir}`);
    }
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    try {
      // Sites table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          domain TEXT UNIQUE NOT NULL,
          target TEXT NOT NULL,
          sslEnabled INTEGER DEFAULT 1,
          antiBotEnabled INTEGER DEFAULT 1,
          rateLimitEnabled INTEGER DEFAULT 1,
          rateLimitRequests INTEGER DEFAULT 60,
          concurrencyEnabled INTEGER DEFAULT 1,
          concurrencyMax INTEGER DEFAULT 5,
          tenant_id TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Security rules table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS security_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          siteId INTEGER NOT NULL,
          ruleType TEXT NOT NULL,
          config TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (siteId) REFERENCES sites(id) ON DELETE CASCADE
        )
      `);

      // Scan results table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS scan_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          siteId INTEGER,
          scanType TEXT NOT NULL,
          result TEXT NOT NULL,
          recommendations TEXT,
          status TEXT DEFAULT 'pending',
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (siteId) REFERENCES sites(id) ON DELETE CASCADE
        )
      `);

      // Backups table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS backups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          data TEXT NOT NULL,
          size INTEGER,
          isAutomatic INTEGER DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Monitoring data table (time-series)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          siteId INTEGER NOT NULL,
          metricType TEXT NOT NULL,
          value REAL NOT NULL,
          metadata TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (siteId) REFERENCES sites(id) ON DELETE CASCADE
        )
      `);

      // Agents table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          hostname TEXT NOT NULL,
          platform TEXT,
          arch TEXT,
          version TEXT,
          lastHeartbeat DATETIME,
          status TEXT DEFAULT 'offline',
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Users table (for authentication)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          username TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'tenant', 'viewer')),
          plan TEXT DEFAULT 'starter' CHECK(plan IN ('starter', 'pro', 'ultra')),
          tenant_id TEXT,
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
          last_login DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Auto-migrate: add 'plan' column to existing 'users' table if it doesn't have one
      try {
        this.db.exec(`ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'starter' CHECK(plan IN ('starter', 'pro', 'ultra'))`);
        logger.info('Database migration applied: added plan column to users');
      } catch (e: any) {
        // We expect an error if the column already exists
        if (!(e.message && e.message.includes('duplicate column name'))) {
          logger.warn('Error during database soft migration', { error: e.message });
        }
      }

      // Auto-migrate: add 'tenant_id' column to existing 'sites' table if it doesn't have one
      try {
        this.db.exec(`ALTER TABLE sites ADD COLUMN tenant_id TEXT`);
        logger.info('Database migration applied: added tenant_id column to sites');
      } catch (e: any) {
        if (!(e.message && e.message.includes('duplicate column name'))) {
          logger.warn('Error during database soft migration', { error: e.message });
        }
      }

      // API Keys table (for agent/device authentication)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          key_hash TEXT UNIQUE NOT NULL,
          user_id TEXT,
          tenant_id TEXT,
          permissions TEXT DEFAULT '["read"]',
          last_used DATETIME,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Devices table (for ESP32 dongles)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          device_type TEXT DEFAULT 'esp32',
          mac_address TEXT UNIQUE,
          firmware_version TEXT,
          status TEXT DEFAULT 'offline',
          last_seen DATETIME,
          config TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Alerts table (for security alerts)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          severity TEXT DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical')),
          source TEXT,
          message TEXT NOT NULL,
          details TEXT,
          acknowledged INTEGER DEFAULT 0,
          acknowledged_by TEXT,
          acknowledged_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Agent registrations table (for probe agent authentication)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL UNIQUE,
          hostname TEXT NOT NULL,
          api_key_hash TEXT NOT NULL,
          secret_key TEXT NOT NULL,
          fingerprint TEXT,
          platform TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'revoked')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME
        )
      `);

      // System configuration table (for seed version, settings, etc.)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_results_siteId ON scan_results(siteId)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_siteId ON metrics(siteId)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at)`);

      logger.info('Database schema initialized');
    } catch (error: any) {
      logger.error('Failed to initialize database schema', { error: error.message });
      throw error;
    }
  }

  /**
   * Get database instance with sql.js compatible API
   * Returns a wrapped database that supports run(), step(), getAsObject(), free()
   */
  public getDb(): any {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    const db = this.db;
    const isSqlJs = useSqlJs;

    // Return a wrapped database with sql.js-compatible API
    return {
      // Direct database operations
      exec: (sql: string) => db.exec(sql),
      run: (sql: string, params?: any[]) => {
        if (params && params.length > 0) {
          if (isSqlJs) {
            db.run(sql, params);
          } else {
            db.prepare(sql).run(...params);
          }
        } else {
          db.exec(sql);
        }
      },

      // Statement creation with sql.js-compatible API
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        let boundParams: any[] = [];
        let hasStepped = false;
        let cachedRow: any = null;

        return {
          // Bind parameters
          bind: (params: any[]) => {
            boundParams = params;
            hasStepped = false;
            cachedRow = null;
          },

          // Step through results (simulated for better-sqlite3)
          step: () => {
            if (!hasStepped) {
              if (isSqlJs) {
                stmt.bind(boundParams);
                hasStepped = stmt.step();
                if (hasStepped) {
                  cachedRow = stmt.getAsObject();
                }
              } else {
                cachedRow = stmt.get(...boundParams);
                hasStepped = true;
              }
            }
            return cachedRow !== undefined && cachedRow !== null;
          },

          // Get current row as object
          getAsObject: () => {
            if (cachedRow === null || cachedRow === undefined) {
              if (isSqlJs) {
                stmt.bind(boundParams);
                stmt.step();
                cachedRow = stmt.getAsObject();
              } else {
                cachedRow = stmt.get(...boundParams);
              }
            }
            // Convert array to object using column names if available
            if (!isSqlJs && Array.isArray(cachedRow)) {
              const columns = stmt.columns ? stmt.columns() : [];
              if (columns.length > 0) {
                const obj: any = {};
                columns.forEach((col: any, i: number) => {
                  obj[col.name] = cachedRow[i];
                });
                return obj;
              }
            }
            return cachedRow;
          },

          // Free statement
          free: () => {
            if (isSqlJs) {
              stmt.free();
            }
          },

          // Also provide direct run/all/get for convenience
          run: (...params: any[]) => {
            if (isSqlJs) {
              stmt.bind(params);
              stmt.step();
              stmt.free();
            } else {
              stmt.run(...params);
            }
          },
          all: (...params: any[]) => {
            if (isSqlJs) {
              const results: any[] = [];
              stmt.bind(params);
              while (stmt.step()) {
                results.push(stmt.getAsObject());
              }
              stmt.free();
              return results;
            } else {
              return stmt.all(...params);
            }
          },
          get: (...params: any[]) => {
            if (isSqlJs) {
              stmt.bind(params);
              if (stmt.step()) {
                const result = stmt.getAsObject();
                stmt.free();
                return result;
              }
              stmt.free();
              return undefined;
            } else {
              return stmt.get(...params);
            }
          }
        };
      }
    };
  }

  /**
   * Execute SQL with parameters (sql.js compatible API)
   */
  public run(sql: string, params?: any[]): void {
    if (!this.db) throw new Error('Database not connected');
    if (params && params.length > 0) {
      if (useSqlJs) {
        this.db.run(sql, params);
      } else {
        this.db.prepare(sql).run(...params);
      }
    } else {
      this.db.exec(sql);
    }
  }

  /**
   * Execute SQL (for DDL statements)
   */
  public exec(sql: string, params?: any[]): void {
    if (!this.db) throw new Error('Database not connected');
    if (params && params.length > 0) {
      if (useSqlJs) {
        this.db.run(sql, params);
      } else {
        this.db.prepare(sql).run(...params);
      }
    } else {
      this.db.exec(sql);
    }
  }

  /**
   * Prepare and run a statement (compatible API with sql.js)
   */
  public prepare(sql: string): {
    run: (...params: any[]) => void;
    all: (...params: any[]) => any[];
    get: (...params: any[]) => any;
    free: () => void;
    bind: (params: any[]) => void;
    step: () => boolean;
    getAsObject: () => any;
  } {
    if (!this.db) throw new Error('Database not connected');

    const stmt = this.db.prepare(sql);
    let boundParams: any[] = [];
    let hasStepped = false;
    let cachedRow: any = null;

    return {
      run: (...params: any[]) => {
        if (useSqlJs) {
          stmt.bind(params);
          stmt.step();
          stmt.free();
        } else {
          stmt.run(...params);
        }
      },
      all: (...params: any[]) => {
        if (useSqlJs) {
          const results: any[] = [];
          stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } else {
          return stmt.all(...params);
        }
      },
      get: (...params: any[]) => {
        if (useSqlJs) {
          stmt.bind(params);
          if (stmt.step()) {
            const result = stmt.getAsObject();
            stmt.free();
            return result;
          }
          stmt.free();
          return undefined;
        } else {
          return stmt.get(...params);
        }
      },
      free: () => {
        if (useSqlJs) {
          stmt.free();
        }
      },
      bind: (params: any[]) => {
        boundParams = params;
        hasStepped = false;
        cachedRow = null;
      },
      step: () => {
        if (useSqlJs) {
          if (!hasStepped) {
            stmt.bind(boundParams);
            hasStepped = stmt.step();
            if (hasStepped) {
              cachedRow = stmt.getAsObject();
            }
          }
          return hasStepped;
        } else {
          // better-sqlite3 doesn't need step() - just get the row
          if (!hasStepped) {
            cachedRow = stmt.get(...boundParams);
            hasStepped = true;
          }
          return cachedRow !== undefined && cachedRow !== null;
        }
      },
      getAsObject: () => {
        if (useSqlJs) {
          // Return the cached row or get a new one
          if (cachedRow === null || cachedRow === undefined) {
            stmt.bind(boundParams);
            stmt.step();
            cachedRow = stmt.getAsObject();
          }
          return cachedRow;
        } else {
          // Return the cached row or get a new one
          if (cachedRow === null || cachedRow === undefined) {
            cachedRow = stmt.get(...boundParams);
          }
          // Convert array to object if needed
          if (Array.isArray(cachedRow)) {
            // For SELECT * queries, we need column names
            // This is a simplification - the actual usage may vary
            return cachedRow;
          }
        }
        return cachedRow;
      }
    };
  }

  /**
   * Run a transaction
   */
  public transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not connected');
    if (useSqlJs) {
      this.exec('BEGIN');
      try {
        const result = fn();
        this.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure and rethrow original error
        }
        throw error;
      }
    }
    return (this.db as BetterSqliteDatabase).transaction(fn)();
  }

  /**
   * Save database to disk
   */
  public save(): void {
    if (!this.db) return;

    try {
      if (useSqlJs) {
        // sql.js: Export to buffer and write to file
        const data = (this.db as SqlJsDatabase).export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
        logger.debug('Database saved to disk (sql.js)');
      } else {
        // better-sqlite3: Checkpoint to ensure data is written to main database
        (this.db as BetterSqliteDatabase).pragma('wal_checkpoint(TRUNCATE)');
      }
    } catch (error: any) {
      logger.error('Failed to save database', { error: error.message });
    }
  }

  /**
   * Backup database to specified path
   */
  public backup(backupPath: string): void {
    if (!this.db) throw new Error('Database not connected');
    if (useSqlJs) {
      const data = (this.db as SqlJsDatabase).export();
      fs.writeFileSync(backupPath, Buffer.from(data));
    } else {
      (this.db as BetterSqliteDatabase).backup(backupPath);
    }
    logger.info(`Database backed up to: ${backupPath}`);
  }

  /**
   * Close database connection
   */
  public close(): void {
    if (this.db) {
      if (this.saveInterval) {
        clearInterval(this.saveInterval);
        this.saveInterval = null;
      }

      if (useSqlJs) {
        this.save();
        (this.db as SqlJsDatabase).close();
      } else {
        // Close WAL before closing
        (this.db as BetterSqliteDatabase).pragma('wal_checkpoint(TRUNCATE)');
        (this.db as BetterSqliteDatabase).close();
      }
      this.db = null;
      logger.info('Database connection closed');
    }
  }
}

// Singleton instance
let dbManager: DatabaseManager | null = null;

export async function initDatabase(): Promise<DatabaseManager> {
  if (dbManager) return dbManager;

  dbManager = new DatabaseManager();
  await dbManager.initAsync();
  return dbManager;
}

export function getDatabase(): DatabaseManager {
  if (!dbManager) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbManager;
}

export function closeDatabase(): void {
  if (dbManager) {
    dbManager.close();
    dbManager = null;
  }
}

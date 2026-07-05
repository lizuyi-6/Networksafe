import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';
import { getDatabaseMode, isSqliteFallbackEnabled } from './platform-runtime';

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

export type SqliteEngine = 'sqljs' | 'better-sqlite3';

/**
 * Decide which SQLite engine to try first.
 *
 * - `DB_ENGINE=sqljs|better-sqlite3` is an explicit override.
 * - Test runs (Jest) stay on sql.js: every worker loads its own in-memory
 *   snapshot of the DB file, which is what keeps parallel workers isolated.
 *   better-sqlite3 would share one physical file across workers.
 * - Every other runtime prefers better-sqlite3: WAL journaling and
 *   synchronous commits, instead of sql.js's whole-DB-in-memory model whose
 *   writes only reach disk on the periodic save.
 */
export function resolveSqliteEngineOrder(env: NodeJS.ProcessEnv = process.env): SqliteEngine[] {
  if (env.DB_ENGINE === 'sqljs') return ['sqljs', 'better-sqlite3'];
  if (env.DB_ENGINE === 'better-sqlite3') return ['better-sqlite3', 'sqljs'];
  if (env.NODE_ENV === 'test' || env.JEST_WORKER_ID) return ['sqljs', 'better-sqlite3'];
  return ['better-sqlite3', 'sqljs'];
}

export interface WrappedStatement {
  run: (...params: any[]) => void;
  all: (...params: any[]) => any[];
  get: (...params: any[]) => any;
  free: () => void;
  bind: (params: any[]) => void;
  step: () => boolean;
  getAsObject: () => any;
}

/**
 * Wrap a raw sql.js / better-sqlite3 statement behind one sql.js-style API.
 *
 * step() advances a cursor on every call and returns false once the result
 * set is exhausted, so `while (stmt.step())` iterates all rows and
 * terminates. (The previous wrapper cached the first step() result and
 * returned it forever, which made that loop infinite on any non-empty
 * result set.)
 */
function wrapStatement(stmt: any, isSqlJs: boolean): WrappedStatement {
  let boundParams: any[] = [];
  let bound = false; // sql.js: params bound to the underlying statement
  let rows: any[] | null = null; // better-sqlite3: materialized result rows
  let rowIndex = 0;
  let currentRow: any = null;

  const step = (): boolean => {
    if (isSqlJs) {
      if (!bound) {
        stmt.bind(boundParams);
        bound = true;
      }
      const hasRow = stmt.step();
      currentRow = hasRow ? stmt.getAsObject() : null;
      return hasRow;
    }
    if (rows === null) {
      rows = stmt.all(...boundParams);
      rowIndex = 0;
    }
    if (rows && rowIndex < rows.length) {
      currentRow = rows[rowIndex++];
      return true;
    }
    currentRow = null;
    return false;
  };

  return {
    bind: (params: any[]) => {
      boundParams = params || [];
      bound = false;
      rows = null;
      rowIndex = 0;
      currentRow = null;
    },
    step,
    getAsObject: () => {
      if (currentRow === null || currentRow === undefined) {
        step();
      }
      return currentRow;
    },
    free: () => {
      if (isSqlJs) {
        stmt.free();
      }
    },
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
      }
      return stmt.all(...params);
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
      }
      return stmt.get(...params);
    }
  };
}

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
   * Initialize database - engine order decided by resolveSqliteEngineOrder()
   */
  public async initAsync(): Promise<void> {
    // Guard: if SQLite fallback is disabled and DB_MODE is postgres, refuse to
    // silently degrade — the caller must ensure Postgres is available.
    if (!isSqliteFallbackEnabled() && getDatabaseMode() === 'postgres') {
      throw new Error('SQLite fallback is disabled. Postgres connection is required.');
    }

    const errors: string[] = [];
    for (const engine of resolveSqliteEngineOrder()) {
      try {
        if (engine === 'sqljs') {
          await this.initSqlJs();
        } else {
          this.initBetterSqlite3();
        }
        this.initSchema();
        return;
      } catch (engineError: any) {
        // Undo any half-initialized engine state before trying the next one
        if (this.saveInterval) {
          clearInterval(this.saveInterval);
          this.saveInterval = null;
        }
        this.db = null;
        errors.push(`${engine}: ${engineError.message}`);
        logger.warn(`SQLite engine ${engine} unavailable, trying next`, { error: engineError.message });
      }
    }

    const error = new Error(`Failed to initialize database with any engine (${errors.join('; ')})`);
    logger.error('Failed to initialize database', { error: error.message });
    throw error;
  }

  private async initSqlJs(): Promise<void> {
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
  }

  private initBetterSqlite3(): void {
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    (this.db as BetterSqliteDatabase).pragma('journal_mode = WAL');
    (this.db as BetterSqliteDatabase).pragma('foreign_keys = ON');
    useSqlJs = false;

    logger.info(`Database opened with better-sqlite3: ${this.dbPath} (WAL mode enabled)`);
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
          role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'tenant', 'viewer', 'platform_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer', 'auditor')),
          plan TEXT DEFAULT 'starter' CHECK(plan IN ('starter', 'pro', 'ultra')),
          tenant_id TEXT,
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
          last_login DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.migrateUsersRoleConstraint();

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

      // Devices table (Gateway Appliance + registered devices). The legacy
      // ESP32 serial-deployer hardware is retired; default reflects the active
      // Root-Resistant Gateway Appliance baseline.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          device_type TEXT DEFAULT 'gateway_appliance',
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

      try {
        this.db.exec(`ALTER TABLE agent_registrations ADD COLUMN tenant_id TEXT`);
        logger.info('Database migration applied: added tenant_id column to agent_registrations');
      } catch (e: any) {
        if (!(e.message && e.message.includes('duplicate column name'))) {
          logger.warn('Error during database soft migration', { error: e.message });
        }
      }

      try {
        this.db.exec(`UPDATE agent_registrations SET tenant_id = 'platform' WHERE tenant_id IS NULL OR tenant_id = ''`);
      } catch (e: any) {
        logger.warn('Error during database tenant backfill for agent_registrations', { error: e.message });
      }

      // System configuration table (for seed version, settings, etc.)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Announcements table (for system-wide announcements)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS announcements (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'info' CHECK(type IN ('info', 'warning', 'critical')),
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
          published_at DATETIME,
          expires_at DATETIME,
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Traffic samples table (fixed-interval time-series for dashboard 1h/24h/7d
      // traffic charts). Each row is the per-interval request/blocked delta stamped
      // with an absolute epoch-ms timestamp; the traffic-history service buckets
      // these into uniform windows and prunes rows past the 7d+margin retention.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS traffic_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts_epoch_ms INTEGER NOT NULL,
          requests INTEGER NOT NULL DEFAULT 0,
          blocked INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Login history table (for tracking user logins)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS login_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          status TEXT DEFAULT 'success' CHECK(status IN ('success', 'failed')),
          logout_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_traffic_samples_ts ON traffic_samples(ts_epoch_ms)`);

      logger.info('Database schema initialized');
    } catch (error: any) {
      logger.error('Failed to initialize database schema', { error: error.message });
      throw error;
    }
  }

  private migrateUsersRoleConstraint(): void {
    if (!this.db) {
      return;
    }

    try {
      const row = (this.db as any).prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'users'
        LIMIT 1
      `).get() as { sql?: string } | undefined;
      const createSql = String(row?.sql || '');
      if (!createSql || createSql.includes('platform_admin')) {
        return;
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users_enterprise_migration (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          username TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'tenant', 'viewer', 'platform_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer', 'auditor')),
          plan TEXT DEFAULT 'starter' CHECK(plan IN ('starter', 'pro', 'ultra')),
          tenant_id TEXT,
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
          last_login DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users_enterprise_migration (
          id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at
        )
        SELECT id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_enterprise_migration RENAME TO users;
      `);
      logger.info('Database migration applied: expanded users role constraint for enterprise roles');
    } catch (error: any) {
      logger.warn('Error during users role constraint migration', { error: error?.message });
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
      prepare: (sql: string) => wrapStatement(db.prepare(sql), isSqlJs)
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
   * Execute SQL (alias of run — kept for callers that use exec for DDL)
   */
  public exec(sql: string, params?: any[]): void {
    this.run(sql, params);
  }

  /**
   * Prepare and run a statement (compatible API with sql.js)
   */
  public prepare(sql: string): WrappedStatement {
    if (!this.db) throw new Error('Database not connected');
    return wrapStatement(this.db.prepare(sql), useSqlJs);
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

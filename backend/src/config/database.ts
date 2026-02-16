import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';

/**
 * Database Manager
 * Handles SQLite database operations using sql.js (pure JavaScript)
 */
export class DatabaseManager {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private saveInterval: NodeJS.Timeout | null = null;

  constructor() {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.dbPath = path.join(dataDir, 'newsecurity.db');
    this.ensureDataDir(dataDir);
  }

  /**
   * Initialize database (async because sql.js needs to load WASM)
   */
  public async init(): Promise<void> {
    try {
      const SQL = await initSqlJs();

      // Try to load existing database
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
        logger.info(`Loaded existing database: ${this.dbPath}`);
      } else {
        this.db = new SQL.Database();
        logger.info(`Created new database: ${this.dbPath}`);
      }

      this.initSchema();
      this.startAutoSave();
    } catch (error: any) {
      logger.error('Failed to initialize database', { error: error.message });
      throw error;
    }
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
      this.db.run(`
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
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Security rules table
      this.db.run(`
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
      this.db.run(`
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
      this.db.run(`
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
      this.db.run(`
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
      this.db.run(`
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
      this.db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          username TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'tenant', 'viewer')),
          tenant_id TEXT,
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
          last_login DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // API Keys table (for agent/device authentication)
      this.db.run(`
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
      this.db.run(`
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
      this.db.run(`
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
      this.db.run(`
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

      // Create indexes
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_scan_results_siteId ON scan_results(siteId)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_siteId ON metrics(siteId)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at)`);

      logger.info('Database schema initialized');
    } catch (error: any) {
      logger.error('Failed to initialize database schema', { error: error.message });
      throw error;
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    // Save to disk every 30 seconds
    this.saveInterval = setInterval(() => {
      this.save();
    }, 30000);
  }

  /**
   * Save database to disk
   */
  public save(): void {
    if (!this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error: any) {
      logger.error('Failed to save database', { error: error.message });
    }
  }

  /**
   * Get database instance
   */
  public getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not connected');
    }
    return this.db;
  }

  /**
   * Execute SQL and return results
   */
  public exec(sql: string): void {
    if (!this.db) throw new Error('Database not connected');
    this.db.run(sql);
  }

  /**
   * Prepare and run a statement
   */
  public prepare(sql: string): {
    run: (...params: any[]) => void;
    all: (...params: any[]) => any[];
    get: (...params: any[]) => any;
  } {
    if (!this.db) throw new Error('Database not connected');

    const db = this.db;

    return {
      run: (...params: any[]) => {
        db.run(sql, params);
      },
      all: (...params: any[]) => {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results: any[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
      get: (...params: any[]) => {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const result = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return result;
      }
    };
  }

  /**
   * Run a transaction
   */
  public transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not connected');
    this.db.run('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close database connection
   */
  public close(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    if (this.db) {
      this.save(); // Final save
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }
}

// Singleton instance
let dbManager: DatabaseManager | null = null;
let initPromise: Promise<DatabaseManager> | null = null;

export async function initDatabase(): Promise<DatabaseManager> {
  if (dbManager) return dbManager;

  if (!initPromise) {
    initPromise = (async () => {
      dbManager = new DatabaseManager();
      await dbManager.init();
      return dbManager;
    })();
  }

  return initPromise;
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
    initPromise = null;
  }
}

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';

/**
 * Database Manager
 * Handles SQLite database operations
 */
export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor() {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.dbPath = path.join(dataDir, 'newsecurity.db');

    this.ensureDataDir(dataDir);
    this.connect();
    this.initSchema();
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
   * Connect to database
   */
  private connect(): void {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      logger.info(`Connected to database: ${this.dbPath}`);
    } catch (error: any) {
      logger.error('Failed to connect to database', { error });
      throw error;
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

      // Create indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
        CREATE INDEX IF NOT EXISTS idx_scan_results_siteId ON scan_results(siteId);
        CREATE INDEX IF NOT EXISTS idx_metrics_siteId ON metrics(siteId);
        CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
      `);

      logger.info('Database schema initialized');
    } catch (error: any) {
      logger.error('Failed to initialize database schema', { error });
      throw error;
    }
  }

  /**
   * Get database instance
   */
  public getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not connected');
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Backup database
   */
  public backup(backupPath: string): void {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    try {
      this.db.backup(backupPath).then(() => {
        logger.info(`Database backed up to: ${backupPath}`);
      });
    } catch (error: any) {
      logger.error('Failed to backup database', { error });
      throw error;
    }
  }
}

// Singleton instance
let dbManager: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

export function closeDatabase(): void {
  if (dbManager) {
    dbManager.close();
    dbManager = null;
  }
}

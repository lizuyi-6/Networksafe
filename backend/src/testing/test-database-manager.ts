/**
 * Test Database Manager
 *
 * Creates isolated in-memory SQLite database instances for testing.
 * Each test gets its own database to ensure complete isolation.
 */

import logger from '../utils/logger';

/**
 * TestDatabaseManager
 *
 * Manages isolated in-memory database instances for parallel test execution.
 * Each test can request its own database instance using a unique test ID.
 */
export class TestDatabaseManager {
  private static instances: Map<string, any> = new Map();
  private static currentTestId: string | null = null;
  private static SqlJs: any = null;

  /**
   * Create a new in-memory database for a test
   */
  public static createTestDatabase(testId: string): any {
    if (!this.SqlJs) {
      throw new Error('TestDatabaseManager not initialized. Call init() first.');
    }

    // Close existing instance for this test if any
    if (this.instances.has(testId)) {
      this.closeTestDatabase(testId);
    }

    // Create new in-memory sql.js database
    const db = new this.SqlJs.Database();
    db.run('PRAGMA foreign_keys = ON');

    this.instances.set(testId, db);
    this.currentTestId = testId;

    logger.debug(`Created test database: ${testId}`);

    return db;
  }

  /**
   * Get the current test database
   */
  public static getTestDatabase(): any | null {
    if (!this.currentTestId) {
      return null;
    }
    return this.instances.get(this.currentTestId) || null;
  }

  /**
   * Get database by test ID
   */
  public static getDatabaseById(testId: string): any | null {
    return this.instances.get(testId) || null;
  }

  /**
   * Close a test database
   */
  public static closeTestDatabase(testId: string): void {
    const db = this.instances.get(testId);
    if (db) {
      if (typeof db.close === 'function') {
        db.close();
      }
      this.instances.delete(testId);
      logger.debug(`Closed test database: ${testId}`);
    }
  }

  /**
   * Close all test databases
   */
  public static closeAll(): void {
    for (const [testId, db] of this.instances) {
      if (typeof db.close === 'function') {
        db.close();
      }
      logger.debug(`Closed test database: ${testId}`);
    }
    this.instances.clear();
    this.currentTestId = null;
  }

  /**
   * Set current test ID
   */
  public static setCurrentTestId(testId: string | null): void {
    this.currentTestId = testId;
  }

  /**
   * Get current test ID
   */
  public static getCurrentTestId(): string | null {
    return this.currentTestId;
  }

  /**
   * Initialize the test database manager (no-op for better-sqlite3)
   */
  public static async init(): Promise<void> {
    if (this.SqlJs) return;
    const initSqlJs = require('sql.js');
    this.SqlJs = await initSqlJs();
    logger.debug('TestDatabaseManager initialized');
  }

  /**
   * Create an isolated database for a test (alias for createTestDatabase)
   */
  public static createIsolatedDatabase(testId: string): any {
    return this.createTestDatabase(testId);
  }

  /**
   * Clean up a test database (alias for closeTestDatabase)
   */
  public static cleanupDatabase(testId: string): void {
    this.closeTestDatabase(testId);
  }

  /**
   * Clean up all test databases (compatibility alias for closeAll)
   */
  public static cleanupAll(): void {
    this.closeAll();
  }

  /**
   * Test manager stats used by jest setup hooks
   */
  public static getStats(): { currentTestId: string | null; activeInstances: number; testIds: string[] } {
    return {
      currentTestId: this.currentTestId,
      activeInstances: this.instances.size,
      testIds: Array.from(this.instances.keys())
    };
  }
}

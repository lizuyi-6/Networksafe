/**
 * Test Database Manager
 *
 * Creates isolated in-memory SQLite database instances for testing.
 * Each test gets its own database to ensure complete isolation.
 */

import Database, { Database as BetterSqliteDatabase } from 'better-sqlite3';
import logger from '../utils/logger';

/**
 * TestDatabaseManager
 *
 * Manages isolated in-memory database instances for parallel test execution.
 * Each test can request its own database instance using a unique test ID.
 */
export class TestDatabaseManager {
  private static instances: Map<string, BetterSqliteDatabase> = new Map();
  private static currentTestId: string | null = null;

  /**
   * Create a new in-memory database for a test
   */
  public static createTestDatabase(testId: string): BetterSqliteDatabase {
    // Close existing instance for this test if any
    if (this.instances.has(testId)) {
      this.closeTestDatabase(testId);
    }

    // Create new in-memory database
    const db = new Database(':memory:');

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    this.instances.set(testId, db);
    this.currentTestId = testId;

    logger.debug(`Created test database: ${testId}`);

    return db;
  }

  /**
   * Get the current test database
   */
  public static getTestDatabase(): BetterSqliteDatabase | null {
    if (!this.currentTestId) {
      return null;
    }
    return this.instances.get(this.currentTestId) || null;
  }

  /**
   * Get database by test ID
   */
  public static getDatabaseById(testId: string): BetterSqliteDatabase | null {
    return this.instances.get(testId) || null;
  }

  /**
   * Close a test database
   */
  public static closeTestDatabase(testId: string): void {
    const db = this.instances.get(testId);
    if (db) {
      db.close();
      this.instances.delete(testId);
      logger.debug(`Closed test database: ${testId}`);
    }
  }

  /**
   * Close all test databases
   */
  public static closeAll(): void {
    for (const [testId, db] of this.instances) {
      db.close();
      logger.debug(`Closed test database: ${testId}`);
    }
    this.instances.clear();
    this.currentTestId = null;
  }

  /**
   * Set current test ID
   */
  public static setCurrentTestId(testId: string): void {
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
    // No initialization needed for better-sqlite3
    logger.debug('TestDatabaseManager initialized');
  }

  /**
   * Create an isolated database for a test (alias for createTestDatabase)
   */
  public static createIsolatedDatabase(testId: string): BetterSqliteDatabase {
    return this.createTestDatabase(testId);
  }

  /**
   * Clean up a test database (alias for closeTestDatabase)
   */
  public static cleanupDatabase(testId: string): void {
    this.closeTestDatabase(testId);
  }
}

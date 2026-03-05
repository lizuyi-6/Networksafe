/**
 * Test Context
 *
 * Provides a complete test environment including database, fixtures, and app instance.
 * This simplifies test setup and teardown.
 */

import express, { Application } from 'express';
import Database, { Database as SqlJsDatabase } from 'better-sqlite3';
import { TestDatabaseManager } from './test-database-manager';
import { TestDataFixtures, SeedOptions } from './test-data-fixtures';
import request from 'supertest';

/**
 * Test context options
 */
export interface TestContextOptions {
  /**
   * Seed test data on creation
   */
  seedData?: SeedOptions;

  /**
   * Custom Express application setup
   */
  setupApp?: (app: Application, db: SqlJsDatabase) => void;

  /**
   * Test ID (auto-generated if not provided)
   */
  testId?: string;
}

/**
 * Test context interface
 */
export interface TestContext {
  /**
   * Database instance
   */
  db: SqlJsDatabase;

  /**
   * Test fixtures helper
   */
  fixtures: typeof TestDataFixtures;

  /**
   * Express application instance
   */
  app: Application;

  /**
   * Supertest request helper
   */
  request: ReturnType<typeof request>;

  /**
   * Test ID
   */
  testId: string;

  /**
   * Seeded data (if seedData option was used)
   */
  seededData?: ReturnType<typeof TestDataFixtures.seedTestData>;
}

/**
 * Create a complete test context
 *
 * @param options - Test context options
 * @returns Test context with database, fixtures, app, and request
 */
export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  // Initialize TestDatabaseManager if needed
  await TestDatabaseManager.init();

  // Generate test ID
  const testId = options.testId || `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Create isolated database
  const db = TestDatabaseManager.createIsolatedDatabase(testId);

  // Create Express app
  const app = express();
  app.use(express.json());

  // Custom app setup
  if (options.setupApp) {
    options.setupApp(app, db);
  }

  // Seed data if requested
  let seededData;
  if (options.seedData) {
    seededData = TestDataFixtures.seedTestData(db, options.seedData);
  }

  return {
    db,
    fixtures: TestDataFixtures,
    app,
    request: request(app),
    testId,
    seededData
  };
}

/**
 * Destroy test context and clean up resources
 *
 * @param ctx - Test context to destroy
 */
export function destroyTestContext(ctx: TestContext): void {
  // Clean up database
  TestDatabaseManager.cleanupDatabase(ctx.testId);
}

/**
 * Create a test context for a specific test file
 *
 * This is a convenience function that creates a test context with a descriptive ID.
 *
 * @param testFileName - Name of the test file
 * @param options - Test context options
 * @returns Test context
 */
export async function createTestContextForFile(
  testFileName: string,
  options: Omit<TestContextOptions, 'testId'> = {}
): Promise<TestContext> {
  const testId = `${testFileName}-${Date.now()}`;
  return createTestContext({ ...options, testId });
}

/**
 * Helper to run a test with automatic context management
 *
 * @param testFn - Test function that receives the context
 * @param options - Test context options
 */
export async function withTestContext<T>(
  testFn: (ctx: TestContext) => Promise<T>,
  options: TestContextOptions = {}
): Promise<T> {
  const ctx = await createTestContext(options);
  try {
    return await testFn(ctx);
  } finally {
    destroyTestContext(ctx);
  }
}

/**
 * Create a mock request context with authenticated user
 *
 * @param ctx - Test context
 * @param userOverrides - Custom user data
 * @returns Request context with authenticated user
 */
export function createAuthenticatedRequest(
  ctx: TestContext,
  userOverrides: { userId?: string; email?: string; role?: string; tenantId?: string } = {}
): {
  request: ReturnType<typeof request>;
  user: { userId: string; email: string; role: string; tenantId: string };
} {
  const user = {
    userId: userOverrides.userId || 'test-user',
    email: userOverrides.email || 'test@example.com',
    role: userOverrides.role || 'admin',
    tenantId: userOverrides.tenantId || 'tenant-001'
  };

  return {
    request: ctx.request,
    user
  };
}

/**
 * Database query helpers for test context
 */
export class TestContextQueries {
  /**
   * Get all users from database
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getUsers(db: any): any[] {
    const stmt = db.prepare('SELECT * FROM users');
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Get all agents from database
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getAgents(db: any): any[] {
    const stmt = db.prepare('SELECT * FROM agents');
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Get all alerts from database
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getAlerts(db: any): any[] {
    const stmt = db.prepare('SELECT * FROM alerts');
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Get all sites from database
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getSites(db: any): any[] {
    const stmt = db.prepare('SELECT * FROM sites');
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Get all devices from database
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getDevices(db: any): any[] {
    const stmt = db.prepare('SELECT * FROM devices');
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Count rows in a table
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static countRows(db: any, table: string): number {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
    const result = stmt.step() ? stmt.getAsObject() : { count: 0 };
    stmt.free();
    return result.count as number;
  }
}

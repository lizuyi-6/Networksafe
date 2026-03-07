/**
 * Jest Database Setup
 *
 * Configures test database management for isolated test execution.
 * This setup file manages the lifecycle of test databases.
 */

const { TestDatabaseManager } = require('./src/testing/test-database-manager');

// Global test database setup
let isInitialized = false;

/**
 * Initialize test database manager before all tests
 */
global.beforeAll(async () => {
  if (!isInitialized) {
    await TestDatabaseManager.init();
    isInitialized = true;
    console.log('Test database manager initialized');
  }
});

/**
 * Clean up current test database after each test
 */
global.afterEach(() => {
  const stats = TestDatabaseManager.getStats();
  if (stats.currentTestId) {
    TestDatabaseManager.cleanupDatabase(stats.currentTestId);
  }
});

/**
 * Clean up all test databases after all tests
 */
global.afterAll(() => {
  TestDatabaseManager.cleanupAll();
  console.log('All test databases cleaned up');
});

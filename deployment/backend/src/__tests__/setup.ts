/**
 * Global Test Setup
 * This file runs before all tests.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3006'; // Use different port for testing
process.env.REDIS_URL = 'redis://localhost:6379'; // Assuming local redis or mocked

// Mock console methods to keep test output clean
global.console = {
    ...console,
    // log: jest.fn(), // Uncomment to silence logs
    // debug: jest.fn(),
    // info: jest.fn(),
    // warn: jest.fn(),
    // error: jest.fn(),
};

beforeAll(async () => {
    // Global setup like connecting to test DB would go here
});

afterAll(async () => {
    // Global teardown
});

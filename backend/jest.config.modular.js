/**
 * Modular Jest Configuration
 *
 * Allows running tests by module via TEST_MODULE environment variable
 * Usage: TEST_MODULE=security,scanner npm run test:module
 */

const baseConfig = require('./jest.config');

// Module test patterns - use <rootDir> for cross-platform compatibility
const MODULES = {
    core: ['<rootDir>/src/__tests__/core/**/*.test.ts'],
    security: ['<rootDir>/src/__tests__/security/**/*.test.ts'],
    scanner: ['<rootDir>/src/__tests__/scanner/**/*.test.ts'],
    websocket: ['<rootDir>/src/__tests__/websocket/**/*.test.ts'],
    services: ['<rootDir>/src/__tests__/services/**/*.test.ts'],
    agent: ['<rootDir>/src/__tests__/agent/**/*.test.ts'],
    utils: ['<rootDir>/src/__tests__/utils/**/*.test.ts'],
    integration: ['<rootDir>/src/__tests__/integration/**/*.test.ts'],
    modules: ['<rootDir>/src/__tests__/modules/**/*.test.ts'],
    routes: ['<rootDir>/src/__tests__/routes/**/*.test.ts'],
    controllers: ['<rootDir>/src/__tests__/controllers/**/*.test.ts'],
};

// Parse requested modules from environment
const requested = process.env.TEST_MODULE?.split(',').map(m => m.trim()).filter(Boolean) || [];

// Build test match patterns
let testMatch;
if (requested.length > 0) {
    // Expand module names to patterns
    const patterns = requested.flatMap(m => {
        if (MODULES[m]) {
            return MODULES[m];
        }
        // Allow direct path patterns
        if (m.includes('/') || m.includes('*')) {
            return m;
        }
        console.warn(`Unknown module: ${m}, available: ${Object.keys(MODULES).join(', ')}`);
        return [];
    });
    testMatch = patterns.length > 0 ? patterns : baseConfig.testMatch;
} else {
    // Default: run all tests
    testMatch = baseConfig.testMatch;
}

// Log what we're running
if (requested.length > 0) {
    console.log(`[Modular Test] Running modules: ${requested.join(', ')}`);
    console.log(`[Modular Test] Patterns: ${testMatch.join(', ')}`);
}

module.exports = {
    ...baseConfig,
    testMatch,
};

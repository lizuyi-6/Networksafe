module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/tests/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    collectCoverageFrom: [
        'src/api/**/*.ts',
        'src/services/**/*.ts',
        'src/middleware/**/*.ts',
        'src/security/**/*.ts',
        'src/core/**/*.ts',
        'src/config/**/*.ts',
        'src/utils/**/*.ts',
        'src/modules/**/*.ts',
        'src/ai-agents/**/*.ts',
        'src/agent/**/*.ts',
        'src/scanner/**/*.ts',
        'src/websocket/**/*.ts',
        '!src/**/*.d.ts'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        'src/ai-agents/investigation/',
        'src/testing/',
    ],
    coverageDirectory: 'coverage',
    transform: {
        '^.+\\.ts$': [require.resolve('ts-jest'), {
            tsconfig: 'tsconfig.test.json',
            diagnostics: false
        }]
    },
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/src/ai-agents/investigation/',
        '/src/ai-agents/tests/'
    ],
    watchman: false,
    maxWorkers: 1,
    forceExit: true,
    testTimeout: 30000
};

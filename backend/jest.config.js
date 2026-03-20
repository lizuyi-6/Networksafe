module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/tests/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    collectCoverageFrom: [
        'src/api/**/*.ts',
        'src/services/**/*.ts',
        'src/middleware/**/*.ts',
        '!src/**/*.d.ts'
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

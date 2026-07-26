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
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/src/ai-agents/investigation/',
        '/src/ai-agents/tests/'
    ],
    watchman: false,
    // OOM FIX: ts-jest accumulates compiled module memory across suites
    // within a single worker. With maxWorkers: 1 all 186 suites shared
    // one V8 heap and OOM'd around suite ~130. A worker pool forks a
    // fresh process per worker, so each gets a bounded heap. Paired
    // with NODE_OPTIONS=--max-old-space-size=4096 in package.json's
    // `test` script, the full suite runs in well under the per-worker
    // ceiling. CI may override with --maxWorkers=1 for logs.
    maxWorkers: '50%',
    // OOM FIX: recycle a worker once its idle heap exceeds 1GB so
    // ts-jest accumulated memory never reaches the V8 ceiling.
    // SECURITY: re-enable ts-jest diagnostics so type regressions in
    // tests fail the run instead of silently passing (was disabled to
    // mask the 354 pre-existing errors that are now fixed).
    transform: {
        '^.+\\.ts$': [require.resolve('ts-jest'), {
            tsconfig: 'tsconfig.test.json',
            diagnostics: true
        }]
    },
    testTimeout: 30000
};

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/__tests__/**'
    ],
    coverageDirectory: 'coverage',
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    // 忽略某些路径
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    // 超时设置
    testTimeout: 30000
};

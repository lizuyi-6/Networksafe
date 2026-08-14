/** Audit-only Jest config for security-audit PoCs (does not touch backend test suites). */
const path = require('path');

module.exports = {
  rootDir: path.join(__dirname, '..', 'backend'),
  roots: [path.join(__dirname, 'poc')],
  testMatch: ['**/*.poc.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        target: 'ES2022',
        module: 'commonjs',
        types: ['jest', 'node'],
        typeRoots: ['node_modules/@types'],
        baseUrl: '.',
        paths: {
          'express': ['node_modules/express'],
          'supertest': ['node_modules/supertest']
        }
      }
    }]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^(express|supertest)$': '<rootDir>/node_modules/$1'
  },
  testEnvironment: 'node',
  verbose: true
};

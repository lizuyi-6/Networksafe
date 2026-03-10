const tsParser = require('@typescript-eslint/parser');

module.exports = [
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        rules: {
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-duplicate-case': 'error',
            'no-dupe-keys': 'error',
            'no-empty-pattern': 'error',
            'no-unreachable': 'error',
            'no-unsafe-finally': 'error',
        },
    },
];

module.exports = {
    root: true,
    env: {
        es2022: true,
        node: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint'],
    ignorePatterns: ['dist', 'node_modules'],
    rules: {
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-dupe-keys': 'error',
        'no-duplicate-case': 'error',
        'no-empty-pattern': 'error',
        'no-unreachable': 'error',
        'no-unsafe-finally': 'error',
    },
};

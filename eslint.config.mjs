import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const typedParserOptions = {
    projectService: {
        allowDefaultProject: ['eslint.config.mjs', 'vitest.config.ts'],
        defaultProject: './tsconfig.scripts.json',
    },
    tsconfigRootDir: import.meta.dirname,
};

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,
    eslintConfigPrettier,
    {
        languageOptions: {
            parserOptions: typedParserOptions,
        },
        rules: {
            // TypeScript specific rules
            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/prefer-nullish-coalescing': ['error', {
                ignorePrimitives: { boolean: true },
            }],
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/strict-boolean-expressions': 'off',

            // General rules
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    {
        // Config for scripts folder (Node.js)
        files: ['scripts/**/*.ts'],
        rules: {
            'no-console': 'off',
        },
    },
    {
        // Config for test files
        files: ['test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        ignores: ['coverage/**', 'dist/**', 'node_modules/**', '*.js', '*.cjs'],
    }
);

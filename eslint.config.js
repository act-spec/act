// Flat ESLint config (ESLint 9). Shared across the monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.tsbuildinfo',
      '**/src/generated/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        // Per-package lint tsconfigs that include source + test files so the
        // type-aware lint rules can resolve every file ESLint visits.
        project: ['./packages/*/tsconfig.eslint.json', './apps/*/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strictness adjustments (anti-pattern: ignoring TS strictness signals).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/scripts/**', '**/conformance.ts'],
    rules: {
      'no-console': 'off',
      // Tests fabricate fake fetchers and stub Responses; the type-aware
      // rules over-flag what's intentional in test scaffolding.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Browser SPA: DOM globals + browser globals for the validator-web app.
    files: ['apps/*/src/**/*.ts', 'apps/*/vite.config.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  prettier,
);

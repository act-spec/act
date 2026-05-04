import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // PRD-500 framework — 85% line per docs/workflow.md "Testing
        // strategy". The framework is not wire-format core (PRD-100/103
        // are); 85% matches the adapter-framework floor for the same
        // reason (see ADR-005 + packages/adapter-framework/vitest.config.ts).
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

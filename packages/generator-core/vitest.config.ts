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
        // PRD-400 framework — 85% line per docs/workflow.md, matching the
        // astro generator floor it was extracted from (ADR-006).
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

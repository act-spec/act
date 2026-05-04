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
        // PRD-406 leaf — 85% line per docs/workflow.md.
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

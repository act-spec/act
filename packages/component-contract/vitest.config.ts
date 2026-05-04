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
        // PRD-300 framework — 85% line per docs/workflow.md (matches the
        // 200-series framework floor; leaf binding packages 301/302/303
        // will declare their own coverage on top).
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

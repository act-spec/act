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
        // Per docs/workflow.md / team-blueprint.md G2 sign-off: 100% line +
        // 100% branch on the wire-format core.
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});

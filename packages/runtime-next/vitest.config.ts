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
        // PRD-501 leaf SDK — 85% line per docs/workflow.md "Testing
        // strategy". The leaf is glue between Next.js's request shape
        // and the runtime-core dispatch pipeline; the heavy lifting is
        // in @act-spec/runtime-core (96.83% line). 85% is the floor for
        // non-wire-format-core packages.
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

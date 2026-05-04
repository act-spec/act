import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/_fixtures.ts', 'src/types.ts'],
      thresholds: {
        // PRD-602 leaf SDK — 85% line per docs/workflow.md "Testing
        // strategy". The bridge is composition over @act-spec/runtime-core
        // (PRD-500 dispatch), @act-spec/validator's static walker
        // (PRD-706-R13 drift prevention), and the MCP TypeScript SDK
        // request handlers. 85% is the floor for non-wire-format-core
        // packages.
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

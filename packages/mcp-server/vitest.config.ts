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
        // Universal MCP server — composition over @act-spec/inspector's
        // walk/fetch APIs and the MCP TypeScript SDK request handlers.
        // 80% line floor; the package's own logic is glue + cache + the
        // four tool wrappers.
        lines: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});

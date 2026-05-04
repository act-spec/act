import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // The config-loading shim and version constants are not behavior to
      // verify per PRD-409 — the value is already pinned by package.json.
      // The bin entry is exercised by the spawned-CLI integration test.
      exclude: ['src/**/*.test.ts', 'src/version.ts', 'src/index.ts'],
      thresholds: {
        // PRD-409 — non-wire-format-core; 85% line floor per
        // docs/workflow.md "Testing strategy". Heavy lifting (pipeline,
        // schema validation, adapter framework) is delegated to
        // @act-spec/generator-core / @act-spec/validator / etc.
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

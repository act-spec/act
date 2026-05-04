import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/_fixtures.ts', 'src/types.ts', 'src/version.ts'],
      thresholds: {
        // PRD-601 inspector — non-wire-format-core; 85% line floor per
        // docs/workflow.md "Testing strategy". The package's heavy
        // lifting (schema-driven envelope parsing) is delegated to
        // @act-spec/validator, so the inspector's own logic is glue +
        // walk + diff + budget orchestration.
        lines: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

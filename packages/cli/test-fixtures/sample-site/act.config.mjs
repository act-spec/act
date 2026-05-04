/**
 * PRD-409 conformance fixture — minimal markdown-driven config.
 *
 * Used by `pnpm -F @act-spec/cli conformance` to exercise the CLI's
 * end-to-end build path against the PRD-201 markdown adapter and feed the
 * emitted artifacts through @act-spec/validator. Mirrors the @act-spec/plugin-astro
 * conformance fixture (`packages/plugin-astro/test-fixtures/sample-site/`) so that
 * the CLI and Astro generators converge on byte-identical output for the
 * same content corpus (the relevant subset; the CLI does not bundle Astro
 * route metadata).
 */
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default {
  conformanceTarget: 'core',
  outputDir: 'dist',
  adapters: [
    {
      adapter: createMarkdownAdapter(),
      config: { sourceDir: 'content' },
      actVersion: '0.1',
    },
  ],
  site: { name: 'CLI Conformance Fixture' },
};

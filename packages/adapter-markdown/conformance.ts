/**
 * Conformance gate (PRD-200-R28 / PRD-201-R28): runs the markdown adapter
 * over the bundled fixture corpus and validates each emitted node envelope
 * via @act-spec/validator's `validateNode`. Exits non-zero on any gap.
 *
 * Invoked by `pnpm -F @act-spec/adapter-markdown conformance`.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNode } from '@act-spec/validator';
import { createMarkdownAdapter, runAdapter } from './src/index.js';
import type { AdapterContext } from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'test-fixtures', 'sample-tree');

const logger = {
  debug: (m: string) => console.error('debug:', m),
  info: (m: string) => console.log('info:', m),
  warn: (m: string) => console.warn('warn:', m),
  error: (m: string) => console.error('error:', m),
};

async function main(): Promise<void> {
  const ctx: AdapterContext = {
    config: { sourceDir: fixtureDir },
    targetLevel: 'core',
    actVersion: '0.1',
    logger,
    signal: new AbortController().signal,
    state: {},
  };
  console.log(`Conformance — running adapter over ${fixtureDir}`);
  const adapter = createMarkdownAdapter();
  const result = await runAdapter(adapter, ctx.config, ctx);
  console.log(`Adapter "${result.adapter}" emitted ${result.nodes.length} nodes (${result.warnings.length} warnings).`);

  let failed = 0;
  for (const node of result.nodes) {
    // The adapter pre-stamps an etag for stability; validator's etag re-derive
    // happens in the generator. Here we validate the node envelope shape.
    const probe = validateNode(node);
    if (probe.gaps.length === 0) {
      console.log(`  PASS ${node.id}`);
    } else {
      failed += 1;
      console.error(`  FAIL ${node.id}`);
      for (const g of probe.gaps) console.error(`    [${g.requirement}] ${g.missing}`);
    }
  }

  if (failed > 0) {
    console.error(`\nConformance failed: ${failed} node(s) had validator gaps.`);
    process.exit(1);
  }
  console.log(`\nConformance summary: ${result.nodes.length} nodes, 0 gaps.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/**
 * Conformance gate: runs the WordPress adapter over the bundled fixture
 * corpus and validates each emitted node envelope via @act-spec/validator's
 * `validateNode`. Exits non-zero on any gap.
 *
 * Invoked by `pnpm -F @act-spec/adapter-wordpress conformance`.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNode } from '@act-spec/validator';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext } from '@act-spec/adapter-framework';
import { createWordPressAdapter } from './src/index.js';
import type { WordPressAdapterConfig, WordPressSourceCorpus } from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, 'test-fixtures');

const logger = {
  debug: (m: string) => console.error('debug:', m),
  info: (m: string) => console.log('info:', m),
  warn: (m: string) => console.warn('warn:', m),
  error: (m: string) => console.error('error:', m),
};

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    config: {},
    targetLevel: 'standard',
    actVersion: '0.1',
    logger,
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

function loadCorpus(name: string): WordPressSourceCorpus {
  return JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'corpus.json'), 'utf8'),
  ) as WordPressSourceCorpus;
}

interface Scenario {
  name: string;
  corpus: string;
  config: WordPressAdapterConfig;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'standard-blog (posts + pages + categories + tags + users)',
    corpus: 'standard-blog',
    config: {
      baseUrl: 'https://blog.example',
      include: { posts: true, pages: true, categories: true, tags: true, users: true },
    },
  },
];

async function main(): Promise<void> {
  let totalGaps = 0;
  let totalNodes = 0;

  for (const scenario of SCENARIOS) {
    console.log(`\n--- ${scenario.name} ---`);
    const adapter = createWordPressAdapter({ corpus: loadCorpus(scenario.corpus) });
    const result = await runAdapter(
      adapter,
      scenario.config as unknown as Record<string, unknown>,
      ctx({ targetLevel: 'standard' }),
    );
    for (const node of result.nodes) {
      totalNodes += 1;
      const r = validateNode(node);
      if (r.gaps.length > 0) {
        totalGaps += r.gaps.length;
        console.error(
          `  GAP @ ${(node as { id: string }).id}: ${r.gaps.map((g) => g.missing).join('; ')}`,
        );
      }
    }
    console.log(`  ${result.nodes.length} node(s) emitted.`);
  }

  if (totalGaps > 0) {
    console.error(`\nFAIL: ${totalGaps} gap(s) across ${totalNodes} node(s).`);
    process.exit(1);
  }
  console.log(`\nOK: ${totalNodes} node(s) validated; 0 gap(s).`);
}

void main();

/**
 * Conformance gate (PRD-200-R28 / PRD-204-R27): runs the Storyblok adapter
 * over the bundled recorded fixtures and validates each emitted node envelope
 * via @act-spec/validator's `validateNode`. Exits non-zero on any gap.
 *
 * Invoked by `pnpm -F @act-spec/adapter-storyblok conformance`.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNode } from '@act-spec/validator';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext } from '@act-spec/adapter-framework';
import { createStoryblokAdapter } from './src/index.js';
import type { StoryblokAdapterConfig, StoryblokSourceCorpus } from './src/index.js';

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

function loadCorpus(name: string): StoryblokSourceCorpus {
  return JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'stories.json'), 'utf8'),
  ) as StoryblokSourceCorpus;
}

interface Scenario {
  name: string;
  corpus: string;
  config: StoryblokAdapterConfig;
  ctxOver?: Partial<AdapterContext>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'standard-emission (PRD-204 Examples 1+3)',
    corpus: 'standard-emission',
    config: {
      spaceId: 12345,
      accessToken: 'fixture-token',
      version: 'published',
      fieldMapping: { related: { related_articles: 'see-also' } },
    },
    ctxOver: { targetLevel: 'standard' },
  },
  {
    name: 'plus-emission (PRD-204 Examples 2+4)',
    corpus: 'plus-emission',
    config: {
      spaceId: 12345,
      accessToken: 'fixture-token',
      locale: { pattern: 'folder', field: 'lang' },
      componentMapping: {
        hero: {
          type: 'marketing:hero',
          fields: {
            headline: 'headline',
            subhead: 'subhead',
            cta: { label: 'ctaLabel', href: 'ctaHref' },
          },
        },
        'feature-grid': {
          type: 'marketing:feature-grid',
          fields: { features: 'features' },
        },
      },
    },
    ctxOver: { targetLevel: 'strict' },
  },
];

async function main(): Promise<void> {
  let totalNodes = 0;
  let failed = 0;
  for (const sc of SCENARIOS) {
    console.log(`\nScenario: ${sc.name}`);
    const corpus = loadCorpus(sc.corpus);
    const adapter = createStoryblokAdapter({ corpus });
    const c = ctx(sc.ctxOver);
    c.config = sc.config as unknown as Record<string, unknown>;
    const result = await runAdapter(adapter, c.config, c);
    console.log(
      `  Adapter "${result.adapter}" emitted ${String(result.nodes.length)} nodes (${String(result.warnings.length)} warnings).`,
    );
    totalNodes += result.nodes.length;
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      if (probe.gaps.length === 0) {
        console.log(`    PASS ${node.id}`);
      } else {
        failed += 1;
        console.error(`    FAIL ${node.id}`);
        for (const g of probe.gaps) console.error(`      [${g.requirement}] ${g.missing}`);
      }
    }
  }

  if (failed > 0) {
    console.error(`\nConformance failed: ${String(failed)} node(s) had validator gaps.`);
    process.exit(1);
  }
  console.log(`\nConformance summary: ${String(totalNodes)} nodes, 0 gaps.`);
}

function stripPartial(node: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

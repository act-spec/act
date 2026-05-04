/**
 * Conformance gate (PRD-200-R28 / PRD-202-R24): runs the Contentful adapter
 * over the bundled recorded fixtures and validates each emitted node
 * envelope via @act-spec/validator's `validateNode`. Exits non-zero on any
 * gap.
 *
 * Invoked by `pnpm -F @act-spec/adapter-contentful conformance`.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNode } from '@act-spec/validator';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext } from '@act-spec/adapter-framework';
import { createContentfulAdapter } from './src/index.js';
import type {
  ContentfulSourceCorpus,
  ContentfulAdapterConfig,
} from './src/index.js';

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

function loadCorpus(name: string): ContentfulSourceCorpus {
  const space = JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'space.json'), 'utf8'),
  ) as { spaceLocales: ContentfulSourceCorpus['spaceLocales']; contentTypes: ContentfulSourceCorpus['contentTypes'] };
  const entries = JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'entries.json'), 'utf8'),
  ) as {
    items: ContentfulSourceCorpus['entries'];
    assets?: ContentfulSourceCorpus['assets'];
  };
  // Capture per-locale + authored-locales metadata if the fixture supplies them.
  const perLocale: Record<string, Record<string, Record<string, unknown>>> = {};
  const authoredLocales: Record<string, string[]> = {};
  for (const e of entries.items) {
    const ext = e as unknown as {
      perLocale?: Record<string, Record<string, unknown>>;
      authoredLocales?: string[];
      sys: { id: string };
    };
    if (ext.perLocale) perLocale[ext.sys.id] = ext.perLocale;
    if (ext.authoredLocales) authoredLocales[ext.sys.id] = ext.authoredLocales;
  }
  return {
    spaceLocales: space.spaceLocales,
    contentTypes: space.contentTypes,
    entries: entries.items,
    perLocale,
    authoredLocales,
    assets: entries.assets ?? {},
  };
}

interface Scenario {
  name: string;
  corpus: string;
  config: ContentfulAdapterConfig;
  ctxOver?: Partial<AdapterContext>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'standard-blog-post (PRD-202 Example 1)',
    corpus: 'standard-blog-post',
    config: {
      spaceId: 'fixture-space',
      accessToken: 'fixture-token',
      contentTypes: ['blogPost'],
      defaults: { blogPost: 'article' },
    },
    ctxOver: { targetLevel: 'standard' },
  },
  {
    name: 'strict-multi-locale (PRD-202 Examples 3+4)',
    corpus: 'strict-multi-locale',
    config: {
      spaceId: 'fixture-space',
      accessToken: 'fixture-token',
      contentTypes: ['landingPage'],
      defaults: { landingPage: 'page' },
      locale: { available: ['en-US', 'es-ES', 'de-DE'], default: 'en-US', pattern: 1 },
    },
    ctxOver: { targetLevel: 'strict' },
  },
  {
    name: 'strict-marketing-hero (PRD-202 Example 2)',
    corpus: 'strict-marketing-hero',
    config: {
      spaceId: 'fixture-space',
      accessToken: 'fixture-token',
      contentTypes: ['landingPage'],
      defaults: { landingPage: 'page' },
      mappings: {
        landingPage: {
          title: 'title',
          summary: 'subhead',
          blocks: [
            {
              when: { field: 'type', equals: 'hero' },
              type: 'marketing:hero',
              fields: { headline: 'headline', subhead: 'subhead', cta: 'cta' },
            },
          ],
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
    const adapter = createContentfulAdapter({ corpus });
    const c = ctx(sc.ctxOver);
    c.config = sc.config as unknown as Record<string, unknown>;
    const result = await runAdapter(adapter, c.config, c);
    console.log(
      `  Adapter "${result.adapter}" emitted ${String(result.nodes.length)} nodes (${String(result.warnings.length)} warnings).`,
    );
    totalNodes += result.nodes.length;
    for (const node of result.nodes) {
      // Strip _actPartial before validation.
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

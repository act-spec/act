/**
 * Conformance gate: runs the Notion adapter over a small in-tree corpus
 * and validates each emitted node envelope via @act-spec/validator's
 * `validateNode`. Exits non-zero on any gap.
 *
 * Invoked by `pnpm -F @act-spec/adapter-notion conformance`.
 */
import { validateNode } from '@act-spec/validator';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext } from '@act-spec/adapter-framework';
import { notionAdapter } from './src/index.js';
import type {
  NotionAdapterConfig,
  NotionSourceCorpus,
} from './src/index.js';

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

const CORPUS: NotionSourceCorpus = {
  database: {
    object: 'database',
    id: 'conformance-db',
    title: [{ type: 'text', plain_text: 'Conformance database' }],
    description: [{ type: 'text', plain_text: 'Drives the conformance gate.' }],
    last_edited_time: '2026-04-01T00:00:00.000Z',
    url: 'https://www.notion.so/conformance-db',
  },
  pages: [
    {
      object: 'page',
      id: 'conformance-page-001',
      last_edited_time: '2026-04-02T00:00:00.000Z',
      url: 'https://www.notion.so/conformance-page-001',
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'First page' }] },
        Locale: { type: 'select', select: { name: 'en-US' } },
        Tags: { type: 'multi_select', multi_select: [{ name: 'docs' }] },
      },
    },
    {
      object: 'page',
      id: 'conformance-page-002',
      last_edited_time: '2026-04-03T00:00:00.000Z',
      url: 'https://www.notion.so/conformance-page-002',
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'Second page' }] },
        Locale: { type: 'select', select: { name: 'es-ES' } },
      },
    },
  ],
  pageBlocks: {
    'conformance-page-001': [
      { object: 'block', id: 'h1', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', plain_text: 'Section' }] } },
      { object: 'block', id: 'p1', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'First page body.' }] } },
      { object: 'block', id: 'l1', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'one' }] } },
      { object: 'block', id: 'l2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'two' }] } },
      { object: 'block', id: 'c1', type: 'code', code: { rich_text: [{ type: 'text', plain_text: 'print("hi")' }], language: 'python' } },
      { object: 'block', id: 'q1', type: 'quote', quote: { rich_text: [{ type: 'text', plain_text: 'lyrics' }] } },
      { object: 'block', id: 'd1', type: 'divider', divider: {} },
    ],
    'conformance-page-002': [
      { object: 'block', id: 'p2', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'Hola.' }] } },
    ],
  },
};

const CONFIG: NotionAdapterConfig = {
  accessToken: 'fixture-token',
  databaseId: CORPUS.database.id,
  properties: { tags: 'Tags' },
  locale: { property: 'Locale' },
};

async function main(): Promise<void> {
  console.log('\nScenario: standard-database (notion adapter conformance)');
  const adapter = notionAdapter({ corpus: CORPUS });
  const c = ctx();
  c.config = CONFIG as unknown as Record<string, unknown>;
  const result = await runAdapter(adapter, c.config, c);
  console.log(
    `  Adapter "${result.adapter}" emitted ${String(result.nodes.length)} nodes (${String(result.warnings.length)} warnings).`,
  );

  let failed = 0;
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

  if (failed > 0) {
    console.error(`\nConformance failed: ${String(failed)} node(s) had validator gaps.`);
    process.exit(1);
  }
  console.log(`\nConformance summary: ${String(result.nodes.length)} nodes, 0 gaps.`);
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

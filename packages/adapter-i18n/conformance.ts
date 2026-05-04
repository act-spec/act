/**
 * Conformance gate (PRD-200-R28 / PRD-207-R19): runs the i18n adapter
 * over the bundled fixture catalogs for each of the three supported
 * libraries (`next-intl`, `react-intl`, `i18next`). PRD-207 emits ONLY
 * partial nodes — they are not full PRD-100 envelopes — so the gate
 * verifies the partial-shape invariants (id present, _actPartial true,
 * metadata.* well-formed, translation_status in the closed enum) rather
 * than running each partial through `validateNode` (which would correctly
 * reject every partial as missing required fields).
 *
 * The cross-source composition step builds a tiny synthetic primary run
 * (act-contentful-shaped full nodes), merges with PRD-207's run via the
 * framework's `mergeRuns`, and validates each resulting full node via
 * `@act-spec/validator`'s `validateNode`. Exits non-zero on any gap or
 * shape violation.
 *
 * Invoked by `pnpm -F @act-spec/adapter-i18n conformance`.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeRuns,
  runAdapter,
  type AdapterContext,
  type EmittedNode,
  type PartialEmittedNode,
} from '@act-spec/adapter-framework';
import { deriveEtag, stripEtag, validateNode } from '@act-spec/validator';
import { createI18nAdapter, type I18nAdapterConfig } from './src/index.js';

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
    targetLevel: 'strict',
    actVersion: '0.1',
    logger,
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

interface Scenario {
  name: string;
  config: I18nAdapterConfig;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'next-intl (PRD-207 Example 1)',
    config: {
      library: 'next-intl',
      messagesDir: path.join(fixtureRoot, 'next-intl', 'messages'),
      locales: { default: 'en-US', available: ['en-US', 'es-ES', 'de-DE'] },
      bindToAdapter: 'act-contentful',
      idTransform: { pattern: 1, namespace: 'cms' },
    },
  },
  {
    name: 'react-intl (PRD-207 Example 2)',
    config: {
      library: 'react-intl',
      messagesDir: path.join(fixtureRoot, 'react-intl', 'messages'),
      locales: { default: 'en-US', available: ['en-US', 'de-DE', 'fr-FR'] },
      bindToAdapter: 'act-contentful',
      idTransform: { pattern: 1, namespace: 'cms' },
      library_options: { messageFormat: 'flat' },
    },
  },
  {
    name: 'i18next + fallback chain (PRD-207 Example 3)',
    config: {
      library: 'i18next',
      messagesDir: path.join(fixtureRoot, 'i18next', 'locales'),
      locales: {
        default: 'en-US',
        available: ['en-US', 'de', 'de-AT'],
        fallback_chain: { 'de-AT': ['de', 'en-US'] },
      },
      bindToAdapter: 'act-markdown',
      idTransform: { pattern: 1, namespace: 'md' },
      library_options: { namespaces: ['common', 'home'] },
    },
  },
];

const CLOSED_STATUS = new Set(['complete', 'partial', 'fallback', 'missing']);

function checkPartialShape(node: PartialEmittedNode | EmittedNode): string[] {
  const out: string[] = [];
  if (typeof node.id !== 'string' || node.id.length === 0) {
    out.push('PRD-207-R4: missing id');
  }
  if (!('_actPartial' in node) || (node as PartialEmittedNode)._actPartial !== true) {
    out.push('PRD-207-R4: missing _actPartial discriminator');
  }
  // PRD-207-R6: only id / _actPartial / metadata permitted at top level.
  for (const k of Object.keys(node)) {
    if (k !== 'id' && k !== '_actPartial' && k !== 'metadata') {
      out.push(`PRD-207-R6: top-level field "${k}" not permitted`);
    }
  }
  const meta = (node.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta['translation_status'] !== 'string'
    || !CLOSED_STATUS.has(meta['translation_status'])) {
    out.push('PRD-207-R7/R11: translation_status not in closed enum');
  }
  const src = meta['source'] as Record<string, unknown> | undefined;
  if (!src || src['adapter'] !== 'act-i18n' || typeof src['source_id'] !== 'string') {
    out.push('PRD-207-R17: metadata.source.{adapter, source_id} not stamped');
  }
  return out;
}

async function main(): Promise<void> {
  let totalNodes = 0;
  let failed = 0;
  for (const sc of SCENARIOS) {
    console.log(`\nScenario: ${sc.name}`);
    const adapter = createI18nAdapter();
    const c = ctx();
    c.config = sc.config as unknown as Record<string, unknown>;
    const result = await runAdapter(adapter, c.config, c);
    console.log(
      `  Adapter "${result.adapter}" emitted ${String(result.nodes.length)} partials (${String(result.warnings.length)} warnings).`,
    );
    totalNodes += result.nodes.length;
    for (const node of result.nodes) {
      const shape = checkPartialShape(node);
      if (shape.length === 0) {
        console.log(`    PASS ${node.id}`);
      } else {
        failed += 1;
        console.error(`    FAIL ${node.id}`);
        for (const m of shape) console.error(`      ${m}`);
      }
    }
  }

  // Cross-source composition: merge a synthetic primary run (PRD-202-shaped)
  // with PRD-207's next-intl run; validate each merged full node.
  console.log('\nCross-source composition (PRD-207 + synthetic act-contentful primary)');
  const primaryNodes = synthesizePrimaryNodes(SCENARIOS[0]!.config);
  const primaryRun = {
    adapter: 'act-contentful',
    capabilities: { level: 'strict' as const, precedence: 'primary' as const },
    nodes: primaryNodes,
    warnings: [],
  };
  const adapter = createI18nAdapter();
  const c = ctx();
  c.config = SCENARIOS[0]!.config as unknown as Record<string, unknown>;
  const i18nRun = await runAdapter(adapter, c.config, c);
  const merged = mergeRuns([primaryRun, i18nRun]);
  let mergedFailed = 0;
  for (const [id, node] of merged) {
    if (!('act_version' in node)) {
      // partial that never got promoted to a full node — skip (PRD-207-R10
      // surfaces this through merge-time warnings; our synthetic primary
      // covers the canonical 1:1 binding cases).
      continue;
    }
    const probe = validateNode(stripPartial(node));
    if (probe.gaps.length === 0) {
      console.log(`  MERGE PASS ${id}`);
    } else {
      mergedFailed += 1;
      console.error(`  MERGE FAIL ${id}`);
      for (const g of probe.gaps) console.error(`    [${g.requirement}] ${g.missing}`);
    }
  }
  failed += mergedFailed;

  if (failed > 0) {
    console.error(`\nConformance failed: ${String(failed)} node(s) had violations.`);
    process.exit(1);
  }
  console.log(`\nConformance summary: ${String(totalNodes)} partials + ${String(merged.size)} merged nodes, 0 violations.`);
}

/**
 * Synthesize a minimal PRD-202-shaped primary run that pairs 1:1 with the
 * IDs PRD-207 will emit for `next-intl` Pattern 1. The conformance script
 * stays self-contained (no `@act-spec/adapter-contentful` instantiation
 * required for the merge step).
 */
function synthesizePrimaryNodes(_cfg: I18nAdapterConfig): EmittedNode[] {
  const ids = [
    { id: 'cms/en-us/home', locale: 'en-US' },
    { id: 'cms/es-es/home', locale: 'es-ES' },
    { id: 'cms/de-de/home', locale: 'de-DE' },
    { id: 'cms/en-us/pricing', locale: 'en-US' },
    { id: 'cms/es-es/pricing', locale: 'es-ES' },
    { id: 'cms/en-us/faq', locale: 'en-US' },
    { id: 'cms/es-es/faq', locale: 'es-ES' },
    { id: 'cms/de-de/faq', locale: 'de-DE' },
    { id: 'cms/de-de/pricing', locale: 'de-DE' },
  ];
  return ids.map(({ id, locale }) => {
    const envelope = {
      act_version: '0.1',
      id,
      type: 'landing',
      title: titleFor(id),
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      summary: `Synthetic CMS summary for ${id}`,
      summary_source: 'author',
      content: [{ type: 'prose', text: `Synthetic CMS body for ${id}.` }],
      tokens: { summary: 4, body: 5 },
      metadata: {
        locale,
        source: { adapter: 'act-contentful', source_id: `space/${id}` },
        translations: [],
      },
    } as unknown as Record<string, unknown>;
    const stripped = stripEtag(envelope);
    envelope['etag'] = deriveEtag(stripped);
    return envelope as unknown as EmittedNode;
  });
}

function titleFor(id: string): string {
  if (id.endsWith('/home')) return 'Home';
  if (id.endsWith('/pricing')) return 'Pricing';
  if (id.endsWith('/faq')) return 'FAQ';
  return id;
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

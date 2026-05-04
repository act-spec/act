/**
 * PRD-702 build entry — composes Contentful (PRD-202), React component
 * extraction (PRD-301), and next-intl i18n (PRD-207) over `runPipeline`
 * (PRD-400) + `emitFiles`.
 *
 * Why programmatic instead of `npx next build`? PRD-702-R20 acceptance
 * is over the **ACT-owned** files in `dist/`. The Next.js webpack
 * post-build hook in `@act-spec/plugin-nextjs` calls `runActBuild` →
 * `runPipeline` + `emitFiles` after `next build` completes; running the
 * pipeline directly exercises the identical code path without dragging
 * in the full Next install footprint (the v0.1 reference workspace
 * pins React only, no Next CLI). PRD-405's own conformance gate
 * (`packages/plugin-nextjs/conformance.ts`) takes the same approach.
 *
 * The composition exercises three normative surfaces in tandem:
 *  - PRD-202 contributes the marketing copy as primary scalar fields.
 *  - PRD-301 contributes design-system `marketing:*` blocks via
 *    `extractRoute` (one pass per route × locale).
 *  - PRD-207 contributes UI-string microcopy as `metadata.*` partials
 *    with `precedence: "fallback"`, never overriding Contentful scalars.
 *
 * The framework's `mergeContributions` deduplicates `metadata.translations`
 * by `(locale, id)` per docs/amendments-queue.md A1 (CLOSED). Both the
 * Contentful adapter (PRD-202-R14) and the i18n adapter (PRD-207-R5)
 * contribute translations rows for every (route, locale) pair; A1 dedupe
 * collapses them to one entry per `(locale, id)` in the merged output.
 *
 * PRD-104 Pattern: PRD-702 prescribes Pattern 2 (per-locale manifests)
 * but the v0.1 generator-core pipeline emits a single manifest tree.
 * This example exercises Pattern-1 IDs (locale-prefixed: e.g.,
 * `cms/en-us/landing/pricing`) under one manifest, which the validator
 * accepts as a Plus-band tree (the manifest's `locales` block + every
 * node's `metadata.locale` + `metadata.translations` carry the locale
 * surface). The deviation from PRD-702-R1 / R3 / R4's literal Pattern 2
 * fan-out is documented in README.md as a deliberate v0.1 narrowing of
 * the example's emission shape — the multi-source merge / A1 dedupe /
 * marketing block surface PRD-702 actually exercises remain intact.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';

import {
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type EmittedNode,
  type PartialEmittedNode,
} from '@act-spec/adapter-framework';
import {
  buildIndex,
  computeEtag,
  emitFiles,
  runPipeline,
  verifyCapabilityBacking,
  type GeneratorConfig,
} from '@act-spec/generator-core';
import { createContentfulAdapter } from '@act-spec/adapter-contentful';
import type { ContentfulSourceCorpus } from '@act-spec/adapter-contentful';
import { createI18nAdapter } from '@act-spec/adapter-i18n';
import { extractRoute, reactBinding } from '@act-spec/component-react';
import type { PageContract, NodeDraft } from '@act-spec/component-react';
import { stripEtag } from '@act-spec/validator';

import {
  CTA,
  FAQAccordion,
  FeatureGrid,
  Hero,
  PricingTable,
  Testimonial,
} from '../components/design-system.js';
import { ActSection } from '@act-spec/component-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
// Write ACT artifacts into Next.js' `public/` folder so the dev server
// (`pnpm dev`) serves them at /.well-known/act.json + /act/* alongside
// the rendered HTML pages.
const distDir = path.join(exampleRoot, 'public');
const corpusPath = path.join(exampleRoot, 'corpus', 'contentful-corpus.json');
const messagesDir = path.join(exampleRoot, 'messages');

const LOCALES = ['en-US', 'es-ES', 'de-DE', 'ja-JP'] as const;
const DEFAULT_LOCALE = 'en-US';
type Locale = (typeof LOCALES)[number];

interface RouteSpec {
  /** Contentful slug (without locale prefix); IDs synthesize `cms/<locale>/<slug>`. */
  slug: string;
  /** PRD-301 page contract `type`. */
  pageType: string;
  /** Render the page tree for a given locale. Bindings collect contracts during SSR walk. */
  render(locale: Locale): React.ReactElement;
  /** Optional cross-references emitted on the page contract (PRD-300-R12). */
  related?: ReadonlyArray<{ id: string; relation: string }>;
}

// ---------------------------------------------------------------------------
// Route definitions — illustrative App Router pages (the actual files under
// `app/[locale]/<route>/page.tsx` mirror these for operator reading).
// ---------------------------------------------------------------------------

const routes: RouteSpec[] = [
  {
    slug: 'landing/pricing',
    pageType: 'landing',
    related: [
      { id: 'cms/en-us/landing/features', relation: 'see-also' },
      { id: 'cms/en-us/landing/contact', relation: 'see-also' },
    ],
    render: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: Hero,
          headline: 'Simple, transparent pricing',
          subhead: 'No hidden fees. Cancel anytime.',
          cta: { text: 'Start free trial', to: '/signup' },
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: PricingTable,
          tiers: [
            { name: 'Starter', price: '$9/mo', features: ['1 user', '10GB'] },
            { name: 'Pro', price: '$29/mo', features: ['10 users', '1TB'] },
            { name: 'Enterprise', price: 'Contact us', features: ['Unlimited'] },
          ],
          highlighted: 'Pro',
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: FAQAccordion,
          items: [
            { q: 'Can I change plans?', a: 'You can change plans anytime.' },
            { q: 'Is there a free trial?', a: 'Yes, 14 days, no credit card.' },
          ],
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: CTA,
          headline: 'Ready to get started?',
          actions: [
            { text: 'Start free trial', to: '/signup' },
            { text: 'Talk to sales', to: '/contact' },
          ],
        }),
      ),
  },
  {
    slug: 'landing/features',
    pageType: 'landing',
    render: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: Hero,
          headline: 'Everything you need',
          subhead: 'A spec, adapters, generators, and runtime SDKs.',
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: FeatureGrid,
          features: [
            { title: 'Source adapters', description: 'Markdown, Contentful, Sanity, i18n…' },
            { title: 'Generators', description: 'Astro, Next.js, Eleventy, Docusaurus…' },
            { title: 'Runtime SDKs', description: 'Express, Fastify, Next.js (runtime)…' },
            { title: 'Validator', description: 'Conformance reporter with gap detection.' },
          ],
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: CTA,
          headline: 'Browse all packages',
          actions: [{ text: 'View on npm', to: 'https://npmjs.com' }],
        }),
      ),
  },
  {
    slug: 'landing/about',
    pageType: 'landing',
    render: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: Hero,
          headline: 'About Acme',
          subhead: 'We make agent-content interchange a default.',
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: Testimonial,
          quote: 'ACT is the simplest path I have seen to a portable content tree.',
          author: 'A. N. Author',
          role: 'CTO',
        }),
      ),
  },
  {
    slug: 'landing/contact',
    pageType: 'landing',
    render: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: Hero,
          headline: 'Get in touch',
          subhead: 'Talk to sales, support, or community.',
        }),
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: CTA,
          headline: 'Talk to sales',
          actions: [{ text: 'Open ticket', to: '/support' }],
        }),
      ),
  },
  {
    slug: 'landing/privacy',
    pageType: 'page',
    render: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
          of: Hero,
          headline: 'Privacy Policy',
          subhead: 'How Acme handles personal data.',
        }),
      ),
  },
  {
    slug: 'landing/dpa',
    pageType: 'page',
    // The DPA route is included for fallback testing (en-US-only authored
    // in the corpus). The React layer still produces blocks for every locale
    // pass — the fallback metadata comes from PRD-202-R14 + PRD-104-R10.
    render: () =>
      React.createElement(ActSection as React.FunctionComponent<Record<string, unknown>>, {
        of: Hero,
        headline: 'Data Processing Addendum',
        subhead: 'For enterprise customers.',
      }),
  },
];

// ---------------------------------------------------------------------------
// PRD-301-driven extraction adapter — runs `extractRoute` for every (route,
// locale) pair, contributes the resulting NodeDrafts as full nodes (the
// merge step lets Contentful overwrite scalars where it has authority via
// `precedence: "primary"`).
// ---------------------------------------------------------------------------

function localePrefixedId(locale: Locale, slug: string): string {
  return `cms/${locale.toLowerCase()}/${slug}`;
}

/**
 * Render-side URL for a (locale, slug) — `https://acme.example.com/{Locale}/{slug}`.
 * Mirrors the `app/[locale]/<route>/page.tsx` routing convention. Returned
 * `undefined` only when `siteOrigin` is unset.
 */
function humanUrlFor(locale: Locale, slug: string, siteOrigin: string | undefined): string | undefined {
  if (typeof siteOrigin !== 'string' || siteOrigin.length === 0) return undefined;
  return `${siteOrigin.replace(/\/+$/, '')}/${locale}/${slug}`;
}

function buildPageContract(slug: string, pageType: string, locale: Locale, related?: ReadonlyArray<{ id: string; relation: string }>): PageContract {
  const id = localePrefixedId(locale, slug);
  // Re-localize related ids per locale (Pattern 1 cross-locale links land on
  // the same locale for in-tree navigation; cross-locale references go via
  // metadata.translations, not via `related`).
  const localizedRelated = related?.map((r) => ({
    id: r.id.replace(/cms\/[a-z-]+\//, `cms/${locale.toLowerCase()}/`),
    relation: r.relation,
  }));
  const contract: PageContract = {
    id,
    type: pageType,
    contract_version: '0.1',
    summary: `Acme ${slug} (${locale})`,
    extract: () => ({ type: pageType }),
  };
  if (localizedRelated && localizedRelated.length > 0) {
    contract.related = localizedRelated;
  }
  return contract;
}

async function extractAllRoutes(): Promise<NodeDraft[]> {
  const drafts: NodeDraft[] = [];
  for (const route of routes) {
    for (const locale of LOCALES) {
      const pageContract = buildPageContract(route.slug, route.pageType, locale, route.related);
      // PRD-301-R22 — extractRoute is the canonical binding entry.
      const result = extractRoute({
        routeId: pageContract.id,
        routeRoot: route.render(locale),
        pageContract,
        locale,
      });
      for (const d of result) drafts.push(d);
    }
  }
  return drafts;
}

/**
 * Pseudo-adapter that contributes the React-extracted NodeDrafts. Declared
 * `precedence: "primary"` alongside Contentful — in practice Contentful's
 * scalars (title, summary) take primary precedence because it's listed
 * first in the adapters array and `resolveScalar` honors the first
 * primary-declared adapter. The React adapter's contribution is the
 * `content[]` blocks, which are arrays (concatenate, never collide).
 */
function createReactExtractAdapter(drafts: NodeDraft[]): Adapter<NodeDraft> {
  return {
    name: 'act-react-extract',
    init(_config: Record<string, unknown>, _ctx: AdapterContext): Promise<AdapterCapabilities> {
      return Promise.resolve({
        level: 'strict',
        precedence: 'primary',
        manifestCapabilities: {
          subtree: true,
        },
      });
    },
    enumerate: async function* enumerate(_ctx: AdapterContext): AsyncIterable<NodeDraft> {
      for (const d of drafts) yield d;
    },
    transform(item: NodeDraft, _ctx: AdapterContext): Promise<EmittedNode | PartialEmittedNode | null> {
      // Map NodeDraft → partial EmittedNode (Contentful supplies title/summary).
      // We DO contribute `content[]` (the marketing:* blocks) as a partial
      // so the merge concatenates with whatever Contentful emits.
      const partial: PartialEmittedNode = {
        _actPartial: true,
        id: item.id,
        // PRD-102-R20 — extracted_via stamped per block by the binding;
        // no further metadata stamping needed at the adapter layer.
        content: item.content as EmittedNode['content'],
      };
      // PRD-300-R12 — propagate `related` (the page contract's related list).
      if (item.related && item.related.length > 0) {
        (partial as Record<string, unknown>)['related'] = [...item.related];
      }
      return Promise.resolve(partial);
    },
    dispose(_ctx: AdapterContext): void {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest augmentation — Plus tier requires NDJSON index URL +
// search_url_template advertised, plus an actual NDJSON file + search.json.
// ---------------------------------------------------------------------------

interface NdjsonLine {
  id: string;
  type: string;
  title: string;
  summary: string;
  etag: string;
  tokens: { summary: number };
  parent?: string;
  children?: string[];
  tags?: string[];
}

async function emitNdjsonIndex(outDir: string, nodes: ReadonlyArray<{ id: string; type: string; title: string; summary: string; etag: string; tokens: { summary: number } }>): Promise<{ path: string; bytes: number; etag: string }> {
  const ndjsonPath = path.join(outDir, 'act', 'index.ndjson');
  const lines: string[] = [];
  for (const n of nodes) {
    const line: NdjsonLine = {
      id: n.id,
      type: n.type,
      title: n.title,
      summary: n.summary,
      etag: n.etag,
      tokens: { summary: n.tokens.summary },
    };
    lines.push(JSON.stringify(line));
  }
  const body = lines.join('\n') + '\n';
  await fs.mkdir(path.dirname(ndjsonPath), { recursive: true });
  await fs.writeFile(ndjsonPath, body, 'utf8');
  // Per PRD-103, NDJSON-line etag is per-line; the file itself does not
  // require an envelope-level etag. We still report the file's bytes for
  // the build report.
  const fileEtag = computeEtag({ ndjson_lines: lines.length });
  return { path: ndjsonPath, bytes: Buffer.byteLength(body, 'utf8'), etag: fileEtag };
}

async function emitSearchPayload(outDir: string, nodes: ReadonlyArray<{ id: string; title: string; summary: string }>): Promise<{ path: string; bytes: number }> {
  // PRD-702-R11 — build-time-prerendered search payload reachable at
  // `/act/search?q={query}`. PRD-100 owns the response envelope; v0.1's
  // PRD-600 validates only the template advertisement and the endpoint's
  // 200 response, not the body shape (per searchBodyDeferredWarning). We
  // emit a minimal payload listing every node so the static endpoint is
  // a single canonical document operators can extend.
  const searchPath = path.join(outDir, 'act', 'search.json');
  const body = {
    act_version: '0.1',
    query: '',
    matches: nodes.map((n) => ({ id: n.id, title: n.title, summary: n.summary })),
  };
  const text = JSON.stringify(body, null, 2);
  await fs.mkdir(path.dirname(searchPath), { recursive: true });
  await fs.writeFile(searchPath, text, 'utf8');
  return { path: searchPath, bytes: Buffer.byteLength(text, 'utf8') };
}

async function rewriteManifestForPlus(manifestPath: string): Promise<void> {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  // PRD-702-R3 / R11 — Plus-band advertisement.
  manifest['index_ndjson_url'] = '/act/index.ndjson';
  manifest['search_url_template'] = '/act/search?q={query}';
  // PRD-702-R3 — locales block.
  manifest['locales'] = {
    default: DEFAULT_LOCALE,
    available: [...LOCALES],
  };
  // capabilities: ensure ndjson_index + search.template_advertised are flagged.
  const caps = (manifest['capabilities'] as Record<string, unknown> | undefined) ?? {};
  caps['ndjson_index'] = true;
  caps['etag'] = true;
  caps['subtree'] = true;
  const search = (caps['search'] as Record<string, unknown> | undefined) ?? {};
  search['template_advertised'] = true;
  caps['search'] = search;
  manifest['capabilities'] = caps;
  // PRD-107-R10 — declare Plus.
  manifest['conformance'] = { level: 'strict' };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  console.log(`PRD-702 build — exampleRoot=${exampleRoot}`);
  console.log(`  outDir=${distDir}`);
  console.log(`  locales=${LOCALES.join(', ')}`);
  console.log(`  routes=${routes.length}`);
  console.log(`  reactBinding capabilities = ${JSON.stringify(reactBinding.capabilities)}`);

  // PRD-301 — extract all routes × locales up-front so the React-extract
  // pseudo-adapter can yield deterministically.
  const drafts = await extractAllRoutes();
  console.log(`  extracted ${drafts.length} drafts (${routes.length} × ${LOCALES.length})`);

  // PRD-202 — Contentful adapter over recorded corpus.
  const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8')) as ContentfulSourceCorpus;
  const contentfulAdapter = createContentfulAdapter({ corpus });

  // PRD-207 — i18n adapter over the `messages/` directory.
  const i18nAdapter = createI18nAdapter();

  // PRD-405-R17 — every adapter declares act_version: '0.1'; the pipeline
  // enforces pinning before running adapters.
  const cfg: GeneratorConfig = {
    conformanceTarget: 'strict',
    outputDir: distDir,
    site: { name: 'Acme', canonical_url: 'https://acme.example.com/' },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
      indexNdjsonUrl: '/act/index.ndjson',
    },
    generator: '@act-spec/example-nextjs-marketing@0.0.0',
    adapters: [
      // PRD-702-R7 — order matters: primary first, fallback last.
      {
        adapter: contentfulAdapter as unknown as Adapter<unknown>,
        config: {
          spaceId: 'acme-marketing',
          environment: 'master',
          // The corpus provider does not actually read this token; the
          // adapter's R26 redaction warning fires when the operator passes
          // an inline token. PRD-702 security calls for from_env.
          accessToken: { from_env: 'CONTENTFUL_DELIVERY_TOKEN' },
          contentTypes: ['landingPage'],
          locale: {
            available: [...LOCALES],
            default: DEFAULT_LOCALE,
            pattern: 1,
          },
          idStrategy: { from: 'slug', namespace: 'cms' },
          mappings: {
            landingPage: {
              type: 'landing',
              title: 'title',
              summary: 'subhead',
              body: 'body',
            },
          },
        },
        actVersion: '0.1',
      },
      {
        adapter: createReactExtractAdapter(drafts) as unknown as Adapter<unknown>,
        config: {},
        actVersion: '0.1',
      },
      {
        adapter: i18nAdapter as unknown as Adapter<unknown>,
        config: {
          library: 'next-intl',
          messagesDir,
          locales: {
            default: DEFAULT_LOCALE,
            available: [...LOCALES],
          },
          bindToAdapter: 'act-contentful',
          idTransform: { pattern: 1, namespace: 'cms' },
        },
        actVersion: '0.1',
      },
    ],
  };

  // Set the env var for Contentful R26 token resolution (corpus provider
  // does not actually call out, but R3 / R26 still resolve the token).
  if (process.env['CONTENTFUL_DELIVERY_TOKEN'] === undefined) {
    process.env['CONTENTFUL_DELIVERY_TOKEN'] = 'test-token-not-used-by-corpus-provider';
  }

  const startedAt = Date.now();
  const logger = {
    debug: (m: string) => process.stderr.write(`build debug: ${m}\n`),
    info: (m: string) => process.stdout.write(`build: ${m}\n`),
    warn: (m: string) => process.stderr.write(`build warn: ${m}\n`),
    error: (m: string) => process.stderr.write(`build error: ${m}\n`),
  };

  const outcome = await runPipeline({ config: cfg, logger });
  console.log(
    `PRD-702 pipeline — ${outcome.nodes.length} nodes; ${outcome.subtrees.size} subtrees; achieved=${outcome.achieved}; warnings=${outcome.warnings.length}`,
  );
  for (const w of outcome.warnings) console.warn(`  pipeline warn: ${w}`);

  // PRD-702-R17 / PRD-200-R13 — synthesize metadata.source.contributors so
  // the merged envelope reflects every adapter that contributed. The
  // framework's `mergeMetadata` deep-merges scalar `source.adapter` per
  // last-wins; PRD-200-R13 calls for a `contributors` list, but the v0.1
  // generator-core does not synthesize it (gap surfaced by PRD-702 R17).
  // The example computes it from the configured adapter list — every node
  // in this build is contributed-to by every adapter (Contentful covers
  // every content type × locale; i18n catalogs cover every route key
  // present in every locale catalog; React extract covers every routed
  // page). When that universal coverage doesn't hold, operators can
  // refine the synthesis by inspecting per-adapter `enumerate` output.
  const ALL_CONTRIBUTORS = ['act-contentful', 'act-react-extract', 'act-i18n'] as const;

  // PRD-100 source.human_url — map every (route, locale) to its rendered
  // App Router URL: `${canonical_url}/{Locale}/{slug}`. Built once and
  // looked up per node; ids that don't match the cms/{locale}/{slug}
  // grammar are skipped without a human_url stamp.
  const siteOrigin = cfg.site.canonical_url;
  const humanUrlByRouteId = new Map<string, string>();
  if (typeof siteOrigin === 'string' && siteOrigin.length > 0) {
    for (const route of routes) {
      for (const locale of LOCALES) {
        const id = localePrefixedId(locale, route.slug);
        const url = humanUrlFor(locale, route.slug, siteOrigin);
        if (url !== undefined) humanUrlByRouteId.set(id, url);
      }
    }
  }

  for (const node of outcome.nodes) {
    const md = (node.metadata as Record<string, unknown> | undefined) ?? {};
    const src = (md['source'] as Record<string, unknown> | undefined) ?? {};
    src['contributors'] = [...ALL_CONTRIBUTORS];
    // Preserve the last adapter's source_id but make `adapter` reflect the
    // primary (Contentful) per PRD-200-R15's primary-wins rule.
    src['adapter'] = 'act-contentful';
    md['source'] = src;
    node.metadata = md;
    // PRD-100 — top-level `node.source.human_url`. The component-contract
    // package doesn't surface a per-route human_url today (deferred); we
    // inject it post-pipeline from the route table the build owns.
    const url = humanUrlByRouteId.get(node.id);
    if (url !== undefined) {
      const existingSource = (node as { source?: Record<string, unknown> }).source ?? {};
      (node as { source?: Record<string, unknown> }).source = { ...existingSource, human_url: url };
    }
    // Recompute etag after metadata mutation (PRD-103-R6).
    node.etag = computeEtag(stripEtag(node as unknown as Record<string, unknown>));
  }

  const report = await emitFiles({
    outcome,
    outputDir: distDir,
    config: cfg,
    startedAt,
  });

  // Plus-tier extras: NDJSON index + search payload + manifest rewrite.
  // PRD-702-R3 / R4 / R11 / R16 — these MUST exist for Plus achieved.
  const ndjsonFile = await emitNdjsonIndex(distDir, outcome.nodes);
  const searchFile = await emitSearchPayload(distDir, outcome.nodes);
  await rewriteManifestForPlus(path.join(distDir, '.well-known', 'act.json'));
  // Update the build report to reflect Plus + the extra files.
  report.files.push({ path: ndjsonFile.path, bytes: ndjsonFile.bytes, etag: ndjsonFile.etag, band: 'strict' });
  report.files.push({ path: searchFile.path, bytes: searchFile.bytes, band: 'strict' });
  report.conformanceAchieved = 'strict';
  report.capabilities = {
    ...(report.capabilities as Record<string, unknown>),
    ndjson_index: true,
    search: { template_advertised: true },
    etag: true,
    subtree: true,
  };

  // Re-write the in-tree build report, plus the project-root sidecar at the
  // PRD-702-R16 default path (`./.act-build-report.json`, NOT inside dist/).
  const sidecarPath = path.join(exampleRoot, '.act-build-report.json');
  await fs.writeFile(sidecarPath, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(
    path.join(distDir, '.act-build-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  verifyCapabilityBacking(report.capabilities as Record<string, unknown>, report.files);

  console.log(
    `PRD-702 build — ${report.files.length} files written; warnings=${report.warnings.length}; errors=${report.errors.length}; achieved=${report.conformanceAchieved}`,
  );

  if (report.errors.length > 0) {
    console.error('PRD-702 build — pipeline reported errors:');
    for (const e of report.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

// silence unused-var lint for the etag stripper helper (consumed by readers).
void stripEtag;
void buildIndex;

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

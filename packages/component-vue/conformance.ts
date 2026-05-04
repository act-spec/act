/**
 * Conformance harness for `@act-spec/component-vue` (PRD-302).
 *
 * Drives the binding's `extractRoute` over the bundled positive /
 * negative fixtures, then assembles the resulting `NodeDraft[]` into
 * full PRD-100 node envelopes (filling generator-owned `act_version` /
 * `etag` / `tokens` per PRD-302-R23) and runs each through
 * `@act-spec/validator.validateNode` for envelope conformance.
 *
 * Invoked by `pnpm -F @act-spec/component-vue conformance`. The G4
 * gate runs this alongside the unit suite.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineComponent, h, type PropType } from 'vue';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { validateNode, deriveEtag, stripEtag, ACT_VERSION } from '@act-spec/validator';
import {
  BuildError,
  type NodeDraft,
  type PageContract,
} from '@act-spec/component-contract';
import {
  ActSection,
  assertVue3Plus,
  capabilities,
  defineActContract,
  extractRoute,
  fallbackSentinel,
  installActProvider,
  useActContract,
  useActStatic,
  vueBinding,
  type ActContract,
  type VueComponentWithAct,
} from './src/index.js';
import { _resetFallbackSentinel } from './src/provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, 'test-fixtures');

interface FixtureCheck {
  name: string;
  run: () => void | Promise<void>;
}

interface PositiveFixture {
  id: string;
  requirements: string[];
  description: string;
  expected: Record<string, unknown>;
}

interface NegativeFixture {
  id: string;
  requirements: string[];
  description: string;
  input?: Record<string, unknown>;
  expectedErrorSubstring?: string;
  expectedFirstBlockType?: string;
  expectedBlockTypesContain?: string[];
  expectedFirstBlockMetadata?: Record<string, unknown>;
  expectedErrorContains?: string;
  expectedErrorNotContains?: string;
  expectedFallbackBumped?: boolean;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, rel), 'utf8')) as T;
}

// ---------- Sample components ---------------------------------------------

interface HeroProps { title: string; subtitle: string }
const Hero: VueComponentWithAct<HeroProps> = defineComponent({
  name: 'Hero',
  props: {
    title: { type: String as PropType<string>, required: true },
    subtitle: { type: String as PropType<string>, required: true },
  },
  setup(props) {
    useActStatic(Hero, props as HeroProps);
    return (): unknown => h('section', null, props.title);
  },
});
Hero.act = {
  type: 'marketing:hero',
  contract_version: '0.1',
  extract: (props) => ({
    type: 'marketing:hero',
    headline: props.title,
    subhead: props.subtitle,
  }),
} satisfies ActContract<HeroProps>;

interface PricingProps { tiers: ReadonlyArray<string> }
const PricingTable = defineComponent({
  name: 'PricingTable',
  props: {
    tiers: { type: Array as PropType<ReadonlyArray<string>>, required: true },
  },
  setup(props) {
    useActContract<PricingProps>(
      {
        type: 'marketing:pricing-table',
        contract_version: '0.1',
        extract: (p) => ({ type: 'marketing:pricing-table', tiers: p.tiers }),
      },
      { tiers: props.tiers },
    );
    return (): unknown => h('ul', null, props.tiers.map((t) => h('li', { key: t }, t)));
  },
});

interface FaqProps { items: ReadonlyArray<{ q: string; a: string }> }
const FAQAccordion = defineComponent({
  name: 'FAQAccordion',
  props: {
    items: { type: Array as PropType<ReadonlyArray<{ q: string; a: string }>>, required: true },
  },
  setup(props) {
    defineActContract<FaqProps>(
      {
        type: 'marketing:faq',
        contract_version: '0.1',
        extract: (p) => ({
          type: 'marketing:faq',
          items: p.items.map((i) => ({ question: i.q, answer: i.a })),
        }),
      },
      { items: props.items },
    );
    return (): unknown => h('dl');
  },
});

const pricingPage: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  summary: 'Acme pricing tiers and plan comparison.',
  related: [{ id: 'products', relation: 'see-also' }],
  extract: () => ({ type: 'landing' }),
};

const heroOnlyPage: PageContract = {
  type: 'landing',
  id: 'hero-only',
  contract_version: '0.1',
  summary: 'Hero-only landing page.',
  extract: () => ({ type: 'landing' }),
};

const HeroOnlyRoute = defineComponent({
  setup() { return (): unknown => h(Hero, { title: 'Welcome', subtitle: 'Hello, world' }); },
});

const ComposableRoute = defineComponent({
  setup() { return (): unknown => h(PricingTable, { tiers: ['free', 'pro'] }); },
});

const FaqRoute = defineComponent({
  setup() { return (): unknown => h(FAQAccordion, { items: [{ q: 'Q?', a: 'A.' }] }); },
});

const WrapperRoute = defineComponent({
  setup() {
    return (): unknown => h(ActSection, { contract: pricingPage }, {
      default: () => h(PricingTable, { tiers: ['free'] }),
    });
  },
});

// ---------- NodeDraft → PRD-100 node envelope -----------------------------

interface NodeEnvelope extends NodeDraft {
  act_version: string;
  etag: string;
  tokens: { summary?: number; body?: number; abstract?: number };
}

function toEnvelope(d: NodeDraft): NodeEnvelope {
  const tokens = d.tokens ?? { summary: 0, body: 0 };
  const summary = d.summary.length === 0 ? d.id : d.summary;
  const base: NodeEnvelope = {
    ...d,
    summary,
    act_version: ACT_VERSION,
    tokens,
    etag: '',
  };
  base.etag = deriveEtag(stripEtag(base as unknown as Record<string, unknown>));
  return base;
}

function validateAll(drafts: NodeDraft[]): void {
  for (const d of drafts) {
    const env = toEnvelope(d);
    const r = validateNode(env);
    if (r.gaps.length > 0) {
      throw new Error(
        `validateNode reported gaps for ${d.id}: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
      );
    }
  }
}

// ---------- Positive checks ----------------------------------------------

async function runStaticField(fix: PositiveFixture): Promise<void> {
  const drafts = await extractRoute({
    routeId: heroOnlyPage.id,
    pageContract: heroOnlyPage,
    routeRoot: HeroOnlyRoute,
  });
  if (drafts.length !== fix.expected['draftCount']) {
    throw new Error(`expected draftCount=${String(fix.expected['draftCount'])}, got ${String(drafts.length)}`);
  }
  const head = drafts[0];
  if (head === undefined) throw new Error('no draft emitted');
  if (head.id !== fix.expected['id']) throw new Error(`id mismatch (${head.id})`);
  if (head.type !== fix.expected['type']) throw new Error(`type mismatch (${head.type})`);
  const blocks = head.content.map((b) => b.type);
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  for (const b of head.content) {
    if (b.metadata?.['extracted_via'] !== fix.expected['extractedVia']) {
      throw new Error(`extracted_via ${String(b.metadata?.['extracted_via'])}`);
    }
    if (b.metadata?.['extraction_method'] !== fix.expected['extractionMethod']) {
      throw new Error(`extraction_method ${String(b.metadata?.['extraction_method'])}`);
    }
  }
  validateAll([head]);
}

async function runComposableForm(fix: PositiveFixture): Promise<void> {
  const drafts = await extractRoute({
    routeId: 'composable-only',
    pageContract: { ...pricingPage, id: 'composable-only' },
    routeRoot: ComposableRoute,
  });
  if (drafts.length !== fix.expected['draftCount']) throw new Error('draftCount mismatch');
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  validateAll(drafts);
}

async function runDefineActContractMacro(fix: PositiveFixture): Promise<void> {
  const drafts = await extractRoute({
    routeId: 'faq-only',
    pageContract: { ...pricingPage, id: 'faq-only' },
    routeRoot: FaqRoute,
  });
  if (drafts.length !== fix.expected['draftCount']) throw new Error('draftCount mismatch');
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  validateAll(drafts);
}

async function runPageBoundaryWrapper(fix: PositiveFixture): Promise<void> {
  const drafts = await extractRoute({
    routeId: 'pricing',
    pageContract: pricingPage,
    routeRoot: WrapperRoute,
  });
  if (drafts.length !== fix.expected['draftCount']) throw new Error('draftCount mismatch');
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  validateAll(drafts);
}

async function runDepthFirstRenderOrder(fix: PositiveFixture): Promise<void> {
  const Inner = defineComponent({
    props: { name: { type: String, required: true } },
    setup(props) {
      useActContract({
        type: `inner:${props.name}`,
        contract_version: '0.1',
        extract: () => ({ type: `inner:${props.name}` }),
      });
      return (): unknown => h('span', null, props.name);
    },
  });
  const Outer = defineComponent({
    setup() {
      useActContract({ type: 'outer', contract_version: '0.1', extract: () => ({ type: 'outer' }) });
      return (): unknown => h('div', null, [
        h(Inner, { name: 'a' }),
        h(Inner, { name: 'b' }),
      ]);
    },
  });
  const Root = defineComponent({
    setup() {
      return (): unknown => h('div', null, [
        h(Outer),
        h(Inner, { name: 'c' }),
      ]);
    },
  });
  const drafts = await extractRoute({
    routeId: 'depth',
    pageContract: { ...pricingPage, id: 'depth' },
    routeRoot: Root,
  });
  const got = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(got) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`render order ${JSON.stringify(got)}`);
  }
}

async function runVariantReplay(fix: PositiveFixture): Promise<void> {
  const drafts = await extractRoute({
    routeId: 'pricing',
    pageContract: { ...pricingPage, variants: ['enterprise-2026q2'] },
    routeRoot: ComposableRoute,
    variantSource: 'experiment',
  });
  if (drafts.length !== fix.expected['draftCount']) throw new Error('draftCount mismatch');
  const ids = drafts.map((d) => d.id);
  if (JSON.stringify(ids) !== JSON.stringify(fix.expected['ids'])) {
    throw new Error(`ids mismatch ${JSON.stringify(ids)}`);
  }
  const variantMeta = drafts[1]?.metadata?.variant;
  if (JSON.stringify(variantMeta) !== JSON.stringify(fix.expected['variantMetadata'])) {
    throw new Error(`variant metadata mismatch ${JSON.stringify(variantMeta)}`);
  }
  validateAll(drafts);
}

async function runServerprefetchCompletion(fix: PositiveFixture): Promise<void> {
  let prefetchResolved = false;
  let extractSawPrefetch = false;
  const Prefetcher = defineComponent({
    async serverPrefetch() {
      await new Promise((res) => setTimeout(res, 10));
      prefetchResolved = true;
    },
    setup() {
      useActContract({
        type: 'marketing:prefetched',
        contract_version: '0.1',
        extract: () => {
          extractSawPrefetch = prefetchResolved;
          return { type: 'marketing:prefetched' };
        },
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({ setup() { return (): unknown => h(Prefetcher); } });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`blocks ${JSON.stringify(blocks)}`);
  }
  if (extractSawPrefetch !== fix.expected['prefetchSeenByExtract']) {
    throw new Error(`prefetchSeenByExtract ${String(extractSawPrefetch)}`);
  }
}

function runCapabilityDeclaration(fix: PositiveFixture): void {
  const expected = fix.expected['capabilities'] as Record<string, boolean>;
  for (const k of Object.keys(expected)) {
    const v = (capabilities as unknown as Record<string, boolean>)[k];
    if (v !== expected[k]) {
      throw new Error(`capability "${k}" expected ${String(expected[k])}, got ${String(v)}`);
    }
  }
  if (vueBinding.capabilities !== capabilities) {
    throw new Error('vueBinding.capabilities does not point at the published const');
  }
}

// ---------- Negative checks ----------------------------------------------

function runVue2Detected(fix: NegativeFixture): void {
  const v = (fix.input?.['version'] ?? '2.7.16') as string;
  expectThrows(() => assertVue3Plus(v), fix.expectedErrorSubstring ?? 'Vue 2');
}

async function runExtractThrows(fix: NegativeFixture): Promise<void> {
  const Boom = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => { throw new Error('CMS prop missing'); },
      });
      return (): unknown => h('span');
    },
  });
  const Survivor = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:pricing-table',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:pricing-table', tiers: [] }),
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({
    setup() { return (): unknown => h('div', null, [h(Boom), h(Survivor)]); },
  });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const types = drafts[0]?.content.map((b) => b.type) ?? [];
  for (const want of fix.expectedBlockTypesContain ?? []) {
    if (!types.includes(want)) {
      throw new Error(`block types missing "${want}": ${JSON.stringify(types)}`);
    }
  }
  const placeholder = drafts[0]?.content.find((b) => b.type === 'marketing:placeholder');
  for (const k of Object.keys(fix.expectedFirstBlockMetadata ?? {})) {
    const want = (fix.expectedFirstBlockMetadata ?? {})[k];
    const got = (placeholder?.metadata as Record<string, unknown> | undefined)?.[k];
    if (got !== want) {
      throw new Error(`metadata[${k}] expected ${String(want)}, got ${String(got)}`);
    }
  }
}

async function runExtractReturnsPromise(fix: NegativeFixture): Promise<void> {
  const AsyncFn = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () =>
          Promise.resolve({ type: 'marketing:hero' }) as unknown as { type: string },
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({ setup() { return (): unknown => h(AsyncFn); } });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const t = drafts[0]?.content[0]?.type;
  if (t !== fix.expectedFirstBlockType) {
    throw new Error(`first block type ${String(t)}; expected ${String(fix.expectedFirstBlockType)}`);
  }
  const err = drafts[0]?.content[0]?.metadata?.['error'];
  if (typeof err !== 'string' || !err.includes(fix.expectedErrorSubstring ?? '')) {
    throw new Error(`error did not include "${String(fix.expectedErrorSubstring)}": ${String(err)}`);
  }
}

async function runComponentThrowsSetup(fix: NegativeFixture): Promise<void> {
  const Boom = defineComponent({
    name: 'Boom',
    setup() { throw new Error('setup fail'); },
  });
  const Survivor = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:pricing-table',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:pricing-table', tiers: [] }),
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({
    setup() { return (): unknown => h('div', null, [h(Boom), h(Survivor)]); },
  });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const types = drafts[0]?.content.map((b) => b.type) ?? [];
  for (const want of fix.expectedBlockTypesContain ?? []) {
    if (!types.includes(want)) {
      throw new Error(`block types missing "${want}": ${JSON.stringify(types)}`);
    }
  }
}

async function runExtractEmitsMalformedBlock(fix: NegativeFixture): Promise<void> {
  const Bad = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => ({} as { type: string }),
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({ setup() { return (): unknown => h(Bad); } });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const t = drafts[0]?.content[0]?.type;
  if (t !== fix.expectedFirstBlockType) {
    throw new Error(`first block type ${String(t)}; expected ${String(fix.expectedFirstBlockType)}`);
  }
}

async function runExtractedViaOverridden(fix: NegativeFixture): Promise<void> {
  const Override = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:hero', metadata: { extracted_via: 'sneaky' } }),
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({ setup() { return (): unknown => h(Override); } });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const t = drafts[0]?.content[0]?.type;
  if (t !== fix.expectedFirstBlockType) {
    throw new Error(`first block type ${String(t)}; expected ${String(fix.expectedFirstBlockType)}`);
  }
}

async function runComposableOutsideAppProvider(fix: NegativeFixture): Promise<void> {
  _resetFallbackSentinel();
  const Naked = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:naked',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:naked' }),
      });
      return (): unknown => h('span');
    },
  });
  const app = createSSRApp(Naked);
  await renderToString(app);
  const bumped = fallbackSentinel.composableOutsideProviderCount > 0;
  if (bumped !== fix.expectedFallbackBumped) {
    throw new Error(`fallback bumped=${String(bumped)}, expected ${String(fix.expectedFallbackBumped)}`);
  }
  _resetFallbackSentinel();
}

async function runPageIdViolatesGrammar(fix: NegativeFixture): Promise<void> {
  const id = (fix.input?.['id'] ?? 'BadID') as string;
  let caught: Error | undefined;
  try {
    await extractRoute({
      routeId: id,
      pageContract: { ...pricingPage, id },
      routeRoot: ComposableRoute,
    });
  } catch (e) {
    caught = e as Error;
  }
  if (caught === undefined) throw new Error('expected throw');
  if (!caught.message.includes(fix.expectedErrorSubstring ?? '')) {
    throw new Error(`error did not include "${String(fix.expectedErrorSubstring)}": ${caught.message}`);
  }
}

async function runVariantCapExceeded(fix: NegativeFixture): Promise<void> {
  const n = (fix.input?.['variantCount'] ?? 65) as number;
  const keys = Array.from({ length: n }, (_, i) => `k${String(i)}`);
  let caught: Error | undefined;
  try {
    await extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p', variants: keys },
      routeRoot: ComposableRoute,
    });
  } catch (e) {
    caught = e as Error;
  }
  if (caught === undefined) throw new Error('expected throw');
  if (!caught.message.includes(fix.expectedErrorSubstring ?? '')) {
    throw new Error(`error did not include "${String(fix.expectedErrorSubstring)}": ${caught.message}`);
  }
}

async function runErrorMessageWithSecret(fix: NegativeFixture): Promise<void> {
  const Leaky = defineComponent({
    setup() {
      useActContract({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => { throw new Error('failed with key sk_live_ABCDEFG123 in payload'); },
      });
      return (): unknown => h('span');
    },
  });
  const Route = defineComponent({ setup() { return (): unknown => h(Leaky); } });
  const drafts = await extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: Route,
  });
  const t = drafts[0]?.content[0]?.type;
  if (t !== fix.expectedFirstBlockType) {
    throw new Error(`first block type ${String(t)}; expected ${String(fix.expectedFirstBlockType)}`);
  }
  const err = drafts[0]?.content[0]?.metadata?.['error'] as string;
  if (fix.expectedErrorContains !== undefined && !err.includes(fix.expectedErrorContains)) {
    throw new Error(`error did not include "${fix.expectedErrorContains}": ${err}`);
  }
  if (fix.expectedErrorNotContains !== undefined && err.includes(fix.expectedErrorNotContains)) {
    throw new Error(`error contained forbidden substring "${fix.expectedErrorNotContains}": ${err}`);
  }
}

function expectThrows(fn: () => void, substring: string): void {
  let caught: Error | undefined;
  try {
    fn();
  } catch (e) {
    caught = e as Error;
  }
  if (caught === undefined) {
    throw new Error(`expected throw containing "${substring}"; none thrown`);
  }
  if (!(caught instanceof BuildError) && !caught.message.includes(substring)) {
    throw new Error(`error mismatch: ${caught.message}`);
  }
  if (!caught.message.includes(substring)) {
    throw new Error(`error message did not include "${substring}": ${caught.message}`);
  }
}

// Side-effect: silence unused `installActProvider` import (kept for harness completeness / future).
void installActProvider;

// ---------- Dispatcher ---------------------------------------------------

const checks: FixtureCheck[] = [];
for (const file of readdirSync(path.join(fixtureRoot, 'positive')).sort()) {
  if (!file.endsWith('.json')) continue;
  const fix = loadJson<PositiveFixture>(`positive/${file}`);
  checks.push({
    name: `positive/${file} [${fix.requirements.join(', ')}]`,
    run: () => {
      switch (fix.id) {
        case 'static-field': return runStaticField(fix);
        case 'composable-form': return runComposableForm(fix);
        case 'define-act-contract-macro': return runDefineActContractMacro(fix);
        case 'page-boundary-wrapper': return runPageBoundaryWrapper(fix);
        case 'depth-first-render-order': return runDepthFirstRenderOrder(fix);
        case 'variant-replay': return runVariantReplay(fix);
        case 'serverprefetch-completion': return runServerprefetchCompletion(fix);
        case 'capability-declaration': return runCapabilityDeclaration(fix);
        default: throw new Error(`unknown positive fixture id: ${fix.id}`);
      }
    },
  });
}
for (const file of readdirSync(path.join(fixtureRoot, 'negative')).sort()) {
  if (!file.endsWith('.json')) continue;
  const fix = loadJson<NegativeFixture>(`negative/${file}`);
  checks.push({
    name: `negative/${file} [${fix.requirements.join(', ')}]`,
    run: () => {
      switch (fix.id) {
        case 'vue-2-detected': return runVue2Detected(fix);
        case 'extract-throws': return runExtractThrows(fix);
        case 'extract-returns-promise': return runExtractReturnsPromise(fix);
        case 'component-throws-setup': return runComponentThrowsSetup(fix);
        case 'extract-emits-malformed-block': return runExtractEmitsMalformedBlock(fix);
        case 'extracted-via-overridden-by-author': return runExtractedViaOverridden(fix);
        case 'composable-outside-app-provider': return runComposableOutsideAppProvider(fix);
        case 'page-id-violates-grammar': return runPageIdViolatesGrammar(fix);
        case 'variant-cap-exceeded': return runVariantCapExceeded(fix);
        case 'error-message-with-secret': return runErrorMessageWithSecret(fix);
        default: throw new Error(`unknown negative fixture id: ${fix.id}`);
      }
    },
  });
}

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    try {
      await c.run();
      console.log(`  PASS ${c.name}`);
      pass += 1;
    } catch (e) {
      console.error(`  FAIL ${c.name}`);
      console.error(`    ${(e as Error).message}`);
      fail += 1;
    }
  }
  console.log(
    `\nConformance summary: ${String(pass)} pass / ${String(fail)} fail across ${String(checks.length)} fixtures.`,
  );
  if (fail > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

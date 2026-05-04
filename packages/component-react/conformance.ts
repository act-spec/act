/**
 * Conformance harness for `@act-spec/component-react` (PRD-301).
 *
 * Drives the binding's `extractRoute` over the bundled positive /
 * negative fixtures, then assembles the resulting `NodeDraft[]` into
 * full PRD-100 node envelopes (filling generator-owned `act_version` /
 * `etag` / `tokens` per PRD-301-R23) and runs each through
 * `@act-spec/validator.validateNode` for envelope conformance.
 *
 * Invoked by `pnpm -F @act-spec/component-react conformance`. The G4
 * gate runs this alongside the unit suite.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { validateNode, deriveEtag, stripEtag, ACT_VERSION } from '@act-spec/validator';
import {
  BuildError,
  type NodeDraft,
  type PageContract,
} from '@act-spec/component-contract';
import {
  ActSection,
  assertHookNotInServerComponent,
  assertReact18Plus,
  capabilities,
  extractRoute,
  reactBinding,
  useActContract,
  type ActContract,
  type ReactComponentWithAct,
} from './src/index.js';

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
  expectedBlockTypes?: string[];
  expectedFirstBlockMetadata?: Record<string, unknown>;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, rel), 'utf8')) as T;
}

// ---------- Sample components ---------------------------------------------

interface HeroProps { title: string; subtitle: string }
const Hero: ReactComponentWithAct<HeroProps> = (props) =>
  React.createElement('section', null, props.title);
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
function PricingTable({ tiers }: PricingProps): React.ReactElement {
  useActContract<PricingProps>(
    {
      type: 'marketing:pricing-table',
      contract_version: '0.1',
      extract: (props) => ({ type: 'marketing:pricing-table', tiers: props.tiers }),
    },
    { tiers },
  );
  return React.createElement(
    'ul',
    null,
    tiers.map((t) => React.createElement('li', { key: t }, t)),
  );
}

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

function HeroOnlyRoute(): React.ReactElement {
  return React.createElement(ActSection, {
    of: Hero,
    title: 'Welcome',
    subtitle: 'Hello, world',
  });
}

function HookOnlyRoute(): React.ReactElement {
  return React.createElement(PricingTable, { tiers: ['free', 'pro'] });
}

function PricingRoute(): React.ReactElement {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ActSection, {
      of: Hero,
      title: 'Pricing',
      subtitle: 'Plans that scale',
    }),
    React.createElement(PricingTable, { tiers: ['free', 'pro', 'enterprise'] }),
  );
}

// ---------- NodeDraft → PRD-100 node envelope -----------------------------

interface NodeEnvelope extends NodeDraft {
  act_version: string;
  etag: string;
  tokens: { summary?: number; body?: number; abstract?: number };
}

function toEnvelope(d: NodeDraft): NodeEnvelope {
  // Generator (PRD-401/404/405/406) overlays act_version, etag, tokens
  // per PRD-301-R23. Mimic that here so the validator sees a well-shaped
  // envelope.
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

// ---------- Positive checks ----------------------------------------------

function runStaticField(fix: PositiveFixture): void {
  const drafts = extractRoute({
    routeId: heroOnlyPage.id,
    pageContract: heroOnlyPage,
    routeRoot: React.createElement(HeroOnlyRoute),
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
  // Validator gate.
  const env = toEnvelope(head);
  const result = validateNode(env);
  if (result.gaps.length > 0) {
    throw new Error(
      `validateNode reported gaps: ${result.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
    );
  }
}

function runHookForm(fix: PositiveFixture): void {
  const drafts = extractRoute({
    routeId: 'hook-only',
    pageContract: { ...pricingPage, id: 'hook-only' },
    routeRoot: React.createElement(HookOnlyRoute),
  });
  if (drafts.length !== fix.expected['draftCount']) {
    throw new Error(`draftCount mismatch (${String(drafts.length)})`);
  }
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  const env = toEnvelope(drafts[0]!);
  const r = validateNode(env);
  if (r.gaps.length > 0) {
    throw new Error(
      `validateNode reported gaps: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
    );
  }
}

function runPageBoundaryConst(fix: PositiveFixture): void {
  const drafts = extractRoute({
    routeId: pricingPage.id,
    pageContract: pricingPage,
    routeRoot: React.createElement(PricingRoute),
  });
  if (drafts.length !== fix.expected['draftCount']) {
    throw new Error('draftCount mismatch');
  }
  if (drafts[0]?.id !== fix.expected['id']) throw new Error('id mismatch');
  if (drafts[0]?.summary !== fix.expected['summary']) throw new Error('summary fallback failed');
  const env = toEnvelope(drafts[0]!);
  const r = validateNode(env);
  if (r.gaps.length > 0) {
    throw new Error(
      `validateNode reported gaps: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
    );
  }
}

function runDepthFirstRenderOrder(fix: PositiveFixture): void {
  function Inner(props: { name: string }): React.ReactElement {
    useActContract(
      {
        type: `inner:${props.name}`,
        contract_version: '0.1',
        extract: () => ({ type: `inner:${props.name}` }),
      },
      undefined,
    );
    return React.createElement('span', null, props.name);
  }
  function Outer(): React.ReactElement {
    useActContract(
      { type: 'outer', contract_version: '0.1', extract: () => ({ type: 'outer' }) },
      undefined,
    );
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Inner, { name: 'a' }),
      React.createElement(Inner, { name: 'b' }),
    );
  }
  const drafts = extractRoute({
    routeId: 'depth',
    pageContract: { ...pricingPage, id: 'depth' },
    routeRoot: React.createElement(
      React.Fragment,
      null,
      React.createElement(Outer),
      React.createElement(Inner, { name: 'c' }),
    ),
  });
  const got = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(got) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`render order ${JSON.stringify(got)}`);
  }
}

function runVariantReplay(fix: PositiveFixture): void {
  const drafts = extractRoute({
    routeId: 'pricing',
    pageContract: { ...pricingPage, variants: ['enterprise-2026q2'] },
    routeRoot: React.createElement(PricingRoute),
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
  // Validator gate on both.
  for (const d of drafts) {
    const r = validateNode(toEnvelope(d));
    if (r.gaps.length > 0) {
      throw new Error(
        `validateNode gaps for ${d.id}: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
      );
    }
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
  // Binding object must reference the same matrix.
  if (reactBinding.capabilities !== capabilities) {
    throw new Error('reactBinding.capabilities does not point at the published const');
  }
}

// ---------- Negative checks ----------------------------------------------

function runReact17Detected(fix: NegativeFixture): void {
  const v = (fix.input?.['version'] ?? '17.0.2') as string;
  expectThrows(() => assertReact18Plus(v), fix.expectedErrorSubstring ?? 'React 17');
}

function runExtractThrows(fix: NegativeFixture): void {
  function Boom(): React.ReactElement {
    useActContract(
      {
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => {
          throw new Error('CMS prop missing');
        },
      },
      undefined,
    );
    return React.createElement('span', null, 'boom');
  }
  function Survivor(): React.ReactElement {
    useActContract(
      {
        type: 'marketing:pricing-table',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:pricing-table', tiers: [] }),
      },
      undefined,
    );
    return React.createElement('span', null, 'survivor');
  }
  const drafts = extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: React.createElement(
      React.Fragment,
      null,
      React.createElement(Boom),
      React.createElement(Survivor),
    ),
  });
  const types = drafts[0]?.content.map((b) => b.type) ?? [];
  const expected = fix.expectedBlockTypes ?? [];
  if (JSON.stringify(types) !== JSON.stringify(expected)) {
    throw new Error(`block types mismatch ${JSON.stringify(types)} vs ${JSON.stringify(expected)}`);
  }
  const meta = drafts[0]?.content[0]?.metadata ?? {};
  for (const k of Object.keys(fix.expectedFirstBlockMetadata ?? {})) {
    const want = (fix.expectedFirstBlockMetadata ?? {})[k];
    if ((meta as Record<string, unknown>)[k] !== want) {
      throw new Error(`metadata[${k}] expected ${String(want)}, got ${String((meta as Record<string, unknown>)[k])}`);
    }
  }
}

function runExtractReturnsPromise(fix: NegativeFixture): void {
  function AsyncFn(): React.ReactElement {
    useActContract(
      {
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => Promise.resolve({ type: 'marketing:hero' }) as unknown as { type: string },
      },
      undefined,
    );
    return React.createElement('span', null, 'async');
  }
  const drafts = extractRoute({
    routeId: 'p',
    pageContract: { ...pricingPage, id: 'p' },
    routeRoot: React.createElement(AsyncFn),
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

function runPageIdViolatesGrammar(fix: NegativeFixture): void {
  const id = (fix.input?.['id'] ?? 'BadID') as string;
  expectThrows(
    () =>
      extractRoute({
        routeId: id,
        pageContract: { ...pricingPage, id },
        routeRoot: React.createElement(HookOnlyRoute),
      }),
    fix.expectedErrorSubstring ?? 'PRD-100-R10',
  );
}

function runVariantCapExceeded(fix: NegativeFixture): void {
  const n = (fix.input?.['variantCount'] ?? 65) as number;
  const keys = Array.from({ length: n }, (_, i) => `k${String(i)}`);
  expectThrows(
    () =>
      extractRoute({
        routeId: 'p',
        pageContract: { ...pricingPage, id: 'p', variants: keys },
        routeRoot: React.createElement(PricingRoute),
      }),
    fix.expectedErrorSubstring ?? 'PRD-300-R17',
  );
}

function runUseActContractInServerComponent(fix: NegativeFixture): void {
  expectThrows(
    () =>
      assertHookNotInServerComponent({
        modulePath: (fix.input?.['modulePath'] ?? '?') as string,
        isClient: Boolean(fix.input?.['isClient']),
        usesActContractHook: Boolean(fix.input?.['usesActContractHook']),
      }),
    fix.expectedErrorSubstring ?? 'server component',
  );
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

// ---------- Dispatcher ---------------------------------------------------

const checks: FixtureCheck[] = [];
for (const file of readdirSync(path.join(fixtureRoot, 'positive')).sort()) {
  if (!file.endsWith('.json')) continue;
  const fix = loadJson<PositiveFixture>(`positive/${file}`);
  checks.push({
    name: `positive/${file} [${fix.requirements.join(', ')}]`,
    run: () => {
      switch (fix.id) {
        case 'static-field':
          return runStaticField(fix);
        case 'hook-form':
          return runHookForm(fix);
        case 'page-boundary-const':
          return runPageBoundaryConst(fix);
        case 'depth-first-render-order':
          return runDepthFirstRenderOrder(fix);
        case 'variant-replay':
          return runVariantReplay(fix);
        case 'capability-declaration':
          return runCapabilityDeclaration(fix);
        default:
          throw new Error(`unknown positive fixture id: ${fix.id}`);
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
        case 'react-17-detected':
          return runReact17Detected(fix);
        case 'extract-throws':
          return runExtractThrows(fix);
        case 'extract-returns-promise':
          return runExtractReturnsPromise(fix);
        case 'page-id-violates-grammar':
          return runPageIdViolatesGrammar(fix);
        case 'variant-cap-exceeded':
          return runVariantCapExceeded(fix);
        case 'use-act-contract-in-server-component':
          return runUseActContractInServerComponent(fix);
        default:
          throw new Error(`unknown negative fixture id: ${fix.id}`);
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

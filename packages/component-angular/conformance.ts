/**
 * Conformance harness for `@act-spec/component-angular` (PRD-303).
 *
 * Drives the binding's `extractRoute` over the bundled positive /
 * negative fixtures, then assembles the resulting `NodeDraft[]` into
 * full PRD-100 node envelopes (filling generator-owned `act_version` /
 * `etag` / `tokens` per PRD-303-R23) and runs each through
 * `@act-spec/validator.validateNode` for envelope conformance.
 *
 * Invoked by `pnpm -F @act-spec/component-angular conformance`. The G4
 * gate runs this alongside the unit suite.
 *
 * Per PRD-303 Goal 9 / R23, no v0.1 paired Angular generator exists; the
 * harness uses a synthetic SSR walker that simulates the Angular SSR
 * pipeline (registering contracts on the per-render
 * ActCollectorService). PRD-409 (standalone CLI) supplies its own
 * walker once authored; v0.2's Angular-native generator will replace
 * the synthetic walker entirely.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNode, deriveEtag, stripEtag, ACT_VERSION } from '@act-spec/validator';
import {
  BuildError,
  type NodeDraft,
  type PageContract,
} from '@act-spec/component-contract';
import {
  ActSectionComponent,
  ActSectionDirective,
  angularBinding,
  applyActSection,
  assertAngular17Plus,
  assertCollectorScopeIsComponentLocal,
  capabilities,
  extractRoute,
  type ActContract,
  type AngularComponentWithAct,
  type SsrWalker,
} from './src/index.js';
import { ActCollectorService } from './src/collector.js';

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
  expectedWarningSubstring?: string;
  expectedFirstBlockType?: string;
  expectedBlockTypes?: string[];
  expectedFirstBlockMetadata?: Record<string, unknown>;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, rel), 'utf8')) as T;
}

// ---------- Sample components / contracts ---------------------------------

interface HeroProps { title: string; subtitle: string }
class HeroComponent {
  static act: ActContract<HeroProps> = {
    type: 'marketing:hero',
    contract_version: '0.1',
    extract: (props) => ({
      type: 'marketing:hero',
      headline: props.title,
      subhead: props.subtitle,
    }),
  };
}

interface PricingProps { tiers: ReadonlyArray<string> }
const pricingContract: ActContract<PricingProps> = {
  type: 'marketing:pricing-table',
  contract_version: '0.1',
  extract: (props) => ({ type: 'marketing:pricing-table', tiers: props.tiers }),
};

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

class PricingPageComponent {}

function makeWalker(
  registrar: (collector: ActCollectorService) => void,
): SsrWalker {
  return async ({ collector }) => {
    registrar(collector);
    await Promise.resolve();
  };
}

// ---------- NodeDraft → PRD-100 node envelope -----------------------------

interface NodeEnvelope extends NodeDraft {
  act_version: string;
  etag: string;
  tokens: { summary?: number; body?: number; abstract?: number };
}

function toEnvelope(d: NodeDraft): NodeEnvelope {
  // Generator (PRD-409 / future Angular generator) overlays act_version,
  // etag, tokens per PRD-303-R23. Mimic that here so the validator sees
  // a well-shaped envelope.
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

async function runStaticField(fix: PositiveFixture): Promise<void> {
  const walker = makeWalker((c) => {
    c.register(HeroComponent.act, { title: 'Welcome', subtitle: 'Hello, world' });
  });
  const drafts = await extractRoute(
    {
      routeId: heroOnlyPage.id,
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: heroOnlyPage,
    },
    walker,
  );
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

async function runServiceRegister(fix: PositiveFixture): Promise<void> {
  const walker = makeWalker((c) => {
    c.register(pricingContract, { tiers: ['free', 'pro'] });
  });
  const drafts = await extractRoute(
    {
      routeId: 'service',
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: { ...pricingPage, id: 'service' },
    },
    walker,
  );
  if (drafts.length !== fix.expected['draftCount']) {
    throw new Error(`draftCount mismatch (${String(drafts.length)})`);
  }
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  for (const b of drafts[0]?.content ?? []) {
    if (b.metadata?.['extracted_via'] !== fix.expected['extractedVia']) {
      throw new Error(`extracted_via mismatch`);
    }
  }
  const env = toEnvelope(drafts[0]!);
  const r = validateNode(env);
  if (r.gaps.length > 0) {
    throw new Error(
      `validateNode reported gaps: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
    );
  }
}

async function runPageBoundaryDirective(fix: PositiveFixture): Promise<void> {
  // Simulate the *actSection directive lifecycle: the walker creates a
  // directive instance, sets its contract to the page's, and calls
  // ngOnInit (which registers the page contract on the collector). Then
  // descendant components register.
  const walker: SsrWalker = async ({ collector }) => {
    const directive = new ActSectionDirective(collector);
    directive.contract = pricingPage;
    directive.ngOnInit();
    collector.register(HeroComponent.act, { title: 'Pricing', subtitle: 'Plans' });
    collector.register(pricingContract, { tiers: ['free', 'pro'] });
    await Promise.resolve();
  };
  const drafts = await extractRoute(
    {
      routeId: pricingPage.id,
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: pricingPage,
    },
    walker,
  );
  if (drafts.length !== fix.expected['draftCount']) {
    throw new Error('draftCount mismatch');
  }
  if (drafts[0]?.id !== fix.expected['id']) throw new Error('id mismatch');
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  const env = toEnvelope(drafts[0]!);
  const r = validateNode(env);
  if (r.gaps.length > 0) {
    throw new Error(
      `validateNode gaps: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
    );
  }
}

async function runPageBoundaryComponent(fix: PositiveFixture): Promise<void> {
  // Same as the directive flow, using ActSectionComponent instead.
  const walker: SsrWalker = async ({ collector }) => {
    const cmp = new ActSectionComponent(collector);
    cmp.contract = pricingPage;
    cmp.ngOnInit();
    collector.register(HeroComponent.act, { title: 'Pricing', subtitle: 'Plans' });
    collector.register(pricingContract, { tiers: ['free', 'pro'] });
    await Promise.resolve();
  };
  const drafts = await extractRoute(
    {
      routeId: pricingPage.id,
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: pricingPage,
    },
    walker,
  );
  if (drafts.length !== fix.expected['draftCount']) {
    throw new Error('draftCount mismatch');
  }
  if (drafts[0]?.id !== fix.expected['id']) throw new Error('id mismatch');
  const blocks = drafts[0]?.content.map((b) => b.type) ?? [];
  if (JSON.stringify(blocks) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`block types ${JSON.stringify(blocks)}`);
  }
  const env = toEnvelope(drafts[0]!);
  const r = validateNode(env);
  if (r.gaps.length > 0) {
    throw new Error(
      `validateNode gaps: ${r.gaps.map((g) => `[${g.requirement}] ${g.missing}`).join('; ')}`,
    );
  }
}

async function runDepthFirstRenderOrder(fix: PositiveFixture): Promise<void> {
  const a: ActContract<undefined> = {
    type: 'inner:a', contract_version: '0.1', extract: () => ({ type: 'inner:a' }),
  };
  const b: ActContract<undefined> = {
    type: 'inner:b', contract_version: '0.1', extract: () => ({ type: 'inner:b' }),
  };
  const outer: ActContract<undefined> = {
    type: 'outer', contract_version: '0.1', extract: () => ({ type: 'outer' }),
  };
  const c: ActContract<undefined> = {
    type: 'inner:c', contract_version: '0.1', extract: () => ({ type: 'inner:c' }),
  };
  const walker = makeWalker((coll) => {
    coll.register(outer, undefined);
    coll.register(a, undefined);
    coll.register(b, undefined);
    coll.register(c, undefined);
  });
  const drafts = await extractRoute(
    {
      routeId: 'depth',
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: { ...pricingPage, id: 'depth' },
    },
    walker,
  );
  const got = drafts[0]?.content.map((bl) => bl.type) ?? [];
  if (JSON.stringify(got) !== JSON.stringify(fix.expected['blockTypes'])) {
    throw new Error(`render order ${JSON.stringify(got)}`);
  }
}

async function runVariantReplay(fix: PositiveFixture): Promise<void> {
  const walker = makeWalker((c) => {
    c.register(HeroComponent.act, { title: 'P', subtitle: 'P2' });
    c.register(pricingContract, { tiers: ['free'] });
  });
  const drafts = await extractRoute(
    {
      routeId: 'pricing',
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: { ...pricingPage, variants: ['enterprise-2026q2'] },
    },
    walker,
  );
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
  if (angularBinding.capabilities !== capabilities) {
    throw new Error('angularBinding.capabilities does not point at the published const');
  }
}

// ---------- Negative checks ----------------------------------------------

function runAngularVersionDetected(fix: NegativeFixture): void {
  const v = (fix.input?.['version'] ?? '16.2.0') as string;
  expectThrows(() => assertAngular17Plus(v), fix.expectedErrorSubstring ?? 'PRD-303-R2');
}

async function runExtractThrows(fix: NegativeFixture): Promise<void> {
  const boom: ActContract<undefined> = {
    type: 'marketing:hero',
    contract_version: '0.1',
    extract: () => { throw new Error('CMS prop missing'); },
  };
  const survivor: ActContract<undefined> = {
    type: 'marketing:pricing-table',
    contract_version: '0.1',
    extract: () => ({ type: 'marketing:pricing-table', tiers: [] }),
  };
  const walker = makeWalker((c) => {
    c.register(boom, undefined);
    c.register(survivor, undefined);
  });
  const drafts = await extractRoute(
    {
      routeId: 'p',
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: { ...pricingPage, id: 'p' },
    },
    walker,
  );
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

async function runExtractReturnsPromise(fix: NegativeFixture): Promise<void> {
  const asyncFn: ActContract<undefined> = {
    type: 'marketing:hero',
    contract_version: '0.1',
    extract: () => Promise.resolve({ type: 'marketing:hero' }) as unknown as { type: string },
  };
  const walker = makeWalker((c) => { c.register(asyncFn, undefined); });
  const drafts = await extractRoute(
    {
      routeId: 'p',
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: { ...pricingPage, id: 'p' },
    },
    walker,
  );
  const t = drafts[0]?.content[0]?.type;
  if (t !== fix.expectedFirstBlockType) {
    throw new Error(`first block type ${String(t)}; expected ${String(fix.expectedFirstBlockType)}`);
  }
  const err = drafts[0]?.content[0]?.metadata?.['error'];
  if (typeof err !== 'string' || !err.includes(fix.expectedErrorSubstring ?? '')) {
    throw new Error(`error did not include "${String(fix.expectedErrorSubstring)}": ${String(err)}`);
  }
}

async function runPageIdViolatesGrammar(fix: NegativeFixture): Promise<void> {
  const id = (fix.input?.['id'] ?? 'BadID') as string;
  const walker = makeWalker(() => undefined);
  await expectAsyncThrows(
    () => extractRoute(
      {
        routeId: id,
        module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
        pageContract: { ...pricingPage, id },
      },
      walker,
    ),
    fix.expectedErrorSubstring ?? 'PRD-100-R10',
  );
}

async function runVariantCapExceeded(fix: NegativeFixture): Promise<void> {
  const n = (fix.input?.['variantCount'] ?? 65) as number;
  const keys = Array.from({ length: n }, (_, i) => `k${String(i)}`);
  const walker = makeWalker(() => undefined);
  await expectAsyncThrows(
    () => extractRoute(
      {
        routeId: 'p',
        module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
        pageContract: { ...pricingPage, id: 'p', variants: keys },
      },
      walker,
    ),
    fix.expectedErrorSubstring ?? 'PRD-300-R17',
  );
}

function runNestedActSection(fix: NegativeFixture): void {
  const c = new ActCollectorService();
  applyActSection(c, { ...pricingPage, id: 'outer' });
  expectThrows(
    () => applyActSection(c, { ...pricingPage, id: 'inner' }),
    fix.expectedErrorSubstring ?? 'PRD-303-R11',
  );
}

function runCollectorProvidedAtRoot(fix: NegativeFixture): void {
  expectThrows(
    () => assertCollectorScopeIsComponentLocal('root'),
    fix.expectedErrorSubstring ?? 'PRD-303-R7',
  );
}

async function runServiceRegisterOutsideScope(fix: NegativeFixture): Promise<void> {
  const walker: SsrWalker = async () => {
    // Simulate a service that was not wired to a collector.
    const { ActContractService } = await import('./src/index.js');
    const orphan = new ActContractService(null);
    orphan.register(HeroComponent.act, { title: 't', subtitle: 's' });
    await Promise.resolve();
  };
  const drafts = await extractRoute(
    {
      routeId: 'orphan',
      module: PricingPageComponent as unknown as AngularComponentWithAct<unknown>,
      pageContract: { ...pricingPage, id: 'orphan' },
    },
    walker,
  );
  const meta = drafts[0]?.metadata as Record<string, unknown> | undefined;
  const warnings = meta?.['warnings'] as unknown;
  if (warnings === undefined) throw new Error('expected warnings on draft metadata');
  const want = fix.expectedWarningSubstring ?? 'PRD-303-R16';
  if (!JSON.stringify(warnings).includes(want)) {
    throw new Error(`warnings did not include "${want}": ${JSON.stringify(warnings)}`);
  }
}

function expectThrows(fn: () => void, substring: string): void {
  let caught: Error | undefined;
  try { fn(); } catch (e) { caught = e as Error; }
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

async function expectAsyncThrows(fn: () => Promise<unknown>, substring: string): Promise<void> {
  let caught: Error | undefined;
  try { await fn(); } catch (e) { caught = e as Error; }
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
        case 'service-register':
          return runServiceRegister(fix);
        case 'page-boundary-directive-form':
          return runPageBoundaryDirective(fix);
        case 'page-boundary-component-form':
          return runPageBoundaryComponent(fix);
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
        case 'angular-16-detected':
          return runAngularVersionDetected(fix);
        case 'angularjs-detected':
          return runAngularVersionDetected(fix);
        case 'extract-throws':
          return runExtractThrows(fix);
        case 'extract-returns-promise':
          return runExtractReturnsPromise(fix);
        case 'page-id-violates-grammar':
          return runPageIdViolatesGrammar(fix);
        case 'variant-cap-exceeded':
          return runVariantCapExceeded(fix);
        case 'nested-actsection-directives':
          return runNestedActSection(fix);
        case 'collector-provided-at-root':
          return runCollectorProvidedAtRoot(fix);
        case 'service-register-outside-scope':
          return runServiceRegisterOutsideScope(fix);
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

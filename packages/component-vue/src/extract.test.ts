/**
 * PRD-302-R3 / R4 / R5 / R6 / R7 / R8 / R9 / R10 / R11 / R13 / R14 / R15 /
 * R16 / R17 / R19 / R22 / R23 — `extractRoute` end-to-end.
 *
 * Exercises the SSR-walk path via `@vue/server-renderer.renderToString`
 * with each declaration pattern (composable, defineActContract macro form,
 * static field, ActSection wrapper) and the failure modes (extract throws,
 * Promise return, malformed block, secret redaction, variant cap, page id
 * grammar, composable outside provider).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, type PropType } from 'vue';
import {
  ActSection,
  defineActContract,
  extractRoute,
  fallbackSentinel,
  useActContract,
  useActStatic,
  vueBinding,
  type ActContract,
  type PageContract,
  type VueComponentWithAct,
} from './index.js';
import { _resetFallbackSentinel } from './provider.js';
import { BuildError } from '@act-spec/component-contract';

// ---------- Sample components --------------------------------------------

interface HeroProps { title: string; subtitle: string }
const Hero: VueComponentWithAct<HeroProps> = defineComponent({
  name: 'Hero',
  props: {
    title: { type: String as PropType<string>, required: true },
    subtitle: { type: String as PropType<string>, required: true },
  },
  setup(props) {
    useActStatic(Hero, props as HeroProps, { component: 'Hero', location: 'design-system/Hero.vue:1' });
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
    // PRD-302-R5 — `defineActContract` macro form (runtime equivalent
    // after macro lowering). Identical effect to `useActContract`.
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
    return (): unknown => h('dl', null);
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

const PricingRoute = defineComponent({
  name: 'PricingRoute',
  setup() {
    return (): unknown =>
      h('div', null, [
        h(Hero, { title: 'Pricing', subtitle: 'Plans that scale' }),
        h(PricingTable, { tiers: ['free', 'pro', 'enterprise'] }),
        h(FAQAccordion, { items: [{ q: 'Q?', a: 'A.' }] }),
      ]);
  },
});

const HeroOnlyRoute = defineComponent({
  name: 'HeroOnlyRoute',
  setup() {
    return (): unknown => h(Hero, { title: 'Welcome', subtitle: 'Hello, world' });
  },
});

afterEach(() => {
  _resetFallbackSentinel();
});

describe('PRD-302-R22 extractRoute (Vue SSR-walk)', () => {
  it('PRD-302-R10 / R22: emits one canonical NodeDraft with descendants in render order (depth-first)', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: PricingRoute,
    });
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d?.id).toBe('pricing');
    expect(d?.type).toBe('landing');
    expect(d?.summary).toBe('Acme pricing tiers and plan comparison.');
    expect(d?.content.map((b) => b.type)).toEqual([
      'marketing:hero',
      'marketing:pricing-table',
      'marketing:faq',
    ]);
  });

  it('PRD-302-R3 / R6: static-field declaration via Component.act registers via useActStatic', async () => {
    const heroPage: PageContract = { ...pricingPage, id: 'hero-only' };
    const drafts = await extractRoute({
      routeId: 'hero-only',
      pageContract: heroPage,
      routeRoot: HeroOnlyRoute,
    });
    expect(drafts[0]?.content.map((b) => b.type)).toEqual(['marketing:hero']);
  });

  it('PRD-302-R4 / R6 / R8: composable form registers and extract runs once after render', async () => {
    let extractCalls = 0;
    const Counted = defineComponent({
      name: 'Counted',
      setup() {
        useActContract({
          type: 'marketing:counted',
          contract_version: '0.1',
          extract: () => {
            extractCalls += 1;
            return { type: 'marketing:counted' };
          },
        });
        return (): unknown => h('div');
      },
    });
    const Route = defineComponent({
      setup() { return (): unknown => h(Counted); },
    });
    await extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: Route,
    });
    expect(extractCalls).toBe(1);
  });

  it('PRD-302-R5 / R6: defineActContract macro form desugars equivalently (FAQAccordion uses it)', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: PricingRoute,
    });
    const blocks = drafts[0]?.content ?? [];
    expect(blocks.some((b) => b.type === 'marketing:faq')).toBe(true);
  });

  it('PRD-302-R5: <ActSection> wrapper renders its slot under the provider', async () => {
    const wrapped = defineComponent({
      setup() {
        return (): unknown => h(ActSection, { contract: pricingPage }, {
          default: () => h(PricingTable, { tiers: ['free'] }),
        });
      },
    });
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: wrapped,
    });
    expect(drafts[0]?.content.map((b) => b.type)).toEqual(['marketing:pricing-table']);
  });

  it('PRD-302-R10: depth-first render order across nested components', async () => {
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
    expect(drafts[0]?.content.map((b) => b.type)).toEqual([
      'outer',
      'inner:a',
      'inner:b',
      'inner:c',
    ]);
  });

  it('PRD-302-R14: every emitted block carries metadata.extracted_via=component-contract', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: PricingRoute,
    });
    for (const b of drafts[0]?.content ?? []) {
      expect(b.metadata?.['extracted_via']).toBe('component-contract');
    }
  });

  it('PRD-302-R15: every emitted block carries metadata.extraction_method=ssr-walk', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: PricingRoute,
    });
    for (const b of drafts[0]?.content ?? []) {
      expect(b.metadata?.['extraction_method']).toBe('ssr-walk');
    }
  });

  it('PRD-302-R7: page id violating PRD-100-R10 grammar throws build error', async () => {
    await expect(
      extractRoute({
        routeId: 'BadID',
        pageContract: { ...pricingPage, id: 'BadID' },
        routeRoot: HeroOnlyRoute,
      }),
    ).rejects.toThrowError(/PRD-100-R10|PRD-302-R7/);
  });

  it('PRD-302-R7: page contract missing contract_version throws build error', async () => {
    const broken = { ...pricingPage, contract_version: '' } as PageContract;
    await expect(
      extractRoute({
        routeId: 'pricing',
        pageContract: broken,
        routeRoot: HeroOnlyRoute,
      }),
    ).rejects.toThrowError(/contract_version/);
  });
});

describe('PRD-302-R13 variant replay', () => {
  it('PRD-302-R13: emits canonical + one draft per declared variant key', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: { ...pricingPage, variants: ['fr-FR', 'de-DE'] },
      routeRoot: PricingRoute,
      variantSource: 'locale',
    });
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.id)).toEqual([
      'pricing',
      'pricing@fr-FR',
      'pricing@de-DE',
    ]);
  });

  it('PRD-302-R13: variant draft carries metadata.variant {base_id, key, source}', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: { ...pricingPage, variants: ['fr-FR'] },
      routeRoot: PricingRoute,
      variantSource: 'locale',
    });
    expect(drafts[1]?.metadata?.variant).toEqual({
      base_id: 'pricing',
      key: 'fr-FR',
      source: 'locale',
    });
  });

  it('PRD-302-R13: variant draft carries variant_of related entry', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: { ...pricingPage, variants: ['fr-FR'] },
      routeRoot: PricingRoute,
      variantSource: 'locale',
    });
    const related = drafts[1]?.related ?? [];
    expect(related.some((r) => r.id === 'pricing' && r.relation === 'variant_of')).toBe(true);
  });

  it('PRD-302-R13: variant matrix > 64 throws BuildError per PRD-300-R17', async () => {
    const tooMany = Array.from({ length: 65 }, (_v, i) => `k${String(i)}`);
    await expect(
      extractRoute({
        routeId: 'pricing',
        pageContract: { ...pricingPage, variants: tooMany },
        routeRoot: PricingRoute,
      }),
    ).rejects.toThrowError(/PRD-300-R17|exceeds cap/);
  });

  it('PRD-302-R13: each variant pass uses a fresh Vue app (extract called once per variant)', async () => {
    let calls = 0;
    const Counted = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:counted',
          contract_version: '0.1',
          extract: () => {
            calls += 1;
            return { type: 'marketing:counted' };
          },
        });
        return (): unknown => h('div');
      },
    });
    const R = defineComponent({ setup() { return (): unknown => h(Counted); } });
    await extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p', variants: ['a', 'b'] },
      routeRoot: R,
      variantSource: 'experiment',
    });
    expect(calls).toBe(3); // canonical + 2 variants.
  });
});

describe('PRD-302-R16 placeholder failure modes', () => {
  it('PRD-302-R16: extract throws → marketing:placeholder; descendants still contribute', async () => {
    const Boom = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => {
            throw new Error('CMS prop missing');
          },
        });
        return (): unknown => h('span', null, 'boom');
      },
    });
    const Survivor = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:pricing-table',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:pricing-table', tiers: [] }),
        });
        return (): unknown => h('span', null, 'survivor');
      },
    });
    const Route = defineComponent({
      setup() {
        return (): unknown => h('div', null, [h(Boom), h(Survivor)]);
      },
    });
    const drafts = await extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: Route,
    });
    const types = drafts[0]?.content.map((b) => b.type) ?? [];
    expect(types).toContain('marketing:placeholder');
    expect(types).toContain('marketing:pricing-table');
    const placeholder = drafts[0]?.content.find((b) => b.type === 'marketing:placeholder');
    expect(placeholder?.metadata?.['extraction_status']).toBe('failed');
    expect(placeholder?.metadata?.['extracted_via']).toBe('component-contract');
  });

  it('PRD-302-R9 / R16: extract returns Promise → placeholder', async () => {
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
    expect(drafts[0]?.content[0]?.type).toBe('marketing:placeholder');
    const err = drafts[0]?.content[0]?.metadata?.['error'];
    expect(typeof err).toBe('string');
    expect(err as string).toContain('Promise');
  });

  it('PRD-302-R14 / R16: extract returns malformed block (missing type) → placeholder', async () => {
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
    expect(drafts[0]?.content[0]?.type).toBe('marketing:placeholder');
  });

  it('PRD-302-R14: author-supplied metadata.extracted_via override → placeholder per PRD-300-R21', async () => {
    const Override = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => ({
            type: 'marketing:hero',
            metadata: { extracted_via: 'sneaky' },
          }),
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
    expect(drafts[0]?.content[0]?.type).toBe('marketing:placeholder');
  });

  it('PRD-302-R16: component throws in setup → placeholder via app.config.errorHandler; render continues', async () => {
    const Boom = defineComponent({
      name: 'Boom',
      setup() {
        throw new Error('setup failure');
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
      setup() {
        return (): unknown => h('div', null, [h(Boom), h(Survivor)]);
      },
    });
    const drafts = await extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: Route,
    });
    const types = drafts[0]?.content.map((b) => b.type) ?? [];
    expect(types).toContain('marketing:placeholder');
    expect(types).toContain('marketing:pricing-table');
  });

  it('PRD-302-R19: error message containing a secret token is redacted', async () => {
    const Leaky = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => {
            throw new Error('failed with key sk_live_ABCDEFG123 in payload');
          },
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
    const err = drafts[0]?.content[0]?.metadata?.['error'];
    expect(err).toBeDefined();
    expect(err as string).not.toContain('sk_live_ABCDEFG123');
    expect(err as string).toContain('[REDACTED]');
  });

  it('PRD-302-R19: error message > 200 chars is truncated', async () => {
    const long = 'x'.repeat(500);
    const Big = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => {
            throw new Error(long);
          },
        });
        return (): unknown => h('span');
      },
    });
    const Route = defineComponent({ setup() { return (): unknown => h(Big); } });
    const drafts = await extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: Route,
    });
    const err = drafts[0]?.content[0]?.metadata?.['error'] as string;
    expect(err.length).toBeLessThanOrEqual(200);
  });

  it('PRD-302-R16: composable called outside an installed provider → fallback sentinel records and route render emits placeholder', async () => {
    // Direct test of the composable outside installActProvider scope.
    _resetFallbackSentinel();
    const Naked = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:hero' }),
        });
        return (): unknown => h('span');
      },
    });
    // Call the composable through Vue's createApp (no provider).
    // Instead of routing through extractRoute (which always installs a
    // provider), we render via a bare app to demonstrate the fallback.
    const { createSSRApp } = await import('vue');
    const { renderToString } = await import('@vue/server-renderer');
    const app = createSSRApp(Naked);
    await renderToString(app);
    expect(fallbackSentinel.composableOutsideProviderCount).toBeGreaterThan(0);
    _resetFallbackSentinel();
  });
});

describe('PRD-302-R11 serverPrefetch completion', () => {
  it('PRD-302-R11: renderToString awaits serverPrefetch promises before yielding (binding sees registrations after prefetch resolves)', async () => {
    let prefetchResolved = false;
    let extractSawPrefetch = false;
    const Prefetcher = defineComponent({
      async serverPrefetch() {
        await new Promise((res) => setTimeout(res, 20));
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
    expect(drafts[0]?.content.map((b) => b.type)).toContain('marketing:prefetched');
    expect(extractSawPrefetch).toBe(true);
  });
});

describe('PRD-302-R23 NodeDraft shape', () => {
  it('PRD-302-R23: binding does NOT supply act_version or etag', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: PricingRoute,
    });
    const d = drafts[0] as unknown as Record<string, unknown>;
    expect(d['act_version']).toBeUndefined();
    expect(d['etag']).toBeUndefined();
  });

  it('PRD-302-R22: returns NodeDraft[] satisfying PRD-300 shape (id/type/title/summary/content)', async () => {
    const drafts = await extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: PricingRoute,
    });
    const d = drafts[0];
    expect(d).toBeDefined();
    expect(typeof d?.id).toBe('string');
    expect(typeof d?.type).toBe('string');
    expect(typeof d?.title).toBe('string');
    expect(typeof d?.summary).toBe('string');
    expect(Array.isArray(d?.content)).toBe(true);
  });
});

describe('PRD-302-R1 binding object', () => {
  it('PRD-302-R1: vueBinding.name is "@act-spec/component-vue"', () => {
    expect(vueBinding.name).toBe('@act-spec/component-vue');
  });

  it('PRD-302-R1: vueBinding.contractVersion is "0.1"', () => {
    expect(vueBinding.contractVersion).toBe('0.1');
  });

  it('PRD-302-R1: vueBinding.capabilities is the published const', () => {
    expect(vueBinding.capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-302-R22: vueBinding.extractRoute consumes ExtractRouteInput shape', async () => {
    const drafts = await vueBinding.extractRoute({
      routeId: 'pricing',
      module: { routeRoot: PricingRoute, pageContract: pricingPage },
      routeProps: undefined,
      locale: undefined,
      variant: undefined,
    });
    expect(drafts).toHaveLength(1);
  });

  it('PRD-302-R22: vueBinding.extractRoute throws on missing module.routeRoot', async () => {
    await expect(
      vueBinding.extractRoute({
        routeId: 'pricing',
        module: { pageContract: pricingPage },
        routeProps: undefined,
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toBeInstanceOf(BuildError);
  });

  it('PRD-302-R22: vueBinding.extractRoute throws on missing module.pageContract', async () => {
    await expect(
      vueBinding.extractRoute({
        routeId: 'pricing',
        module: { routeRoot: PricingRoute },
        routeProps: undefined,
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toBeInstanceOf(BuildError);
  });

  it('PRD-302-R22: vueBinding.extractRoute throws on null module', async () => {
    await expect(
      vueBinding.extractRoute({
        routeId: 'pricing',
        module: null,
        routeProps: undefined,
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toBeInstanceOf(BuildError);
  });
});

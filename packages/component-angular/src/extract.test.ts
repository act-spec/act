/**
 * PRD-303-R7 / R10 / R13 / R14 / R15 / R16 / R22 / R23 — extractRoute
 * end-to-end: page-id validation, SSR walk, variant replay, metadata
 * stamping, placeholder failure modes, NodeDraft shape.
 *
 * Tests use a synthetic SSR walker (per the `SsrWalker` contract) that
 * simulates Angular's render pipeline by invoking caller-supplied
 * registration callbacks against the binding-supplied collector. This
 * is the canonical pattern PRD-303-R23 anticipates: the binding accepts
 * a pluggable walker so unit coverage does not require booting the
 * Angular runtime, while production wires `@angular/platform-server`'s
 * `renderApplication` per PRD-303-R10.
 */
import { describe, expect, it } from 'vitest';
import { extractRoute, type SsrWalker } from './extract.js';
import { angularBinding } from './binding.js';
import { ActContractService, type ActCollectorService } from './collector.js';
import { BuildError } from '@act-spec/component-contract';
import type {
  ActContract,
  ActBinding,
  PageContract,
} from '@act-spec/component-contract';
import type { AngularComponentWithAct } from './types.js';

interface HeroProps { title: string; subtitle: string; ctaText?: string }
class HeroComponent {
  static act: ActContract<HeroProps> = {
    type: 'marketing:hero',
    contract_version: '0.1',
    extract: (props) => ({
      type: 'marketing:hero',
      headline: props.title,
      subhead: props.subtitle,
      ...(props.ctaText !== undefined ? { cta: { label: props.ctaText, href: '#' } } : {}),
    }),
  };
}

interface PricingProps { tiers: ReadonlyArray<{ name: string; price: number }> }
const pricingContract: ActContract<PricingProps> = {
  type: 'marketing:pricing-table',
  contract_version: '0.1',
  extract: (props) => ({
    type: 'marketing:pricing-table',
    tiers: props.tiers.map((t) => ({ name: t.name, price: t.price })),
  }),
};

const pricingPage: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  summary: 'Acme pricing tiers and plan comparison.',
  related: [{ id: 'products', relation: 'see-also' }],
  extract: () => ({ type: 'landing' }),
};

class PricingPage {}

/**
 * Synthetic walker: caller supplies a per-pass callback that registers
 * contracts on the collector (mirrors what the `*actSection` directive
 * + service-based components would do during a real `renderApplication`
 * pass).
 */
function makeWalker(
  registrar: (collector: ActCollectorService, ctx: { variant?: string | undefined }) => void,
): SsrWalker {
  return async ({ collector, context }) => {
    registrar(collector, context);
    // Simulate the `ApplicationRef.isStable` first-`true` wait per PRD-303-R10.
    await Promise.resolve();
  };
}

describe('PRD-303-R22 extractRoute', () => {
  it('PRD-303-R10 / R22: emits one canonical NodeDraft with descendants in render order', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 'Pricing', subtitle: 'Plans that scale', ctaText: 'Start' });
      c.register(pricingContract, { tiers: [{ name: 'Free', price: 0 }, { name: 'Pro', price: 20 }] });
    });
    const drafts = await extractRoute(
      { routeId: 'pricing', module: PricingPage, pageContract: pricingPage },
      walker,
    );
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d?.id).toBe('pricing');
    expect(d?.type).toBe('landing');
    expect(d?.summary).toBe('Acme pricing tiers and plan comparison.');
    expect(d?.content.map((b) => b.type)).toEqual([
      'marketing:hero',
      'marketing:pricing-table',
    ]);
  });

  it('PRD-303-R14: every emitted block carries metadata.extracted_via=component-contract', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 't', subtitle: 's' });
    });
    const drafts = await extractRoute(
      { routeId: 'pricing', module: PricingPage, pageContract: pricingPage },
      walker,
    );
    for (const b of drafts[0]?.content ?? []) {
      expect(b.metadata?.['extracted_via']).toBe('component-contract');
    }
  });

  it('PRD-303-R15: every emitted block carries metadata.extraction_method=ssr-walk', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 't', subtitle: 's' });
    });
    const drafts = await extractRoute(
      { routeId: 'pricing', module: PricingPage, pageContract: pricingPage },
      walker,
    );
    for (const b of drafts[0]?.content ?? []) {
      expect(b.metadata?.['extraction_method']).toBe('ssr-walk');
    }
  });

  it('PRD-303-R23: NodeDraft shape carries no act_version / etag (generator-owned)', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 't', subtitle: 's' });
    });
    const drafts = await extractRoute(
      { routeId: 'pricing', module: PricingPage, pageContract: pricingPage },
      walker,
    );
    expect(drafts[0]).not.toHaveProperty('act_version');
    expect(drafts[0]).not.toHaveProperty('etag');
  });

  it('PRD-303-R7: invalid page id throws BuildError', async () => {
    const walker = makeWalker(() => undefined);
    await expect(
      extractRoute(
        { routeId: 'BadID', module: PricingPage, pageContract: { ...pricingPage, id: 'BadID' } },
        walker,
      ),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R7: empty page id throws BuildError', async () => {
    const walker = makeWalker(() => undefined);
    await expect(
      extractRoute(
        { routeId: '', module: PricingPage, pageContract: { ...pricingPage, id: '' } },
        walker,
      ),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R7: missing contract_version on page contract throws BuildError', async () => {
    const walker = makeWalker(() => undefined);
    await expect(
      extractRoute(
        { routeId: 'pricing', module: PricingPage, pageContract: { ...pricingPage, contract_version: '' } },
        walker,
      ),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R13: variant replay emits canonical + per-variant drafts', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 't', subtitle: 's' });
    });
    const drafts = await extractRoute(
      {
        routeId: 'pricing',
        module: PricingPage,
        pageContract: { ...pricingPage, variants: ['enterprise-2026q2'] },
      },
      walker,
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.id).toBe('pricing');
    expect(drafts[1]?.id).toBe('pricing@enterprise-2026q2');
    // PRD-300-R18 — variant metadata stamped on the variant draft.
    expect(drafts[1]?.metadata?.variant).toEqual({
      base_id: 'pricing',
      key: 'enterprise-2026q2',
      source: 'experiment',
    });
    // PRD-300-R19 — variant_of related entry.
    expect(drafts[1]?.related).toContainEqual({ id: 'pricing', relation: 'variant_of' });
  });

  it('PRD-303-R13 / PRD-300-R17: variant matrix > 64 throws BuildError', async () => {
    const keys = Array.from({ length: 65 }, (_, i) => `k${String(i)}`);
    const walker = makeWalker(() => undefined);
    await expect(
      extractRoute(
        { routeId: 'pricing', module: PricingPage, pageContract: { ...pricingPage, variants: keys } },
        walker,
      ),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R13: variant render uses fresh collector scope (not canonical)', async () => {
    let calls = 0;
    const walker: SsrWalker = async ({ collector }) => {
      calls += 1;
      collector.register(HeroComponent.act, { title: 't', subtitle: 's' });
      await Promise.resolve();
    };
    await extractRoute(
      {
        routeId: 'page',
        module: PricingPage,
        pageContract: { ...pricingPage, id: 'page', variants: ['v1', 'v2'] },
      },
      walker,
    );
    // Canonical + 2 variants = 3 walker invocations, each with its own collector.
    expect(calls).toBe(3);
  });

  it('PRD-303-R16: extract that throws produces a placeholder block; subsequent contracts still contribute', async () => {
    const boom: ActContract<undefined> = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: () => {
        throw new Error('CMS prop missing');
      },
    };
    const walker = makeWalker((c) => {
      c.register(boom, undefined);
      c.register(pricingContract, { tiers: [] });
    });
    const drafts = await extractRoute(
      { routeId: 'page', module: PricingPage, pageContract: { ...pricingPage, id: 'page' } },
      walker,
    );
    const blocks = drafts[0]?.content ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe('marketing:placeholder');
    expect(blocks[0]?.metadata?.['extraction_status']).toBe('failed');
    expect(blocks[1]?.type).toBe('marketing:pricing-table');
  });

  it('PRD-303-R9 / R16: extract returning a Promise produces a placeholder per PRD-300-R7', async () => {
    const asyncFn: ActContract<undefined> = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: () => Promise.resolve({ type: 'marketing:hero' }) as unknown as { type: string },
    };
    const walker = makeWalker((c) => {
      c.register(asyncFn, undefined);
    });
    const drafts = await extractRoute(
      { routeId: 'p', module: PricingPage, pageContract: { ...pricingPage, id: 'p' } },
      walker,
    );
    const block = drafts[0]?.content[0];
    expect(block?.type).toBe('marketing:placeholder');
    expect(block?.metadata?.['error']).toMatch(/Promise/);
  });

  it('PRD-303-R14 / PRD-300-R20: malformed block (missing type) becomes a placeholder', async () => {
    const bad: ActContract<undefined> = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: () => ({ headline: 'x' } as unknown as { type: string }),
    };
    const walker = makeWalker((c) => {
      c.register(bad, undefined);
    });
    const drafts = await extractRoute(
      { routeId: 'p', module: PricingPage, pageContract: { ...pricingPage, id: 'p' } },
      walker,
    );
    expect(drafts[0]?.content[0]?.type).toBe('marketing:placeholder');
  });

  it('PRD-303-R14 / PRD-300-R21: author override of metadata.extracted_via becomes a placeholder', async () => {
    const override: ActContract<undefined> = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: () => ({ type: 'marketing:hero', metadata: { extracted_via: 'author' } }),
    };
    const walker = makeWalker((c) => {
      c.register(override, undefined);
    });
    const drafts = await extractRoute(
      { routeId: 'p', module: PricingPage, pageContract: { ...pricingPage, id: 'p' } },
      walker,
    );
    expect(drafts[0]?.content[0]?.type).toBe('marketing:placeholder');
  });

  it('PRD-303-R10: descendant render-order is preserved across nested registrations', async () => {
    const a: ActContract<undefined> = {
      type: 'inner:a', contract_version: '0.1', extract: () => ({ type: 'inner:a' }),
    };
    const b: ActContract<undefined> = {
      type: 'inner:b', contract_version: '0.1', extract: () => ({ type: 'inner:b' }),
    };
    const c: ActContract<undefined> = {
      type: 'outer', contract_version: '0.1', extract: () => ({ type: 'outer' }),
    };
    const d: ActContract<undefined> = {
      type: 'inner:c', contract_version: '0.1', extract: () => ({ type: 'inner:c' }),
    };
    const walker = makeWalker((coll) => {
      // Simulate depth-first render order: outer → a → b → c.
      coll.register(c, undefined);
      coll.register(a, undefined);
      coll.register(b, undefined);
      coll.register(d, undefined);
    });
    const drafts = await extractRoute(
      { routeId: 'depth', module: PricingPage, pageContract: { ...pricingPage, id: 'depth' } },
      walker,
    );
    expect(drafts[0]?.content.map((bl) => bl.type)).toEqual([
      'outer', 'inner:a', 'inner:b', 'inner:c',
    ]);
  });

  it('PRD-303-R22: empty route (no descendants) emits a draft with empty content', async () => {
    const walker = makeWalker(() => undefined);
    const drafts = await extractRoute(
      { routeId: 'empty', module: PricingPage, pageContract: { ...pricingPage, id: 'empty' } },
      walker,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.content).toEqual([]);
  });

  it('PRD-303-R13: variantSource override is honored on emitted variant metadata', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 't', subtitle: 's' });
    });
    const drafts = await extractRoute(
      {
        routeId: 'i18n',
        module: PricingPage,
        pageContract: { ...pricingPage, id: 'i18n', variants: ['fr-FR'] },
        variantSource: 'locale',
      },
      walker,
    );
    expect(drafts[1]?.metadata?.variant?.source).toBe('locale');
  });

  it('PRD-303-R16: walker that throws is captured as a render warning on the canonical draft', async () => {
    const walker: SsrWalker = async () => {
      await Promise.resolve();
      throw new Error('bootstrap-time crash');
    };
    const drafts = await extractRoute(
      { routeId: 'crash', module: PricingPage, pageContract: { ...pricingPage, id: 'crash' } },
      walker,
    );
    expect(drafts).toHaveLength(1);
    const meta = drafts[0]?.metadata as Record<string, unknown> | undefined;
    expect(meta?.['warnings']).toBeDefined();
  });

  it('PRD-303-R16: variant walker that throws produces warnings on the canonical draft', async () => {
    let count = 0;
    const walker: SsrWalker = async ({ collector }) => {
      count += 1;
      if (count === 2) {
        throw new Error('variant pass crash');
      }
      collector.register(HeroComponent.act, { title: 'Hero', subtitle: 'Sub' });
      await Promise.resolve();
    };
    const drafts = await extractRoute(
      {
        routeId: 'crashv',
        module: PricingPage,
        pageContract: { ...pricingPage, id: 'crashv', variants: ['v1'] },
      },
      walker,
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.content[0]?.type).toBe('marketing:hero');
    const meta = drafts[0]?.metadata as Record<string, unknown> | undefined;
    expect(meta?.['warnings']).toBeDefined();
  });

  it('PRD-303-R16: ActContractService.register outside scope routes via fallback sentinel into the draft', async () => {
    const walker: SsrWalker = async ({ collector: _collector }) => {
      // Simulate a registration that bypasses the active collector
      // (e.g., a service constructed before the bootstrap wired it).
      const orphan = new ActContractService(null);
      orphan.register(HeroComponent.act, { title: 't', subtitle: 's' });
      await Promise.resolve();
    };
    const drafts = await extractRoute(
      { routeId: 'orphan', module: PricingPage, pageContract: { ...pricingPage, id: 'orphan' } },
      walker,
    );
    expect(drafts[0]?.content[0]?.type).toBe('marketing:hero');
    const meta = drafts[0]?.metadata as Record<string, unknown> | undefined;
    expect(meta?.['warnings']).toBeDefined();
    expect(JSON.stringify(meta?.['warnings'])).toContain('PRD-303-R16');
  });

  it('PRD-303-R10: extractRoute is awaitable (returns Promise<NodeDraft[]>)', async () => {
    const walker = makeWalker(() => undefined);
    const result = extractRoute(
      { routeId: 'p', module: PricingPage, pageContract: { ...pricingPage, id: 'p' } },
      walker,
    );
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('PRD-303-R10: locale is forwarded into the walker context', async () => {
    let observedLocale: string | undefined;
    const walker: SsrWalker = async ({ context, collector: _collector }) => {
      observedLocale = context.locale;
      await Promise.resolve();
    };
    await extractRoute(
      { routeId: 'p', module: PricingPage, pageContract: { ...pricingPage, id: 'p' }, locale: 'fr-FR' },
      walker,
    );
    expect(observedLocale).toBe('fr-FR');
  });

  it('PRD-303-R13: variant key is forwarded into the walker context', async () => {
    const observed: Array<string | undefined> = [];
    const walker: SsrWalker = async ({ context, collector: _collector }) => {
      observed.push(context.variant);
      await Promise.resolve();
    };
    await extractRoute(
      {
        routeId: 'p',
        module: PricingPage,
        pageContract: { ...pricingPage, id: 'p', variants: ['v1', 'v2'] },
      },
      walker,
    );
    expect(observed).toEqual([undefined, 'v1', 'v2']);
  });
});

describe('PRD-303-R1 / R20 angularBinding object', () => {
  it('PRD-303-R1: name + contractVersion + capabilities present', () => {
    expect(angularBinding.name).toBe('@act-spec/component-angular');
    expect(angularBinding.contractVersion).toBe('0.1');
    expect(angularBinding.capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-303-R22: extractRoute via the framework input shape works', async () => {
    const walker = makeWalker((c) => {
      c.register(HeroComponent.act, { title: 't', subtitle: 's' });
    });
    const out = await angularBinding.extractRoute({
      routeId: 'pricing',
      module: {
        module: PricingPage as unknown as AngularComponentWithAct<unknown>,
        pageContract: pricingPage,
        walker,
      },
      routeProps: {},
      locale: undefined,
      variant: undefined,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('pricing');
  });

  it('PRD-303-R22: missing module.module is a BuildError', async () => {
    const walker = makeWalker(() => undefined);
    await expect(
      angularBinding.extractRoute({
        routeId: 'p',
        module: { pageContract: pricingPage, walker },
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R22: missing module.pageContract is a BuildError', async () => {
    const walker = makeWalker(() => undefined);
    await expect(
      angularBinding.extractRoute({
        routeId: 'p',
        module: { module: PricingPage, walker },
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R22: missing module.walker is a BuildError', async () => {
    await expect(
      angularBinding.extractRoute({
        routeId: 'p',
        module: { module: PricingPage, pageContract: pricingPage },
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R22: non-object module is a BuildError', async () => {
    await expect(
      angularBinding.extractRoute({
        routeId: 'p',
        module: null,
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R22: walker is required (typeof check)', async () => {
    await expect(
      angularBinding.extractRoute({
        routeId: 'p',
        module: { module: PricingPage, pageContract: pricingPage, walker: 'not-a-function' as unknown as SsrWalker },
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-303-R20: angularBinding satisfies the ActBinding interface', () => {
    const b: ActBinding = angularBinding;
    expect(b.capabilities).toBe(angularBinding.capabilities);
  });
});

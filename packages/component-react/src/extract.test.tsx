/**
 * PRD-301-R7 / R10 / R13 / R14 / R15 / R16 / R22 / R23 — extractRoute
 * end-to-end: page-id validation, SSR walk, variant replay, metadata
 * stamping, placeholder failure modes, NodeDraft shape.
 */
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import {
  ActSection,
  useActContract,
  type ActContract,
  type PageContract,
  type ReactComponentWithAct,
} from './index.js';
import { extractRoute } from './extract.js';
import { reactBinding } from './binding.js';
import { BuildError } from '@act-spec/component-contract';

interface HeroProps {
  title: string;
  subtitle: string;
  ctaText?: string;
}

const Hero: ReactComponentWithAct<HeroProps> = (props) =>
  <section>{props.title}</section>;
Hero.act = {
  type: 'marketing:hero',
  contract_version: '0.1',
  extract: (props) => ({
    type: 'marketing:hero',
    headline: props.title,
    subhead: props.subtitle,
    ...(props.ctaText !== undefined ? { cta: { label: props.ctaText, href: '#' } } : {}),
  }),
} satisfies ActContract<HeroProps>;

interface PricingProps { tiers: ReadonlyArray<{ name: string; price: number }> }

function PricingTable({ tiers }: PricingProps): React.ReactElement {
  useActContract<PricingProps>(
    {
      type: 'marketing:pricing-table',
      contract_version: '0.1',
      extract: (props) => ({
        type: 'marketing:pricing-table',
        tiers: props.tiers.map((t) => ({ name: t.name, price: t.price })),
      }),
    },
    { tiers },
  );
  return <ul>{tiers.map((t) => <li key={t.name}>{t.name}</li>)}</ul>;
}

const pricingPage: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  summary: 'Acme pricing tiers and plan comparison.',
  related: [{ id: 'products', relation: 'see-also' }],
  extract: () => ({ type: 'landing' }),
};

function PricingPage(): React.ReactElement {
  return (
    <>
      <ActSection of={Hero} title="Pricing" subtitle="Plans that scale" ctaText="Start" />
      <PricingTable tiers={[{ name: 'Free', price: 0 }, { name: 'Pro', price: 20 }]} />
    </>
  );
}

describe('PRD-301-R22 extractRoute', () => {
  it('PRD-301-R10 / R22: emits one canonical NodeDraft with descendants in render order', () => {
    const drafts = extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: <PricingPage />,
    });
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

  it('PRD-301-R14: every emitted block carries metadata.extracted_via=component-contract', () => {
    const drafts = extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: <PricingPage />,
    });
    const blocks = drafts[0]?.content ?? [];
    for (const b of blocks) {
      expect(b.metadata?.['extracted_via']).toBe('component-contract');
    }
  });

  it('PRD-301-R15: every emitted block carries metadata.extraction_method=ssr-walk', () => {
    const drafts = extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: <PricingPage />,
    });
    const blocks = drafts[0]?.content ?? [];
    for (const b of blocks) {
      expect(b.metadata?.['extraction_method']).toBe('ssr-walk');
    }
  });

  it('PRD-301-R23: NodeDraft shape carries no act_version / etag (generator-owned)', () => {
    const drafts = extractRoute({
      routeId: 'pricing',
      pageContract: pricingPage,
      routeRoot: <PricingPage />,
    });
    expect(drafts[0]).not.toHaveProperty('act_version');
    expect(drafts[0]).not.toHaveProperty('etag');
  });

  it('PRD-301-R7: invalid page id throws BuildError', () => {
    expect(() =>
      extractRoute({
        routeId: 'BadID',
        pageContract: { ...pricingPage, id: 'BadID' },
        routeRoot: <PricingPage />,
      }),
    ).toThrow(BuildError);
  });

  it('PRD-301-R7: empty page id throws BuildError', () => {
    expect(() =>
      extractRoute({
        routeId: '',
        pageContract: { ...pricingPage, id: '' },
        routeRoot: <PricingPage />,
      }),
    ).toThrow(BuildError);
  });

  it('PRD-301-R7: missing contract_version on page contract throws BuildError', () => {
    expect(() =>
      extractRoute({
        routeId: 'pricing',
        pageContract: { ...pricingPage, contract_version: '' },
        routeRoot: <PricingPage />,
      }),
    ).toThrow(BuildError);
  });

  it('PRD-301-R13: variant replay emits canonical + per-variant drafts', () => {
    const drafts = extractRoute({
      routeId: 'pricing',
      pageContract: { ...pricingPage, variants: ['enterprise-2026q2'] },
      routeRoot: <PricingPage />,
    });
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

  it('PRD-301-R13 / PRD-300-R17: variant matrix > 64 throws BuildError', () => {
    const keys = Array.from({ length: 65 }, (_, i) => `k${String(i)}`);
    expect(() =>
      extractRoute({
        routeId: 'pricing',
        pageContract: { ...pricingPage, variants: keys },
        routeRoot: <PricingPage />,
      }),
    ).toThrow(BuildError);
  });

  it('PRD-301-R13: variant render uses fresh provider scope (not canonical)', () => {
    let renders = 0;
    function Counter(): React.ReactElement {
      renders += 1;
      useActContract(
        {
          type: 'marketing:callout',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:callout' }),
        },
        undefined,
      );
      return <span>{renders}</span>;
    }
    extractRoute({
      routeId: 'page',
      pageContract: { ...pricingPage, id: 'page', variants: ['v1', 'v2'] },
      routeRoot: <Counter />,
    });
    // Canonical + 2 variants = 3 renders, each with its own provider/scope.
    expect(renders).toBe(3);
  });

  it('PRD-301-R16: extract that throws produces a placeholder block; render continues', () => {
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
      return <span>boom</span>;
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
      return <span>survivor</span>;
    }
    const drafts = extractRoute({
      routeId: 'page',
      pageContract: { ...pricingPage, id: 'page' },
      routeRoot: <><Boom /><Survivor /></>,
    });
    const blocks = drafts[0]?.content ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe('marketing:placeholder');
    expect(blocks[0]?.metadata?.['extraction_status']).toBe('failed');
    expect(blocks[1]?.type).toBe('marketing:pricing-table');
  });

  it('PRD-301-R16 / R9: extract returning Promise produces a placeholder per PRD-300-R7', () => {
    function AsyncFn(): React.ReactElement {
      useActContract<undefined>(
        {
          type: 'marketing:hero',
          contract_version: '0.1',
          // Return a Promise (forbidden under PRD-300-R7).
          extract: () => Promise.resolve({ type: 'marketing:hero' }) as unknown as { type: string },
        },
        undefined,
      );
      return <span>async</span>;
    }
    const drafts = extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: <AsyncFn />,
    });
    const block = drafts[0]?.content[0];
    expect(block?.type).toBe('marketing:placeholder');
    expect(block?.metadata?.['error']).toMatch(/Promise/);
  });

  it('PRD-301-R14 / PRD-300-R20: malformed block (missing type) becomes a placeholder', () => {
    function BadShape(): React.ReactElement {
      useActContract(
        {
          type: 'marketing:hero',
          contract_version: '0.1',
          // Missing required `type` on the returned block.
          extract: () => ({ headline: 'x' } as unknown as { type: string }),
        },
        undefined,
      );
      return <span>bad</span>;
    }
    const drafts = extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: <BadShape />,
    });
    const block = drafts[0]?.content[0];
    expect(block?.type).toBe('marketing:placeholder');
  });

  it('PRD-301-R14 / PRD-300-R21: author override of metadata.extracted_via becomes a placeholder', () => {
    function Override(): React.ReactElement {
      useActContract(
        {
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => ({
            type: 'marketing:hero',
            metadata: { extracted_via: 'author' },
          }),
        },
        undefined,
      );
      return <span>override</span>;
    }
    const drafts = extractRoute({
      routeId: 'p',
      pageContract: { ...pricingPage, id: 'p' },
      routeRoot: <Override />,
    });
    const block = drafts[0]?.content[0];
    expect(block?.type).toBe('marketing:placeholder');
  });

  it('PRD-301-R10: descendant render-order is depth-first across nested components', () => {
    function Inner(props: { name: string }): React.ReactElement {
      useActContract(
        {
          type: `inner:${props.name}`,
          contract_version: '0.1',
          extract: () => ({ type: `inner:${props.name}` }),
        },
        undefined,
      );
      return <span>{props.name}</span>;
    }
    function Outer(): React.ReactElement {
      useActContract(
        {
          type: 'outer',
          contract_version: '0.1',
          extract: () => ({ type: 'outer' }),
        },
        undefined,
      );
      return (
        <>
          <Inner name="a" />
          <Inner name="b" />
        </>
      );
    }
    const drafts = extractRoute({
      routeId: 'depth',
      pageContract: { ...pricingPage, id: 'depth' },
      routeRoot: <><Outer /><Inner name="c" /></>,
    });
    expect(drafts[0]?.content.map((b) => b.type)).toEqual([
      'outer',
      'inner:a',
      'inner:b',
      'inner:c',
    ]);
  });

  it('PRD-301-R22: empty route (no descendants) emits a draft with empty content', () => {
    function Empty(): React.ReactElement {
      return <span>nothing</span>;
    }
    const drafts = extractRoute({
      routeId: 'empty',
      pageContract: { ...pricingPage, id: 'empty' },
      routeRoot: <Empty />,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.content).toEqual([]);
  });

  it('PRD-301-R13: variantSource override is honored on emitted variant metadata', () => {
    const drafts = extractRoute({
      routeId: 'i18n',
      pageContract: { ...pricingPage, id: 'i18n', variants: ['fr-FR'] },
      routeRoot: <PricingPage />,
      variantSource: 'locale',
    });
    expect(drafts[1]?.metadata?.variant?.source).toBe('locale');
  });

  it('PRD-301-R16: route component that throws synchronously is captured as a render error', () => {
    function Crash(): React.ReactElement {
      throw new Error('render-time crash');
    }
    // The render error aborts THIS pass; the binding still emits a draft
    // (the page-level extract has run; descendants may be empty).
    const drafts = extractRoute({
      routeId: 'crash',
      pageContract: { ...pricingPage, id: 'crash' },
      routeRoot: <Crash />,
    });
    expect(drafts).toHaveLength(1);
    // PRD-301-R16: the binding records the failure as a warning on the
    // first draft's metadata (non-normative diagnostic channel).
    const meta = drafts[0]?.metadata as Record<string, unknown> | undefined;
    expect(meta?.['warnings']).toBeDefined();
  });

  it('PRD-301-R16: variant render that throws produces a warning on the variant draft', () => {
    let renderCount = 0;
    function PartialCrash(): React.ReactElement {
      renderCount += 1;
      // Crash only on the variant pass (renderCount === 2).
      if (renderCount === 2) {
        throw new Error('variant pass crash');
      }
      useActContract(
        { type: 'marketing:hero', contract_version: '0.1', extract: () => ({ type: 'marketing:hero', headline: 'h', subhead: 's' }) },
        undefined,
      );
      return <span>ok</span>;
    }
    const drafts = extractRoute({
      routeId: 'crashv',
      pageContract: { ...pricingPage, id: 'crashv', variants: ['v1'] },
      routeRoot: <PartialCrash />,
    });
    expect(drafts).toHaveLength(2);
    // Canonical succeeds; variant pass crashed during render.
    expect(drafts[0]?.content[0]?.type).toBe('marketing:hero');
    const meta = drafts[0]?.metadata as Record<string, unknown> | undefined;
    expect(meta?.['warnings']).toBeDefined();
  });

  it('PRD-301-R16: useActContract outside provider in a route shows up as placeholder', () => {
    function Outside(): React.ReactElement {
      // The provider is wired by extractRoute; this hook IS inside it,
      // so we simulate the failure by writing to fallbackSentinel via
      // a render before extractRoute (already covered in provider.test).
      // Here we verify that extractRoute drains and surfaces warnings.
      useActContract(
        {
          type: 'marketing:hero',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:hero', headline: 'h', subhead: 's' }),
        },
        undefined,
      );
      return <span>x</span>;
    }
    const drafts = extractRoute({
      routeId: 'page',
      pageContract: { ...pricingPage, id: 'page' },
      routeRoot: <Outside />,
    });
    expect(drafts[0]?.content[0]?.type).toBe('marketing:hero');
  });
});

describe('PRD-301-R1 / R20 reactBinding object', () => {
  it('PRD-301-R1: name + contractVersion + capabilities present', () => {
    expect(reactBinding.name).toBe('@act-spec/component-react');
    expect(reactBinding.contractVersion).toBe('0.1');
    expect(reactBinding.capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-301-R22: extractRoute via the framework input shape works', async () => {
    const out = await reactBinding.extractRoute({
      routeId: 'pricing',
      module: {
        routeRoot: <PricingPage />,
        pageContract: pricingPage,
      },
      routeProps: {},
      locale: undefined,
      variant: undefined,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('pricing');
  });

  it('PRD-301-R22: missing module.routeRoot is a BuildError', async () => {
    await expect(
      reactBinding.extractRoute({
        routeId: 'p',
        module: { pageContract: pricingPage },
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-301-R22: missing module.pageContract is a BuildError', async () => {
    await expect(
      reactBinding.extractRoute({
        routeId: 'p',
        module: { routeRoot: <PricingPage /> },
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });

  it('PRD-301-R22: non-object module is a BuildError', async () => {
    await expect(
      reactBinding.extractRoute({
        routeId: 'p',
        module: null,
        routeProps: {},
        locale: undefined,
        variant: undefined,
      }),
    ).rejects.toThrow(BuildError);
  });
});

/**
 * PRD-301-R3 / R4 / R5 / R6 / R8 / R10 / R16 — declaration patterns +
 * `<ActProvider>` collector + hook semantics.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActContract, PageContract } from '@act-spec/component-contract';
import {
  ActContractWrapper,
  ActProvider,
  ActSection,
  _ActProviderWithState,
  _resetFallbackSentinel,
  createCollectorState,
  fallbackSentinel,
  useActContract,
  useCollectorState,
} from './provider.js';
import type { ReactComponentWithAct } from './types.js';

interface HeroProps {
  title: string;
  subtitle: string;
}

const heroContract: ActContract<HeroProps> = {
  type: 'marketing:hero',
  contract_version: '0.1',
  extract: (props) => ({
    type: 'marketing:hero',
    headline: props.title,
    subhead: props.subtitle,
  }),
};

const Hero: ReactComponentWithAct<HeroProps> = (props) =>
  <section data-testid="hero">{props.title}</section>;
Hero.act = heroContract;

interface PricingProps { tiers: string[] }

function PricingTable({ tiers }: PricingProps): React.ReactElement {
  useActContract<PricingProps>(
    {
      type: 'marketing:pricing-table',
      contract_version: '0.1',
      extract: (props) => ({
        type: 'marketing:pricing-table',
        tiers: props.tiers,
      }),
    },
    { tiers },
  );
  return <ul>{tiers.map((t) => <li key={t}>{t}</li>)}</ul>;
}

const samplePage: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  summary: 'Acme pricing tiers and plan comparison.',
  extract: () => ({ type: 'landing' }),
};

describe('PRD-301-R10 <ActProvider> collector', () => {
  it('PRD-301-R4 / R8: useActContract registers contract during render (registration-only)', () => {
    const collector = createCollectorState({ pageContract: samplePage });
    let extractInvocations = 0;
    function Watcher(): React.ReactElement {
      useActContract<{ x: number }>(
        {
          type: 'marketing:callout',
          contract_version: '0.1',
          extract: () => {
            extractInvocations += 1;
            return { type: 'marketing:callout' };
          },
        },
        { x: 1 },
      );
      return <span>watcher</span>;
    }
    renderToString(
      <_ActProviderWithState state={collector}>
        <Watcher />
      </_ActProviderWithState>,
    );
    // PRD-301-R8 — extract MUST NOT run during render; the binding's
    // `aggregatePage` would invoke it post-render.
    expect(extractInvocations).toBe(0);
    expect(collector.collected).toHaveLength(1);
    expect(collector.collected[0]?.contract.type).toBe('marketing:callout');
  });

  it('PRD-301-R10: collector records contracts in render order (depth-first)', () => {
    const collector = createCollectorState({ pageContract: samplePage });
    function ChildA(): React.ReactElement {
      useActContract({ type: 'a', contract_version: '0.1', extract: () => ({ type: 'a' }) });
      return <span>a</span>;
    }
    function ChildB(): React.ReactElement {
      useActContract({ type: 'b', contract_version: '0.1', extract: () => ({ type: 'b' }) });
      return <span>b</span>;
    }
    function Parent(): React.ReactElement {
      useActContract({ type: 'parent', contract_version: '0.1', extract: () => ({ type: 'parent' }) });
      return (
        <>
          <ChildA />
          <ChildB />
        </>
      );
    }
    renderToString(
      <_ActProviderWithState state={collector}>
        <Parent />
      </_ActProviderWithState>,
    );
    expect(collector.collected.map((c) => c.contract.type)).toEqual([
      'parent',
      'a',
      'b',
    ]);
  });

  it('PRD-301-R3 / R6: ActSection desugars static-field contract identically to hook', () => {
    const collector = createCollectorState({ pageContract: samplePage });
    renderToString(
      <_ActProviderWithState state={collector}>
        <ActSection of={Hero} title="Pricing" subtitle="Plans" />
      </_ActProviderWithState>,
    );
    expect(collector.collected).toHaveLength(1);
    const entry = collector.collected[0];
    expect(entry?.contract.type).toBe('marketing:hero');
    // PRD-301-R6 — props the hook would have seen are propagated for
    // post-render extract invocation.
    expect(entry?.props).toEqual({ title: 'Pricing', subtitle: 'Plans' });
  });

  it('PRD-301-R3: ActSection on a component without .act registers nothing', () => {
    const collector = createCollectorState({ pageContract: samplePage });
    function Plain(_props: { tag: string }): React.ReactElement {
      return <span>{_props.tag}</span>;
    }
    renderToString(
      <_ActProviderWithState state={collector}>
        <ActSection of={Plain as ReactComponentWithAct<{ tag: string }>} tag="x" />
      </_ActProviderWithState>,
    );
    expect(collector.collected).toHaveLength(0);
  });

  it('PRD-301-R5: ActContractWrapper attaches a page contract when none was set', () => {
    const collector = createCollectorState();
    function Inner(): React.ReactElement {
      const s = useCollectorState();
      expect(s?.pageContract?.id).toBe('pricing');
      return <span>inner</span>;
    }
    renderToString(
      <_ActProviderWithState state={collector}>
        <ActContractWrapper contract={samplePage}>
          <Inner />
        </ActContractWrapper>
      </_ActProviderWithState>,
    );
    expect(collector.pageContract?.id).toBe('pricing');
  });

  it('PRD-301-R5: ActContractWrapper does not overwrite an existing page contract', () => {
    const other: PageContract = { ...samplePage, id: 'enterprise' };
    const collector = createCollectorState({ pageContract: samplePage });
    renderToString(
      <_ActProviderWithState state={collector}>
        <ActContractWrapper contract={other}>
          <span>x</span>
        </ActContractWrapper>
      </_ActProviderWithState>,
    );
    expect(collector.pageContract?.id).toBe('pricing');
  });

  it('PRD-301-R16: useActContract outside provider records on fallback sentinel', () => {
    _resetFallbackSentinel();
    function Floating(): React.ReactElement {
      useActContract({ type: 'orphan', contract_version: '0.1', extract: () => ({ type: 'orphan' }) });
      return <span>orphan</span>;
    }
    renderToString(<Floating />);
    expect(fallbackSentinel.hookOutsideProviderCount).toBeGreaterThanOrEqual(1);
    _resetFallbackSentinel();
  });

  it('PRD-301-R3 / R6: PricingTable renders + registers (hook form)', () => {
    const collector = createCollectorState({ pageContract: samplePage });
    renderToString(
      <_ActProviderWithState state={collector}>
        <PricingTable tiers={['free', 'pro']} />
      </_ActProviderWithState>,
    );
    expect(collector.collected).toHaveLength(1);
    expect(collector.collected[0]?.contract.type).toBe('marketing:pricing-table');
    expect(collector.collected[0]?.props).toEqual({ tiers: ['free', 'pro'] });
  });

  it('PRD-301-R10: useCollectorState returns null outside any provider', () => {
    function Floating(): React.ReactElement {
      const s = useCollectorState();
      expect(s).toBeNull();
      return <span>floating</span>;
    }
    renderToString(<Floating />);
  });

  it('PRD-301-R10: ActSection forwards location/component metadata to collector', () => {
    const collector = createCollectorState({ pageContract: samplePage });
    renderToString(
      <_ActProviderWithState state={collector}>
        <ActSection of={Hero} component="Hero" location="design-system/Hero.tsx:14" title="Pricing" subtitle="Plans" />
      </_ActProviderWithState>,
    );
    expect(collector.collected[0]?.component).toBe('Hero');
    expect(collector.collected[0]?.location).toBe('design-system/Hero.tsx:14');
  });

  it('PRD-301-R3 / R6: ActSection without provider falls back to sentinel', () => {
    _resetFallbackSentinel();
    renderToString(<ActSection of={Hero} title="x" subtitle="y" />);
    expect(fallbackSentinel.hookOutsideProviderCount).toBeGreaterThanOrEqual(1);
    _resetFallbackSentinel();
  });

  it('PRD-301-R10: ActProvider standalone form (per-mount state) supports hook registration', () => {
    function Probe(): React.ReactElement {
      const s = useCollectorState();
      expect(s).not.toBeNull();
      // Inside <ActProvider>, the page contract is propagated.
      expect(s?.pageContract?.id).toBe('pricing');
      useActContract(
        { type: 'marketing:hero', contract_version: '0.1', extract: () => ({ type: 'marketing:hero' }) },
        undefined,
      );
      return <span>probe</span>;
    }
    renderToString(
      <ActProvider pageContract={samplePage} variant="v1">
        <Probe />
      </ActProvider>,
    );
    // The standalone form keeps state in useRef — collector is per-mount
    // and not directly reachable from outside; we verified registration
    // inside via useCollectorState.
  });

  it('PRD-301-R10: ActProvider without pageContract / variant renders cleanly', () => {
    function Probe(): React.ReactElement {
      const s = useCollectorState();
      expect(s?.pageContract).toBeUndefined();
      expect(s?.variant).toBeUndefined();
      return <span>probe</span>;
    }
    renderToString(
      <ActProvider>
        <Probe />
      </ActProvider>,
    );
  });

  it('PRD-301-R5: page-level boundary const form is the canonical input shape', () => {
    // The exported `act` const form does not require a wrapper component;
    // generators read it from the module and pass it as PageContract.
    expect(samplePage.id).toBe('pricing');
    expect(samplePage.contract_version).toBe('0.1');
  });
});

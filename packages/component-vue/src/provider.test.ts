/**
 * PRD-302-R4 / R8 / R10 / R16 — provider + composable unit tests.
 *
 * Tests independent of the SSR-walk path. The provider state machine
 * (collector creation, dedupe by instance.uid, fallback sentinel) is
 * exercised here without `renderToString` so failures are easier to
 * localize.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  COLLECTOR_KEY,
  _resetFallbackSentinel,
  createCollectorState,
  fallbackSentinel,
  installActProvider,
  provideCollectorState,
  useActContract,
  useActStatic,
  type CollectorState,
} from './provider.js';
import type { ActContract, PageContract } from '@act-spec/component-contract';
import type { VueComponentWithAct } from './types.js';

afterEach(() => {
  _resetFallbackSentinel();
});

describe('PRD-302-R10 createCollectorState', () => {
  it('PRD-302-R10: empty state has empty collected array and zero error counters', () => {
    const s = createCollectorState();
    expect(s.collected).toEqual([]);
    expect(s.errors).toEqual([]);
    expect(s.composableOutsideProviderCount).toBe(0);
    expect(s.seenUids.size).toBe(0);
  });

  it('PRD-302-R10: state carries pageContract + variant when supplied', () => {
    const page: PageContract = {
      type: 'landing',
      id: 'p',
      contract_version: '0.1',
      extract: () => ({ type: 'landing' }),
    };
    const s = createCollectorState({ pageContract: page, variant: 'fr-FR' });
    expect(s.pageContract).toBe(page);
    expect(s.variant).toBe('fr-FR');
  });
});

describe('PRD-302-R10 installActProvider', () => {
  it('PRD-302-R10: provides the collector under COLLECTOR_KEY', async () => {
    const collector = createCollectorState();
    const Probe = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:probe',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:probe' }),
        });
        return (): unknown => h('span');
      },
    });
    const app = createSSRApp(Probe);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.collected).toHaveLength(1);
    expect(collector.collected[0]?.contract.type).toBe('marketing:probe');
  });

  it('PRD-302-R16: installs app.config.errorHandler that captures setup throws', async () => {
    const collector = createCollectorState();
    const Boom = defineComponent({
      name: 'Boom',
      setup() {
        throw new Error('setup blew up');
      },
    });
    const app = createSSRApp(Boom);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.errors.length).toBeGreaterThan(0);
    expect(collector.errors[0]?.error.message).toContain('setup blew up');
  });

  it('PRD-302-R16: errorHandler captures component name when available', async () => {
    const collector = createCollectorState();
    const NamedBoom = defineComponent({
      name: 'NamedBoom',
      setup() {
        throw new Error('boom');
      },
    });
    const app = createSSRApp(NamedBoom);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.errors[0]?.component).toBe('NamedBoom');
  });
});

describe('PRD-302-R8 useActContract dedupe by instance uid', () => {
  it('PRD-302-R8: composable called twice in the same setup() registers once', async () => {
    const collector = createCollectorState();
    const contract: ActContract = {
      type: 'marketing:dup',
      contract_version: '0.1',
      extract: () => ({ type: 'marketing:dup' }),
    };
    const Twice = defineComponent({
      setup() {
        useActContract(contract);
        useActContract(contract);
        return (): unknown => h('span');
      },
    });
    const app = createSSRApp(Twice);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.collected).toHaveLength(1);
  });

  it('PRD-302-R8: each component instance gets its own registration', async () => {
    const collector = createCollectorState();
    const Leaf = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:leaf',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:leaf' }),
        });
        return (): unknown => h('span');
      },
    });
    const Root = defineComponent({
      setup() { return (): unknown => h('div', null, [h(Leaf), h(Leaf), h(Leaf)]); },
    });
    const app = createSSRApp(Root);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.collected).toHaveLength(3);
  });
});

describe('PRD-302-R16 fallback sentinel (composable outside provider)', () => {
  it('PRD-302-R16: composable outside provider bumps fallback sentinel and does not throw', async () => {
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
    expect(fallbackSentinel.composableOutsideProviderCount).toBeGreaterThan(0);
    expect(fallbackSentinel.collected.length).toBeGreaterThan(0);
  });

  it('PRD-302-R16: _resetFallbackSentinel clears state', () => {
    fallbackSentinel.collected.push({
      contract: { type: 'x', contract_version: '0.1', extract: () => ({ type: 'x' }) },
      props: undefined,
    });
    fallbackSentinel.composableOutsideProviderCount = 5;
    fallbackSentinel.errors.push({ error: new Error('e') });
    _resetFallbackSentinel();
    expect(fallbackSentinel.collected).toEqual([]);
    expect(fallbackSentinel.composableOutsideProviderCount).toBe(0);
    expect(fallbackSentinel.errors).toEqual([]);
  });
});

describe('PRD-302-R3 useActStatic (static-field declaration helper)', () => {
  it('PRD-302-R3: registers Component.act under the surrounding collector', async () => {
    interface P { name: string }
    const Comp: VueComponentWithAct<P> = defineComponent({
      name: 'Comp',
      props: { name: { type: String, required: true } },
      setup(props) {
        useActStatic(Comp, props as P);
        return (): unknown => h('span', null, props.name);
      },
    });
    Comp.act = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: (props) => ({ type: 'marketing:hero', headline: props.name }),
    } satisfies ActContract<P>;

    const collector = createCollectorState();
    const Route = defineComponent({
      setup() { return (): unknown => h(Comp, { name: 'A' }); },
    });
    const app = createSSRApp(Route);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.collected).toHaveLength(1);
    expect(collector.collected[0]?.contract.type).toBe('marketing:hero');
  });

  it('PRD-302-R3: useActStatic on a component without Component.act is a no-op', async () => {
    const Comp = defineComponent({
      name: 'Bare',
      setup() {
        useActStatic(Comp);
        return (): unknown => h('span');
      },
    });
    const collector = createCollectorState();
    const app = createSSRApp(Comp);
    installActProvider(app, { collector });
    await renderToString(app);
    expect(collector.collected).toHaveLength(0);
  });

  it('PRD-302-R3 + R16: useActStatic outside provider routes to fallback sentinel', async () => {
    _resetFallbackSentinel();
    interface P { name: string }
    const Comp: VueComponentWithAct<P> = defineComponent({
      name: 'Comp',
      props: { name: { type: String, required: true } },
      setup(props) {
        useActStatic(Comp, props as P);
        return (): unknown => h('span');
      },
    });
    Comp.act = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: (props) => ({ type: 'marketing:hero', headline: props.name }),
    } satisfies ActContract<P>;
    const app = createSSRApp(Comp, { name: 'a' });
    await renderToString(app);
    expect(fallbackSentinel.composableOutsideProviderCount).toBeGreaterThan(0);
    _resetFallbackSentinel();
  });
});

describe('PRD-302-R10 provideCollectorState (manual provide helper)', () => {
  it('PRD-302-R10: provideCollectorState scopes a child collector inside a setup()', async () => {
    const child: CollectorState = createCollectorState();
    const Inner = defineComponent({
      setup() {
        useActContract({
          type: 'marketing:inner',
          contract_version: '0.1',
          extract: () => ({ type: 'marketing:inner' }),
        });
        return (): unknown => h('span');
      },
    });
    const Wrapper = defineComponent({
      setup() {
        provideCollectorState(child);
        return (): unknown => h(Inner);
      },
    });
    const app = createSSRApp(Wrapper);
    // No outer installActProvider — the wrapper provides the collector.
    await renderToString(app);
    expect(child.collected).toHaveLength(1);
  });
});

describe('PRD-302-R10 COLLECTOR_KEY identity', () => {
  it('PRD-302-R10: key is a Symbol.for so identical across module instances', () => {
    expect(typeof COLLECTOR_KEY).toBe('symbol');
    expect(COLLECTOR_KEY).toBe(Symbol.for('@act-spec/component-vue/collector'));
  });
});

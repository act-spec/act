/**
 * PRD-303-R4 / R5 / R7 / R8 / R10 / R11 / R16 — collector + service +
 * directive lifecycle.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ActCollectorService,
  ActContractService,
  _resetFallbackSentinel,
  applyActSection,
  assertCollectorScopeIsComponentLocal,
  fallbackSentinel,
} from './collector.js';
import { AngularBindingError } from './errors.js';
import type { ActContract, PageContract } from '@act-spec/component-contract';

const heroContract: ActContract<{ title: string }> = {
  type: 'marketing:hero',
  contract_version: '0.1',
  extract: (props) => ({ type: 'marketing:hero', headline: props.title }),
};

const pricingContract: ActContract<{ tiers: string[] }> = {
  type: 'marketing:pricing-table',
  contract_version: '0.1',
  extract: (props) => ({ type: 'marketing:pricing-table', tiers: props.tiers }),
};

const samplePage: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  extract: () => ({ type: 'landing' }),
};

beforeEach(() => {
  _resetFallbackSentinel();
});

describe('PRD-303-R10 ActCollectorService.register', () => {
  it('PRD-303-R10: records contracts in render order', () => {
    const c = new ActCollectorService();
    c.register(heroContract, { title: 'A' });
    c.register(pricingContract, { tiers: ['x'] });
    expect(c.collected.map((e) => e.contract.type)).toEqual([
      'marketing:hero',
      'marketing:pricing-table',
    ]);
  });

  it('PRD-303-R8: dedupes by instance handle (last-wins)', () => {
    const c = new ActCollectorService();
    const inst = {};
    c.register(heroContract, { title: 'first' }, { instance: inst });
    c.register(heroContract, { title: 'second' }, { instance: inst });
    expect(c.collected).toHaveLength(1);
    expect((c.collected[0]?.props as { title: string }).title).toBe('second');
  });

  it('PRD-303-R10: distinct instances are NOT deduped', () => {
    const c = new ActCollectorService();
    c.register(heroContract, { title: 'a' }, { instance: {} });
    c.register(heroContract, { title: 'b' }, { instance: {} });
    expect(c.collected).toHaveLength(2);
  });

  it('PRD-303-R10: registrations without instance handle are NOT deduped (e.g., directive form)', () => {
    const c = new ActCollectorService();
    c.register(heroContract, { title: 'a' });
    c.register(heroContract, { title: 'a' });
    expect(c.collected).toHaveLength(2);
  });

  it('PRD-303-R16: forwards optional component + location for placeholder metadata', () => {
    const c = new ActCollectorService();
    c.register(heroContract, { title: 'x' }, {
      component: 'HeroComponent',
      location: 'design-system/hero.component.ts:14',
    });
    expect(c.collected[0]?.component).toBe('HeroComponent');
    expect(c.collected[0]?.location).toBe('design-system/hero.component.ts:14');
  });

  it('PRD-303-R8 dedupe preserves component / location metadata when re-registering', () => {
    const c = new ActCollectorService();
    const inst = {};
    c.register(heroContract, { title: 'a' }, { instance: inst });
    c.register(heroContract, { title: 'b' }, {
      instance: inst,
      component: 'Hero',
      location: 'a.ts:1',
    });
    expect(c.collected).toHaveLength(1);
    expect(c.collected[0]?.component).toBe('Hero');
    expect(c.collected[0]?.location).toBe('a.ts:1');
  });
});

describe('PRD-303-R5 / R11 ActCollectorService.setPageContract', () => {
  it('PRD-303-R5: stores the page contract on the collector', () => {
    const c = new ActCollectorService();
    c.setPageContract(samplePage);
    expect(c.pageContract?.id).toBe('pricing');
  });

  it('PRD-303-R11 / PRD-300-R13: nested page contract throws AngularBindingError', () => {
    const c = new ActCollectorService();
    c.setPageContract(samplePage);
    expect(() => c.setPageContract({ ...samplePage, id: 'inner' })).toThrow(
      AngularBindingError,
    );
  });

  it('PRD-303-R11: nested-contract error message cites both page ids', () => {
    const c = new ActCollectorService();
    c.setPageContract(samplePage);
    try {
      c.setPageContract({ ...samplePage, id: 'inner' });
    } catch (e) {
      expect((e as Error).message).toContain('inner');
      expect((e as Error).message).toContain('pricing');
      expect((e as Error).message).toContain('PRD-303-R11');
    }
  });
});

describe('PRD-303-R16 ActCollectorService.recordError', () => {
  it('PRD-303-R16: captures Error instances verbatim', () => {
    const c = new ActCollectorService();
    const e = new Error('boom');
    c.recordError(e);
    expect(c.renderErrors[0]?.error).toBe(e);
  });

  it('PRD-303-R16: wraps non-Error throws into Error instances', () => {
    const c = new ActCollectorService();
    c.recordError('string error');
    expect(c.renderErrors[0]?.error).toBeInstanceOf(Error);
    expect(c.renderErrors[0]?.error.message).toBe('string error');
  });

  it('PRD-303-R16: forwards optional component + location for placeholder metadata', () => {
    const c = new ActCollectorService();
    c.recordError(new Error('x'), 'HeroComponent', 'a.ts:1');
    expect(c.renderErrors[0]?.component).toBe('HeroComponent');
    expect(c.renderErrors[0]?.location).toBe('a.ts:1');
  });
});

describe('PRD-303-R4 ActContractService.register', () => {
  it('PRD-303-R4: forwards registrations to the underlying collector', () => {
    const c = new ActCollectorService();
    const svc = new ActContractService(c);
    svc.register(heroContract, { title: 'A' });
    expect(c.collected.map((e) => e.contract.type)).toEqual(['marketing:hero']);
  });

  it('PRD-303-R8: forwards instance handle for dedupe', () => {
    const c = new ActCollectorService();
    const svc = new ActContractService(c);
    const inst = {};
    svc.register(heroContract, { title: 'a' }, { instance: inst });
    svc.register(heroContract, { title: 'b' }, { instance: inst });
    expect(c.collected).toHaveLength(1);
  });

  it('PRD-303-R16: registration outside an installed collector scope routes to fallback sentinel', () => {
    const svc = new ActContractService(null);
    svc.register(heroContract, { title: 'A' });
    expect(fallbackSentinel.outsideScopeCount).toBe(1);
    expect(fallbackSentinel.collected).toHaveLength(1);
  });

  it('PRD-303-R16: the fallback sentinel does NOT throw (render must continue)', () => {
    const svc = new ActContractService(null);
    expect(() => svc.register(heroContract, { title: 'x' })).not.toThrow();
  });
});

describe('PRD-303-R5 / R16 applyActSection', () => {
  it('PRD-303-R5: registers the page contract on the collector', () => {
    const c = new ActCollectorService();
    applyActSection(c, samplePage);
    expect(c.pageContract?.id).toBe('pricing');
  });

  it('PRD-303-R11: nested page registration throws via collector', () => {
    const c = new ActCollectorService();
    applyActSection(c, samplePage);
    expect(() => applyActSection(c, { ...samplePage, id: 'inner' })).toThrow(
      AngularBindingError,
    );
  });

  it('PRD-303-R16: directive used outside collector scope routes to sentinel (no throw)', () => {
    expect(() => applyActSection(null, samplePage)).not.toThrow();
    expect(fallbackSentinel.outsideScopeCount).toBe(1);
  });
});

describe('PRD-303-R7 assertCollectorScopeIsComponentLocal', () => {
  it('PRD-303-R7: accepts component-level scope', () => {
    expect(() => assertCollectorScopeIsComponentLocal('component')).not.toThrow();
  });

  it('PRD-303-R7: throws AngularBindingError on root-level scope', () => {
    expect(() => assertCollectorScopeIsComponentLocal('root')).toThrow(AngularBindingError);
  });

  it('PRD-303-R7: error cites the per-render-state-leak rationale', () => {
    try {
      assertCollectorScopeIsComponentLocal('root');
    } catch (e) {
      expect((e as Error).message).toContain('PRD-303-R7');
      expect((e as Error).message).toContain('root');
    }
  });
});

describe('PRD-303-R16 fallbackSentinel reset', () => {
  it('_resetFallbackSentinel clears outsideScopeCount + collected', () => {
    const svc = new ActContractService(null);
    svc.register(heroContract, { title: 'x' });
    expect(fallbackSentinel.outsideScopeCount).toBe(1);
    _resetFallbackSentinel();
    expect(fallbackSentinel.outsideScopeCount).toBe(0);
    expect(fallbackSentinel.collected).toHaveLength(0);
  });
});

/**
 * PRD-303-R5 / R6 / R11 — `*actSection` + `<act-section>` lifecycle.
 */
import { describe, expect, it } from 'vitest';
import { ActSectionComponent, ActSectionDirective } from './act-section.js';
import { ActCollectorService, _resetFallbackSentinel, fallbackSentinel } from './collector.js';
import { AngularBindingError } from './errors.js';
import type { PageContract } from '@act-spec/component-contract';

const samplePage: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  summary: 'Acme pricing tiers and plan comparison.',
  extract: () => ({ type: 'landing' }),
};

describe('PRD-303-R5 ActSectionDirective', () => {
  it('PRD-303-R5: ngOnInit registers the bound contract on the collector', () => {
    const c = new ActCollectorService();
    const d = new ActSectionDirective(c);
    d.contract = samplePage;
    d.ngOnInit();
    expect(c.pageContract?.id).toBe('pricing');
  });

  it('PRD-303-R11: ngOnInit on a nested directive throws AngularBindingError', () => {
    const c = new ActCollectorService();
    c.setPageContract(samplePage);
    const d = new ActSectionDirective(c);
    d.contract = { ...samplePage, id: 'inner' };
    expect(() => d.ngOnInit()).toThrow(AngularBindingError);
  });

  it('PRD-303-R16: directive used outside an installed collector scope routes to sentinel (no throw)', () => {
    _resetFallbackSentinel();
    const d = new ActSectionDirective(null);
    d.contract = samplePage;
    expect(() => d.ngOnInit()).not.toThrow();
    expect(fallbackSentinel.outsideScopeCount).toBe(1);
    _resetFallbackSentinel();
  });
});

describe('PRD-303-R5 ActSectionComponent', () => {
  it('PRD-303-R5: ngOnInit registers the bound contract on the collector', () => {
    const c = new ActCollectorService();
    const cmp = new ActSectionComponent(c);
    cmp.contract = samplePage;
    cmp.ngOnInit();
    expect(c.pageContract?.id).toBe('pricing');
  });

  it('PRD-303-R6: directive form and component form produce identical collector state', () => {
    const c1 = new ActCollectorService();
    const d = new ActSectionDirective(c1);
    d.contract = samplePage;
    d.ngOnInit();

    const c2 = new ActCollectorService();
    const cmp = new ActSectionComponent(c2);
    cmp.contract = samplePage;
    cmp.ngOnInit();

    expect(c1.pageContract).toEqual(c2.pageContract);
  });

  it('PRD-303-R11: ngOnInit on a nested component-form throws AngularBindingError', () => {
    const c = new ActCollectorService();
    c.setPageContract(samplePage);
    const cmp = new ActSectionComponent(c);
    cmp.contract = { ...samplePage, id: 'inner' };
    expect(() => cmp.ngOnInit()).toThrow(AngularBindingError);
  });

  it('PRD-303-R16: component used outside an installed collector scope routes to sentinel', () => {
    _resetFallbackSentinel();
    const cmp = new ActSectionComponent(null);
    cmp.contract = samplePage;
    expect(() => cmp.ngOnInit()).not.toThrow();
    expect(fallbackSentinel.outsideScopeCount).toBe(1);
    _resetFallbackSentinel();
  });
});

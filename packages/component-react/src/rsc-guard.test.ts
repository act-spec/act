/**
 * PRD-301-R12 — React Server Components walk rule.
 */
import { describe, expect, it } from 'vitest';
import { BuildError } from '@act-spec/component-contract';
import { assertHookNotInServerComponent } from './rsc-guard.js';

describe('PRD-301-R12 RSC server-tree walk rule', () => {
  it('PRD-301-R12: throws BuildError when useActContract is in a server component', () => {
    expect(() =>
      assertHookNotInServerComponent({
        modulePath: 'app/pricing/PricingTable.tsx',
        isClient: false,
        usesActContractHook: true,
      }),
    ).toThrow(BuildError);
    expect(() =>
      assertHookNotInServerComponent({
        modulePath: 'app/pricing/PricingTable.tsx',
        isClient: false,
        usesActContractHook: true,
      }),
    ).toThrow(/PRD-300-R30|server component/);
  });

  it('PRD-301-R12: accepts useActContract in a client component', () => {
    expect(() =>
      assertHookNotInServerComponent({
        modulePath: 'app/pricing/PricingTable.tsx',
        isClient: true,
        usesActContractHook: true,
      }),
    ).not.toThrow();
  });

  it('PRD-301-R12: accepts a server component that does not call useActContract', () => {
    expect(() =>
      assertHookNotInServerComponent({
        modulePath: 'app/pricing/page.tsx',
        isClient: false,
        usesActContractHook: false,
      }),
    ).not.toThrow();
  });

  it('PRD-301-R12: accepts a client component without the hook (static-field path)', () => {
    expect(() =>
      assertHookNotInServerComponent({
        modulePath: 'app/Hero.tsx',
        isClient: true,
        usesActContractHook: false,
      }),
    ).not.toThrow();
  });
});

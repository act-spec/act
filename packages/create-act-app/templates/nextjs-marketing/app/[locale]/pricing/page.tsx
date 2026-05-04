/**
 * PRD-702-R6 — page-level boundary contract (App Router, const form).
 * The `act` const is what `readPageActExport` (PRD-405-R8) reads at
 * build time; `withAct`'s post-build hook combines this with the React
 * binding's SSR walk to extract `marketing:*` blocks.
 */
import * as React from 'react';
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '../../../components/act-section';
import { Hero, PricingTable, FAQAccordion, CTA } from '../../../components/design-system';

export const act: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  extract: () => ({ type: 'landing' }),
  related: [
    { id: 'features', relation: 'see-also' },
    { id: 'contact', relation: 'see-also' },
  ],
};

export default function PricingPage(): React.ReactElement {
  return (
    <>
      <ActSection
        of={Hero}
        headline="Simple, transparent pricing"
        subhead="No hidden fees. Cancel anytime."
        cta={{ text: 'Start free trial', to: '/signup' }}
      />
      <ActSection
        of={PricingTable}
        tiers={[
          { name: 'Starter', price: '$9/mo', features: ['1 user', '10GB'] },
          { name: 'Pro', price: '$29/mo', features: ['10 users', '1TB'] },
          { name: 'Enterprise', price: 'Contact us', features: ['Unlimited'] },
        ]}
        highlighted="Pro"
      />
      <ActSection
        of={FAQAccordion}
        items={[
          { q: 'Can I change plans?', a: 'You can change plans anytime.' },
          { q: 'Is there a free trial?', a: 'Yes, 14 days, no credit card.' },
        ]}
      />
      <ActSection
        of={CTA}
        headline="Ready to get started?"
        actions={[
          { text: 'Start free trial', to: '/signup' },
          { text: 'Talk to sales', to: '/contact' },
        ]}
      />
    </>
  );
}

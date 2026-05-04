/** PRD-702-R6 — page-level boundary (illustrative). See pricing/page.tsx. */
import * as React from 'react';
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '../../../components/act-section';
import { Hero, CTA } from '../../../components/design-system';

export const act: PageContract = {
  type: 'landing',
  id: 'contact',
  contract_version: '0.1',
  extract: () => ({ type: 'landing' }),
};

export default function ContactPage(): React.ReactElement {
  return (
    <>
      <ActSection of={Hero} headline="Get in touch" subhead="Talk to sales, support, or community." />
      <ActSection of={CTA} headline="Talk to sales" actions={[{ text: 'Open ticket', to: '/support' }]} />
    </>
  );
}

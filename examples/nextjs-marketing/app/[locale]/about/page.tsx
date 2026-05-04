/** PRD-702-R6 — page-level boundary (illustrative). See pricing/page.tsx. */
import * as React from 'react';
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '../../../components/act-section';
import { Hero, Testimonial } from '../../../components/design-system';

export const act: PageContract = {
  type: 'landing',
  id: 'about',
  contract_version: '0.1',
  extract: () => ({ type: 'landing' }),
};

export default function AboutPage(): React.ReactElement {
  return (
    <>
      <ActSection of={Hero} headline="About Acme" subhead="We make agent-content interchange a default." />
      <ActSection of={Testimonial} quote="ACT is the simplest path I have seen to a portable content tree." author="A. N. Author" role="CTO" />
    </>
  );
}

/** PRD-702-R6 — page-level boundary (illustrative). See pricing/page.tsx. */
import * as React from 'react';
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '../../../components/act-section';
import { Hero } from '../../../components/design-system';

export const act: PageContract = {
  type: 'page',
  id: 'dpa',
  contract_version: '0.1',
  extract: () => ({ type: 'page' }),
};

export default function DpaPage(): React.ReactElement {
  return (
    <ActSection of={Hero} headline="Data Processing Addendum" subhead="For enterprise customers." />
  );
}

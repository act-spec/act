/** PRD-702-R6 — page-level boundary (illustrative). See pricing/page.tsx. */
import * as React from 'react';
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '../../../components/act-section';
import { Hero } from '../../../components/design-system';

export const act: PageContract = {
  type: 'page',
  id: 'privacy',
  contract_version: '0.1',
  extract: () => ({ type: 'page' }),
};

export default function PrivacyPage(): React.ReactElement {
  return (
    <ActSection of={Hero} headline="Privacy Policy" subhead="How Acme handles personal data." />
  );
}

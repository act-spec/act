/**
 * PRD-702-R6 — page-level boundary contract (App Router, const form).
 * Illustrative; the actual extraction at build time happens inside
 * `scripts/build.ts` against a `React.createElement` tree mirroring
 * this file's JSX (the workspace does not pin the full Next.js CLI).
 */
import * as React from 'react';
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '../../../components/act-section';
import { Hero, FeatureGrid, CTA } from '../../../components/design-system';

export const act: PageContract = {
  type: 'landing',
  id: 'features',
  contract_version: '0.1',
  extract: () => ({ type: 'landing' }),
};

export default function FeaturesPage(): React.ReactElement {
  return (
    <>
      <ActSection of={Hero} headline="Everything you need" subhead="A spec, adapters, generators, and runtime SDKs." />
      <ActSection
        of={FeatureGrid}
        features={[
          { title: 'Source adapters', description: 'Markdown, Contentful, Sanity, i18n…' },
          { title: 'Generators', description: 'Astro, Next.js, Eleventy, Docusaurus…' },
          { title: 'Runtime SDKs', description: 'Express, Fastify, Next.js (runtime)…' },
          { title: 'Validator', description: 'Conformance reporter with gap detection.' },
        ]}
      />
      <ActSection of={CTA} headline="Browse all packages" actions={[{ text: 'View on npm', to: 'https://npmjs.com' }]} />
    </>
  );
}

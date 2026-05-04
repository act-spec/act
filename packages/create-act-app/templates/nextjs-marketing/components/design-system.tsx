/**
 * PRD-702-R5 — Acme design-system components instrumented with the
 * `@act-spec/component-react` static-field declaration pattern
 * (PRD-301-R3). Each component's `act.extract` returns a single canonical
 * `marketing:*` block (PRD-102-R6 through PRD-102-R11). The PRD-702
 * example MUST NOT ship any component whose `extract` produces
 * placeholders under conformant inputs (PRD-301-R14 / R16); the components
 * here therefore populate every required field of their target block
 * shape.
 *
 * Authors call them via the canonical `<ActSection of={Hero} {...props} />`
 * desugaring (PRD-301-R6 third form) — see app/[locale]/<route>/page.tsx.
 * The `Hero` (etc.) function components are also valid React elements on
 * their own; the static-field `act` annotation lets the SSR walk register
 * the contract via the binding's collector.
 */
import * as React from 'react';
import type { ActContract, ReactComponentWithAct } from '@act-spec/component-react';

// ---------------------------------------------------------------------------
// Hero — marketing:hero (PRD-102-R7)
// ---------------------------------------------------------------------------

export interface HeroProps {
  headline: string;
  subhead?: string;
  cta?: { text: string; to: string };
}

const HeroImpl = function Hero(props: HeroProps): React.ReactElement {
  return (
    <section data-component="hero">
      <h1>{props.headline}</h1>
      {props.subhead !== undefined ? <p>{props.subhead}</p> : null}
      {props.cta ? <a href={props.cta.to}>{props.cta.text}</a> : null}
    </section>
  );
} as ReactComponentWithAct<HeroProps>;
HeroImpl.act = {
  type: 'marketing:hero',
  contract_version: '0.1',
  extract: (props: HeroProps) => ({
    type: 'marketing:hero',
    headline: props.headline,
    ...(props.subhead !== undefined ? { subhead: props.subhead } : {}),
    ...(props.cta !== undefined ? { cta: props.cta } : {}),
  }),
} satisfies ActContract<HeroProps>;
export const Hero = HeroImpl;

// ---------------------------------------------------------------------------
// FeatureGrid — marketing:feature-grid (PRD-102-R8)
// ---------------------------------------------------------------------------

export interface FeatureGridProps {
  features: Array<{ title: string; description: string; icon?: string }>;
}

const FeatureGridImpl = function FeatureGrid(props: FeatureGridProps): React.ReactElement {
  return (
    <section data-component="feature-grid">
      {props.features.map((f, i) => (
        <div key={i}>
          <h3>{f.title}</h3>
          <p>{f.description}</p>
        </div>
      ))}
    </section>
  );
} as ReactComponentWithAct<FeatureGridProps>;
FeatureGridImpl.act = {
  type: 'marketing:feature-grid',
  contract_version: '0.1',
  extract: (props: FeatureGridProps) => ({
    type: 'marketing:feature-grid',
    features: props.features,
  }),
} satisfies ActContract<FeatureGridProps>;
export const FeatureGrid = FeatureGridImpl;

// ---------------------------------------------------------------------------
// PricingTable — marketing:pricing-table (PRD-102-R9)
// ---------------------------------------------------------------------------

export interface PricingTier {
  name: string;
  price: string;
  features: string[];
}

export interface PricingTableProps {
  tiers: PricingTier[];
  highlighted?: string;
}

const PricingTableImpl = function PricingTable(props: PricingTableProps): React.ReactElement {
  return (
    <section data-component="pricing-table">
      {props.tiers.map((t, i) => (
        <div key={i} data-highlighted={t.name === props.highlighted ? 'true' : 'false'}>
          <h3>{t.name}</h3>
          <p>{t.price}</p>
          <ul>{t.features.map((feat, j) => <li key={j}>{feat}</li>)}</ul>
        </div>
      ))}
    </section>
  );
} as ReactComponentWithAct<PricingTableProps>;
PricingTableImpl.act = {
  type: 'marketing:pricing-table',
  contract_version: '0.1',
  extract: (props: PricingTableProps) => ({
    type: 'marketing:pricing-table',
    tiers: props.tiers,
    ...(props.highlighted !== undefined ? { highlighted: props.highlighted } : {}),
  }),
} satisfies ActContract<PricingTableProps>;
export const PricingTable = PricingTableImpl;

// ---------------------------------------------------------------------------
// Testimonial — marketing:testimonial (PRD-102-R10)
// ---------------------------------------------------------------------------

export interface TestimonialProps {
  quote: string;
  author: string;
  role?: string;
}

const TestimonialImpl = function Testimonial(props: TestimonialProps): React.ReactElement {
  return (
    <blockquote data-component="testimonial">
      <p>{props.quote}</p>
      <cite>{props.author}{props.role ? `, ${props.role}` : ''}</cite>
    </blockquote>
  );
} as ReactComponentWithAct<TestimonialProps>;
TestimonialImpl.act = {
  type: 'marketing:testimonial',
  contract_version: '0.1',
  extract: (props: TestimonialProps) => ({
    type: 'marketing:testimonial',
    quote: props.quote,
    author: props.author,
    ...(props.role !== undefined ? { role: props.role } : {}),
  }),
} satisfies ActContract<TestimonialProps>;
export const Testimonial = TestimonialImpl;

// ---------------------------------------------------------------------------
// FAQAccordion — marketing:faq (PRD-102-R11)
// ---------------------------------------------------------------------------

export interface FAQItem { q: string; a: string }
export interface FAQAccordionProps { items: FAQItem[] }

const FAQAccordionImpl = function FAQAccordion(props: FAQAccordionProps): React.ReactElement {
  return (
    <section data-component="faq">
      {props.items.map((it, i) => (
        <details key={i}>
          <summary>{it.q}</summary>
          <p>{it.a}</p>
        </details>
      ))}
    </section>
  );
} as ReactComponentWithAct<FAQAccordionProps>;
FAQAccordionImpl.act = {
  type: 'marketing:faq',
  contract_version: '0.1',
  extract: (props: FAQAccordionProps) => ({
    type: 'marketing:faq',
    items: props.items,
  }),
} satisfies ActContract<FAQAccordionProps>;
export const FAQAccordion = FAQAccordionImpl;

// ---------------------------------------------------------------------------
// CTA — marketing:cta (PRD-102-R6 generic marketing namespace)
// ---------------------------------------------------------------------------

export interface CTAProps {
  headline: string;
  actions: Array<{ text: string; to: string }>;
}

const CTAImpl = function CTA(props: CTAProps): React.ReactElement {
  return (
    <section data-component="cta">
      <h2>{props.headline}</h2>
      {props.actions.map((a, i) => <a key={i} href={a.to}>{a.text}</a>)}
    </section>
  );
} as ReactComponentWithAct<CTAProps>;
CTAImpl.act = {
  type: 'marketing:cta',
  contract_version: '0.1',
  extract: (props: CTAProps) => ({
    type: 'marketing:cta',
    headline: props.headline,
    actions: props.actions,
  }),
} satisfies ActContract<CTAProps>;
export const CTA = CTAImpl;

# Next.js marketing site with ACT

A real, runnable Next.js 14 App Router marketing site with four locales and a small React design system. The most complex example in this repo: it demonstrates how ACT composes multiple content sources (a headless CMS + i18n message catalogs + React components) into one validated tree, while also rendering a browseable Next.js site at the same origin.

If you're already running Next.js with a headless CMS and React components, this is the pattern: declare your adapters, drop component contracts on the components you want extracted, build as normal.

## The stack

- **Next.js 14** (App Router, statically generated `[locale]` routes)
- **Contentful** as the primary content source — six landing pages × four locales (mocked from a recorded corpus so no live API calls)
- **next-intl message catalogs** at `messages/<locale>.json`, exposed via `@act-spec/adapter-i18n` as a fallback content source
- **React** components in `components/design-system.tsx`, instrumented with `static act = {...}` for block-level extraction
- **`@act-spec/plugin-nextjs`** as the build orchestrator (in your own project; this example runs the ACT pipeline directly)

## How ACT plugs in

Three things compose at build time:

1. **`withAct(nextConfig, actConfig)`** wraps your `next.config.mjs`. It registers a webpack post-build hook that runs the ACT pipeline after `next build`.
2. **Adapters** in `actConfig.adapters` declare your content sources in priority order. The Contentful adapter pulls landing-page entries; the i18n adapter contributes locale fallbacks.
3. **Component contracts** (`export const act = {...}` on a page, or `Component.act = {...}` on individual components) tell the React binding which blocks to extract.

The build emits ACT files alongside your Next.js output:

```
out/                              ← from `next build` (static export)
public/                           ← in dev: served at the origin root
├── .well-known/act.json
└── act/
    ├── index.json
    ├── index.ndjson              # Plus-tier streaming index
    ├── nodes/<id>.json
    ├── subtrees/<id>.json
    └── search.json
```

Per-locale node IDs (`cms/en-US/landing/pricing`, `cms/es-ES/landing/pricing`, …) plus `metadata.translations` cross-link the locales.

## Quick start (your project)

Add ACT to your existing Next.js App Router app in **three steps**:

**1. Install:**

```sh
pnpm add @act-spec/plugin-nextjs @act-spec/adapter-contentful @act-spec/adapter-i18n @act-spec/component-react
```

**2. Wrap your `next.config.mjs` with `withAct`:**

```js
import { withAct } from '@act-spec/plugin-nextjs';
import { createContentfulAdapter } from '@act-spec/adapter-contentful';
import { createI18nAdapter } from '@act-spec/adapter-i18n';

export default withAct(
  { /* your next config */ },
  {
    conformanceTarget: 'standard',
    manifest: { siteName: 'Your Site' },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
    },
    adapters: [
      {
        adapter: createContentfulAdapter(),
        config: { spaceId: '...', accessToken: { from_env: 'CONTENTFUL_DELIVERY_TOKEN' }, /* ... */ },
        actVersion: '0.1',
      },
      {
        adapter: createI18nAdapter(),
        config: { library: 'next-intl', messagesDir: './messages', /* ... */ },
        actVersion: '0.1',
      },
    ],
  },
);
```

**3. Drop a contract on each page** you want extracted as a `marketing:*` block:

```tsx
// app/[locale]/pricing/page.tsx
import type { PageContract } from '@act-spec/component-react';
import { ActSection } from '@act-spec/component-react';
import { Hero, PricingTable } from '@/components';

export const act: PageContract = {
  type: 'landing',
  id: 'pricing',
  contract_version: '0.1',
  extract: () => ({ type: 'landing' }),
};

export default function PricingPage() {
  return (
    <>
      <ActSection of={Hero} headline="Pricing" />
      <ActSection of={PricingTable} tiers={[/* ... */]} />
    </>
  );
}
```

`next build` now emits ACT files into `out/.well-known/` and `out/act/` alongside your static export.

## Run this example

ACT artifacts land in Next.js' `public/` folder so the dev server serves them at the same origin as the rendered pages.

```sh
pnpm install                                              # from the repo root

# 1. Build the ACT artifacts (writes to public/.well-known/ + public/act/)
pnpm -F @act-spec/example-nextjs-marketing build

# 2. Boot the Next.js dev server
pnpm -F @act-spec/example-nextjs-marketing dev            # http://localhost:3000

# Browse both sides at the same origin:
#   http://localhost:3000/en-US/pricing                ← rendered page (en-US)
#   http://localhost:3000/de-DE/pricing                ← same page in German
#   http://localhost:3000/.well-known/act.json         ← ACT manifest
#   http://localhost:3000/act/index.json               ← ACT index (24 nodes)
#   http://localhost:3000/act/nodes/cms/en-us/landing/pricing.json

# Validate the ACT output
pnpm -F @act-spec/example-nextjs-marketing validate
pnpm -F @act-spec/example-nextjs-marketing conformance    # build + validate
```

### Verifying ACT against the rendered pages

With `pnpm dev` running, open `/en-US/pricing` in the browser and look at its hero, feature grid, pricing table, FAQ, and CTA. Then fetch the matching ACT node:

```sh
curl http://localhost:3000/act/nodes/cms/en-us/landing/pricing.json | jq '.blocks[]?.kind'
```

You should see one entry per `<ActSection of={...} />` block on the page (`marketing:hero`, `marketing:pricing-table`, `marketing:faq`, `marketing:cta`). Locale fallbacks are visible by visiting `/de-DE/dpa` (`landing/dpa` is authored only in `en-US` so the German node is a fallback).

## What the corpus shows

- **6 routes × 4 locales = 24 ACT nodes**, locale-prefixed (`cms/<locale>/landing/<slug>`).
- **52 component-extracted blocks** across `marketing:hero`, `marketing:feature-grid`, `marketing:pricing-table`, `marketing:testimonial`, `marketing:faq`, `marketing:cta`.
- **3 fallback nodes**: `landing/dpa` is authored only in `en-US`; the other locales emit fallback nodes carrying `metadata.translation_status: "fallback"`.
- **Plus-tier surface**: NDJSON streaming index at `act/index.ndjson` + a search payload at `act/search.json` advertised via `search_url_template`.

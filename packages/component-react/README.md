# @act-spec/component-react

React binding for the ACT component contract. Bridges React component
trees to the framework-agnostic `NodeDraft` shape exported by
`@act-spec/component-contract`.

Implements the three React declaration patterns:

- static field — `Component.act = { … }`,
- hook — `useActContract({ … })`,
- page-level boundary — exported `act` const or `<ActContractWrapper>`.

The collector wraps the tree as `<ActProvider>` and walks via
`react-dom/server` (`onAllReady` for streaming completion). React Server
Components are walked over the server tree only. The variant-replay loop,
truncated + secret-redacted placeholder emission on render error, and the
`BindingCapabilities` const are pinned to the v0.1 surface.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/component-react": "workspace:*" } }
```

## Usage

Static field:

```tsx
import type { ReactComponentWithAct } from '@act-spec/component-react';

export const PricingTable: ReactComponentWithAct = (props) => { /* … */ };

PricingTable.act = {
  type: 'marketing:pricing',
  title: (p) => p.heading,
  contentBlocks: (p) => [
    { type: 'marketing:pricing-tier', tiers: p.tiers },
  ],
};
```

Hook form:

```tsx
import { useActContract } from '@act-spec/component-react';

export function FaqSection(props: { items: Faq[] }) {
  useActContract({
    type: 'marketing:faq',
    contentBlocks: () => props.items.map(toBlock),
  });
  return <ul>{/* … */}</ul>;
}
```

Generators (Astro, Next.js, Remix, the standalone CLI) call `extractRoute`
to produce `NodeDraft`s for the manifest pipeline:

```ts
import { extractRoute, reactBinding } from '@act-spec/component-react';

const drafts = await extractRoute({
  pageContract: { /* … */ },
  rootElement: <App />,
  variants: [/* PageContract.variants */],
});
```

## Conformance / what's tested

Every public API has a citing test in the package's test suite, including
the React 18+ floor (`assertReact18Plus`), the RSC walk guard,
contract-version pinning, and the placeholder + redaction contract. The
conformance gate runs `@act-spec/validator` against the extracted nodes.

```bash
pnpm -F @act-spec/component-react conformance
```

## Peer dependencies

| Peer | Range |
| --- | --- |
| `react` | `>=18 <20` |
| `react-dom` | `>=18 <20` |

Both peers are optional from npm's perspective; the binding only requires
them at extraction time.

## Links

- Component contract: [`@act-spec/component-contract`](../component-contract)
- Repository: <https://github.com/act-spec/act>

# @act-spec/component-angular

Angular binding for the ACT component contract. Bridges Angular component
trees to the framework-agnostic `NodeDraft` shape exported by
`@act-spec/component-contract`.

Implements the three Angular declaration patterns:

- component static field — `static act = { … }`,
- service-based — `ActContractService.register({ … })`,
- page-level boundary — `*actSection="contract"` structural directive
  or the `<act-section>` component form.

The `ActCollectorService` is provided component-locally (never `'root'`)
for SSR-walk extraction. The canonical SSR walker uses
`@angular/platform-server.renderApplication` and waits for
`ApplicationRef.isStable`. Variant replay constructs a fresh
`ApplicationRef` + `EnvironmentInjector` per variant. Render-time errors
surface through Angular's `ErrorHandler` provider as truncated +
secret-redacted placeholders. The `BindingCapabilities` const reflects
only what v0.1 ships.

Note: no v0.1 leaf generator depends on this binding directly. The
documented integration path is via `@act-spec/cli` running over an Angular
Universal app. A future Angular-native generator (deferred to v0.2) would
consume the same `extractRoute()` API.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/component-angular": "workspace:*" } }
```

## Usage

Static field on a component class:

```ts
import { Component } from '@angular/core';
import type { AngularComponentWithAct } from '@act-spec/component-angular';

@Component({ selector: 'pricing-table', templateUrl: './pricing.html' })
export class PricingTable implements AngularComponentWithAct {
  static act = {
    type: 'marketing:pricing',
    title: (p: Inputs) => p.heading,
    contentBlocks: (p: Inputs) => p.tiers.map(toBlock),
  };
}
```

Service-based registration:

```ts
import { Component, inject } from '@angular/core';
import { ActContractService } from '@act-spec/component-angular';

@Component({ selector: 'faq-section', templateUrl: './faq.html' })
export class FaqSection {
  private readonly act = inject(ActContractService);
  constructor() {
    this.act.register({
      type: 'marketing:faq',
      contentBlocks: () => this.items.map(toBlock),
    });
  }
}
```

Generators call `extractRoute`:

```ts
import { extractRoute, angularBinding } from '@act-spec/component-angular';

const drafts = await extractRoute({
  pageContract: { /* … */ },
  appModule: AppModule,
  variants: [/* … */],
});
```

## Conformance / what's tested

Every public API has a citing test in the package's test suite,
including the Angular 17+ floor (`assertAngular17Plus`), the collector
scope check, contract-version pinning, and the placeholder + redaction
contract. The conformance gate runs `@act-spec/validator` against the
extracted nodes.

```bash
pnpm -F @act-spec/component-angular conformance
```

## Peer dependencies

| Peer | Range |
| --- | --- |
| `@angular/core` | `>=17 <21` |
| `@angular/platform-server` | `>=17 <21` |

Both peers are optional from npm's perspective; the binding only requires
them at extraction time.

## Links

- Component contract: [`@act-spec/component-contract`](../component-contract)
- Repository: <https://github.com/act-spec/act>

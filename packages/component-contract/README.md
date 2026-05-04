# @act-spec/component-contract

Component-instrumentation contract framework for ACT (Agent Content Tree).
Defines the canonical contract object every framework binding (React, Vue,
Angular) desugars into, the page-level aggregation rule, the variant
emission protocol, and the binding capability matrix.

This is a framework package. It emits no nodes itself; it provides the
types, the desugaring helpers (static-field / hook / decorator), the
page-level aggregation walk, the variant replay loop, the placeholder +
secret-redaction helpers, and the contract-version gate that the leaf
bindings implement against.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/component-contract": "workspace:*" } }
```

## Usage

You typically don't import this package directly — use one of the
framework bindings:

- [`@act-spec/component-react`](../component-react)
- [`@act-spec/component-vue`](../component-vue)
- [`@act-spec/component-angular`](../component-angular)

For custom bindings, import the contract types directly:

```ts
import type { ComponentContract, NodeDraft } from '@act-spec/component-contract';
```

## Links

- Repository: <https://github.com/act-spec/act>

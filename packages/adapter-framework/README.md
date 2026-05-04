# @act-spec/adapter-framework

Shared adapter framework for ACT (Agent Content Tree). Provides the types, lifecycle helpers, and multi-source merge logic used by every first-party content-source adapter.

This package defines the `Adapter` contract — `enumerate`, `transform`, `dispose` — plus the framework-side machinery that all leaf adapters reuse: precedence-aware merging across sources, capability sampling, error policies, and source attribution.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-framework": "workspace:*" } }
```

## Usage

You typically don't import this package directly — instead, install one of the leaf adapters that build on it:

- [`@act-spec/adapter-markdown`](../adapter-markdown)
- [`@act-spec/adapter-contentful`](../adapter-contentful)
- [`@act-spec/adapter-sanity`](../adapter-sanity)
- [`@act-spec/adapter-storyblok`](../adapter-storyblok)
- [`@act-spec/adapter-strapi`](../adapter-strapi)
- [`@act-spec/adapter-builder`](../adapter-builder)
- [`@act-spec/adapter-i18n`](../adapter-i18n)
- [`@act-spec/adapter-programmatic`](../adapter-programmatic)

For custom adapters, import the framework types directly:

```ts
import type { Adapter, AdapterContext } from '@act-spec/adapter-framework';
```

## Links

- Repository: <https://github.com/act-spec/act>

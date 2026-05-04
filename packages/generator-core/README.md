# @act-spec/generator-core

Shared generator framework for ACT (Agent Content Tree). Pipeline orchestration, manifest/index/subtree builders, etag derivation, target-level + adapter-pinning enforcement, file emission, capability backing verification, and build-report shape — shared by every first-party generator.

The Astro, Docusaurus, Next.js, Remix, Nuxt, Eleventy generators and the standalone CLI all import from here directly.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/generator-core": "workspace:*" } }
```

## Usage

You typically don't import this package directly — use one of the framework generators:

- [`@act-spec/plugin-astro`](../plugin-astro)
- [`@act-spec/plugin-docusaurus`](../plugin-docusaurus)
- [`@act-spec/plugin-eleventy`](../plugin-eleventy)
- [`@act-spec/plugin-nextjs`](../plugin-nextjs)
- [`@act-spec/plugin-nuxt`](../plugin-nuxt)
- [`@act-spec/plugin-remix`](../plugin-remix)
- [`@act-spec/cli`](../cli) (framework-free)

For custom generators, import the pipeline builders directly:

```ts
import { runPipeline, buildManifest, buildIndex } from '@act-spec/generator-core';
```

## Links

- Repository: <https://github.com/act-spec/act>

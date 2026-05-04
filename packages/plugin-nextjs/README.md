# @act-spec/plugin-nextjs

Next.js static-export generator for ACT (Agent Content Tree).

Public surface: `withAct(nextConfig, options)` — a `next.config.js` wrapper that registers a post-build webpack hook to invoke the canonical generator pipeline against Next's static-export output (`out/`).

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/plugin-nextjs": "workspace:*" } }
```

## Usage

```ts
// next.config.mjs
import { withAct } from '@act-spec/plugin-nextjs';

export default withAct(
  {
    output: 'export',
    // ...other Next config
  },
  {
    manifest: { site: { name: 'Example' } },
    conformanceTarget: 'standard',
  },
);
```

See [`examples/nextjs-marketing/`](../../examples/nextjs-marketing) for a complete project.

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Repository: <https://github.com/act-spec/act>

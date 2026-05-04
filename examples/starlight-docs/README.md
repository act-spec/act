# Starlight + ACT (minimal starter)

A tiny [Astro Starlight](https://starlight.astro.build) site that emits
an ACT (Agent Content Tree) artifact set alongside its HTML build via
[`@act-spec/plugin-astro`](../../packages/plugin-astro). About half a
dozen markdown pages, two integrations registered side-by-side in
`astro.config.mjs`, one `astro build` produces both outputs.

> **Note**
> This is the **minimal "drop in and run" starter**. The full
> `act-spec.org` homepage — itself a Starlight site eating its own
> dogfood — lives at [`apps/website/`](../../apps/website) (TBD). Use
> this example when you want the smallest possible reference for adding
> ACT to your own Starlight project.

## What it shows

- A vanilla Starlight install with default theme and sidebar.
- The `@act-spec/plugin-astro` integration registered alongside
  `@astrojs/starlight` in a single `astro.config.mjs`.
- A small markdown corpus under `src/content/docs/` driving both the
  human-facing site and the ACT tree.
- A second locale (`fr/`) showing how Starlight's i18n folders show up
  to the ACT pipeline.
- A `conformance.ts` script that walks `dist/` through
  `@act-spec/validator` and asserts a green `standard`-level report.

## Quickstart

```sh
pnpm install                                          # from the repo root

# Start the Starlight dev server
pnpm -F @act-spec/example-starlight-docs dev          # http://localhost:4321

# Static build (Starlight HTML + ACT artifacts)
pnpm -F @act-spec/example-starlight-docs build

# Validate the emitted ACT tree
pnpm -F @act-spec/example-starlight-docs conformance
```

## How to run (your own Starlight site)

Two steps:

**1. Install:**

```sh
pnpm add @act-spec/plugin-astro @act-spec/adapter-markdown
```

**2. Add the integration to `astro.config.mjs`:**

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default defineConfig({
  site: 'https://your-site.example',
  integrations: [
    starlight({ title: 'Your Docs' }),
    act({
      level: 'standard',
      site: { name: 'Your Docs' },
      adapters: [
        {
          adapter: createMarkdownAdapter(),
          config: {
            sourceDir: './src/content/docs',
            mode: 'fine',
            targetLevel: 'standard',
          },
          actVersion: '0.1',
        },
      ],
    }),
  ],
});
```

`astro build` now emits the usual Starlight HTML output **plus**:

```
dist/
├── .well-known/act.json
├── act/
│   ├── index.json
│   ├── nodes/<id>.json
│   └── subtrees/<id>.json
├── llms.txt
└── llms-full.txt
```

## Verifying ACT output

After `pnpm build`, the ACT artifacts sit under `dist/`:

```sh
# Discovery manifest
cat dist/.well-known/act.json | jq

# Index of every node in the tree
cat dist/act/index.json | jq '.nodes | length'

# Back-compat /llms.txt + /llms-full.txt
head dist/llms.txt
head dist/llms-full.txt
```

The bundled conformance script wraps the same walk used by the public
validator and exits non-zero on any gap or level mismatch:

```sh
pnpm -F @act-spec/example-starlight-docs conformance
```

A green run prints something like:

```
Starlight + ACT conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static.
```

# Astro docs site with ACT

A minimal [Astro 4](https://astro.build) documentation site that ships an ACT tree alongside its HTML build. About a dozen markdown pages, organized in two sections, generating a fully-conformant Standard-tier ACT tree out of the box.

If you're already running an Astro docs (or marketing, or blog) site backed by markdown content collections, this is the smallest possible integration: install one package, add one entry to `integrations: [...]`, build as normal.

## The stack

- **Astro 4** with `output: 'static'`
- **Markdown content collection** at `src/content/docs/` — one `.md` file per page, frontmatter for `title` / `description`, nested folders for subsections
- **`@act-spec/plugin-astro`** as an Astro integration
- **`@act-spec/adapter-markdown`** as the content source

## How ACT plugs in

ACT is a single Astro integration. It runs after `astro build`, walks your markdown collection, and writes:

```
dist/
├── .well-known/act.json    # discovery manifest
└── act/
    ├── index.json          # one entry per page
    ├── nodes/<id>.json     # one file per page
    └── subtrees/<id>.json  # one file per nested section
```

Your existing Astro routes are untouched. The ACT files sit beside them and are served as static assets by whatever you deploy `dist/` to.

There's nothing to wire up at request time, no separate build step, no content rewrite. Add the integration once and ACT regenerates on every `astro build`.

## Quick start (your project)

Add ACT to your existing Astro site in **two steps**:

**1. Install:**

```sh
pnpm add @act-spec/plugin-astro @act-spec/adapter-markdown
```

**2. Add the integration to `astro.config.mjs`:**

```js
import { defineConfig } from 'astro/config';
import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default defineConfig({
  site: 'https://your-site.example',
  integrations: [
    act({
      level: 'standard',
      site: { name: 'Your Site' },
      urlTemplates: {
        indexUrl: '/act/index.json',
        nodeUrlTemplate: '/act/nodes/{id}.json',
        subtreeUrlTemplate: '/act/subtrees/{id}.json',
      },
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

`astro build` now emits `dist/.well-known/act.json` and `dist/act/...` alongside your HTML.

## Summaries: zero-config by default

Every ACT node carries a `summary` field — the one-sentence preview an agent reads to decide whether to fetch the body. The markdown adapter wires this up automatically:

1. **Frontmatter `summary:`** wins when present (stamped `summary_source: "author"`).
2. Otherwise, the adapter **extracts the first non-empty paragraph** from the body and clamps it to ~50 tokens (stamped `summary_source: "extracted"`).

Set a custom summary in any markdown file's frontmatter to override the extracted default:

```md
---
title: Quickstart
summary: Provision a workspace token, hit the SDK, and ship the first POST.
---

# Quickstart
…
```

Need full control over how summaries are derived (e.g. you have a custom CMS field, or want to call an LLM at build time)? Pass a `humanUrlFor`-style callback to the adapter — see [`@act-spec/adapter-markdown` docs](../../packages/adapter-markdown/README.md) for the full surface; the same precedence (author override > callback > extracted) holds.

## Run this example

```sh
pnpm install                                     # from the repo root

# View the human-facing site
pnpm -F @act-spec/example-astro-docs dev         # http://localhost:4321
pnpm -F @act-spec/example-astro-docs build       # static build to dist/
pnpm -F @act-spec/example-astro-docs preview     # serve dist/ locally

# Inspect the ACT output
open examples/astro-docs/dist/.well-known/act.json

# Validate the ACT output
pnpm -F @act-spec/example-astro-docs validate
pnpm -F @act-spec/example-astro-docs conformance # build + validate
```

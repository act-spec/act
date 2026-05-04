# VitePress docs site with ACT

A minimal [VitePress 1](https://vitepress.dev) documentation site that
ships an ACT tree alongside its HTML build. Seven markdown pages across
`guide/` and `reference/`, plus a small Spanish locale, generating a
fully-conformant Standard-tier ACT tree out of the box.

If you are already running a VitePress docs site backed by markdown, this
is the smallest possible integration: install one package, wire two hook
fields in `defineConfig`, build as normal.

## The stack

- **VitePress 1.x** with the default file-system router under `docs/`
- **`@act-spec/plugin-vitepress`** — wires VitePress's `transformPageData`
  + `buildEnd` hooks into the ACT generator pipeline
- **`@act-spec/adapter-markdown`** — auto-wired against VitePress's
  resolved `srcDir`; no separate adapter wiring needed
- **VitePress `locales` config** — exposes a Spanish (`/es/`) subtree that
  flows through to the ACT locale tree

## How ACT plugs in

The ACT plugin returns a plain object with two functions; spread them
into `defineConfig`. After `vitepress build`, the plugin walks the
markdown source and writes:

```
docs/.vitepress/dist/
├── .well-known/act.json    # discovery manifest
├── act/
│   ├── index.json          # one entry per page
│   ├── nodes/<id>.json     # one file per page
│   └── subtrees/<id>.json  # one file per nested section
├── llms.txt                # per-locale H2 index
└── llms-full.txt           # full corpus, concatenated
```

Your existing VitePress routes are untouched. The ACT files sit beside
them and are served as static assets by whatever you deploy
`docs/.vitepress/dist/` to.

There is nothing to wire up at request time, no separate build step, no
content rewrite. Add the hooks once and ACT regenerates on every
`vitepress build`.

## Quick start (your project)

Add ACT to your existing VitePress site in **two steps**:

**1. Install:**

```sh
pnpm add @act-spec/plugin-vitepress @act-spec/adapter-markdown
```

**2. Wire the hooks in `docs/.vitepress/config.ts`:**

```ts
import { defineConfig } from 'vitepress';
import { actPlugin } from '@act-spec/plugin-vitepress';

const act = actPlugin({
  baseUrl: 'https://your-site.example',
  conformanceTarget: 'standard',
  manifest: { site: { name: 'Your Site' } },
  urlTemplates: {
    indexUrl: '/act/index.json',
    nodeUrlTemplate: '/act/nodes/{id}.json',
    subtreeUrlTemplate: '/act/subtrees/{id}.json',
  },
});

export default defineConfig({
  title: 'Your Site',
  transformPageData: act.transformPageData,
  buildEnd: act.buildEnd,
});
```

`vitepress build` now emits `.well-known/act.json`, `act/...`, and the
`/llms.txt` + `/llms-full.txt` companions alongside your HTML.

## What this example shows

- **Default-locale pages** under `docs/` (an index + three guide pages +
  three reference pages) emitted as ACT nodes with frontmatter `id`,
  `title`, `summary`, `parent`, and `related` propagated through.
- **A Spanish locale** under `docs/es/` declared via VitePress's
  `locales` config; the plugin observes the `lang` codes through
  `transformPageData` and threads them into the ACT locale tree.
- **A subtree per nested parent** (`guide/` and `reference/`) written to
  `act/subtrees/`.
- **`/llms.txt` + `/llms-full.txt`** emitted by the generator core's
  back-compat surface — locale-aware, default-on.
- **Standard-tier conformance** verified end-to-end via
  `@act-spec/validator`'s static walk.

## Run this example

```sh
pnpm install                                          # from the repo root

# View the human-facing site
pnpm -F @act-spec/example-vitepress-docs dev          # http://localhost:5173
pnpm -F @act-spec/example-vitepress-docs build        # static build
pnpm -F @act-spec/example-vitepress-docs preview      # serve dist locally

# Inspect the ACT output
cat examples/vitepress-docs/docs/.vitepress/dist/.well-known/act.json
cat examples/vitepress-docs/docs/.vitepress/dist/llms.txt

# Validate the ACT output
pnpm -F @act-spec/example-vitepress-docs validate
pnpm -F @act-spec/example-vitepress-docs conformance  # build + validate
```

## Verifying ACT output

The `conformance` script walks `docs/.vitepress/dist/` after the
VitePress build, runs `@act-spec/validator`'s static walker, and asserts:

- `gaps` array is empty
- `declared.level === 'standard'` and `achieved.level === 'standard'`
- `delivery === 'static'`
- `/.well-known/act.json`, `/act/index.json`, `/llms.txt`,
  `/llms-full.txt` all present
- at least one subtree file emitted (the `guide/` + `reference/`
  parents in this corpus produce two)

Any mismatch exits non-zero so the conformance gate fails CI.

# Docusaurus docs site with ACT

A real, runnable [Docusaurus 3.x](https://docusaurus.io) documentation site (200–500 pages, deep nested sidebar) that ships an ACT tree alongside its HTML build. Spin up the dev server and you can browse the human-facing docs at `/docs/...` and the ACT artifacts at `/.well-known/act.json` + `/act/...` from the same origin.

If you're already running a Docusaurus docs site, this is the smallest possible integration: install one package, register it as a Docusaurus plugin, build as normal.

## The stack

- **Docusaurus 3.x** with `@docusaurus/preset-classic`
- **Markdown docs** under `docs/`, organized by sidebar category
- **Sidebar config** at `sidebars.cjs` driving the navigation hierarchy
- **`@act-spec/plugin-docusaurus`** registered as a Docusaurus plugin

## How ACT plugs in

`@act-spec/plugin-docusaurus` is a standard Docusaurus plugin. It runs in `postBuild`, walks your `docs/` corpus and the resolved sidebar, and writes the ACT artifact set:

```
build/
├── index.html              # your Docusaurus site
├── docs/...                # rendered docs HTML
├── .well-known/act.json    # discovery manifest
└── act/
    ├── index.json
    ├── nodes/<id>.json
    └── subtrees/<id>.json  # one per sidebar category
```

Sidebar categories become synthesized parent nodes, so the ACT tree mirrors your sidebar hierarchy. Anything you have in `docs/` shows up; nothing in your existing setup needs to change.

## Quick start (your project)

Add ACT to your existing Docusaurus site in **two steps**:

**1. Install:**

```sh
pnpm add @act-spec/plugin-docusaurus
```

**2. Register the plugin in `docusaurus.config.mjs`** (use the function form so Docusaurus can load the ESM-only plugin):

```js
import actDocusaurusPlugin from '@act-spec/plugin-docusaurus';

export default {
  // ...your existing config...
  plugins: [
    [
      actDocusaurusPlugin,
      {
        target: 'standard',
        urlTemplates: {
          indexUrl: '/act/index.json',
          nodeUrlTemplate: '/act/nodes/{id}.json',
          subtreeUrlTemplate: '/act/subtrees/{id}.json',
        },
      },
    ],
  ],
};
```

`docusaurus build` now emits `build/.well-known/act.json` and `build/act/...` alongside your docs HTML.

## Run this example

The corpus is generated procedurally so the example is reproducible byte-for-byte. ACT artifacts land in Docusaurus' `static/` folder so the dev server serves them at the same origin as the human site.

```sh
pnpm install                                            # from the repo root

# 1. Generate the markdown corpus (~300 .md files into docs/)
pnpm -F @act-spec/example-docusaurus-docs generate-corpus

# 2. Build the ACT artifacts (writes to static/.well-known/ + static/act/)
pnpm -F @act-spec/example-docusaurus-docs build

# 3. Boot the Docusaurus dev server
pnpm -F @act-spec/example-docusaurus-docs dev          # http://localhost:3000

# Now browse both sides at the same origin:
#   http://localhost:3000/docs/intro              ← human docs
#   http://localhost:3000/.well-known/act.json    ← ACT manifest
#   http://localhost:3000/act/index.json          ← ACT index
#   http://localhost:3000/act/nodes/<id>.json     ← ACT nodes

# Validate the ACT output
pnpm -F @act-spec/example-docusaurus-docs validate
pnpm -F @act-spec/example-docusaurus-docs conformance  # generate + build + validate
```

### Verifying ACT against the rendered docs

With `pnpm dev` running, open any docs page in the browser, then fetch the matching ACT node — the title, summary, and outline should line up:

```sh
curl http://localhost:3000/.well-known/act.json | jq .site
curl http://localhost:3000/act/nodes/intro.json | jq '{title, summary, blocks: [.blocks[]?.kind]}'
```

If anything in the ACT output disagrees with what's rendered, that's a bug to file.

## What the corpus shows

- A fixed top-level shape — `intro`, `getting-started`, `concepts`, `api`, `recipes`, `troubleshooting`, `changelog`.
- The `recipes/` and `troubleshooting/` branches expand procedurally to hit a 200–500 page corpus, exercising deep nested sidebar categories.
- Each sidebar category becomes a synthesized parent node in the ACT tree, with the docs under it as children.

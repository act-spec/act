# ACT site browser (web)

A hosted, single-page browser app for ACT (Agent Content Tree) sites. Paste a URL or `act.json` manifest URL, walk the tree, inspect the envelopes — entirely in the browser. No upload. Nothing leaves your machine.

Deployed to GitHub Pages at `/browser/` from this repo.

## What it does

Wraps [`@act-spec/inspector`](../../packages/inspector) and [`@act-spec/validator`](../../packages/validator) for browser consumption: walks a manifest, renders the index/subtree, and surfaces validator findings inline. Schemas are bundled at build time; the validator's Node-only filesystem loader is never called in this build.

## Run locally

```bash
pnpm -F @act-spec/site-browser dev        # vite dev server on :5175
pnpm -F @act-spec/site-browser typecheck  # tsc --noEmit
pnpm -F @act-spec/site-browser test       # vitest
```

The dev server hosts the SPA at `http://localhost:5175/browser/`.

## Build for Pages

```bash
pnpm -F @act-spec/site-browser build      # static SPA in apps/site-browser/dist
pnpm -F @act-spec/site-browser preview    # serve the built SPA
```

`SITE_BROWSER_BASE` overrides the asset base path at build time (default `/browser/`).

## Status

Scaffold only — full requirements tracked in [`docs/v0.2-todos.md`](../../docs/v0.2-todos.md) under "ACT site browser SPA".

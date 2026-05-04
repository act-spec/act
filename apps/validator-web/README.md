# ACT validator (web)

A hosted, single-page browser app that validates ACT manifests, indexes, nodes, NDJSON indexes, subtrees, and error envelopes — entirely in the browser. No upload. Nothing leaves your machine.

Drop a JSON file in (or paste it), pick the envelope kind, get a structured pass/fail report.

Deployed to GitHub Pages at `/validator/` from this repo.

## Develop

```bash
pnpm -F @act-spec/validator-web dev        # vite dev server on :5174
pnpm -F @act-spec/validator-web build      # static SPA in apps/validator-web/dist
pnpm -F @act-spec/validator-web preview    # serve the built SPA
pnpm -F @act-spec/validator-web typecheck  # tsc --noEmit
pnpm -F @act-spec/validator-web test       # vitest
```

The dev server hosts the SPA at `http://localhost:5174/validator/`. `VALIDATOR_WEB_BASE` overrides the asset base path at build time (default `/validator/`).

## How it works

Wraps [`@act-spec/validator`](../../packages/validator) for browser consumption: schemas are bundled at build time via Vite's `?raw` import and handed to `compileSchemasFromRaw` — the validator's Node-only filesystem loader is never called in this build.

## Build metadata

The footer surfaces the short git SHA and build timestamp the SPA was built from, derived in `vite.config.ts` via `git rev-parse --short HEAD` at build time.

## Compatibility

Modern browsers (ES2022 baseline). The bundle is sourcemapped; the schema files at the repo root are inlined as raw strings, so SPA size scales with schema count.

## Links

- Validator package: [`@act-spec/validator`](../../packages/validator)
- Repository: <https://github.com/act-spec/act>

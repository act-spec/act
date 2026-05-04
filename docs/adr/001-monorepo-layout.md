# ADR-001 — Monorepo layout for ACT v0.1

**Status:** Accepted
**Date:** 2026-05-02
**Author:** Jeremy Forsythe

## Context

The ACT v0.1 reference implementation needs a monorepo to host its TypeScript-only first-party packages; non-TS PRDs (Hugo / MkDocs / FastAPI / Rails) ship as spec text only and do not appear in the monorepo. The locked JSON Schemas under `schemas/{100,101,102,103,109}/` and 92 fixtures under `fixtures/{100..109}/` are inputs to the monorepo; they are the source of truth and must not be duplicated.

The initial vertical slice requires four packages — `@act-spec/core`, `@act-spec/validator`, `@act-spec/adapter-markdown`, `@act-spec/plugin-astro` — and one example (`examples/700-tinybox/`). Subsequent work fans out into ~30 more leaf packages. The layout we pick now will absorb that growth.

## Decision

1. **pnpm workspaces.** `pnpm-workspace.yaml` declares `packages/*` and `examples/*`. `packageManager` in the root `package.json` pins `pnpm@10.17.1`. `engine-strict=true` in `.npmrc` enforces it.
2. **npm scope `@act-spec`.** Public packages publish under `@act-spec/{core,validator,markdown-adapter,astro,...}`. The shorter `@act` scope on npm is registered to an unrelated party and is not obtainable; `@act-spec` matches the repo / org name (`act-spec`) and the schema `$id` host (`act-spec.org`). The role manual's prior reference to `@act/*` is updated by this ADR.
3. **ESM-only.** Every published package is `"type": "module"` with an `exports` map gating its public surface. No CJS dual-publish in v0.1 — Node 20+ and modern bundlers all support ESM natively. A future ADR may revisit if a CJS-only consumer surfaces.
4. **Strict TypeScript** via `tsconfig.base.json` extended by every package: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noImplicitOverride`. TypeScript project references at the root `tsconfig.json` cover the four packages so `pnpm -r build` benefits from incremental compilation.
5. **JSON Schema 2020-12 + ajv 8** for runtime structural validation in `@act-spec/validator` (PRD-600). No hand-rolled validator (anti-pattern: NIH for spec-validation). PRD-600's reporter shape is hand-written in `@act-spec/core`'s `conformance-reporter.ts` because PRD-107 pins it as a TypeScript contract, not as a JSON Schema.
6. **Vitest** for unit + integration tests (one config per package). **Stryker (`@stryker-mutator/core`)** wired but not yet running — kicks in at the v0.1 conformance milestone for wire-format-core packages.
7. **ESLint flat config + Prettier**, single `eslint.config.js` and `.prettierrc` at the root. Configs are shared, not duplicated per package.
8. **Changesets** at `.changeset/` for versioning + the `@changesets/action` GitHub Action for the `release.yml` workflow. The PRD-700 example is `private` and ignored by changesets.
9. **CI = one reusable workflow.** `.github/workflows/_package.yml` is the single source of build-test-conformance steps; `ci.yml` calls it on a Node 20 / 22 matrix. `nightly.yml` (cron) and `release.yml` (changesets) are separate. This pre-empts the "CI workflow drift" anti-pattern.
10. **`@act-spec/core` is the single shared-types package.** Envelope types are codegen'd from `schemas/` via `json-schema-to-typescript` (`pnpm -F @act-spec/core codegen` writes `src/generated/`, gitignored). Reporter types are hand-written in `src/conformance-reporter.ts`. No leaf package widens shared types — discomfort routes through `docs/amendments-queue.md`.

## Consequences

### Positive

- One pnpm install at the root produces all four packages plus the example.
- Schema → TypeScript codegen prevents type drift between the locked schemas and the implementation surface.
- The reusable `_package.yml` workflow is the only place CI logic lives, satisfying the anti-drift rule.
- ESM-only matches every modern host (Node 20+, Vite, Astro, Next 14+), and we sidestep the dual-publish complexity of `exports` conditions for CJS.
- `@act-spec` scope aligns with the spec's home (`act-spec.org`) and the GitHub org name.

### Negative

- npm consumers locked into ESM. Any v0.1 adopter on legacy CJS-only Node will need a transpile step. Acceptable for a 2026 ESM-first ecosystem.
- TypeScript project references add a small `composite: true` / `.tsbuildinfo` overhead. Worth it for incremental builds.
- Codegen must run before first build / typecheck on a fresh clone (`pnpm -F @act-spec/core codegen`). The CI workflow does this automatically; documented for human contributors.
- `@act-spec/*` is one extra character vs `@act/*`. Documented and forwarded to npm registration ahead of v0.1 publish.

### Neutral

- We do not adopt Turborepo / Nx in v0.1. pnpm's `-r` filter is sufficient for four packages plus an example. Revisit if build times warrant.
- We do not write a separate `@act-spec/adapter-framework` or `@act-spec/generator-framework` package yet. Extraction is delayed until a third consumer exists (avoiding premature abstraction in `@act/core`). PRD-200 / PRD-400 framework code initially lives inside the leaf packages; extraction is a later refactor under a separate ADR.

## Alternatives considered

- **`@act/*` npm scope** — rejected: scope is taken on npm by an unrelated party, and the project's GitHub org / domain / `$id` host is `act-spec.org`.
- **Turborepo** — rejected for v0.1: pnpm's built-in workspace topology is sufficient for the package count. Revisit if cross-package build caching becomes a bottleneck.
- **Dual ESM/CJS publish via `tsup`** — rejected for v0.1: every target consumer is ESM-capable. ESM-only halves the build artifact surface and the `exports` map complexity. ADR-amendable if a real CJS consumer emerges.
- **One `tsconfig.json` per package without project references** — rejected: composite mode + project references catches stale `dist/.tsbuildinfo` issues at compile time and powers incremental rebuilds with `tsc -b`.
- **Single `validator` + `core` package (no separate `core`)** — rejected: the adapter and generator packages depend on the reporter contract types but should not depend on ajv. A thin `@act-spec/core` keeps the runtime weight on the leaf that needs it.
- **Yarn or npm workspaces** — rejected: pnpm's content-addressed store and stricter peer-dep handling are a better fit for a multi-package public-facing TypeScript stack.
- **Hand-write envelope types** — rejected: schemas are normative (PRD-100-R0). Typing them by hand invites drift. Codegen makes the schemas the single source of truth.

# ADR-006 — Extract `@act-spec/generator-core` from `@act-spec/plugin-astro`

**Status:** Accepted
**Date:** 2026-05-02
**Author:** Jeremy Forsythe

## Context

ADR-001 §"Neutral" deferred extracting a dedicated PRD-400 framework
package to avoid premature abstraction in `@act/core`: no extraction
until a third concrete consumer exists. ADR-003 placed the PRD-400
framework code inside `@act-spec/plugin-astro/src/pipeline.ts` for the
same reason — PRD-401 was the only first-party generator in flight
during the v0.1 prework slice.

ADR-004 closed the v0.1 prework slice with an explicit retro entry
naming this seam (§"Where the seams are loose" → "Seam 2") and a
recommendation in §"Recommendations for the subsequent fan-out" item 2:

> Plan the PRD-400 framework extraction when generator work begins.
> PRD-404 Docusaurus is the second TS generator; extraction to
> `@act-spec/generator-core` precedes PRD-404's leaf.

Generator work is about to dispatch PRD-404 (Docusaurus, A2 closed;
parseMode amended), then PRD-405 Next.js, PRD-406 Remix, PRD-407 Nuxt,
PRD-408 Eleventy, PRD-409 CLI. Doing the extraction before PRD-404
keeps PRD-404 as a clean leaf PR and avoids a follow-up rebase across
multiple generators. ADR-005 already extracted the parallel
`@act-spec/adapter-framework` package; this ADR mirrors that
extraction in shape and discipline. The pipeline code is the same
shape it had after the prework slice landed (no semantic drift since).
The conditions ADR-004 named are met.

## Decision

1. **New package.** Create `packages/generator-core/` with the same
   shape as the other `packages/*` workspaces (`package.json`,
   `tsconfig.json`, `tsconfig.eslint.json`, `vitest.config.ts`,
   `README.md`, `src/`). Published as `@act-spec/generator-core`,
   ESM-only, `exports` map gating the public surface, depending on
   `@act-spec/core`, `@act-spec/adapter-framework`, and
   `@act-spec/validator`.
2. **Move PRD-400 code via `git mv`.** The pre-extraction file
   `packages/plugin-astro/src/pipeline.ts` and its unit-test sibling
   `pipeline.test.ts` move to `packages/generator-core/src/` unchanged
   except for the framework-import path (now
   `@act-spec/adapter-framework` directly, the canonical post-ADR-005
   path; previously imported through `@act-spec/adapter-markdown`'s
   re-export). History is preserved.
3. **Public surface unchanged.** The new package's `src/index.ts`
   re-exports every type and function the astro generator previously
   exported under the framework section. The astro generator's
   `src/index.ts` continues to re-export the same symbols (now sourced
   from `@act-spec/generator-core`), so external consumers that imported
   `runPipeline`, `buildManifest`, `buildIndex`, `buildSubtree`,
   `emitFiles`, `enforceTargetLevel`, `enforceAdapterPinning`,
   `inferAchievedLevel`, `verifyCapabilityBacking`, `computeEtag`,
   `atomicWrite`, `cleanupTmp`, `PIPELINE_FRAMEWORK_VERSION`,
   `VERSIONED_TREES_SUPPORTED`, and the `GeneratorConfig` /
   `GeneratorPlugin` / `BuildContext` / `BuildReport` /
   `PipelineOutcome` / `PipelineRun` types from `@act-spec/plugin-astro` keep
   working byte-for-byte.
4. **Internal consumers updated.** `packages/plugin-astro/src/integration.ts`
   now imports framework symbols from `@act-spec/generator-core`
   directly (the shorter, canonical path). The astro generator package
   keeps a runtime dependency on `@act-spec/adapter-framework` (it
   needs the `Adapter` type for its options shape) and on
   `@act-spec/adapter-markdown` (it auto-wires `createMarkdownAdapter`
   in `resolveConfig`). New generator leaves (PRD-404 Docusaurus,
   PRD-405 Next.js, …) import directly from `@act-spec/generator-core`;
   they do not depend on `@act-spec/plugin-astro`.
5. **Workspace + project-references wiring.** Add the package to the
   root `tsconfig.json` references list (between
   `programmatic-adapter` and `astro`). Add it to `astro`'s composite
   reference graph alongside `adapter-framework`. `pnpm-workspace.yaml`
   already covers `packages/*`. `package.json` declares
   `@act-spec/generator-core: "workspace:*"` as a dependency of
   `@act-spec/plugin-astro` (and will of every future generator leaf).
6. **Coverage threshold mirrors the source.** The new package's
   `vitest.config.ts` carries the same 85%-line / 85%-functions /
   85%-statements floor that the astro generator has. The 37 framework
   tests that moved with the file produce 93.62% line / 100% function
   coverage on `pipeline.ts`, comfortably above the ADR-004 §"Coverage
   trend" baseline (≥85% line on the astro generator pre-extraction).
   The astro generator post-extraction holds 99.31% line / 100%
   function coverage on its remaining `integration.ts` surface (a
   handful of unused inline logger methods carry `/* v8 ignore next */`
   markers — these were never reached pre-extraction either; they were
   absorbed into the package-wide average by pipeline.ts's broader
   surface).
7. **ADR-004 §"Seam 2" marked DONE.** This ADR is the trigger; ADR-004's
   retro is amended in the same commit to record the closure.
8. **Out of scope.** The `@act-spec/adapter-markdown` runtime dependency
   in the astro generator stays in place — `resolveConfig` auto-wires
   the markdown adapter as the default first-party adapter (PRD-401-R6).
   New generator leaves (Docusaurus, Next.js, …) may auto-wire the
   markdown adapter or leave adapter wiring entirely to the host app;
   that decision belongs in each leaf's PRD, not in this extraction.

## Consequences

### Positive

- Subsequent generators (PRD-404 Docusaurus, PRD-405 Next.js, PRD-406
  Remix, PRD-407 Nuxt, PRD-408 Eleventy, PRD-409 CLI) import framework
  types from a single canonical package whose name reflects its purpose.
  No future generator needs to depend on `@act-spec/plugin-astro` to reach the
  framework.
- The three-consumers rule is respected: PRD-401 + PRD-404
  are the second consumer; the remaining generators (PRD-405,
  PRD-406, PRD-407, PRD-408, PRD-409) make this the most-shared
  framework in the monorepo. Extraction now is on-rule, not
  speculative.
- The seam ADR-004 named is closed with a date stamp; the retro stays
  honest about which seams are open vs closed.
- Surface stability is preserved: every external import of a framework
  symbol from `@act-spec/plugin-astro` continues to resolve. No semver-major
  break.
- Symmetry with ADR-005's adapter-framework extraction: the monorepo
  now has a clean adapter-framework / generator-core / leaf-package
  topology. Every adapter leaf depends on `@act-spec/adapter-framework`;
  every generator leaf depends on `@act-spec/generator-core`.

### Negative

- One additional published package (9 vs 8) increases the npm release
  matrix surface by one. Mitigated by the changesets workflow already
  in place (ADR-001).
- The astro generator's `index.ts` now does dual duty: it re-exports
  framework symbols from `@act-spec/generator-core` *and* exports
  PRD-401 leaf symbols from `./integration.js`. New consumers should
  prefer the direct package path (`@act-spec/generator-core`); the
  re-export remains for backward compatibility and is documented as
  such in the file's header comment.
- The `pipeline.test.ts` file carries `@act-spec/adapter-markdown` as
  a `devDependency` of `@act-spec/generator-core` because the tests use
  the real markdown adapter against a real fixture corpus rather than
  inline test adapters. This is a one-way devDep (markdown-adapter does
  not depend on generator-core), so there is no cycle. Future framework
  unit tests may prefer inline adapters to drop even this devDep, but
  that refactor is out of scope for this mechanical extraction (the
  existing tests must pass without modification per ADR-006's
  no-behavior-change rule).

### Neutral

- The astro generator continues to import `Adapter` from
  `@act-spec/adapter-framework` (transitively via
  `@act-spec/adapter-markdown`'s re-export pre-extraction; now via a
  direct dependency added in this PR's `astro/package.json`). This
  keeps the package import graph explicit and matches the post-ADR-005
  convention.
- The `conformance.ts` script in `@act-spec/plugin-astro` is unchanged: it
  still imports `runActBuild` from the astro package and calls it
  programmatically. The conformance gate exercises the leaf integration
  (which exercises the framework transitively); a separate
  framework-only conformance gate is not warranted (PRD-400 is
  framework-only and is exercised by every generator leaf's gate).

## Alternatives considered

- **Move PRD-400 code into `@act-spec/core`.** Rejected: ADR-001 §10
  pins `@act-spec/core` to wire-format types only. Pipeline
  orchestration, file emission, and adapter pinning are runtime
  mechanics, not wire types. Polluting core would couple every
  wire-format consumer to runtime helpers it doesn't need.
- **Move PRD-400 code into `@act-spec/adapter-framework`.** Rejected:
  the adapter framework and the generator framework are distinct
  PRDs (PRD-200 vs PRD-400) with distinct consumer sets. Adapters
  consume PRD-200 only; generators consume PRD-200 + PRD-400. Merging
  the packages would force every adapter to pull in pipeline
  orchestration code it never executes.
- **Defer extraction until two non-Astro generators exist.** Rejected:
  ADR-004 already named the trigger (the first new generator, PRD-404
  Docusaurus). Deferring further would force PRD-404 to either depend
  on `@act-spec/plugin-astro` for framework symbols (semantically wrong — a
  Docusaurus leaf shouldn't depend on an Astro leaf) or duplicate the
  framework (worse).
- **Bigger refactor: rename `@act-spec/plugin-astro` to `@act-spec/generator`
  and host both the framework and the Astro leaf there.** Rejected:
  same anti-pattern as the markdown-adapter case in ADR-005 — every
  generator would have to depend on a package whose name implies a
  specific host. Cleaner to keep `@act-spec/plugin-astro` as a leaf and host
  the framework in `@act-spec/generator-core`.
- **Rewrite the moved tests to drop the `@act-spec/adapter-markdown`
  devDep and use only inline test adapters.** Rejected for this PR:
  the extraction mandates "no behavior change" and "tests pass
  without modification (other than import path updates)". Re-shaping
  tests is a separate concern; if the devDep proves problematic in
  later generator work it can be revisited under a follow-up.

## Cross-references

- ADR-001 — Monorepo layout (defers framework package; this ADR is one
  of the promised follow-ups, pair to ADR-005).
- ADR-003 — Adapter framework + generator pipeline placement (originally
  placed PRD-400 inside the astro generator).
- ADR-004 — Vertical slice retro (named Seam 2 and the trigger
  conditions).
- ADR-005 — Extract `@act-spec/adapter-framework` from
  `@act-spec/adapter-markdown` (parallel extraction; same shape and
  discipline).
- `prd/400-generator-architecture.md` — PRD-400 source.
- `packages/generator-core/` — new package.

# ADR-005 — Extract `@act-spec/adapter-framework` from `@act-spec/adapter-markdown`

**Status:** Accepted
**Date:** 2026-05-02
**Author:** Jeremy Forsythe

## Context

ADR-001 §"Neutral" deferred extracting a dedicated PRD-200 framework
package to avoid premature abstraction in `@act/core`: no extraction
until a third concrete consumer exists. ADR-003 placed the PRD-200
framework code inside `@act-spec/adapter-markdown/src/framework.ts` for
the same reason — PRD-201 was the only first-party adapter in flight
during the v0.1 prework slice.

ADR-004 closed the v0.1 prework slice with an explicit retro entry
naming this seam (§"Where the seams are loose" → "Seam 1") and a
recommendation in §"Recommendations for the subsequent fan-out" item 1:

> Plan the PRD-200 framework extraction ahead of the next adapter. The
> first new adapter (PRD-208 programmatic) is the trigger; do the
> extraction first so subsequent adapters import from
> `@act-spec/adapter-framework` directly.

PRD-208 is the next adapter to land. Doing the extraction before PRD-208
keeps PRD-208 as a clean leaf PR and avoids a follow-up rebase across
two adapters. PRD-602 (multi-mount) and PRD-404 (parseMode) are now
Accepted, the prework amendments A1–A4 are closed, and the
markdown-adapter framework code is the same shape it had after the
slice landed (no semantic drift since). The conditions ADR-004 named
are met.

## Decision

1. **New package.** Create `packages/adapter-framework/` with the same
   shape as the other `packages/*` workspaces (`package.json`,
   `tsconfig.json`, `tsconfig.eslint.json`, `vitest.config.ts`,
   `README.md`, `src/`). Published as `@act-spec/adapter-framework`,
   ESM-only, `exports` map gating the public surface, depending only on
   `@act-spec/core`.
2. **Move PRD-200 code via `git mv`.** The pre-extraction file
   `packages/adapter-markdown/src/framework.ts` and its unit-test sibling
   `framework.test.ts` move to `packages/adapter-framework/src/`
   unchanged. History is preserved.
3. **Public surface unchanged.** The new package's `src/index.ts`
   re-exports every type and function the markdown-adapter previously
   exported under the framework section. The markdown-adapter's
   `src/index.ts` continues to re-export the same symbols (now sourced
   from `@act-spec/adapter-framework`), so external consumers that
   imported `Adapter`, `runAdapter`, `mergeRuns`, etc. from
   `@act-spec/adapter-markdown` keep working byte-for-byte.
4. **Internal consumers updated.** `packages/adapter-markdown/src/markdown.ts`
   and `packages/adapter-markdown/src/markdown.test.ts` now import
   framework symbols from `@act-spec/adapter-framework` directly (the
   shorter, canonical path). `packages/plugin-astro/src/pipeline.ts` continues
   to import through `@act-spec/adapter-markdown` for this PR — single-
   concern refactor, no behavior change. A follow-up PR may switch the
   astro generator to import from `@act-spec/adapter-framework` directly.
5. **Workspace + project-references wiring.** Add the package to the
   root `tsconfig.json` references list and to `markdown-adapter`'s
   composite reference graph. `pnpm-workspace.yaml` already covers
   `packages/*`. `package.json` declares
   `@act-spec/adapter-framework: "workspace:*"` as a dependency of
   `@act-spec/adapter-markdown`.
6. **Coverage threshold mirrors the source.** The new package's
   `vitest.config.ts` carries the same 85%-line / 85%-functions /
   85%-statements floor that the markdown-adapter has. The 33 framework
   tests that moved with the file produce 89.9% line coverage on
   `framework.ts` (and 100% function coverage), comfortably above the
   ADR-004 §"Coverage trend" baseline (≥85% line on the markdown-adapter
   pre-extraction).
7. **ADR-004 §"Seam 1" marked DONE.** This ADR is the trigger; ADR-004's
   retro is amended in the same commit to record the closure.
8. **Out of scope.** The PRD-400 generator pipeline extraction
   (ADR-004 §"Seam 2") waits for the second TS generator (PRD-404
   Docusaurus implementation) per ADR-004 recommendation 2. That seam
   stays open here.

## Consequences

### Positive

- Subsequent adapters (PRD-208, PRD-202, PRD-203, …) import framework
  types from a single canonical package whose name reflects its purpose.
  No future adapter needs to depend on `@act-spec/adapter-markdown`
  to reach the framework.
- The three-consumers rule is respected: PRD-201 + PRD-208
  are the second consumer; the astro generator (which consumes the
  framework via `runAdapter` / `mergeRuns` / `bubbleManifestCapabilities`
  from the pipeline) is the third. Extraction now is on-rule, not
  speculative.
- The seam ADR-004 named is closed with a date stamp; the retro stays
  honest about which seams are open vs closed.
- Surface stability is preserved: every external import of a framework
  symbol from `@act-spec/adapter-markdown` continues to resolve. No
  semver-major break.

### Negative

- One additional published package (8 vs 7) increases the npm release
  matrix surface by one. Mitigated by the changesets workflow already
  in place (ADR-001).
- The markdown-adapter's `index.ts` now does dual duty: it re-exports
  framework symbols from `@act-spec/adapter-framework` *and* exports
  PRD-201 leaf symbols from `./markdown.js`. New consumers should prefer
  the direct package path (`@act-spec/adapter-framework`); the
  re-export remains for backward compatibility and is documented as
  such in the file's header comment.

### Neutral

- The astro generator continues to import framework symbols through
  `@act-spec/adapter-markdown`. This is intentional for this PR (single-
  concern). A follow-up may switch to the direct dependency once the
  PRD-400 pipeline extraction (ADR-004 Seam 2) lands and the import
  graph is rewritten as a single, larger refactor.

## Alternatives considered

- **Move PRD-200 code into `@act-spec/core`.** Rejected: ADR-001 §10
  pins `@act-spec/core` to wire-format types only. Adapter lifecycle and
  multi-source merge are runtime mechanics, not wire types. Polluting
  core would couple every wire-format consumer to runtime helpers it
  doesn't need.
- **Defer extraction until two non-markdown adapters exist.** Rejected:
  ADR-004 already named the trigger (the first new adapter, PRD-208).
  Deferring further would force two adapters to either depend on
  `@act-spec/adapter-markdown` for framework symbols (semantically
  wrong) or duplicate the framework (worse).
- **Bigger refactor: extract PRD-400 generator pipeline at the same
  time.** Rejected: ADR-004 recommendation 2 explicitly delays that
  extraction until the second TS generator (PRD-404 Docusaurus) lands.
  Doing both in one PR breaks the single-concern rule and conflates
  triggers.
- **Keep framework code in `markdown-adapter` and rename the package
  to `@act-spec/adapter`.** Rejected: would force every adapter to
  depend on `@act-spec/adapter` (which historically held PRD-201 leaf
  code) — a leakier abstraction than a clean `adapter-framework`
  package. Also a noisier rename across consumers.

## Cross-references

- ADR-001 — Monorepo layout (defers framework package; this ADR is the
  promised follow-up).
- ADR-003 — Adapter framework + generator pipeline placement (originally
  placed PRD-200 inside markdown-adapter).
- ADR-004 — Vertical slice retro (named Seam 1 and the trigger
  conditions).
- `prd/200-adapter-framework.md` — PRD-200 source.
- `packages/adapter-framework/` — new package.

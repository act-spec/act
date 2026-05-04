# ADR-003 — Adapter framework + generator pipeline placement and library choices

**Status:** Accepted
**Date:** 2026-05-02
**Author:** Jeremy Forsythe

## Context

PRD-200 (adapter framework) and PRD-400 (generator architecture) define
abstract framework contracts. Their concrete leaves — PRD-201 (markdown
adapter) and PRD-401 (Astro plugin) — land alongside them. Two placement
decisions are forced:

1. **Where does the PRD-200 framework code live?** Options: in
   `@act-spec/core` as shared types + utilities; in a dedicated
   `@act-spec/adapter-framework` package; or co-located in the markdown
   adapter (the one current consumer).
2. **Where does the PRD-400 framework code live?** Options: in
   `@act-spec/core`; in a dedicated `@act-spec/generator-core` package;
   or co-located in `@act-spec/plugin-astro` (the one current consumer).

The repo avoids premature abstraction in `@act/core` — three concrete
usages before extracting. PRD-202–PRD-208 (other adapters) and
PRD-405–PRD-409 (other generators) are not first-party for v0.1; the
second consumer of either framework arrives later.

A third decision is forced by PRD-201: the markdown / MDX library stack.

## Decision

**Framework placement.** Co-locate framework code with its sole v0.1
consumer:

- PRD-200 framework lives in `@act-spec/adapter-markdown/src/framework.ts`.
  The Astro generator imports it via `@act-spec/adapter-markdown`'s public
  exports. When the second TS-first-party adapter lands, extract to a
  dedicated `@act-spec/adapter-framework` package.
- PRD-400 framework lives in `@act-spec/plugin-astro/src/pipeline.ts`. When a
  second TS leaf generator lands (e.g., a Next.js plugin in v0.2),
  extract to `@act-spec/generator-core`.

Both packages re-export the framework surface so downstream consumers
(future adapters / generators / inspectors) can depend on them today.

**ETag derivation.** Live in `@act-spec/validator`'s `etag.ts` (already
shipping). Both the markdown adapter (for caching pre-emit) and the
generator pipeline (for the canonical post-merge derivation per
PRD-103-R6/R8 and PRD-400-R8) import `deriveEtag` and `stripEtag` from
`@act-spec/validator`. One source of truth → no silent shared-type
widening on the wire-format core.

**Library choices for PRD-201 markdown adapter.**

- `unified` 11.x + `remark-parse` 11.x + `remark-frontmatter` 5.x +
  `remark-gfm` 4.x for markdown AST traversal. Chosen because they're
  the canonical TS markdown stack; hand-rolling markdown parsing is
  banned (NIH).
- `yaml@2` for YAML 1.2 frontmatter. Widely used, ESM-clean, no native
  deps.
- A bundled tiny TOML 1.0 subset parser (≈40 LoC) instead of pulling in
  `@iarna/toml`. PRD-201 frontmatter usage is small (key = scalar /
  array of scalars); shipping a full TOML parser triples the dep
  surface for a feature most projects won't exercise. Documented in
  `parseTomlSubset`.
- **MDX strategy: regex-detect uppercase JSX tags; do NOT load
  `@mdx-js/mdx` in v0.1.** PRD-201-R15's only behavior at v0.1 is
  emitting `marketing:placeholder` blocks per detected component. A
  full MDX AST adds a heavy dep (`@mdx-js/mdx`, `acorn`, multiple
  rollup plugins) for no v0.1 win — the placeholder behavior does not
  need MDX-aware parsing. When PRD-300 (component contract) lands and
  we need to extract real props, switch to `@mdx-js/mdx` and remove
  the regex.

**Library choice for PRD-401 Astro plugin.**

- Use Astro's official `AstroIntegration` API. Astro is declared as a
  `peerDependency` so the package is usable in non-Astro contexts (the
  conformance gate, programmatic build invocation via `runActBuild`,
  and tests).
- Do NOT spin a parallel build pipeline. The integration registers
  `astro:config:setup`, `astro:server:start`, `astro:build:done`. The
  PRD-400 pipeline runs from `astro:build:done` per PRD-401-R5.

## Consequences

### Positive

- One package per consumer keeps `@act-spec/core` minimal and stable.
  Any change to the framework surface stays in one place; no breaking
  PR rippling across leaves that don't exist yet.
- Library choices are small and conservative; both `unified` and
  Astro's integration API are well-trodden.
- The conformance gate is fast (no Astro CLI spin-up) — `runActBuild`
  is the same pipeline Astro invokes from `astro:build:done`.

### Negative

- When the second adapter lands, framework code must move. The move is
  a mechanical re-export rebase (the public API is already shaped for
  it), but it touches every leaf adapter's imports.
- The MDX regex approach silently underperforms on edge cases (nested
  JSX, mid-paragraph components). v0.1 documents the limitation;
  PRD-300 (component contract) will replace the regex with an MDX
  AST walk. Negative fixtures in `fixtures/201/` cover the common
  malformed-MDX cases.
- Bundling a TOML subset parser adds maintenance burden if PRD-201
  later admits richer TOML shapes. Mitigation: documented + bounded;
  swap to `@iarna/toml` if the surface grows.

### Neutral

- Astro is a heavy peer dep; users who want only the markdown adapter
  pull only `@act-spec/adapter-markdown`. Users who want the generator
  pull `@act-spec/plugin-astro` and accept the Astro install.

## Alternatives considered

- **PRD-200 framework in `@act-spec/core`.** Rejected: violates the
  three-consumers rule. PRD-201 is the only first-party adapter at this
  point; promoting now is premature abstraction.
- **PRD-400 framework in a dedicated `@act-spec/generator-core` from
  day one.** Rejected for the same reason. Easy to extract later when
  the second generator lands.
- **`@mdx-js/mdx` for MDX in v0.1.** Rejected: too heavy for the
  v0.1-only placeholder behavior. Re-evaluate when PRD-300 lands.
- **Hand-rolled JSON Schema validator.** Already rejected by ADR-002
  (`ajv`); applies transitively here. The pipeline reuses
  `@act-spec/validator`'s `validateNode` / `validateIndex` /
  `validateManifest` rather than re-deriving structural validation.
- **Stryker mutation testing on adapter / generator packages.** Per
  `docs/workflow.md`, the 75% mutation floor applies to wire-format
  core only. Skipped here; coverage threshold is 85% line per the same
  doc.

## Cross-references

- ADR-001 — monorepo layout.
- ADR-002 — ajv for runtime schema validation.
- `docs/workflow.md` — coverage and mutation thresholds.
- `docs/amendments-queue.md` A1 — `metadata.translations` dedupe.
  Surfaced in `framework.ts`'s `mergeMetadata` / `dedupeTranslations`
  with conservative interpretation per A1's "Proposed fix."

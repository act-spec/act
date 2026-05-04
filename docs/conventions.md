# Cross-package conventions

Coordinator-level conventions shared by every TypeScript package in this repo. Source of truth for cross-cutting choices is `docs/adr/`. This document is a quick reference.

## File naming

- Source files: `kebab-case.ts` (e.g. `discovery-walk.ts`, `etag-prober.ts`).
- Test files: co-located, `*.test.ts` next to the unit they cover (e.g. `etag-prober.ts` + `etag-prober.test.ts`).
- Type-only modules: `*.types.ts` when the file contains no runtime code; otherwise inline `export type` is preferred.
- Generated code: `src/generated/**`, gitignored, never edited by hand.
- Scripts: `scripts/<name>.ts`, run via `tsx`.

## Public API surface

- Each package's `exports` map declares every public entry point. `main` and `types` mirror the `.` entry. Anything not in `exports` is private.
- The `files` field gates what npm publishes: `dist` + `src` (so consumers can read source for debugging).
- Re-exports of `@act-spec/core` types from leaf packages are permitted and encouraged for consumer convenience; the source-of-truth location for the type stays in `core`.
- Default exports are forbidden. Named exports only.

## TypeScript

- Every package extends `tsconfig.base.json`. Do not loosen `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, or `exactOptionalPropertyTypes` per-package.
- `// @ts-expect-error` requires a comment with the underlying issue and a TODO. `any` is grep-banned by the lint rule `@typescript-eslint/no-explicit-any: error`.
- Imports of TypeScript files use the `.js` extension (NodeNext resolution). Imports of types use `import type` or `import { type Foo }`.

## Test conventions

- Vitest, one `vitest.config.ts` per package.
- Every test cites a `PRD-{NNN}-R{n}` in either the `describe`/`it` name or a comment immediately above. Anti-pattern: "coverage theater" — tests that hit lines without verifying a requirement.
- Coverage thresholds are enforced by QA per `docs/workflow.md`, not per-package.
- Mutation testing (Stryker) runs nightly on wire-format-core packages (`@act-spec/core`, `@act-spec/validator`); leaf packages are exempt below the role-manual's stated threshold.

## Fixture loading

- Fixtures live at the repo root in `fixtures/{NNN}/{positive,negative}/*.json`. They are the Spec Steward's deliverable and must not be duplicated into a package.
- Loading helper convention: each package's tests use a `loadFixture(series, kind, name)` utility resolving from the repo root. The helper lives in `@act-spec/core`'s test utils once a third consumer materializes; until then, leaf packages may inline it.
- Negative fixtures carry `_fixture_meta.expected_error` matching PRD-600's `gaps[]` reporter shape; assertions read this field rather than hard-coding the expected error inline.

## Error-class hierarchy

- A package emitting structured errors derives them from a single base `ActError` (lives in `@act-spec/core` once we have one). Each subclass carries `code: string` (the PRD-600 reporter `code` enum extended where appropriate), `requirement?: string` (a `PRD-{NNN}-R{n}` citation), and `cause?: unknown`.
- Errors thrown across the package boundary are always instances of the package's exported error classes — never bare `Error`. This keeps consumer `catch` blocks narrow.

## Workspace dependencies

- Internal references use `workspace:*` to keep monorepo builds in lockstep. The `release.yml` workflow rewrites these on publish via changesets.
- Adding a new external dependency to a leaf package requires the Lead's review (per the role manual). Prefer composing existing first-party packages.

## Conformance script

- Every package has a `conformance` script in its `package.json`. Until PRD-600 ships, the script is a stub: `node -e "console.log('no conformance gate yet for $pkg')"` exiting 0. Once PRD-600 lands, the script invokes `act-validate --conformance` against the package's emitted output.
- The CI lint enforces presence of the script. A missing or skipped `conformance` script fails CI (anti-pattern: "conformance gate skipping").

# ADR-002 — Validation library: Ajv 8 over hand-rolled / zod

**Status:** Accepted
**Date:** 2026-05-02
**Author:** Jeremy Forsythe

## Context

PRD-600 (the validator) is the conformance gate every other PRD's reference implementation depends on. Its primary job is structural validation of every wire-format envelope (`manifest`, `index`, `index-entry`, `node`, `subtree`, `error`) against the locked JSON Schemas at `schemas/100/*.schema.json`. Behavioral checks (ETag derivation per PRD-103, mounts coherence per PRD-106, conformance-level inference per PRD-107) layer on top.

The constraint is unambiguous: PRD-100-R0 declares the JSON Schemas authoritative ("inline schemas in PRD-100 are reproductions for reading convenience; the files in `schemas/100/` are authoritative"). PRD-600-R1 echoes that requirement: the validator MUST validate against `schemas/100/*.schema.json` and MUST NOT carry a parallel inline schema that could drift.

Hand-rolling JSON Schema is explicitly banned (NIH for spec-validation). This ADR documents the choice and the rejected alternatives.

## Decision

`@act-spec/validator` uses **Ajv 8** (specifically `ajv/dist/2020.js` for JSON Schema 2020-12 support) plus `ajv-formats` for the `format` keyword (`uri`, `uri-reference`, `date-time`).

The schema bundle loader (`packages/validator/src/schemas.ts`) reads every `*.schema.json` under `schemas/` at module init, registers each by canonical `$id` (`https://act-spec.org/schemas/0.1/<name>.schema.json`) so cross-`$ref` resolution works, then compiles seven validators by `$id` lookup:

- `manifest`, `index`, `node`, `subtree`, `error` — PRD-100 envelopes.
- `indexEntry` — PRD-100-R37 NDJSON line shape (the `$defs/IndexEntry` sub-schema).
- `etag` — PRD-103-R3 admit-list (kept compiled for code-paths that want a standalone check; current implementation also exposes the regex directly).

Ajv error objects are translated to PRD requirement IDs by a small mapping table (`ajvErrorToRequirement`), so every emitted `gaps[]` entry cites a `PRD-{NNN}-R{n}` per PRD-600-R2 / R19.

**Behavioral checks (not expressible in JSON Schema) live in dedicated TypeScript modules:**

- `etag.ts` — JCS canonicalization (RFC 8785) + SHA-256 + base64url + 22-char truncation, with `s256:` prefix. PRD-103-R4 / R6 derivation; PRD-600-R7 / R8.
- `cycles.ts` — children-graph cycle detection (PRD-100-R25, PRD-600-R13).
- `mounts.ts` — overlapping-prefix detection (PRD-106-R20, PRD-600-R3).
- `walk.ts` — discovery walk + ETag determinism prober (PRD-103-R7) + If-None-Match prober (PRD-103-R8) + auth-challenge prober (PRD-106-R5/R8).

The reporter assembly (`reporter.ts`) is pure data — no library dependency.

## Consequences

### Positive

- **Spec-fidelity by construction.** Every envelope is checked against the locked schema files. Drift between PRD-100's inline schema and the implementation's checks is impossible.
- **Battle-tested:** Ajv is the de facto JSON Schema validator for the JS ecosystem (≥40M downloads/week). Its keyword coverage and standards conformance are known-good.
- **Friendly errors:** Ajv 8's error objects expose `instancePath` (RFC 6901 JSON Pointer), `keyword`, `params`, `message` — all of which our PRD-600-R19 `gaps[]` mapping uses verbatim.
- **Tree-shakable:** The `ajv/dist/2020.js` entry point includes only the 2020-12 dialect. We do not pull in Draft-07 / Draft-04 baggage.
- **One mental model:** Schemas live in `schemas/`. The validator reads them. Codegen (`@act-spec/core`) reads the same files. There is no second source of truth.

### Negative

- **ESM/CJS interop wart.** Ajv 8 publishes a CJS default-export. Under TypeScript's `verbatimModuleSyntax` the default-import surfaces with type-system gymnastics; the validator's `schemas.ts` casts the import to a typed constructor. A future Ajv 9 ESM-native release will simplify this. Documented inline in `schemas.ts`.
- **Bundle size.** Ajv's standalone footprint is ~120 kB minified. The hosted SPA (PRD-600-R28) absorbs this; on the SPA the cost is measured-once-cached. CLI footprint is irrelevant.
- **Schema-vs-PRD-citation mapping is hand-maintained.** When a new PRD-100 requirement lands as a schema rule, `ajvErrorToRequirement` may need a new entry. Tested at unit level with explicit cases per requirement keyword.

### Neutral

- We do not use Ajv's `$async` features. All schemas are sync.
- We do not enable Ajv's `coerceTypes` mode; the wire format is strict.
- We do not use Ajv's `removeAdditional`; PRD-108-R7 mandates that consumers tolerate (not strip) unknown fields.

## Alternatives considered

### Hand-rolled JSON Schema validator

**Rejected.** Re-implementing well-trod problem domains burns time on solved problems and ships subtle bugs (NIH for spec-validation). JSON Schema 2020-12 has hundreds of edge cases (`$dynamicRef`, `unevaluatedProperties`, format conformance, `allOf` short-circuit semantics) that are tested-into-submission in Ajv. A first-party reimplementation would burn weeks and ship CVE-shaped defects.

### Zod (https://zod.dev) with schema-derived types

**Rejected.** Zod is excellent for application-layer schemas where TypeScript is the source of truth, but here the source of truth is the JSON Schema files. Adopting Zod would mean either:
1. Hand-maintaining a parallel Zod-shaped schema set — exactly the "drift" PRD-600-R1 prohibits.
2. Generating Zod schemas from JSON Schema (`json-schema-to-zod`) — adds an extra transform layer with its own semantic gaps.

Zod is also less keyword-complete than Ajv (e.g., `$ref` cross-schema resolution requires `zod-from-json-schema` adapters that don't fully cover 2020-12). Net: worse fit for our authoritative-JSON-Schema constraint.

### Valibot (https://valibot.dev)

**Rejected** for the same reason as Zod (TypeScript-source-of-truth design) plus a smaller ecosystem; same drift risk.

### `@apidevtools/json-schema-validator` / `jsonschema` (npm)

**Rejected.** Both are JSON Schema validators but lag Ajv on Draft-2020-12 support and have markedly worse error-object ergonomics. We already use `json-schema-to-typescript` (which itself depends on `@apidevtools/json-schema-ref-parser`) for codegen — pulling in a second JSON Schema engine for validation would be redundant.

## Supersession

This ADR may be superseded by a future ADR-NNN if:
- A v0.2 spec adds JSON Schema 2024 features Ajv doesn't yet support.
- The hosted SPA's bundle-size budget forces a swap to a smaller validator (e.g., `@cfworker/json-schema`).
- A first-party port to a non-TS language (Python/Go/Rust per Q3) needs schema-shape compatibility a JS-only library can't promise.

None of these apply for v0.1.

## References

- PRD-600 §"Implementation notes" (Snippet 2 — schema bundle loader).
- PRD-100-R0 (schemas authoritative).
- PRD-600-R1 / R2 / R5 / R6 / R31 (validation surface anchored to schemas).
- ADR-001 (monorepo layout — pins TS-only first-party impl).
- `docs/amendments-queue.md` A7 — etag top-level shape ambiguity surfaced during PRD-600 implementation.

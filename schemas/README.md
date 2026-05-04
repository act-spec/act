# ACT v0.1 schemas — index and conformance fixture conventions

This directory houses the canonical JSON Schemas (Draft 2020-12) that the
PRD-100-series wire-format PRDs are normatively pinned against. Companion
fixtures live in `fixtures/`.

Schemas are locked at gate G1. Subsequent edits route through the
`docs/amendments-queue.md` triage flow (gate G3).

---

## Schema index

Each schema's `$id` follows the canonical pattern
`https://act-spec.org/schemas/0.1/<name>.schema.json`. Rows below list
the schema, its source PRD, and the `PRD-{NNN}-R{n}` requirement IDs the
schema enforces (S = schema-checkable; F = fixture-checkable but not at
the schema layer; P = process-only and out of schema scope).

### Wire-format core (PRD-100)

| Schema file | `$id` | Source PRD | Requirements covered (S) |
|---|---|---|---|
| `100/manifest.schema.json` | `https://act-spec.org/schemas/0.1/manifest.schema.json` | PRD-100 | R1, R3, R4, R5, R6 (closed object form), R7 (mounts shape), R8 (optional fields), R9 (no new required fields beyond R4 + PRD-107) |
| `100/index.schema.json` | `https://act-spec.org/schemas/0.1/index.schema.json` | PRD-100 | R1, R16, R17, R18 (no `content`), R19 (summary non-empty), R37 (NDJSON line shape via `$defs/IndexEntry`) |
| `100/node.schema.json` | `https://act-spec.org/schemas/0.1/node.schema.json` | PRD-100 | R1, R10 (ID grammar with variant extension per A6), R11 (256 byte cap), R21, R22, R23 (summary_source string), R24, R28 (block discriminator). Cross-cuts PRD-102: `related` items follow PRD-102-R18 per amendment A5. |
| `100/subtree.schema.json` | `https://act-spec.org/schemas/0.1/subtree.schema.json` | PRD-100 | R1, R32, R33 (depth ≤ 8), R34, R35 |
| `100/error.schema.json` | `https://act-spec.org/schemas/0.1/error.schema.json` | PRD-100 | R1, R41 (closed `error.code` enum), R42 (message string), R43 (details object), R44 (closed top-level shape) |

### Discovery (PRD-101)

| Schema file | `$id` | Source PRD | Requirements covered (S) |
|---|---|---|---|
| `101/profile-parameter.schema.json` | `https://act-spec.org/schemas/0.1/profile-parameter.schema.json` | PRD-101 | R7 (closed `profile` enum) |
| `101/link-header.schema.json` | `https://act-spec.org/schemas/0.1/link-header.schema.json` | PRD-101 | R5 (Link header shape on every authenticated runtime response), R7 (closed `profile` enum within the header) |

PRD-101's other requirements (R1 well-known path, R3 `/llms.txt`, R8
discovery algorithm, R10 longest-prefix mounts, R11 cross-origin trust,
R12 discovery-context-vs-`delivery` consistency) are all (F) and live in
PRD-600's integration probes; the fixture corpus exercises them, but
they are not single-schema rules.

### Content blocks (PRD-102)

| Schema file | `$id` | Source PRD | Requirements covered (S) |
|---|---|---|---|
| `102/block-markdown.schema.json` | `https://act-spec.org/schemas/0.1/block-markdown.schema.json` | PRD-102 | R1 |
| `102/block-prose.schema.json` | `https://act-spec.org/schemas/0.1/block-prose.schema.json` | PRD-102 | R2 |
| `102/block-code.schema.json` | `https://act-spec.org/schemas/0.1/block-code.schema.json` | PRD-102 | R3 |
| `102/block-data.schema.json` | `https://act-spec.org/schemas/0.1/block-data.schema.json` | PRD-102 | R4 |
| `102/block-callout.schema.json` | `https://act-spec.org/schemas/0.1/block-callout.schema.json` | PRD-102 | R5 (closed `level` enum) |
| `102/block-marketing-namespace.schema.json` | `https://act-spec.org/schemas/0.1/block-marketing-namespace.schema.json` | PRD-102 | R6 (namespace pattern). R7–R11 (per-canonical-type field shapes) are not enforced at the namespace schema; per PRD-102 the namespace is documented-open and per-type fields are normative-prose-only at the schema layer. |

PRD-102 requirements that span the node envelope (R12 summary_source,
R18–R20 `related`, R21–R23 component-extracted blocks, R24 block ordering,
R25 children-cycle prohibition, R29–R32 variants) are enforced via the
node schema (R12 type, R18 items shape) and via PRD-600 integration probes
(R20 cycle tolerance, R24 ordering, R25 cycle prohibition, R30 base-node
emission paired with variants).

### Caching / ETag (PRD-103)

| Schema file | `$id` | Source PRD | Requirements covered (S) |
|---|---|---|---|
| `103/etag.schema.json` | `https://act-spec.org/schemas/0.1/etag.schema.json` | PRD-103 | R1 (etag presence — enforced by referrers), R2 (value-shape), R3 (v0.1 strict s256:[A-Za-z0-9_-]{22}). R4–R12 (derivation recipe, runtime HTTP semantics, NDJSON line etag) are (F) and live in PRD-600. |

### Security (PRD-109)

| Schema file | `$id` | Source PRD | Requirements covered (S) |
|---|---|---|---|
| `109/auth-schemes.schema.json` | `https://act-spec.org/schemas/0.1/auth-schemes.schema.json` | PRD-109 | R6 (ordered array), R7 (OAuth required fields via `if/then`), R8 (api_key header_name advisory). The `kind` enum is closed. |
| `109/www-authenticate.schema.json` | `https://act-spec.org/schemas/0.1/www-authenticate.schema.json` | PRD-109 | R4 (401 reserved), R5 (one challenge per advertised scheme — structural shape; the 1:1 cardinality with `auth.schemes` is enforced by PRD-600 against this schema), R9 (auth-param non-PII — prose-only at the schema layer) |
| `109/cross-origin-mount-trust.schema.json` | `https://act-spec.org/schemas/0.1/cross-origin-mount-trust.schema.json` | PRD-109 | R21 (algorithm input/output shape) |

PRD-109 process-only / integration-level requirements: R1, R2, R3, R4
(401-vs-404 collapse), R10–R15 (per-tenant scoping, error-message PII
prohibition), R16, R17 (etag determinism — paired with PRD-103), R18, R19
(DoS posture), R20 (constant-time act_version rejection), R22 (per-node
"agents only" non-feature warning), R23 (well-known path is a public
feature). PRD-600 probes these.

### `additionalProperties` policy

Default is `true` across the wire-format core, in line with PRD-108-R7
(consumers MUST tolerate unknown optional fields). The closed sub-objects
that explicitly use `additionalProperties: false` are:
- `manifest.conformance` (per PRD-107-R2 — the level enum is closed)
- `error` (per PRD-100-R41 / PRD-100-R44 — the envelope shape is fully pinned)
- `109/cross-origin-mount-trust.schema.json` input/output (PRD-109-R21 — the algorithm I/O is fully pinned)
- `109/www-authenticate.schema.json` (PRD-109-R4/R5 — the parsed shape is the contract)

---

## Fixture conventions

Fixtures live under `fixtures/{NNN}/{positive,negative}/`.
The fixture filename SHOULD be slugged from the requirement ID it
exercises, e.g., `manifest-missing-act-version.json` (negative for
PRD-100-R1) or `block-callout.json` (positive for PRD-102-R5).

### Positive fixtures

A positive fixture is a JSON document that MUST validate green against
its declared schema. Many positive fixtures carry a top-level `$comment`
or `_fixture_meta.satisfies: ["PRD-{NNN}-R{n}", ...]` array citing the
requirements the fixture demonstrates. Validators MUST strip these meta
fields before validation (the validation harness in
`tmp_validate/validate.mjs` does so).

### Negative fixtures and the PRD-600 reporter `gaps[]` shape

PRD-600's reporter emits `gaps[]` entries with the shape
`{level: "core"|"standard"|"plus", requirement: "PRD-NNN-R{n}",
missing: "<human-readable description>"}` per PRD-600-R19 / PRD-107
reporter schema. **Every negative fixture MUST document the expected
`gaps[]` entry it triggers.**

Two equivalent conventions are accepted; pick whichever matches the
fixture's existing structure:

1. **Sidecar `_fixture_meta` block** (preferred for new fixtures and for
   PRD-100, PRD-102, PRD-109):
   ```json
   {
     "_fixture_meta": {
       "prd": "PRD-100",
       "violates": ["PRD-100-R10"],
       "describes": "...",
       "expected_error": {
         "level": "core",
         "requirement": "PRD-100-R10",
         "missing": "Node id contains uppercase characters; ID grammar admits lowercase ASCII alphanumeric only.",
         "kind": "error"
       }
     },
     "...envelope content...": "..."
   }
   ```
   Optional `expected_error.kind` distinguishes `"error"` (default — emit
   `gaps[]` entry) from `"warning"` (emit `warnings[]` entry per
   PRD-600-R20 — used for PRD-102-R28 body-size, PRD-109-R22 per-node
   non-feature flag, PRD-102 data-as-content advisory).

2. **Top-level `expected_finding` (or `expected_validator_finding`) block**
   (PRD-103 fixtures use this; both forms are accepted). Same `{level?,
   requirement, missing, kind?}` shape.

For multi-case fixtures like `etag-whitespace-and-bad-charset.json` the
`cases[]` array carries one expected `requirement` at the file level
that applies to every case.

### Integration-only negative fixtures

Some PRD requirements are not expressible in a single JSON Schema rule:
cycles in `children` (PRD-100-R25 / PRD-102-R25), discovery-context
matching (PRD-101-R12), runtime ETag determinism (PRD-103-R7,
PRD-109-R17), HTTP `If-None-Match` honoring (PRD-103-R8), runtime auth
flows (PRD-101-R5, PRD-109-R5), per-tenant scoping (PRD-109-R13),
cross-tenant cache poisoning (PRD-109-R13). Fixtures targeting these
requirements live in the corpus but are tagged
`_fixture_meta.expected_error.kind: "integration-only"` (or simply omit
schema mapping; PRD-600 exercises them at the validator integration-test
layer).

### Fixture-corpus gaps noted at G1

Some PRD-100 (S) requirements lack a negative fixture pair in v0.1 and
are noted here as deliberate v0.1 gaps; PRD-600 may add fixtures under
`fixtures/600/` during its build phase:

- **PRD-100-R7** (mounts entry shape — `prefix`/`delivery`/`manifest_url`
  required). The manifest schema enforces it; no isolated negative fixture.
- **PRD-100-R11** (id ≤ 256 bytes UTF-8). The schema enforces `maxLength: 256`
  on ASCII; PRD-600 owns the byte-length probe for any future non-ASCII
  extension.
- **PRD-100-R37 / R38** (NDJSON index variant: line shape, MIME `profile=ndjson`).
  The line shape is the index `$defs/IndexEntry` schema. PRD-600 adds a
  full NDJSON-file probe at integration time.
- **PRD-101-R1, R3, R4, R5, R6, R8, R10, R11, R12** — discovery flow,
  predominantly integration-level. Existing positive/negative pairs cover
  R5 (link-header), R7 (profile parameter), R12 (mismatched-delivery).

Validation harness (`tmp_validate/validate.mjs`, used during G1 close)
confirms every positive fixture in the wire-format core that has a
schema mapping validates green and every negative fixture rejects.

---

## Self-validation

To re-run the G1 self-validation harness after a schema or fixture
change:

```sh
cd tmp_validate
node validate.mjs
```

Expected output at G1 close (2026-05-02):

```
Loaded 24 schemas.
Positive fixtures: 27/27 validated green
Negative fixtures: 21/21 rejected as expected
Skipped (no schema mapping; integration-layer): 16
```

The skipped count is the integration-only fixtures (HTTP transcripts,
hash-derivation worked examples, discovery traces) — PRD-600's prober
exercises them, not a static schema.

---

## Versioning

Schemas are versioned implicitly via their `$id` segment `0.1`. A future
MINOR adds new optional fields and enum values per PRD-108-R4; the `$id`
remains `0.1` until a MAJOR superseding cycle. Schemas are edited in place
for trivial clarifications; semantic changes route through the amendments
queue (In review → Accepted with maintainer sign-off) or a superseding PRD.

## Open amendments referenced inline

The schemas under G1 lock cite the following amendment-queue entries
inline (see `docs/amendments-queue.md`):

- **A5** — PRD-100 vs PRD-102 conflict on `node.related` shape. The
  `node.schema.json` file follows PRD-102-R18's `[{id, relation}]` form
  (the more specific specification); PRD-100's inline array-of-strings
  shape will be aligned at G3 amendment triage. Trivial-inline pending.
- **A6** — PRD-100 vs PRD-102 conflict on the variant ID grammar.
  All ID-bearing patterns admit an optional `@<variant_key>` suffix per
  PRD-102-R29; PRD-100-R10 will be amended at G3 to admit the same.
  Trivial-inline pending.

Neither A5 nor A6 blocks G1 — both are trivial-inline alignments and the
schemas already encode the conservative interpretation.

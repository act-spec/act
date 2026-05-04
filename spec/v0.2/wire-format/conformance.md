---
title: Conformance levels
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Conformance levels

> ACT defines three conformance levels: **Core**, **Standard**, and
> **Strict**. Producers declare the level they target via the manifest's
> `conformance.level` field; validators verify compliance against the
> declared level. Level names are normative identifiers and remain stable
> across the v0.2.x release line. Additions to a level constitute a
> `MINOR` spec bump; redefinitions or removals require a `MAJOR` spec
> bump.

## Overview

The three levels exist to give producers a clear, low-friction onramp
and consumers a simple negotiation surface. A producer SHOULD pick the
lowest level that meets the producer's actual delivery contract; a
consumer SHOULD reject producers below the consumer's minimum required
level rather than silently degrade.

Level names are declared in the manifest as the lowercase strings
`"core"`, `"standard"`, `"strict"` (the wire enum follows the level
names verbatim). Adding a fourth value to the enum is a MAJOR change.

A producer that declares Strict MUST satisfy every Standard requirement
(transitively, every Core requirement). A producer that declares
Standard MUST satisfy every Core requirement. Levels are additive in
the consumer-facing direction: a consumer requiring Standard MUST
accept any producer declaring Standard or Strict.

## Core

Core is the floor. A Core producer is discoverable, parseable, and
walkable, but is permitted to omit i18n, the subtree endpoint, the
search advertisement, and the marketing block namespace. Core is the
target for tiny static sites and minimum-viable adapters.

A producer declaring `conformance.level: "core"` MUST satisfy every
requirement below.

- **Manifest:** publish a manifest validated by
  [`schemas/100/manifest.schema.json`](../../../schemas/100/manifest.schema.json)
  with the required field set: `act_version`, `site.name`, `index_url`,
  `node_url_template`, `conformance.level`, `delivery`. See
  [manifest.md](./manifest.md).
- **Discovery:** static-profile producers MUST publish the manifest at
  `/.well-known/act.json`; runtime-only producers MUST emit the
  `Link: </.well-known/act.json>; rel="act"; profile="runtime"` HTTP
  header on every authenticated response. See
  [security.md](./security.md).
- **Index:** publish an index validated by
  [`schemas/100/index.schema.json`](../../../schemas/100/index.schema.json).
  See [index.md](./index.md).
- **Node:** for every entry in the index, publish a node JSON validated
  by [`schemas/100/node.schema.json`](../../../schemas/100/node.schema.json).
  Block types: at minimum `markdown`. See [node.md](./node.md).
- **ID grammar:** every node id MUST match
  `^[a-z0-9]([a-z0-9._\-]|/)*[a-z0-9]$` and MUST be ≤ 256 bytes UTF-8.
- **`children` cycles:** PROHIBITED.
- **Summary:** every node and every index entry MUST carry a non-empty
  `summary`.

Core does not mandate ETag emission, the subtree endpoint, the NDJSON
index, the search endpoint, the `marketing:*` namespace, the i18n
manifest, or the `abstract` disclosure level.

## Standard

Standard is the production target. A Standard producer is fully
walkable with conditional-fetch optimization, supports a richer block
set, and offers structured cross-references. Standard is the target
for most public docs sites, corporate marketing sites, and
content-managed knowledge bases.

A producer declaring `conformance.level: "standard"` MUST satisfy every
Core requirement (above) AND each of the following.

- **ETag:** every node and every index entry MUST carry a strong
  validator `etag` of the form `s256:<22 base64url chars>`. Conditional
  GET (`If-None-Match`) MUST resolve to `304 Not Modified` on match.
  See [etag.md](./etag.md).
- **Block set:** support for `prose`, `code`, `data`, `callout` blocks
  in addition to `markdown`. Block schemas live under
  [`schemas/102/`](../../../schemas/102/).
- **Subtree endpoint (SHOULD):** a Standard producer SHOULD advertise
  `subtree_url_template` and serve subtree responses at the substituted
  URL. The subtree response is validated by
  [`schemas/100/subtree.schema.json`](../../../schemas/100/subtree.schema.json).
- **Capabilities:** the manifest MUST declare `capabilities.etag: true`.
- **HTTPS:** transport MUST be HTTPS for any production deployment.
  See [security.md](./security.md).
- **CORS:** static-profile manifests SHOULD serve
  `Access-Control-Allow-Origin: *`.
- **Schema validation:** every manifest, every index, every node, and
  every subtree response MUST validate clean against the corresponding
  schema. A producer that emits any envelope failing schema validation
  is non-conformant.

Standard does not mandate the search endpoint, the `marketing:*`
namespace, the NDJSON index, or runtime-mode authentication. Those are
Strict-tier additions.

## Strict

Strict is the high-stakes target — for runtime-mode producers,
enterprise deployments, large trees that need NDJSON sharding,
producers offering search, and any deployment that requires
authentication. Strict is the target for vendor-hosted ACT services,
auth-gated workspaces, and producers shipping marketing landing pages.

A producer declaring `conformance.level: "strict"` MUST satisfy every
Standard requirement (transitively, every Core requirement) AND each
of the following.

- **Runtime mode (when applicable):** runtime-profile producers MUST
  honor authenticated requests per [security.md](./security.md). The
  manifest MUST declare an `auth.schemes` array; runtime 401 responses
  MUST include one `WWW-Authenticate` header per advertised scheme in
  preference order. The 404-vs-401 disclosure rule MUST be observed.
- **Subtree:** the subtree endpoint MUST be served (not just SHOULD).
  Default depth MUST be `3`; maximum depth MUST be `8`.
- **Marketing namespace:** consumers MUST tolerate `marketing:*`
  blocks and producers MAY emit them. Strict producers shipping
  landing-page content typically populate this namespace.
- **NDJSON index (when sharded):** producers whose tree exceeds
  ~10000 nodes SHOULD shard via NDJSON; the manifest declares
  `index_ndjson_url`.
- **Search advertisement (when offered):** if the producer offers
  search, the manifest MUST declare `search_url_template` and
  `capabilities.search.template_advertised: true`.
- **Bearer-token auth on per-node fetches (runtime-only):** when
  authentication is required, runtime endpoints MUST honor a bearer
  token in the `Authorization` header per the manifest's declared
  `api_key` scheme (or equivalent OAuth2 scheme). See
  [security.md](./security.md).
- **CORS preflight:** runtime-profile Strict producers MUST handle
  `OPTIONS` preflight correctly when serving cross-origin consumers.
- **Content sanitization expectations:** producers SHOULD NOT emit
  active-script payloads in prose blocks. Consumers MUST sanitize
  prose-block content before rendering. See [security.md](./security.md).

## Validator

Every conformant publisher MUST validate clean against `@act-spec/validator`
at the declared level. The validator implements the algorithm defined
in this document and the per-document schemas referenced above. The
validator is the authoritative operationalization of the level
contract — wherever this prose and the validator's behavior disagree,
the prose is authoritative and the validator is bug-for-fix.

Running the validator:

```
npx @act-spec/cli actree validate https://docs.example.com
```

The validator emits a structured report (see "Conformance reporting"
below) and exits non-zero on any `gaps` entry at or below the producer's
declared level.

## Test fixtures

Reference fixtures live at [`fixtures/`](../../../fixtures/) (in the
repository). Each conformance level has a positive fixture suite (every
fixture MUST validate clean) and a negative fixture suite (every
fixture MUST be rejected with a specific finding). Adapter and
generator implementations exercise these fixtures as part of `pnpm -r
conformance`; producers SHOULD adopt the same fixture suite as a
regression baseline.

## Conformance reporting

A conformance report is a JSON document with the following minimum
shape:

```json
{
  "act_version": "0.2",
  "url": "https://docs.example.com",
  "declared": { "level": "standard", "delivery": "static" },
  "achieved": { "level": "standard", "delivery": "static" },
  "gaps": [],
  "warnings": [],
  "passed_at": "2026-05-03T12:00:00Z"
}
```

- `declared` is the level and delivery the producer declared in its
  manifest.
- `achieved` is the highest level the producer actually meets when
  probed. If the producer fails Core, `achieved.level` is `null`.
- `gaps` is an array of objects with `level`, `requirement`, and
  `missing` fields. Each declared-but-not-achieved level MUST result
  in at least one `gaps` entry.
- `warnings` is an array of non-blocking observations (e.g., "summary
  length exceeds the 50-token guideline"). Warnings MUST NOT cause
  `achieved` to differ from `declared`.

Producers SHOULD publish a recent conformance report alongside their
manifest (e.g., at `/act/conformance.json`) so consumers can audit
without re-probing. Publishing a report is OPTIONAL and is not part of
the conformance contract itself.

## Stability guarantee

The names `Core`, `Standard`, and `Strict` are normative and remain
stable for the entire v0.2.x line. The wire enum values
(`"core"`, `"standard"`, `"strict"`) likewise remain stable. Additions
to a level (e.g. a new MUST field) constitute a `MINOR` bump of the
spec; redefinitions or removals require a `MAJOR` bump. Renaming any
level name is MAJOR.

## Examples

### Declared Core, achieved Core (passing)

```json
{
  "act_version": "0.2",
  "url": "https://example.com",
  "declared": { "level": "core", "delivery": "static" },
  "achieved": { "level": "core", "delivery": "static" },
  "gaps": [],
  "warnings": [
    { "level": "core", "code": "summary-length", "message": "intro/getting-started summary is 67 tokens (SHOULD be ≤ 50)." }
  ],
  "passed_at": "2026-05-03T12:00:00Z"
}
```

### Declared Standard, achieved Core (failing)

```json
{
  "act_version": "0.2",
  "url": "https://example.com",
  "declared": { "level": "standard", "delivery": "static" },
  "achieved": { "level": "core", "delivery": "static" },
  "gaps": [
    { "level": "standard", "requirement": "etag", "missing": "Manifest does not declare capabilities.etag: true; index entries lack the etag field." }
  ],
  "warnings": [],
  "passed_at": "2026-05-03T12:00:00Z"
}
```

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

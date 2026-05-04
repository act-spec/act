---
title: Manifest
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Manifest

> The ACT manifest is the single discovery document a consumer fetches first.
> It declares the producer's spec version, conformance level, delivery
> profile, the URL templates a consumer uses to walk the rest of the tree,
> and the optional capabilities the producer supports. The manifest is the
> root of the contract; every other ACT document referenced from the
> manifest is reached via templates declared in it.

## Discovery

A static-profile producer MUST publish its manifest at the absolute path
`/.well-known/act.json`, scoped to the producer's origin. The path is
normative; producers MUST NOT relocate the manifest. A runtime-only
producer MAY decline to serve the well-known path publicly and instead
hand off via the HTTP `Link` header. See
[security.md](./security.md) for the discovery posture, transport
requirements (HTTPS), and CORS guidance.

The well-known path is the same byte string for static and runtime
profiles. The two profiles are distinguished by the manifest's `delivery`
field and by the discovery context that located the manifest, not by the
path. A consumer that reaches a manifest via the well-known path under an
unauthenticated GET MUST find `delivery: "static"`; a consumer that
reaches a manifest via an HTTP `Link` header on an authenticated response
MUST find `delivery: "runtime"`.

## Schema

The manifest is a JSON object validated by
[`schemas/100/manifest.schema.json`](../../../schemas/100/manifest.schema.json).
The schema file is authoritative. Producers MUST emit the
`application/act-manifest+json` MIME type with a `profile` parameter of
`"static"` or `"runtime"` — the closed set of values is defined in
[`schemas/101/profile-parameter.schema.json`](../../../schemas/101/profile-parameter.schema.json).

## Required fields

A conformant manifest MUST include each of the following fields.

### `act_version`

A string matching `^[0-9]+\.[0-9]+$` declaring the spec version the
producer targets. A PATCH segment is NOT permitted on the wire. For ACT
v0.2.x, the value MUST be `"0.2"`. The same field appears at the top
level of every other ACT envelope.

### `site`

An object describing the producer site. The nested `site.name` field
(string, non-empty) is REQUIRED. Optional sibling fields: `description`,
`canonical_url` (URI), `locale`, `license`.

### `index_url`

A URI reference (typically a path like `/act/index.json`) at which the
producer's index document is served. The schema for the index is defined
in [index.md](./index.md).

### `node_url_template`

A URL template containing the literal placeholder `{id}`. Substitution
follows RFC 3986 §3.3 `pchar` per-segment percent-encoding; slashes
between segments are preserved verbatim. The template's substituted form
locates an individual node JSON. The schema for a node is defined in
[node.md](./node.md).

### `conformance.level`

An object containing a `level` field. The value MUST be one of the closed
enum `"core"`, `"standard"`, `"strict"`. See
[conformance.md](./conformance.md). A consumer MUST treat any value
outside the enum as a manifest validation error.

### `delivery`

A string. The value MUST be one of `"static"`, `"runtime"`. Hybrid
deployments use the optional `mounts` array (see below); `delivery` on
the parent manifest still declares one of the two values. Conformance
level and delivery profile are orthogonal — `{ "level": "core",
"delivery": "runtime" }` and `{ "level": "strict", "delivery": "static" }`
are both valid.

## Optional fields

The manifest MAY include the following fields. Producers SHOULD NOT
populate runtime-only fields (e.g., an `auth.schemes` array) on a
static-profile manifest; doing so is a validator finding.

| Field | Type | Notes |
|---|---|---|
| `generated_at` | RFC 3339 timestamp | Build time of a static manifest. |
| `generator` | string | Human-readable generator identifier. |
| `index_ndjson_url` | URI reference | Strict-only; NDJSON variant of the index. |
| `subtree_url_template` | URL template containing `{id}` | Standard+; subtree endpoint per [node.md](./node.md). |
| `search_url_template` | URL template containing `{query}` | Strict-only; search response shape is out of scope for v0.2. |
| `root_id` | string | The id of the conceptual root node, when the producer wants to declare one. |
| `stats` | object | `node_count`, `total_tokens_full`, `total_tokens_summary`. Informational. |
| `capabilities` | object | See [capabilities.md](./capabilities.md). Boolean or sub-object values keyed by capability name. |
| `mounts` | array of objects | Hybrid deployments; see "Mounts" below. |
| `auth` | object | Runtime-only; `auth.schemes` array. See [security.md](./security.md). |
| `policy` | object | `robots_respected`, `rate_limit_per_minute`, `contact`. Advisory. |
| `locales` | object | i18n declaration. Informative for v0.2; full normative shape deferred. |

The manifest's `capabilities` field, when present, MUST be a JSON object
with boolean (or sub-object) values keyed by capability name. The legacy
array form (`capabilities: ["subtree", ...]`) is NOT permitted at the
wire layer. Consumers MUST tolerate unknown capability keys; adding a
new capability key in a future MINOR is permitted.

## Mounts

A manifest MAY declare a `mounts` array, each entry of which is an object
with `prefix` (string), `delivery` (`"static" | "runtime"`),
`manifest_url` (URI reference), and an optional `conformance.level`. A
mount that omits `conformance.level` inherits the parent manifest's
level. Mounts MUST NOT recurse — a manifest reached via a mount MUST NOT
itself declare a `mounts` array. When multiple mount prefixes match a
target resource URL, longest-prefix wins.

Cross-origin mounts (a `mounts[].manifest_url` whose origin differs from
the parent) carry trust implications. See
[security.md](./security.md) for the trust evaluation rules a consumer
MUST apply before treating a cross-origin mount as authoritative.

## Static delivery

A manifest delivered as a static file (the producer declares
`delivery: "static"`) carries additional CDN-level requirements that
producers MUST satisfy:

- The CDN MUST serve the manifest with `Content-Type:
  application/act-manifest+json` and the `profile=static` parameter.
- The CDN MUST honor conditional requests (`If-None-Match`) and emit
  strong `ETag` headers per [etag.md](./etag.md).
- The CDN MUST NOT mutate the JSON body in transit (no whitespace
  normalization, no trailing-newline fixup, no character-set transcoding
  beyond what `Content-Type` declares).
- The CDN SHOULD serve `Access-Control-Allow-Origin: *` since static
  ACT is a public discovery document; private-network deployments MAY
  override.
- A static-profile manifest MUST NOT populate runtime-only fields
  (`auth.schemes`, runtime-only capability flags). A manifest that
  violates this rule is a build-time error.

A producer SHOULD treat the well-known manifest URL as monotonic: each
deploy bumps the manifest's content hash (the basis of its ETag) so that
consumers' conditional fetches resolve to `304 Not Modified` for
unchanged builds and to `200 OK` for new builds. Atomic deploys (the new
file appears in one operation, not partially) are REQUIRED so that no
consumer ever observes a half-written manifest.

The full static-delivery contract — well-known path, MIME types,
file-set guarantees, conditional GET semantics — is normative for every
static-profile producer regardless of conformance level.

## Examples

### Minimum-conformant Core manifest

```json
{
  "act_version": "0.2",
  "site": { "name": "Example Docs" },
  "index_url": "/act/index.json",
  "node_url_template": "/act/n/{id}.json",
  "conformance": { "level": "core" },
  "delivery": "static",
  "capabilities": { "etag": true }
}
```

### Standard manifest (multi-locale, with subtree endpoint)

```json
{
  "act_version": "0.2",
  "site": {
    "name": "Example Knowledge Base",
    "canonical_url": "https://docs.example.com",
    "locale": "en-US",
    "license": "CC-BY-4.0"
  },
  "generated_at": "2026-05-03T12:00:00Z",
  "generator": "@act-spec/plugin-astro/0.2.0",
  "index_url": "/act/index.json",
  "node_url_template": "/act/n/{id}.json",
  "subtree_url_template": "/act/sub/{id}.json",
  "stats": { "node_count": 247 },
  "capabilities": {
    "etag": true,
    "subtree": true
  },
  "conformance": { "level": "standard" },
  "delivery": "static"
}
```

### Strict runtime manifest

```json
{
  "act_version": "0.2",
  "site": {
    "name": "Example Workspace",
    "canonical_url": "https://app.example.com"
  },
  "index_url": "/act/index.json",
  "index_ndjson_url": "/act/index.ndjson",
  "node_url_template": "/act/n/{id}.json",
  "subtree_url_template": "/act/sub/{id}.json",
  "search_url_template": "/act/search?q={query}",
  "capabilities": {
    "etag": true,
    "subtree": true,
    "ndjson_index": true,
    "search": { "template_advertised": true }
  },
  "conformance": { "level": "strict" },
  "delivery": "runtime",
  "policy": {
    "robots_respected": true,
    "rate_limit_per_minute": 600,
    "contact": "agents@example.com"
  }
}
```

## Conformance

| Field | Core | Standard | Strict |
|---|---|---|---|
| `act_version` | MUST | MUST | MUST |
| `site.name` | MUST | MUST | MUST |
| `index_url` | MUST | MUST | MUST |
| `node_url_template` | MUST | MUST | MUST |
| `conformance.level` | MUST | MUST | MUST |
| `delivery` | MUST | MUST | MUST |
| `subtree_url_template` | OPTIONAL | SHOULD | SHOULD |
| `index_ndjson_url` | OPTIONAL | OPTIONAL | MUST when sharded |
| `search_url_template` | OPTIONAL | OPTIONAL | OPTIONAL |
| `capabilities.etag` | OPTIONAL (`true` SHOULD) | MUST be `true` | MUST be `true` |
| `auth.schemes` | OPTIONAL (runtime-only) | OPTIONAL (runtime-only) | OPTIONAL (runtime-only) |

A producer MUST NOT introduce required fields beyond those listed above.
Adding a new required field in a future spec revision is a MAJOR change.
Adding a new optional field is MINOR.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---

**Sources:** prd/100-wire-format.md, prd/101-discovery.md, prd/105-static-delivery.md, prd/107-conformance-levels.md, prd/108-versioning-policy.md

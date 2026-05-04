---
title: Capabilities
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Capabilities

> The `capabilities` object on the manifest is the fine-grained signal a
> producer uses to declare which optional features it supports. The
> `conformance.level` field is the coarse contract; the `capabilities`
> object lets a consumer check for individual capabilities (subtree
> endpoint, NDJSON index, search advertisement) without inferring from
> level alone. Level and capabilities together define the consumer's
> negotiation surface.

## Overview

A consumer asks two questions of every ACT producer:

1. **Coarse:** what's the producer's declared `conformance.level`?
   This is the fast filter — a consumer that requires "Standard or
   higher" can reject a Core producer immediately.
2. **Fine:** what individual `capabilities` does the producer
   advertise? A consumer that needs the subtree endpoint can check
   `capabilities.subtree` without inferring from the level.

The level field is a contract — declaring `conformance.level: "standard"`
binds the producer to every Standard requirement. The capabilities
object is a feature-flag — `capabilities.subtree: true` tells consumers
"this endpoint exists" but does not by itself raise the producer's
declared level.

## Schema

The `capabilities` field is part of the manifest schema; see
[`schemas/100/manifest.schema.json`](../../../schemas/100/manifest.schema.json).
The field, when present, MUST be a JSON object with boolean (or
sub-object) values keyed by capability name. The legacy array form
(`capabilities: ["subtree", "ndjson_index"]`) is NOT permitted at the
wire layer.

## Standard capability tokens

The v0.2 capability keys, with their semantics and conformance impact:

### `etag`

- **Type:** boolean.
- **Semantics:** the producer emits ETags on every node, every index,
  and (when applicable) every subtree response, and the producer's
  HTTP layer honors `If-None-Match` conditional requests with `304 Not
  Modified` responses.
- **Conformance:** OPTIONAL at Core (SHOULD); MUST be `true` at
  Standard and Strict. See [etag.md](./etag.md) for the full ETag
  contract.

### `subtree`

- **Type:** boolean.
- **Semantics:** the producer's manifest declares a
  `subtree_url_template` and serves valid subtree envelopes at the
  substituted URL.
- **Conformance:** OPTIONAL at Core; SHOULD at Standard; SHOULD at
  Strict. A producer that sets `capabilities.subtree: true` MUST also
  populate `subtree_url_template`.

### `ndjson_index`

- **Type:** boolean.
- **Semantics:** the producer's manifest declares an
  `index_ndjson_url` and serves an NDJSON-formatted index at that URL.
  Each line is one index entry per [index.md](./index.md).
- **Conformance:** OPTIONAL at Core and Standard; SHOULD at Strict when
  the tree exceeds the producer's chosen NDJSON shard threshold (the
  reference recommendation is ~10000 nodes).

### `search`

- **Type:** sub-object. The shape is `{ "template_advertised": <boolean> }`.
- **Semantics:** when `search.template_advertised` is `true`, the
  manifest carries a `search_url_template` containing the literal
  `{query}` placeholder, and the producer serves a search response at
  the substituted URL. The search response envelope is out of scope
  for v0.2; only the template advertisement is normative here.
- **Conformance:** OPTIONAL at every level. The search endpoint is
  Strict-tier in conformance.md but the capability flag itself is
  separately advertisable.

### `change_feed`

- **Type:** boolean. **Reserved**.
- **Semantics:** reserved for a future spec revision that introduces
  push-style change notifications. v0.2 producers SHOULD NOT set this
  to `true`. Consumers MUST tolerate the key's presence and MUST NOT
  rely on its semantics.
- **Conformance:** reserved.

### `cors`

- **Type:** boolean.
- **Semantics:** the producer's CDN or runtime layer serves
  `Access-Control-Allow-Origin: *` (or an equivalent permissive
  header) on every ACT-shape resource. See [security.md](./security.md).
- **Conformance:** OPTIONAL at every level. SHOULD be advertised on
  any public-discovery static-profile deployment.

### `auth`

- **Type:** boolean (presence indicator) or sub-object.
- **Semantics:** the producer requires authentication for some or all
  ACT endpoints. When `true`, the manifest's `auth.schemes` array
  declares the schemes; see [security.md](./security.md). A
  static-profile manifest MUST NOT advertise `auth: true`.
- **Conformance:** runtime-only. OPTIONAL.

## Custom (vendor) capabilities

Vendor-specific capability tokens MUST use a reverse-DNS namespace
prefix (e.g., `com.example:my-feature`). The colon character separates
the namespace prefix from the capability name. Producers MAY advertise
any vendor capability under this convention; consumers that do not
recognize a vendor capability MUST NOT reject the manifest and SHOULD
silently ignore the unknown key.

A producer MUST NOT use a bare unprefixed capability name not listed in
"Standard capability tokens" above. Adding a new standard token in a
future MINOR is permitted; bare unprefixed tokens are reserved for the
spec.

## Negotiation semantics

A consumer that requires capability `X` follows this algorithm:

1. Fetch and parse the manifest per [manifest.md](./manifest.md).
2. Inspect `capabilities[X]`. If absent or falsy, the producer does
   not advertise the capability.
3. If the consumer's contract requires the capability strictly, the
   consumer MUST refuse to consume from this producer and MUST
   surface the missing capability to its caller.
4. If the consumer's contract is "use if available," the consumer
   proceeds with degraded semantics (e.g., walking node-by-node when
   `capabilities.subtree` is absent).

A producer MUST NOT advertise a capability it does not actually serve.
A producer that sets `capabilities.subtree: true` but returns 404 on
every subtree URL is non-conformant; validators emit a finding.

A consumer MUST NOT infer level promotion from capability presence: a
Core producer that happens to set `capabilities.subtree: true` is still
a Core producer for the purpose of the consumer's minimum-level check.

## Examples

### Minimum capabilities (Core static)

```json
"capabilities": {
  "etag": true
}
```

### Standard with subtree

```json
"capabilities": {
  "etag": true,
  "subtree": true,
  "cors": true
}
```

### Strict runtime with search

```json
"capabilities": {
  "etag": true,
  "subtree": true,
  "ndjson_index": true,
  "search": { "template_advertised": true },
  "auth": true
}
```

### Vendor capability

```json
"capabilities": {
  "etag": true,
  "subtree": true,
  "com.example:graph-export": true
}
```

## Conformance

| Capability | Core | Standard | Strict |
|---|---|---|---|
| `etag` | SHOULD `true` | MUST `true` | MUST `true` |
| `subtree` | OPTIONAL | SHOULD when subtree endpoint is offered | SHOULD when subtree endpoint is offered |
| `ndjson_index` | OPTIONAL | OPTIONAL | SHOULD when sharding threshold reached |
| `search.template_advertised` | OPTIONAL | OPTIONAL | OPTIONAL |
| `cors` | OPTIONAL | SHOULD on public deployments | SHOULD on public deployments |
| `auth` | OPTIONAL (runtime-only) | OPTIONAL (runtime-only) | OPTIONAL (runtime-only) |
| `change_feed` | RESERVED | RESERVED | RESERVED |
| Vendor `<ns>:<name>` | OPTIONAL | OPTIONAL | OPTIONAL |

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

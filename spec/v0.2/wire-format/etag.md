---
title: ETag and caching
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# ETag and caching

> ACT envelopes carry a deterministic content-hash `etag` field at the
> top level of the manifest, the index, every node, every subtree, and
> every NDJSON-index line. The same value is emitted as the HTTP `ETag`
> response header. ETags exist so consumers can re-walk a tree
> efficiently — comparing one cached value against the producer's
> current value is enough to know whether to refetch a body. This
> document defines the ETag value shape, the static and runtime
> derivation recipes, and the HTTP semantics consumers and producers
> MUST follow.

## Why ETags matter

Agents re-walk ACT trees frequently. A consumer that has previously
indexed a producer's tree should be able to detect changes by fetching
one cheap document (the index) and re-fetching only the bodies whose
ETags have moved. Without ETags, consumers either refetch everything
on every walk (wasteful) or build their own change-detection layer
(error-prone). The ETag mechanism puts the contract in the wire
format so every consumer benefits the same way.

ETags also enable selective subtree skipping: a consumer comparing the
index entry's `etag` against the consumer's cached node `etag` can skip
the per-node HTTP fetch entirely on a match.

## Value shape

The `etag` field on every envelope MUST be a JSON string matching
`^[a-z0-9]+:[A-Za-z0-9_-]+$` — a lowercase ASCII algorithm identifier,
a literal colon, then one or more base64url-safe characters (`A`–`Z`,
`a`–`z`, `0`–`9`, `_`, `-`). The value MUST NOT contain whitespace,
padding (`=`), or non-base64url characters.

For ACT v0.2.x the algorithm identifier MUST be `s256` and the hash
portion MUST be exactly 22 base64url characters: `s256:[A-Za-z0-9_-]{22}`.
No other algorithm identifier is admitted at v0.2. Adding a new
algorithm identifier in a future revision is a MINOR change.

The schema for the field is at
[`schemas/103/etag.schema.json`](../../../schemas/103/etag.schema.json).

## Strong vs weak

ACT ETags are **strong validators** in the RFC 9110 §8.8.1 sense.
Producers MUST NOT advertise an ACT ETag with the `W/` weak prefix on
the HTTP `ETag` header. Two responses bearing the same ACT ETag value
MUST be byte-equivalent in their envelope payload (modulo the `etag`
field itself, which is excluded from the hash input).

A producer that needs weak-validator semantics for non-ACT reasons (e.g.,
to avoid recomputation when only insignificant fields change) MUST NOT
use the ACT ETag mechanism for that purpose. The hash recipe is fixed.

## Static derivation

A static-profile producer MUST derive each envelope's `etag` value at
build time by:

1. Take the envelope's full JSON payload.
2. Remove the envelope's own top-level `etag` field (if present in
   the partial computation).
3. Canonicalize the remaining payload per JCS (RFC 8785) — sort
   object keys lexicographically, remove insignificant whitespace,
   encode strings per JSON `RFC 8259` §7.
4. Compute the SHA-256 hash of the canonical UTF-8 bytes.
5. Encode the leading 132 bits (16.5 bytes — the spec rounds to 22
   base64url characters) using the base64url alphabet without
   padding.
6. Prepend `s256:` to produce the final value.

The build-time recipe is deterministic: the same input produces the
same `etag` across machines and across rebuild runs.

A static origin or CDN that controls its response headers SHOULD also
send the same value as the HTTP `ETag` response header. The HTTP value
MUST be the same byte string as the envelope's `etag` field, wrapped in
the double-quotes required by RFC 9110 §8.8.3 for the header form. A
static origin that supports `If-None-Match` SHOULD return `304 Not
Modified` on a match.

## Runtime derivation

A runtime producer MUST derive each envelope's `etag` value by
constructing the input tuple `{ payload, identity, tenant }` and
hashing it under the same canonicalization+SHA-256+truncate+base64url
pipeline as the static recipe.

- `payload` is the envelope's full JSON minus its own top-level `etag`
  field.
- `identity` is the requesting principal's stable identifier (e.g., the
  user's opaque user id) or `null` for anonymous requests.
- `tenant` is the tenant identifier under which the request is served
  or `null` for non-multi-tenant deployments.

Runtime producers MUST NOT mix request-local data into the hash:
HTTP request timestamps, server wall-clock timestamps, request IDs,
correlation IDs, trace IDs, random nonces, per-process counters, or
any value not deterministic given a fixed `(payload, identity, tenant)`
triple. A producer that violates this is non-conformant; consumers can
detect it by issuing two consecutive identical requests and observing
the `etag` change with no underlying content change.

The identity-and-tenant inclusion means the same envelope payload
served to different identities yields different ETags. This is correct:
the per-identity rendering may differ (e.g., personalized content), so
the cache key MUST include identity. It also means an attacker cannot
correlate identities by ETag comparison: the hash is one-way.

## HTTP semantics

### Conditional GET

A consumer with a previously-cached envelope SHOULD issue
`If-None-Match: "<etag>"` (with quotes) on revalidation. The producer
MUST respond:

- `304 Not Modified` with no body if the current ETag matches.
- `200 OK` with a fresh envelope and the new `ETag` response header
  if the ETag has changed.

Consumers MUST be prepared to handle both responses. Consumers that
cannot honor 304 MUST omit `If-None-Match` entirely; consumers that
DO honor 304 MUST treat it as "use my cached body unchanged."

### `ETag` header

A runtime server MUST send the `ETag` HTTP response header on every
`200` and every `304` response, with a value equal to the envelope's
`etag` field, wrapped in double-quotes. The header MUST NOT carry the
`W/` weak prefix.

A static origin SHOULD send the same header on every `200` response.
Static origins not supporting conditional requests MAY ignore
`If-None-Match` and serve `200`.

On `304`, the server MUST NOT include a response body and SHOULD
include the `Cache-Control` header that would have accompanied the
corresponding `200` response.

### `Cache-Control`

A runtime server SHOULD send `Cache-Control: private, must-revalidate`
on responses whose `etag` was derived with a non-`null` identity.
Anonymous public content SHOULD use `Cache-Control: public, max-age=N`
with N typically 60–600 seconds.

A static origin SHOULD set `Cache-Control: public, max-age=N` on
every `200` response, with N in the range 300–3600 seconds for
production deployments.

## Subtree and NDJSON ETags

Subtree envelopes carry their own top-level `etag` value, derived by
the same recipe applied to the full subtree payload. The embedded node
payloads inside a subtree are part of the subtree's hash input — but
each embedded node still carries its own `etag` field unchanged. Only
the subtree envelope's own top-level `etag` field is stripped from
the subtree's hash input.

NDJSON index lines each carry their own `etag`, derived by applying
the recipe to the line as the payload. Each line's `etag` is
independent. The NDJSON file as a whole has no single ACT-level ETag;
the static origin MAY emit an HTTP `ETag` for the file as a whole, but
that header is HTTP-level cache plumbing and is outside the ACT
contract.

## Examples

### Conditional GET with `If-None-Match`

Initial request:

```
GET /act/n/intro.json HTTP/1.1
Host: docs.example.com

HTTP/1.1 200 OK
Content-Type: application/act-node+json
ETag: "s256:abc123abc123abc123abc1"
Cache-Control: public, max-age=300

{"act_version":"0.2","id":"intro","etag":"s256:abc123abc123abc123abc1", ...}
```

Revalidation request, source unchanged:

```
GET /act/n/intro.json HTTP/1.1
Host: docs.example.com
If-None-Match: "s256:abc123abc123abc123abc1"

HTTP/1.1 304 Not Modified
ETag: "s256:abc123abc123abc123abc1"
Cache-Control: public, max-age=300
```

The consumer keeps its cached body. No data transferred beyond headers.

### Curl walkthrough

```bash
# Fetch and cache the manifest
curl -sS https://docs.example.com/.well-known/act.json -D headers.txt > manifest.json
cached_etag=$(awk '/^etag:/ { gsub(/[\r"]/, "", $2); print $2 }' headers.txt)

# Revalidate
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "If-None-Match: \"$cached_etag\"" \
  https://docs.example.com/.well-known/act.json
# Prints "304" when the manifest is unchanged.
```

### Index revalidation skipping unchanged nodes

```
1. GET /act/index.json with If-None-Match: <cached-index-etag>
   → 304 Not Modified  → consumer reuses entire cached tree.
2. (If 200) walk index.nodes[]; for each entry where
   entry.etag == cached_node_etag[entry.id], skip the per-node fetch.
   For mismatched entries, GET the node URL with If-None-Match.
```

## Conformance

| Requirement | Core | Standard | Strict |
|---|---|---|---|
| `etag` field on every envelope | OPTIONAL (SHOULD) | MUST | MUST |
| HTTP `ETag` response header | OPTIONAL | SHOULD | MUST |
| Honor `If-None-Match` (304 on match) | OPTIONAL | SHOULD | MUST |
| Strong validator (no `W/` prefix) | MUST when emitted | MUST | MUST |
| `Cache-Control` directives | OPTIONAL | SHOULD | SHOULD |
| Per-subtree ETag | n/a | SHOULD when subtree offered | MUST when subtree offered |
| Per-NDJSON-line ETag | n/a | n/a | MUST when NDJSON shipped |
| No request-local data in hash input | MUST when emitted | MUST | MUST |

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

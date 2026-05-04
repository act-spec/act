---
title: Index document
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Index document

> The ACT index document enumerates the producer's content tree as a flat
> array of summary-level node references. The index is the second
> document a consumer fetches (after the manifest) and is the entry point
> for walking the tree, populating a search corpus, or revalidating
> previously-cached subtrees against ETag hints.

## Discovery

The index is published at the URL declared by the manifest's `index_url`
field. The path is producer-defined; the convention used throughout
`@act-spec/*` reference implementations is `/act/index.json`. The index
URL MUST be a URI reference resolvable against the manifest's origin (or
absolute) and MUST return a JSON document on a successful GET.

A producer at conformance level Strict MAY additionally publish an NDJSON
index at the URL declared by `index_ndjson_url`. The NDJSON variant
contains one index entry per line and is intended for very large trees
where streaming-parse and partial fetch matter.

## Schema

The index is validated by
[`schemas/100/index.schema.json`](../../../schemas/100/index.schema.json).
The schema file is authoritative.

A static-profile index file MUST be served with `Content-Type:
application/act-index+json`. The NDJSON variant MUST be served with the
same MIME type and SHOULD include the `profile=ndjson` parameter.

## Required fields

A conformant index document MUST include:

- `act_version` — string matching `^[0-9]+\.[0-9]+$`. For ACT v0.2.x the
  value MUST be `"0.2"`.
- `nodes` — an array of index entries. The array MAY be empty (a
  producer with no published content), but the field MUST be present.

A conformant index document MAY include:

- `generated_at` — RFC 3339 timestamp.
- `etag` — ETag for the index document as a whole. See [etag.md](./etag.md).

## Index entries

Each entry of `nodes` is a JSON object with the following required
fields:

- `id` — a node identifier matching `^[a-z0-9]([a-z0-9._\-]|/)*[a-z0-9]$`,
  at most 256 bytes UTF-8. Two ids that differ only in case are NOT
  the same id; the grammar excludes uppercase.
- `type` — a non-empty string. The type is producer-defined; common
  values include `article`, `tutorial`, `reference`, `landing`.
- `title` — a non-empty string.
- `summary` — a non-empty string. Index entries are summary-level
  metadata; SHOULD be ≤ 50 tokens (validators warn above 100).
- `tokens.summary` — an integer ≥ 0 declaring the producer's token
  count for the summary, computed under the producer's declared
  tokenizer.
- `etag` — the ETag for the corresponding node document. See
  [etag.md](./etag.md).

An index entry MAY include `path` (an array of strings), `tokens.abstract`,
`tokens.body`, `updated_at` (RFC 3339), `parent` (a node id or `null`),
`children` (array of node ids), and `tags` (array of strings).

The index MUST NOT contain full `content` arrays for any node. Index
entries are metadata only; the full body lives at the URL produced by
substituting the entry's `id` into `node_url_template`.

## Tree semantics

`parent` and `children` together describe a directed acyclic graph
rooted at zero or more "top-level" nodes (entries with `parent: null`
or `parent` omitted). Cycles in the `children` graph are PROHIBITED — a
producer MUST NOT emit a node whose `children` graph (transitively)
reaches back to itself. Validators treat a `children` cycle as a hard
error.

The `nodes[]` array order is producer-defined. Consumers MUST NOT assume
depth-first, breadth-first, or any other ordering by default.

## ETag and incremental fetch

The index entry's `etag` field is the same byte string a consumer would
observe by fetching the node directly. A consumer that has previously
fetched a node and cached its body alongside its ETag can skip the
node's HTTP fetch entirely whenever the index entry's `etag` matches the
cached value. This is the basis of incremental walks against large
trees: the consumer fetches one document (the index), compares ETags,
and re-fetches only the entries whose ETags have changed.

The index document itself carries its own ETag (the optional `etag`
field at the top level). A consumer that has previously fetched the
whole index can issue a conditional GET (`If-None-Match`) and receive
`304 Not Modified` when the index has not changed. See
[etag.md](./etag.md) for the full ETag derivation contract.

## Static delivery

A producer at delivery profile `static` (the manifest declares
`delivery: "static"`) MUST satisfy these additional constraints for the
index document:

- For every entry in `nodes[]`, the URL produced by substituting the
  entry's `id` into `node_url_template` MUST resolve to an existing
  node file. A static deployment whose index lists an id for which
  no file exists is non-conformant.
- The CDN MUST honor `If-None-Match` against the index's ETag.
- The CDN MUST NOT mutate the JSON body in transit.
- Atomic deploy: the new index file MUST replace the old one
  in one operation; consumers MUST NOT observe a half-written index.

A producer MAY shard the index by emitting the NDJSON variant (Strict).
Each line is one index entry as defined above; the file as a whole has
no outer envelope and no per-line `act_version`. The producer
advertises NDJSON availability via `index_ndjson_url`.

## Pagination

The v0.2 wire format does not normatively define pagination cursors for
the JSON index variant. Producers expecting trees larger than ~10000
nodes SHOULD use the NDJSON variant (Strict) instead, which streams
naturally and avoids the load-the-whole-array semantics of single-file
JSON. Future spec revisions MAY introduce a cursor-paginated index;
adding such a variant in a future MINOR is permitted.

## Examples

### Minimum index

```json
{
  "act_version": "0.2",
  "generated_at": "2026-05-03T12:00:00Z",
  "etag": "s256:9f2c1b8d4a7e3f2a1c5b8e0d4a7f",
  "nodes": [
    {
      "id": "intro",
      "type": "article",
      "title": "Introduction",
      "summary": "An overview of the platform and what you can build with it.",
      "tokens": { "summary": 14 },
      "etag": "s256:abc123abc123abc123abc1",
      "parent": null,
      "children": ["intro/getting-started"]
    },
    {
      "id": "intro/getting-started",
      "type": "tutorial",
      "title": "Getting started",
      "summary": "Install the SDK and send your first request in 5 minutes.",
      "tokens": { "summary": 13 },
      "etag": "s256:def456def456def456def4",
      "parent": "intro",
      "children": []
    }
  ]
}
```

### NDJSON index (Strict)

```
{"id":"intro","type":"article","title":"Introduction","summary":"...","tokens":{"summary":14},"etag":"s256:abc123abc123abc123abc1","parent":null}
{"id":"intro/getting-started","type":"tutorial","title":"Getting started","summary":"...","tokens":{"summary":13},"etag":"s256:def456def456def456def4","parent":"intro"}
```

Each line is a complete index entry. There is no surrounding array, no
`act_version` per line (the `index_ndjson_url` advertisement on the
manifest carries the version association), and no overall `etag` for
the file.

## Conformance

| Field | Core | Standard | Strict |
|---|---|---|---|
| `act_version` | MUST | MUST | MUST |
| `nodes` | MUST | MUST | MUST |
| Per-entry `id`, `type`, `title`, `summary`, `tokens.summary`, `etag` | MUST | MUST | MUST |
| Top-level `etag` (index-level revalidation) | OPTIONAL | SHOULD | SHOULD |
| `generated_at` | OPTIONAL | OPTIONAL | OPTIONAL |
| Per-entry `parent`/`children` | OPTIONAL | SHOULD | SHOULD |
| Per-entry `tokens.body` | OPTIONAL | OPTIONAL | OPTIONAL |
| NDJSON variant available at `index_ndjson_url` | OPTIONAL | OPTIONAL | SHOULD when shard threshold reached |
| Cycle in `children` graph | PROHIBITED | PROHIBITED | PROHIBITED |

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---
title: Node document
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Node document

> An ACT node is the unit of content in the tree. Each node is published
> as a JSON document with a typed payload, structured prose blocks,
> optional component references, and provenance metadata. This document
> defines the node schema, the prose-block grammar, the subtree envelope
> for bulk fetches, and the typing rules producers and consumers MUST
> follow.

## Discovery

A node JSON document is reached at the URL produced by substituting the
node's `id` into the manifest's `node_url_template`. Substitution
follows RFC 3986 §3.3 `pchar` per-segment percent-encoding; slashes
between segments are preserved verbatim.

The MIME type of a node document is `application/act-node+json`.

## Schema

A node is validated by
[`schemas/100/node.schema.json`](../../../schemas/100/node.schema.json).
Block types are validated by the per-block schemas under
[`schemas/102/`](../../../schemas/102/).

## Required fields

A conformant node document MUST include:

- `act_version` — string. For ACT v0.2.x the value MUST be `"0.2"`.
- `id` — node identifier matching `^[a-z0-9]([a-z0-9._\-]|/)*[a-z0-9]$`,
  at most 256 bytes UTF-8.
- `type` — non-empty string. Producer-defined.
- `title` — non-empty string.
- `etag` — strong validator string of the form `s256:<22 base64url chars>`.
  See [etag.md](./etag.md).
- `summary` — non-empty string. SHOULD be ≤ 50 tokens (validators
  warn above 100).
- `content` — array of typed content blocks. See "Content blocks"
  below. The array MAY be empty for a leaf node that carries only
  metadata.
- `tokens` — object with at least `tokens.summary` (integer ≥ 0).
  Producers SHOULD also populate `tokens.body`.

## Optional fields

A node document MAY include:

| Field | Type | Notes |
|---|---|---|
| `updated_at` | RFC 3339 timestamp | Last-modified time of the node's source. |
| `abstract` | string | Paragraph-length summary; longer than `summary`, materially shorter than the body. SHOULD be 80–200 tokens. |
| `summary_source` | string | Open enum; well-known values `"llm"`, `"author"`, `"extracted"`. Adding a value is MINOR. |
| `parent` | string \| `null` | Node id of the immediate parent, or `null` for a root. |
| `children` | array of node ids | Strict tree edge — MUST NOT contain cycles. |
| `related` | array of `{ id, relation }` objects | Soft cross-references; cycles ARE permitted. Well-known relations include `"see-also"`, `"supersedes"`, `"variant_of"`, `"translation_of"`. |
| `source` | object | `human_url` (the URL a human would view), `edit_url` (where the source can be edited). |
| `metadata` | open object | Producer-defined extension slot. Consumers MUST tolerate unknown keys. |
| `locale` | BCP-47 string | Per-node locale; informative for v0.2. |

## Content blocks

The `content` array is an ordered list of typed blocks. Each block is a
JSON object with a `type` discriminator string. Additional fields are
block-type-specific. Block order is semantically meaningful — producers
MUST emit blocks in render order, top-to-bottom; consumers MUST treat
the array as ordered.

### Core block types

The `core:*`-equivalent set required at Core conformance is closed for
the v0.2.x line. Adding a value to this set is a MAJOR change.

| Type | Required fields | Conformance | Notes |
|---|---|---|---|
| `markdown` | `type`, `text` | Core | `text` carries CommonMark. |
| `prose` | `type`, `text` | Standard | Plain text, no markdown. Optional `format`. |
| `code` | `type`, `language`, `text` | Standard | `language` from open enum (`bash`, `javascript`, `typescript`, `python`, `go`, `rust`, `json`, `yaml`, `html`, `css`, `sql`, `shell`, `text`, …); whitespace MUST NOT be transformed. Optional `filename`. |
| `data` | `type`, `format`, `text` | Standard | `format` from open enum (`json`, `csv`, `tsv`, `yaml`, `ndjson`); `text` is canonical. Optional `value` (parsed convenience; on disagreement `text` wins). |
| `callout` | `type`, `level`, `text` | Standard | `level` from closed enum: `"info"`, `"warning"`, `"error"`, `"tip"`. Markdown allowed in `text`. Adding a value to `level` is MAJOR. |

The block schemas live at
[`schemas/102/block-markdown.schema.json`](../../../schemas/102/block-markdown.schema.json),
[`schemas/102/block-prose.schema.json`](../../../schemas/102/block-prose.schema.json),
[`schemas/102/block-code.schema.json`](../../../schemas/102/block-code.schema.json),
[`schemas/102/block-data.schema.json`](../../../schemas/102/block-data.schema.json),
and [`schemas/102/block-callout.schema.json`](../../../schemas/102/block-callout.schema.json).

### Marketing namespace (Strict)

Block types in the `marketing:*` namespace are documented-open and Strict-
tier. The namespace regex is `^marketing:[a-z][a-z0-9-]*$`. Canonical
shapes for v0.2:

- `marketing:hero` — `headline` (required), optional `subhead`, optional `cta` (`{ label, href }`).
- `marketing:feature-grid` — `features` array of `{ title, description, icon? }`.
- `marketing:pricing-table` — `tiers` array of `{ name, price, features }`.
- `marketing:testimonial` — `quote`, `author`, optional `role`, optional `org`.
- `marketing:faq` — `items` array of `{ question, answer }` (markdown allowed in `answer`).

The namespace is informational here; the canonical schemas live at
[`schemas/102/block-marketing-namespace.schema.json`](../../../schemas/102/block-marketing-namespace.schema.json).

### Unknown block types

Consumers MUST tolerate unknown block types: they MUST NOT crash, drop
the enclosing node, or surface an error to the application solely
because of an unrecognized `type`. A consumer SHOULD treat an unknown
block as opaque structured payload, extracting any embedded `text`,
`headline`, or `prose` fields where possible. A producer MAY emit
extension blocks under any `type` outside the `marketing:*` namespace,
but SHOULD prefer reverse-DNS namespacing (e.g., `com.example:my-block`)
to avoid collisions.

## Components

A block whose payload is materialized from a component contract (per
the component-binding contracts in
[components.md](../components.md)) carries
`metadata.extracted_via: "component-contract"` on the block envelope.
When extraction fails, the producer emits a `marketing:placeholder`
block with `metadata.extraction_status: "failed"`. When extraction is
partial, the producer emits the partial block with
`metadata.extraction_status: "partial"`.

The component contract itself is opaque to the wire format: a node
references components by their extracted-block payload, not by an
implementation pointer. Consumers reading nodes do not need to
understand the originating component framework (React, Vue, Angular)
to consume the node correctly.

## Subtree envelope

A producer at conformance level Standard or higher MAY serve a subtree
envelope at the URL produced by substituting a node id into the
manifest's `subtree_url_template`. A subtree response carries the root
node and a depth-bounded slice of its descendants.

A subtree document is validated by
[`schemas/100/subtree.schema.json`](../../../schemas/100/subtree.schema.json)
and MUST include:

- `act_version` — `"0.2"`.
- `root` — the root node's id.
- `etag` — strong validator for the subtree response.
- `depth` — integer in `[0, 8]`. The number of generations included
  below `root`. Default depth (when the consumer does not specify)
  MUST be `3`. Maximum depth a producer may serve in a single
  response MUST be `8`.
- `nodes` — non-empty array of full node envelopes, ordered
  depth-first pre-order with the root first.

A subtree response MAY include `truncated: true` when descendants
beyond `depth` were elided; `truncated` MAY be omitted or set to
`false` for a complete response.

A producer MAY refuse to serve a subtree whose total tokens would
exceed an implementation-defined limit, in which case the producer MUST
respond with an error envelope (`error.code: "validation"`).

## Examples

### Minimum Core node

```json
{
  "act_version": "0.2",
  "id": "intro",
  "type": "article",
  "title": "Introduction",
  "etag": "s256:abc123abc123abc123abc1",
  "summary": "An overview of the platform and what you can build with it.",
  "content": [
    { "type": "markdown", "text": "## Welcome\n\nThis platform helps you ship faster." }
  ],
  "tokens": { "summary": 14, "body": 480 }
}
```

### Standard node with mixed blocks

```json
{
  "act_version": "0.2",
  "id": "intro/getting-started",
  "type": "tutorial",
  "title": "Getting started",
  "etag": "s256:def456def456def456def4",
  "summary": "Install the SDK and send your first request in 5 minutes.",
  "summary_source": "author",
  "content": [
    { "type": "markdown", "text": "## Install\n\nFirst, install the SDK:" },
    { "type": "code", "language": "bash", "text": "npm install @example/sdk" },
    { "type": "callout", "level": "info", "text": "The SDK requires Node.js 20 or newer." }
  ],
  "tokens": { "summary": 13, "body": 920 },
  "parent": "intro",
  "related": [
    { "id": "concepts/authentication", "relation": "see-also" }
  ]
}
```

### Strict node with a marketing block

```json
{
  "act_version": "0.2",
  "id": "pricing",
  "type": "landing",
  "title": "Pricing",
  "etag": "s256:fed987fed987fed987fed9",
  "summary": "Three tiers: free, pro, enterprise.",
  "content": [
    { "type": "marketing:hero", "headline": "Pick the plan that fits.", "subhead": "Free for evaluation; Pro for teams; Enterprise for scale." },
    {
      "type": "marketing:pricing-table",
      "tiers": [
        { "name": "Free", "price": "$0", "features": ["1 user", "100 requests/day"] },
        { "name": "Pro", "price": "$49/mo", "features": ["10 users", "Unlimited requests"] },
        { "name": "Enterprise", "price": "Contact sales", "features": ["SSO", "Custom SLA"] }
      ]
    }
  ],
  "tokens": { "summary": 8, "body": 220 }
}
```

### Subtree envelope (depth 1)

```json
{
  "act_version": "0.2",
  "root": "intro",
  "etag": "s256:sub1230000000000000000",
  "depth": 1,
  "truncated": false,
  "nodes": [
    { "act_version": "0.2", "id": "intro", "type": "article", "title": "Introduction", "etag": "s256:abc123abc123abc123abc1", "summary": "...", "content": [{ "type": "markdown", "text": "..." }], "tokens": { "summary": 14, "body": 480 }, "children": ["intro/getting-started"] },
    { "act_version": "0.2", "id": "intro/getting-started", "type": "tutorial", "title": "Getting started", "etag": "s256:def456def456def456def4", "summary": "...", "content": [{ "type": "markdown", "text": "..." }], "tokens": { "summary": 13, "body": 920 }, "parent": "intro" }
  ]
}
```

## Conformance

| Requirement | Core | Standard | Strict |
|---|---|---|---|
| All required fields populated | MUST | MUST | MUST |
| `markdown` block | MUST support | MUST support | MUST support |
| `prose`, `code`, `data`, `callout` blocks | OPTIONAL | MUST support | MUST support |
| `marketing:*` blocks | OPTIONAL | OPTIONAL | MUST support |
| `abstract` field | OPTIONAL | OPTIONAL | OPTIONAL |
| `related` cross-references | OPTIONAL | OPTIONAL | OPTIONAL |
| Subtree endpoint | OPTIONAL | SHOULD | SHOULD |
| Cycle in `children` graph | PROHIBITED | PROHIBITED | PROHIBITED |
| Cycle in `related` graph | PERMITTED (consumer cycle-detects) | PERMITTED | PERMITTED |
| Producers split nodes > 10000 body tokens | SHOULD | SHOULD | SHOULD |
| Consumer tolerates unknown block types | MUST | MUST | MUST |

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

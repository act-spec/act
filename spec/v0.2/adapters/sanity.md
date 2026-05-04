---
title: Sanity adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Sanity adapter

> The Sanity adapter projects a Sanity dataset onto an ACT tree via
> GROQ queries. Documents become nodes, schema types become node
> types, Portable Text becomes prose blocks, references resolve into
> the tree hierarchy, and Sanity's `__i18n_lang` convention maps to
> ACT locales. A faithful implementation reaches Standard out of the
> box and Strict when locales and `marketing:*` mappings are
> configured.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-sanity`. The mapping below is normative. The
adapter is read-only — it consumes the Content Lake API via the
public CDN endpoint by default and the standard API endpoint when
draft mode is requested.

## Source content model

A Sanity dataset exposes:

- **Documents** keyed by `_id`, typed by `_type`. Drafts have an
  `_id` prefixed with `drafts.`; published documents do not.
- **References** via `{ _ref: "<id>" }` shapes inside fields, single
  or array.
- **Portable Text** as an array of typed blocks (`block`, `image`,
  custom-type blocks) — Sanity's structured content payload.
- **Image assets** via the `image` schema type, resolved to a CDN URL
  by the asset reference.
- **Localization** by convention (no native locale mode in v3) — the
  community pattern of `__i18n_lang` field plus `__i18n_refs` array
  is the canonical contract; the adapter detects and consumes it.

Auth is via a Sanity API token (read scope). The token is treated as
a secret. Public datasets MAY be queried unauthenticated.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Document whose `_type` is in `documentTypes` | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | `type` from `mappings.<type>.type` or `defaults.<type>` or `"article"` |
| Document referenced as a `parent` from another emitted doc | branch (when also enumerated) | as above + `children` | child enumeration follows the configured `parent` reference field |
| Image asset referenced from a Portable Text block | block-level reference | — | `marketing:image` (Plus) or markdown image link inside a `prose` block (Standard) |
| Document with `_id` starting `drafts.` | EXCLUDED unless `preview: true` | — | drafts skipped from CDN endpoint |

**Default field heuristics** (when `mappings.<type>` is absent), in
order:

- `title` ← first present of `title`, `name`, `headline`. Missing all
  three is recoverable: emit a partial node titled
  `"Untitled <type> <_id>"`.
- `summary` ← first present of `summary`, `excerpt`, `description`.
  Otherwise extracted from the body following the Markdown adapter's
  algorithm (`./markdown.md`).
- `body` (the `content` array) ← Portable Text fields converted per
  the mapping below; long-text fields emitted as `prose` blocks.
- `tags` ← string-array fields named `tags` or `categories`.
- `related` ← reference array fields linking to other in-corpus
  documents, emitted as `{ id, relation: "see-also" }`.

**ID derivation** (per `idStrategy`):

- `from: "id"` (default) → `<namespace>/<_id>` lowercased with the
  optional `drafts.` prefix stripped.
- `from: "slug"` → `<namespace>/<doc.slug.current>` normalized per
  Markdown rules.
- `from: "composite"` → `<namespace>/<_type>/<_id>`.

A document field named `actId` (configurable) wins over the strategy.
Default namespace is `cms`.

## Portable Text → block mapping

| Portable Text block | ACT block | Notes |
|---|---|---|
| `block` with `style: "normal"` | `prose` (`format: "markdown"` if marks/links present) | nested marks preserved |
| `block` with `style: "h1".."h6"` | `prose` with leading `#` markers, `format: "markdown"` | |
| `block` with `style: "blockquote"` | `prose` with `>` quoting | |
| `block` with `listItem: "bullet" / "number"` | `prose` with markdown list syntax | adjacent list items collapse into one `prose` block |
| `image` block | `marketing:image` (Plus) or markdown image link in surrounding `prose` (Standard) | resolved via asset reference |
| `code` block (community plugin) | `code` block with `lang` from the block | |
| Custom-type block matching a `mappings.<type>.blocks` rule | the configured `marketing:*` block | required block fields validated; missing required fields fall back to `marketing:placeholder` |
| Custom-type block with no rule | `marketing:placeholder` (Plus) or warn + skip (Standard) | carries `metadata.extracted_via: "component-contract"` |

Block ordering matches source order. Adjacent prose blocks of the
same style MAY be coalesced when safe.

## GROQ query construction

The adapter constructs one GROQ query per `documentTypes` value,
with stable ordering and pagination:

```
*[_type == $type && !(_id in path("drafts.**"))]
  | order(_id asc)
  [$start..$end] {
    _id, _type, _rev, _updatedAt,
    ..., // adapter-emitted projection
    "<refField>": <refField>->{ _id, _type, ... }  // per resolveRefs config
  }
```

Reference resolution is bounded by `resolveRefs.depth` (default 1,
max 3). Deeper resolution requires either a deliberate config bump or
multiple passes. Self-referential cycles MUST be detected and
truncated.

## Manifest emission

Contributed manifest fields:

- `site.canonical_url` ← from generator config.
- `locales.default` and `locales.available` ← from adapter config
  (defaults to the `__i18n_lang` values observed in the dataset).
- `capabilities` ← `etag: true`, `subtree: true` (when subtree files
  emit), `i18n: true` when `>1` locale.
- `delivery: "static"`.

## Index emission

One node-ref per (document, locale) pair, in deterministic order
(sorted by `_id`, then locale). Each node-ref carries `id`, `type`,
`locale`, `href`, `etag` hint, and `parent` derived from the
configured parent reference.

## i18n

Sanity has no native locale field; the v0.2 contract is the
community `__i18n_lang` + `__i18n_refs` convention:

- Each translated variant is a separate document carrying
  `__i18n_lang: "<BCP-47>"` and `__i18n_refs: [<ref>, …]` linking to
  sibling locale variants.
- The adapter walks `__i18n_refs` to populate `metadata.translations`
  densely.
- **Pattern 1** (locale-prefixed IDs) is the default when `>1`
  locale: ID = `<namespace>/<locale-lower>/<derived-id>`.
- **Pattern 2** (per-locale manifests) is opt-in via
  `locale.pattern: 2`.

When the convention is not in use, the adapter operates in
single-locale mode using the configured `locales.default`.

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by Sanity's
listen-mode or by `_updatedAt > <since>` queries:

- `since` is an RFC 3339 timestamp.
- The query yields documents updated since the marker.
- Deletions surface as `null` returns from `transform` with a
  `metadata.tombstone: true` partial marker; full reconciliation
  requires a periodic full enumerate.

## Concurrency and rate limiting

Default `concurrency_max: 8`. The adapter MUST honor 429 responses
with exponential backoff. Sanity's CDN tolerates higher concurrency
than the standard API; the standard API is recommended only for
draft / preview reads.

## Failure surface

- **Recoverable**: missing default heuristic field on a single
  document → partial node; image asset 404 → block reference omitted;
  reference cycle truncated → warning.
- **Unrecoverable**: HTTP 401, sustained 429/5xx after retries,
  configuration violating reserved metadata keys, empty
  `documentTypes`.

## Conformance target

- **Standard:** single-locale, default heuristics, Portable Text →
  `prose`/`code`/`callout` blocks, asset references inlined.
- **Strict:** + multi-locale fan-out, + dense `metadata.translations`
  via `__i18n_refs`, + `marketing:*` block extraction via
  `mappings.<type>.blocks`, + `delta(since)`.

## Examples

A dataset with types `blogPost` (`title`, `slug`, `body`, `hero`,
`__i18n_lang`, `__i18n_refs`) and `author`, configured as:

```json
{
  "projectId": "abc123",
  "dataset": "production",
  "token": "<read token>",
  "documentTypes": ["blogPost", "author"],
  "idStrategy": { "from": "slug", "namespace": "cms" },
  "locale": { "available": ["en-US", "es-ES"], "default": "en-US" }
}
```

emits two nodes per blog post (one per locale variant document),
with `marketing:image` blocks for hero images at Plus and
`metadata.translations` cross-linking the variants via the resolved
`__i18n_refs`.

## Open questions / extension points

- **Native locale support** in Sanity v4+ would replace the
  `__i18n_lang` convention; the adapter MUST detect and prefer the
  native form when available.
- **GROQ-driven custom queries** for advanced ingestion patterns —
  out of scope for v0.2; users needing bespoke queries fall back to
  the programmatic adapter.
- **Preview mode wiring** with Sanity's `previewDrafts` perspective
  — additive ASP candidate.

## Sources

- `./markdown.md` for body extraction.
- `./i18n.md` for cross-locale composition.
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

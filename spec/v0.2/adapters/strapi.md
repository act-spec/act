---
title: Strapi adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Strapi adapter

> The Strapi adapter projects a Strapi v4 (and v5-compatible)
> application onto an ACT tree via the REST API. Collection-type and
> single-type entries become nodes, dynamic zones map to
> mixed-component children, rich-text fields become prose blocks, and
> Strapi's i18n plugin maps to ACT locales. A faithful implementation
> reaches Standard out of the box and Strict when locales and
> `marketing:*` mappings are configured.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-strapi`. The mapping below is normative. The
adapter is read-only — it consumes the REST API only; the GraphQL
endpoint MAY be added later as an additive option.

## Source content model

A Strapi application exposes:

- **Collection types** — repeatable content entries keyed by
  numeric `id`, with `attributes` and a `documentId` (v5+).
- **Single types** — one-off content (site settings, hero pages).
- **Components** — reusable field groups embedded inside entries.
- **Dynamic zones** — heterogeneous arrays of components on a
  parent entry.
- **Relations** — single or array references to other content
  types, populated via the `populate` query parameter.
- **Media** — assets via the upload plugin (`/uploads/*`); each
  media item has URL, MIME type, alt text.
- **Locales** — provided by the official i18n plugin; per-locale
  variants of the same entry share a `localizations` array.

Auth is via either an API token (read-only scope) or a public role
that exposes the relevant content types. Tokens are treated as
secrets.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Collection-type entry whose UID is in `contentTypes` | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | `type` from `mappings.<uid>.type` or `defaults.<uid>` or `"article"` |
| Collection-type entry referenced as `parent` from another emitted entry | branch (when also enumerated) | as above + `children` | child enumeration follows the configured parent relation |
| Single-type entry whose UID is in `contentTypes` | leaf | as above | only one node emitted per single type |
| Dynamic-zone entry within a parent entry's `content[]` | inline block | — | each zone item maps per the dynamic-zone table below |
| Media item referenced from rich text or a media field | block-level reference | — | `marketing:image` (Plus) or markdown image link in `prose` (Standard) |

**Default field heuristics**:

- `title` ← first present of `title`, `name`, `headline`. Missing all
  three is recoverable: emit a partial node titled
  `"Untitled <uid> <id>"`.
- `summary` ← first present of `summary`, `excerpt`, `description`.
  Otherwise extracted via the Markdown algorithm (`./markdown.md`).
- `body` (the `content` array) ← rich-text fields converted per the
  table below; long-text fields emitted as `prose` blocks; dynamic
  zones walked per the dynamic-zone table.
- `tags` ← `tags` relation (when present, materialized as string
  array of tag names) or `tag_list` string-array field.
- `related` ← relation fields linking to other in-corpus entries,
  emitted as `{ id, relation: "see-also" }`.

**ID derivation** (per `idStrategy`):

- `from: "id"` (default) → `<namespace>/<uid-segment>/<numeric-id>`.
- `from: "documentId"` (v5+) → `<namespace>/<documentId>`.
- `from: "slug"` → `<namespace>/<entry.attributes.slug>` normalized.

A field named `act_id` (configurable) wins over the strategy.
Default namespace is `cms`.

## Rich-text → block mapping

Strapi's rich text comes in two flavours:

- **Markdown** (long-text or "Rich text (Markdown)" field) — emitted
  as a `markdown` block in coarse mode; split into
  `prose`/`code`/`data`/`callout` in fine mode (per `./markdown.md`).
- **Block editor** (Strapi v4.18+) — a structured array of typed
  blocks. Mapping:

| Block editor type | ACT block | Notes |
|---|---|---|
| `paragraph` | `prose` (`format: "markdown"` if marks/links present) | |
| `heading` (level 1–6) | `prose` with leading `#` markers | |
| `list` (`unordered` / `ordered`) | `prose` with markdown list syntax | |
| `quote` | `prose` with `>` quoting | |
| `code` | `code` block with `lang` from the editor | |
| `image` | `marketing:image` (Plus) or markdown image link in surrounding `prose` (Standard) | |
| `link` (inline) | inline link inside surrounding `prose` | |

## Dynamic zones

A dynamic-zone field is an array of components, each with a
discriminator `__component` field (e.g.,
`"sections.hero"`). Mapping:

| Dynamic-zone item | ACT block | Notes |
|---|---|---|
| Component matching `mappings.<uid>.zones.<zoneField>.<__component>` | configured `marketing:*` block | required block fields validated; missing fields fall back to `marketing:placeholder` |
| Component with no rule | `marketing:placeholder` (Plus) or warn + skip (Standard) | carries `metadata.extracted_via: "component-contract"` and `metadata.component: "<__component>"` |

## REST query construction

The adapter calls
`GET /api/<plural-uid>?pagination[page]=N&pagination[pageSize]=100&populate=<spec>&locale=<L>`
for each `contentTypes` value. The `populate` spec is derived from
`resolveRefs`:

- `populate: "*"` — populate every level-1 relation, component, and
  dynamic zone (default for shallow needs).
- `populate: { relA: { populate: ["nested"] }, dynamicZone: { populate: "*" } }`
  — explicit deep population, bounded by `resolveRefs.depth`
  (default 2, max 4).

Yield order is stable: sorted by `id`, then locale. Per-content-type
queries run sequentially; pagination continues until response `meta.pagination.pageCount`.

## Manifest emission

Contributed manifest fields:

- `site.canonical_url` ← from generator config.
- `locales.default` ← `locale.default` (or the i18n plugin's
  default locale).
- `locales.available` ← `locale.available` (or the i18n plugin's
  configured locales).
- `capabilities` ← `etag: true`, `subtree: true` (when emitted),
  `i18n: true` when `>1` locale.
- `delivery: "static"`.

## Index emission

One node-ref per (entry, locale) pair, in stable order. Single-type
entries contribute one node-ref each.

## i18n

When the i18n plugin is enabled and `>1` locale is in scope, the
default is **Pattern 1** (locale-prefixed IDs):

- Per-locale REST requests issued (`?locale=<L>`); never the `*`
  wildcard.
- ID = `<namespace>/<locale-lower>/<entry-derived-id>`.
- `metadata.locale` on every node.

**Pattern 2** (per-locale manifests) is opt-in via
`locale.pattern: 2`.

`metadata.translations` is populated densely from the per-entry
`localizations` array (which links sibling locale variants by
`documentId` in v5 or numeric `id` in v4).

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by REST queries
filtering on `updatedAt`:
`?filters[updatedAt][$gt]=<RFC3339>`. Deletions surface as absences
across runs; full reconciliation requires a periodic full enumerate.

## Concurrency and rate limiting

Default `concurrency_max: 6`. Strapi has no built-in rate limiting;
operators self-hosting Strapi should size the database connection
pool to tolerate the configured concurrency. The adapter MUST honor
429 responses (added by reverse proxies or rate-limit middleware)
with exponential backoff.

## Failure surface

- **Recoverable**: missing default heuristic field → partial node;
  unresolved relation → bare reference; media 404 → block reference
  omitted.
- **Unrecoverable**: HTTP 401/403, sustained 429/5xx after retries,
  empty `contentTypes`, reserved-metadata-key violations.

## Conformance target

- **Standard:** single-locale, default heuristics, rich text →
  `prose`/`code` blocks, media inlined.
- **Strict:** + multi-locale fan-out, + dense
  `metadata.translations`, + `marketing:*` block extraction via
  `mappings.<uid>.zones`, + `delta(since)`.

## Examples

A Strapi v5 app with collection types `api::article.article`
(`title`, `slug`, `body`, `cover`, `localizations`) and
`api::author.author`, configured as:

```json
{
  "baseUrl": "https://cms.example.com",
  "token": "<read token>",
  "contentTypes": ["api::article.article", "api::author.author"],
  "defaults": {
    "api::article.article": "article",
    "api::author.author": "person"
  },
  "idStrategy": { "from": "documentId", "namespace": "cms" },
  "locale": { "available": ["en", "es"], "default": "en" }
}
```

emits two nodes per article (one per locale), with `marketing:image`
blocks for cover images at Plus and `metadata.translations`
cross-linking the locale variants from the `localizations` array.

## Open questions / extension points

- **GraphQL endpoint** as an alternative to REST — additive ASP
  candidate.
- **Draft & publish** workflow — the adapter currently emits only
  published entries. Preview mode wiring (consuming the
  `publicationState=preview` parameter) is an additive option.
- **Strapi v5 documentId-only ID strategy** is the recommended
  default for v5 deployments; v4 users keep `from: "id"`.

## Sources

- `./markdown.md` for body extraction.
- `./i18n.md` for cross-locale composition.
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

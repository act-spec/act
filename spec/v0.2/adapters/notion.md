---
title: Notion adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Notion adapter

> The Notion adapter projects a Notion workspace onto an ACT tree via
> the public Notion API. Databases become branches, pages become
> leaves, and the block tree beneath each page maps to ACT prose
> blocks. Notion has no native locale model; the adapter supports a
> per-page locale property as the canonical convention. A faithful
> implementation reaches Standard out of the box.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-notion`, new in v0.2. The mapping below is
normative. The adapter is read-only — it consumes
`api.notion.com/v1/*` via an integration token. The integration MUST
be granted access to the source databases and pages by a workspace
admin; pages outside the integration's scope are silently invisible.

## Source content model

A Notion workspace exposes (via `api.notion.com/v1/`):

- **Databases** keyed by `id` (UUID) — collections of pages with a
  shared property schema. Queried via `databases.query` with optional
  filters and sorts.
- **Pages** keyed by `id` (UUID) — atomic content with a property
  bag (titles, selects, multi-selects, dates, relations, formulas)
  and a child-block tree. Pages MAY belong to a database (parent
  type `database_id`) or to another page (parent type `page_id`).
- **Blocks** — the recursive content payload of a page. Notion has
  ~30 block types; the adapter maps the common ones to ACT prose,
  code, and callout blocks; uncommon types fall back to placeholders.
- **Properties** — per-database typed columns. Common types: `title`,
  `rich_text`, `number`, `select`, `multi_select`, `date`,
  `checkbox`, `url`, `email`, `relation`, `formula`, `rollup`,
  `people`, `files`.
- **Users** — workspace members; surfaced as
  `metadata.author` / `metadata.editors`.
- **Files** — uploads attached to pages or referenced from blocks;
  resolved to AWS-presigned URLs (short-lived; the adapter MUST
  refetch on each build, never cache the URL).

Auth is via a Notion integration token (`secret_*`). The token is
treated as a secret. The Notion API is rate-limited at 3 requests
per second per integration.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Database whose `id` is in `databases` | branch | `id`, `type` (default `"section"`), `children`, `title` | children are the database's pages |
| Page belonging to an enumerated database | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | `type` from `mappings.<dbId>.type` or `defaults.<dbId>` or `"article"` |
| Page belonging to another page (sub-page) | leaf or branch | as above | becomes a branch when `subpages: true` AND it has child sub-pages |
| Block beneath a page | inline block | — | mapped per the block-to-block table below |
| Inline database (database embedded in a page) | EXCLUDED by default | — | OPT-IN via `inlineDatabases: true` |
| File attached to a page or block | block-level reference | — | `marketing:image` for image MIMEs (Plus) or markdown image link (Standard); `marketing:asset` for non-image (Plus) |

**Default field heuristics**:

- `title` ← the page's `title` property (the property whose `type:
  "title"`; usually named `Name` or `Title`). Missing title is
  recoverable: emit a partial node titled `"Untitled page <id>"`.
- `summary` ← a property explicitly named `Summary`, `Description`,
  or `Excerpt` (configurable). Otherwise extracted from the page's
  block tree via the Markdown adapter's algorithm.
- `body` (the `content` array) ← walks the page's block tree per
  the table below.
- `tags` ← `multi_select` properties named `Tags` (configurable).
- `related` ← `relation` properties whose targets are in-corpus
  pages, emitted as `{ id, relation: "see-also" }`.

**Property → metadata mapping**: every page property not consumed by
the heuristics above is passed through under `metadata.notion.<property-name>`,
flattened to its scalar value (selects → string, multi-selects →
array of strings, dates → RFC 3339, relations → array of related
page IDs).

**ID derivation** (per `idStrategy`):

- `from: "id"` (default) → `<namespace>/<page-id>` with hyphens
  stripped (Notion UUIDs use hyphens).
- `from: "slug"` → `<namespace>/<slug-property-value>` normalized;
  requires a configured `slugProperty`.
- `from: "title"` → `<namespace>/<title-normalized>`.

A page property named `act_id` (configurable) wins over the strategy.
Default namespace is `notion`.

## Notion block → ACT block mapping

| Notion block type | ACT block | Notes |
|---|---|---|
| `paragraph` | `prose` (`format: "markdown"` if rich-text marks/links present) | nested marks preserved |
| `heading_1`, `heading_2`, `heading_3` | `prose` with leading `#` markers, `format: "markdown"` | toggleable headings emit children flattened beneath |
| `bulleted_list_item`, `numbered_list_item` | `prose` with markdown list syntax | adjacent items collapse into one `prose` block |
| `quote` | `prose` with `>` quoting | |
| `to_do` | `prose` with markdown task-list syntax (`[ ]` / `[x]`) | |
| `toggle` | `prose` with details summary; children flattened | |
| `code` | `code` block with `lang` from the block's `language` field | |
| `image` | `marketing:image` (Plus) or markdown image link (Standard) | resolved via the file URL or external URL |
| `video`, `audio`, `file` | `marketing:asset` (Plus) or warn + skip (Standard) | |
| `embed`, `bookmark` | `marketing:embed` (Plus) or `prose` with the URL (Standard) | |
| `callout` | `callout` block with `level` derived from the icon (default `"note"`) | |
| `divider` | `prose` with `text: "---"` | |
| `table` | `prose` with markdown table syntax | rows fetched via `blocks.children.list` on the table block |
| `column_list`, `column` (layout) | container only — children walked at the parent's level | |
| `child_page` | `marketing:placeholder` referencing the sub-page | child page emitted as a separate node when `subpages: true` |
| `child_database` | `marketing:placeholder` referencing the database | inline database; not enumerated unless OPT-IN |
| `synced_block` | follows the original block's children | source-of-truth block walked once; references emit placeholders |
| Any other block type | `marketing:placeholder` (Plus) or warn + skip (Standard) | carries `metadata.extracted_via: "component-contract"` and `metadata.component: "<blockType>"` |

Block ordering matches source order (depth-first walk, layout
containers transparent).

## API query construction

The adapter walks the workspace via two passes:

1. **Database enumeration** — `POST /v1/databases/<id>/query` for
   each database in the configured `databases` list, paginating with
   `start_cursor` until `has_more: false`. Default `page_size: 100`
   (the API max).
2. **Block tree fetch** — `GET /v1/blocks/<page-id>/children?page_size=100`
   for each enumerated page; recursively for blocks that have
   `has_children: true` (toggles, list items with nested content,
   tables).

When `subpages: true`, the adapter recursively walks `child_page`
blocks discovered during pass 2 and treats them as additional pages
for pass 1's enumeration.

Yield order is stable: sorted by database, then by page `id`.

## Manifest emission

Contributed manifest fields:

- `site.canonical_url` ← from generator config.
- `locales.default`, `locales.available` ← from adapter config.
- `capabilities` ← `etag: true`, `subtree: true` (when emitted),
  `i18n: true` when `>1` locale.
- `delivery: "static"`.

## Index emission

One node-ref per (page, locale) pair, in stable order. Each database
contributes one branch node-ref whose `children` enumerate the
database's pages.

## i18n

Notion has **no native locale model**. The adapter supports two
opt-in conventions:

- **Per-page locale property** (default convention): a configured
  `localeProperty` (e.g., a `select` property named `Locale`) on
  every translatable page declares the page's BCP-47 locale. Pages
  without the property fall back to `locales.default`.
- **Per-database locale split**: a configured `databasesByLocale` map
  associates each locale with a separate Notion database (`{ "en":
  "<db-id-en>", "es": "<db-id-es>" }`); the adapter walks each
  database with the corresponding locale.

When `>1` locale is in scope, the default is **Pattern 1**
(locale-prefixed IDs):

- ID = `<namespace>/<locale-lower>/<page-derived-id>`.
- `metadata.locale` on every node.

**Pattern 2** (per-locale manifests) is opt-in via
`locale.pattern: 2`.

`metadata.translations` cross-references are populated when a
configured `translationProperty` (a `relation` property) links sibling
locale variants; absent that, cross-locale linking is left to the
i18n adapter (`./i18n.md`) composed in the same build.

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by Notion's
`last_edited_time` filter on `databases.query`:
`{ filter: { timestamp: "last_edited_time", last_edited_time: { after: "<RFC3339>" } } }`.

Block-level edits trigger a full re-walk of the affected page's
block tree (Notion's API does not expose block-level deltas).
Deletions surface as absences across runs.

## Concurrency and rate limiting

Default `concurrency_max: 3`. The Notion API is hard-rate-limited at
3 requests/second/integration; the adapter MUST honor 429 responses
with the `Retry-After` header. Higher `concurrency_max` is rejected
at `init` because it would self-DoS.

Block-tree fetches dominate request counts on large pages; the
adapter SHOULD use the `?page_size=100` max to minimize round-trips.

## Failure surface

- **Recoverable**: missing title property → partial node; unresolved
  file URL (presigned URL expired between query and fetch) → block
  reference omitted; one block fails to map → `marketing:placeholder`
  with the rest of the page intact.
- **Unrecoverable**: HTTP 401 (token invalid), HTTP 404 on a
  configured database (integration not granted access), sustained
  429 after `Retry-After` honored, empty `databases` list,
  reserved-metadata-key violations.

## Conformance target

- **Standard:** single-locale, default heuristics, common Notion
  blocks → `prose`/`code`/`callout`, file references inlined.
- **Strict:** + multi-locale fan-out via the locale-property
  convention, + dense `metadata.translations` via the
  `translationProperty` convention or via i18n-adapter composition,
  + `marketing:*` block extraction via `mappings.<dbId>.blocks`,
  + `delta(since)` via `last_edited_time`.

## Examples

A workspace with two databases (`Articles` and `Authors`),
configured as:

```json
{
  "token": "secret_<token>",
  "databases": [
    "8a1b2c3d-4e5f-6789-abcd-ef0123456789",
    "9b2c3d4e-5f6a-7890-bcde-f01234567890"
  ],
  "defaults": {
    "8a1b2c3d-4e5f-6789-abcd-ef0123456789": "article",
    "9b2c3d4e-5f6a-7890-bcde-f01234567890": "person"
  },
  "summaryProperty": "Summary",
  "tagsProperty": "Tags",
  "subpages": false,
  "idStrategy": { "from": "slug", "slugProperty": "Slug",
                  "namespace": "notion" },
  "locale": {
    "available": ["en", "es"], "default": "en",
    "localeProperty": "Locale",
    "translationProperty": "Translations"
  }
}
```

emits one node per (page, declared locale) with `marketing:image`
blocks for image embeds at Plus and `metadata.translations`
cross-linking the locale variants from the `Translations` relation.

## Open questions / extension points

- **Inline databases promoted to nodes** — additive ASP candidate;
  v0.2 emits them as placeholders.
- **Comments** — out of scope; not content nodes in the ACT model.
- **Notion's AI features** (auto-fill, summarization) — not consumed
  by the adapter; the canonical content is the human-authored
  property and block payload.
- **Token scope reduction** — Notion's integration tokens are
  workspace-scoped. A future Notion API enhancement enabling per-
  database scoping would be honored via additive config; v0.2 trusts
  the operator to grant minimum-necessary access.

## Sources

- `./markdown.md` for body extraction.
- `./i18n.md` for cross-locale composition (composed in builds where
  Notion's per-page locale convention is insufficient).
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---
title: Contentful adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Contentful adapter

> The Contentful adapter projects a Contentful space onto an ACT tree
> via the Content Delivery API. Entries become nodes, content types
> become node types, Rich Text becomes prose blocks, references
> resolve into the tree hierarchy, and Contentful's localization
> model maps to ACT locales. A faithful implementation reaches
> Standard out of the box and Strict when locales and `marketing:*`
> mappings are configured.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-contentful`. The mapping below is normative. The
adapter is read-only — it consumes the Content Delivery API only;
never the Management API.

## Source content model

A Contentful space exposes:

- **Entries** keyed by `sys.id`, typed by `sys.contentType.sys.id`.
- **Assets** keyed by `sys.id`, with file metadata (URL, MIME type,
  alt text).
- **Locales** declared at the space level; one default locale and
  optional additional locales.
- **Linked entries** via single- or array-reference fields, resolved
  by the CDA's `include` parameter (depth 0–10; the adapter caps the
  default at 1 and a configured maximum at 4).
- **Rich Text** fields encoded as a JSON AST per the Contentful Rich
  Text spec.
- **Sync API** for incremental rebuilds via opaque sync tokens.

Auth is via a Content Delivery API token. The token is treated as a
secret and MUST NOT appear in build artifacts or logs.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Entry whose content type is in `contentTypes` | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | `type` from `mappings.<ct>.type` or `defaults.<ct>` or `"article"` |
| Entry referenced by another entry's `parent` field | branch (when also enumerated) | as above + `children` | child enumeration follows the configured `parent` field |
| Asset (image MIME) | block-level reference | — | emitted inside a node's `content[]` as `marketing:image` (Plus) or as a markdown image link inside a `prose` block (Standard) |
| Asset (non-image MIME) | block-level reference | — | `marketing:asset` at Plus; warning + skip at Standard |
| Linked entry outside `contentTypes` and `resolveLinks.scope: "whitelist-only"` | bare reference | — | emitted as `{ id, type }` reference; not as a node |

**Default field heuristics** (applied when `mappings.<ct>` is absent),
in order:

- `title` ← first present of `title`, `name`, `headline`. Missing all
  three is recoverable: emit a partial node titled
  `"Untitled <ct> <sys.id>"` with `extraction_status: "partial"`.
- `summary` ← first present of `summary`, `excerpt`, `description`,
  `subhead`. Otherwise extracted from the body following the
  Markdown adapter's algorithm (`./markdown.md`).
- `abstract` ← first present of `abstract`, `intro`, `lede`.
- `body` (the `content` array) ← Rich Text fields converted per the
  Rich Text mapping below; long-text fields emitted as `prose` or
  `markdown` blocks per detected format.
- `tags` ← Contentful's per-entry `metadata.tags` flattened to an
  array of tag IDs.
- `related` ← reference fields linking to other in-corpus entries,
  emitted as `{ id, relation: "see-also" }`.

**User-supplied `mappings.<ct>`** is authoritative when present and
defines `type`, `title`, `summary`, `body`, `tags`, `parent`,
`related`, `blocks` (Plus marketing-block extraction rules), and
`metadata` (open metadata keys; reserved keys are forbidden).

**ID derivation** (per `idStrategy`):

- `from: "id"` (default) → `<namespace>/<sys.id>` lowercased.
- `from: "slug"` → `<namespace>/<entry.fields[<idField>]>` normalized
  per the Markdown adapter's normalization rules.
- `from: "composite"` → `<namespace>/<contentTypeId>/<sys.id>`.

A frontmatter-equivalent override field on the entry (default
`actId`) wins over the strategy. Default namespace is `cms`.

## Rich Text → block mapping

| Rich Text node type | ACT block | Notes |
|---|---|---|
| `paragraph` | `prose` (`format: "markdown"` if any inline marks/links present, else `"plain"`) | nested marks preserved inline |
| `heading-{1..6}` | `prose` with leading `#` markers and `format: "markdown"` | |
| `unordered-list`, `ordered-list` | `prose` with markdown list syntax | |
| `blockquote` | `prose` with `>` quoting | |
| `hr` | `prose` with `text: "---"` | |
| `embedded-asset-block` (image) | `marketing:image` (Plus) or markdown image link inside surrounding `prose` (Standard) | |
| `embedded-asset-block` (non-image) | `marketing:asset` (Plus) or warn + skip (Standard) | |
| `embedded-entry-block` matching a `mappings.<ct>.blocks` rule | the configured `marketing:*` block | required block fields validated; missing required fields fall back to `marketing:placeholder` |
| `embedded-entry-block` with no rule | `marketing:placeholder` (Plus) or warn + skip (Standard) | |
| `embedded-entry-inline`, `*-hyperlink` | inline link inside surrounding `prose` | |
| Code block (Rich Text 2024+) | `code` block with `lang` from the editor | |
| Table (Rich Text 2024+) | `prose` with markdown table syntax | |

Empty paragraphs MAY be skipped; block order matches source order.

## Manifest emission

Contributed manifest fields (`../wire-format/manifest.md`):

- `site.canonical_url` ← from generator config.
- `locales.default` ← Contentful space's default locale (or
  `locale.default` from adapter config).
- `locales.available` ← `locale.available` (defaulting to the space's
  advertised set).
- `capabilities` ← `etag: true`, `subtree: true` (when subtree files
  emit), `i18n: true` (when `>1` locale).
- `delivery: "static"` (build-time adapter).

## Index emission

The adapter contributes one node-ref per (entry, locale) pair to the
build's index, in deterministic order (sorted by `sys.id`, then
locale). Each node-ref carries `id`, `type`, `locale`, `href`, `etag`
hint, and `parent` derived from the configured parent field (when
present). Subtree files emit at the framework's threshold.

## i18n

When `>1` locale is in scope, the default is **Pattern 1**
(locale-prefixed IDs):

- One node per (entry, locale) pair.
- ID = `<namespace>/<locale-lower>/<entry-derived-id>`.
- `metadata.locale` on every node (BCP-47 form, e.g., `"en-US"`).
- CDA query issued per-locale (`?locale=<L>`), never with the `*`
  wildcard, so per-locale ETag derivation is sound.

**Pattern 2** (per-locale manifests) is opt-in via `locale.pattern: 2`.
The adapter declares `manifestCapabilities.manifest_url_template` so
the generator advertises the per-locale manifest URL template.

`metadata.translations` is populated densely per
`../wire-format/node.md`: each emitted node lists every other locale
that has the same entry as `{ locale, id }`. Untranslated locales
emit `metadata.translation_status: "fallback"` and
`metadata.fallback_from: <source-locale>` with default-locale field
values substituted into affected fields.

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by Contentful's Sync
API:

- `since` is the Contentful `nextSyncToken` from the previous run.
- Yields entries; deletions surface as `null` returns from
  `transform` with a `metadata.tombstone: true` partial marker.
- Sync errors (token expired) fall back to a full enumerate with a
  build warning citing the rebase.

## Concurrency and rate limiting

Default `concurrency_max: 4`. The adapter MUST honor 429 responses
with exponential backoff (initial 1s, factor 2, max 30s, capped at
6 retries) and respect Contentful's `X-Contentful-RateLimit-*`
headers when present. Sustained 429 after retry exhaustion is
unrecoverable.

## Failure surface

- **Recoverable** (warning, exit 0):
  - Missing default heuristic field on a single entry → partial node.
  - Asset 404 on a referenced asset → block reference omitted, rest
    of the node intact.
  - Linked entry outside the resolution depth → bare reference
    emitted instead of full inline payload.
  - Sync token rebase to full enumerate.
- **Unrecoverable** (non-zero exit):
  - HTTP 401 on the auth probe at `init`.
  - Sustained 429 / 5xx after retry exhaustion.
  - Configuration violating reserved metadata keys.
  - Configured `contentTypes` array empty.

## Conformance target

- **Standard:** single-locale build, default field heuristics, Rich
  Text → `prose`/`code`/`callout`/`data` blocks, asset references
  inlined as markdown.
- **Strict:** + multi-locale fan-out (Pattern 1 or 2), + dense
  `metadata.translations`, + `marketing:*` block extraction via
  user-supplied `mappings.<ct>.blocks`, + `delta(since)` via the Sync
  API.

The adapter does not declare Core: any realistic Contentful ingestion
emits Standard-tier content (`abstract`, `related` cross-references)
out of the box.

## Examples

A space with content types `blogPost` (`title`, `slug`, `excerpt`,
`body`, `heroImage`, `author`) and `author` (`name`, `bio`),
configured as:

```json
{
  "spaceId": "abc123",
  "accessToken": "<CDA token>",
  "contentTypes": ["blogPost", "author"],
  "defaults": { "blogPost": "article", "author": "person" },
  "idStrategy": { "from": "slug", "field": "slug", "namespace": "cms" },
  "locale": { "available": ["en-US", "es-ES"], "default": "en-US" }
}
```

emits two nodes per entry (one per locale), with `marketing:image`
blocks for hero images at Plus and `metadata.translations` cross-
linking the locale variants.

## Open questions / extension points

- **Preview-API mode.** Out of scope for v0.2; operators needing
  preview content fall back to the programmatic adapter
  (`./programmatic.md`).
- **Field-mapping transforms** (`{ from: "excerpt", transform:
  "truncate(50)" }`) — declarative-only in v0.2.
- **Tags API** (separate from per-entry tags) — additive ASP
  candidate.
- **Cross-adapter rate-limit coordination** when multiple
  Contentful adapters run against the same space — out of scope;
  documented limitation.

## Sources

- `./markdown.md` for the body-extraction algorithm reused by the
  default heuristics.
- `./i18n.md` for the multi-source merge composition with the i18n
  adapter.
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

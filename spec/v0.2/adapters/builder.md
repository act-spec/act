---
title: Builder.io adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Builder.io adapter

> The Builder.io adapter projects Builder content models onto an ACT
> tree via the Builder Content API. Page models become nodes, data
> models become typed leaves, Builder blocks map to component
> references, and section blocks map to prose where applicable. A
> faithful implementation reaches Standard out of the box and Strict
> when locales and `marketing:*` mappings are configured.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-builder`. The mapping below is normative. The
adapter is read-only — it consumes the public Content API
(`cdn.builder.io/api/v3/content/<model>`) with `published` content
by default and `draft` when preview mode is requested.

## Source content model

A Builder.io space exposes:

- **Page models** — visually-edited content with a URL targeting,
  block tree, and per-locale variants.
- **Data models** — structured content (no visual block tree),
  schema-driven via custom fields.
- **Section models** — reusable visual sections referenced from
  pages; not nodes by default unless OPT-IN.
- **Symbols** — reusable component references.
- **Targeting attributes** — `userAttributes`, `query`-based
  variants. The adapter emits the canonical (no-targeting) variant
  per content item; segmented variants are a v0.3 candidate.
- **Localization** via the per-content `data.locale` field or the
  per-content `query` array filter.

Auth is via a public API key (`apiKey` query parameter). Builder API
keys are not secret-grade tokens but SHOULD be configured via
environment variable for parity with other adapters.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Page-model entry whose model name is in `pageModels` | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | `type` from `mappings.<model>.type` or `defaults.<model>` or `"page"` |
| Data-model entry whose model name is in `dataModels` | leaf | as above | typed by `defaults.<model>` (default `"article"`) |
| Section-model entry referenced from a page block | inline block | — | mapped per the block-to-block table below; OPT-IN as a node via `dataModels` |
| Symbol reference inside a page block tree | inline block | — | `marketing:placeholder` referencing the symbol's content (resolved via `?includeRefs=true`) |
| Targeting variant of an emitted page | EXCLUDED in v0.2 | — | only the canonical variant emitted; segmented variants are a v0.3 candidate |

**Default field heuristics**:

- `title` ← `data.title`, `data.name`, page `name`.
- `summary` ← `data.summary`, `data.description`. Else extracted from
  the rendered prose.
- `body` (the `content` array) ← walks the page's block tree (the
  `data.blocks[]` array) per the table below.
- `tags` ← `data.tags` array (when present).
- `related` ← reference fields whose target entries are in-corpus,
  emitted as `{ id, relation: "see-also" }`.
- For data-model entries: all `data.*` fields not consumed by the
  above heuristics are passed through as `metadata.<key>`.

**ID derivation** (per `idStrategy`):

- `from: "url"` (default for page models) →
  `<namespace>/<data.url-stripped-leading-slash>` normalized.
- `from: "id"` (default for data models) → `<namespace>/<id>`.
- `from: "name"` → `<namespace>/<name>` normalized.

A `data.actId` field (configurable) wins over the strategy. Default
namespace is `cms`.

## Builder block → ACT block mapping

Builder's block tree is a recursive component model. Each block has
a `@type: "@builder.io/sdk:Element"` envelope and a `component.name`
discriminator.

| Builder block component | ACT block | Notes |
|---|---|---|
| `Text` | `prose` block (`format: "markdown"` if HTML markup contains `<a>`/`<strong>`/etc., else `"plain"`) | the block's `text` HTML is converted to markdown |
| `Image` | `marketing:image` (Plus) or markdown image link inside surrounding `prose` (Standard) | |
| `Custom Code` / `Embed` | `code` block with `lang: "html"` (Plus) or `marketing:placeholder` if the embed is opaque | |
| `Section`, `Columns`, `Stack` (layout) | container only — children are walked and their blocks emitted at the parent's level | layout discarded; ACT does not model visual layout |
| Symbol reference | `marketing:placeholder` with `metadata.symbol: <symbol-id>` | symbol body is resolved when `resolveSymbols: true` |
| Block matching `mappings.<pageModel>.blocks.<componentName>` | the configured `marketing:*` block | required block fields validated; missing fields fall back to `marketing:placeholder` |
| Block with no rule | `marketing:placeholder` (Plus) or warn + skip (Standard) | carries `metadata.extracted_via: "component-contract"` and `metadata.component: "<componentName>"` |

Walk order is depth-first; layout containers do not contribute
blocks of their own. Block ordering matches the depth-first traversal.

## Content API query construction

The adapter calls
`GET https://cdn.builder.io/api/v3/content/<model>?apiKey=<key>&limit=100&offset=N&includeRefs=true&fields=...&locale=<L>`
for each entry in `pageModels` and `dataModels`. Pagination continues
until the response returns fewer than `limit` items.

`includeRefs=true` is REQUIRED to resolve symbol references; the
default `noTargeting=true` ensures the canonical variant is fetched.
Yield order is stable: sorted by `id`, then locale.

## Manifest emission

Contributed manifest fields:

- `site.canonical_url` ← from generator config.
- `locales.default`, `locales.available` ← from adapter config.
- `capabilities` ← `etag: true`, `subtree: true` (when emitted),
  `i18n: true` when `>1` locale.
- `delivery: "static"`.

## Index emission

One node-ref per (entry, locale) pair, in stable order. Page-model
entries derive their `parent` from the URL hierarchy (e.g.,
`/products/widget` becomes a child of `/products`); data-model entries
attach to the synthetic root unless an explicit `parent` field is
configured.

## i18n

When `>1` locale is in scope, the default is **Pattern 1**
(locale-prefixed IDs):

- Per-locale Content API requests issued (`?locale=<L>`).
- ID = `<namespace>/<locale-lower>/<entry-derived-id>`.
- `metadata.locale` on every node.

**Pattern 2** (per-locale manifests) is opt-in.

`metadata.translations` is populated by walking the cross-locale
variants of each canonical entry (Builder exposes per-locale variants
under the same content `id` with different `data.locale` values).

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by Content API
queries filtering on `lastUpdated`:
`?query.lastUpdated.$gt=<unix-millis>`. Deletions surface as absences
across runs.

## Concurrency and rate limiting

Default `concurrency_max: 6`. Builder's CDN tolerates moderate
concurrency; the adapter MUST honor 429 responses with exponential
backoff. Per-locale fan-out multiplies request counts; large catalogs
SHOULD use `delta(since)` for incremental rebuilds.

## Failure surface

- **Recoverable**: missing default heuristic field → partial node;
  unresolved symbol → `marketing:placeholder` with the symbol ID
  preserved; image 404 → block reference omitted.
- **Unrecoverable**: HTTP 401, sustained 429/5xx after retries,
  empty `pageModels` and `dataModels`, reserved-metadata-key
  violations.

## Conformance target

- **Standard:** single-locale, default heuristics, `Text` blocks →
  `prose`, image references inlined.
- **Strict:** + multi-locale fan-out, + dense
  `metadata.translations`, + `marketing:*` block extraction via
  `mappings.<pageModel>.blocks`, + `delta(since)`.

## Examples

A Builder space with a `page` model (visually-edited landing pages)
and a `blog-post` data model, configured as:

```json
{
  "apiKey": "<public api key>",
  "pageModels": ["page"],
  "dataModels": ["blog-post"],
  "defaults": { "page": "page", "blog-post": "article" },
  "mappings": {
    "page": {
      "blocks": [
        { "when": { "ofType": "Hero" }, "type": "marketing:hero",
          "fields": { "headline": "headline", "image": "backgroundImage" } },
        { "when": { "ofType": "CTA" }, "type": "marketing:cta",
          "fields": { "label": "buttonText", "href": "buttonHref" } }
      ]
    }
  },
  "locale": { "available": ["en-US", "es-ES"], "default": "en-US" }
}
```

emits two nodes per landing page (one per locale), each composed of
`marketing:hero` + `prose` (from `Text` blocks) + `marketing:cta`
blocks, plus blog-post data-model entries.

## Open questions / extension points

- **Targeting variants** — segmenting per `userAttributes` or
  `query` is a v0.3 candidate; v0.2 emits only the canonical variant.
- **Section-model promotion to nodes** — additive ASP candidate.
- **A/B test variants** — out of scope for v0.2; the adapter emits
  the default variant.

## Sources

- `./contentful.md` for the rich-text-to-block mapping pattern.
- `./i18n.md` for cross-locale composition.
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

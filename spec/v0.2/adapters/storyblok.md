---
title: Storyblok adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Storyblok adapter

> The Storyblok adapter projects a Storyblok space onto an ACT tree
> via the Stories API. Stories become nodes, components (bloks)
> become node types or block-level components, the visual story tree
> maps onto the ACT hierarchy, and Storyblok's per-story
> `translated_slugs` map to ACT locales. A faithful implementation
> reaches Standard out of the box and Strict when locales and
> `marketing:*` mappings are configured.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-storyblok`. The mapping below is normative. The
adapter is read-only — it consumes the public CDN
(`api.storyblok.com/v2/cdn`) with `published` version by default and
the `draft` version when preview mode is requested.

## Source content model

A Storyblok space exposes:

- **Stories** keyed by `id` (numeric) with a `full_slug` (path-like)
  and a `content` payload typed by Storyblok's component model
  (bloks).
- **Components (bloks)** — schema-driven content modules. Each
  component has a `component` discriminator field.
- **Folders** — stories whose `is_folder: true`; they group child
  stories and MAY have a `default_root` story for the section index.
- **Datasource entries** — key/value pairs for shared option lists;
  not nodes by default.
- **Translated slugs** — per-story `translated_slugs[]` array with
  `lang`, `name`, `path`; the canonical i18n source.
- **Releases** — staged content sets; the adapter MAY target a
  specific release via the `from_release` query param.

Auth is via a public access token (preview or published). The token
is treated as a secret in published mode (it can fan out to every
story); preview tokens MUST NOT be used in production builds.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Story with `is_folder: false` whose root component is in `componentTypes` | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | `type` from `mappings.<component>.type` or `defaults.<component>` or `"article"` |
| Story with `is_folder: true` | branch | `id`, `type` (`"section"`), `children`, `title` | `default_root` story (when present) supplies prose; otherwise a synthesized branch |
| Nested blok inside a story `content` field | inline block | — | mapped per the blok-component table below |
| Datasource entry | EXCLUDED by default | — | not a node; OPT-IN for advanced use cases |

**Default field heuristics**:

- `title` ← `content.title`, then `content.headline`, then story
  `name`.
- `summary` ← `content.summary`, `content.excerpt`,
  `content.description`. Else extracted from the rendered body.
- `body` (the `content` array) ← walks the story's component tree;
  each blok maps per the table below.
- `tags` ← story `tag_list` (Storyblok's first-class tags).
- `related` ← reference fields whose target stories are in-corpus,
  emitted as `{ id, relation: "see-also" }`.

**ID derivation** (per `idStrategy`):

- `from: "slug"` (default) → `<namespace>/<full_slug>` normalized.
- `from: "id"` → `<namespace>/<numeric-id>`.
- `from: "composite"` → `<namespace>/<root-component>/<full_slug>`.

A story field named `act_id` (configurable) wins over the strategy.
Default namespace is `cms`.

## Blok component → block mapping

| Blok component pattern | ACT block | Notes |
|---|---|---|
| Rich-text field on a blok (Storyblok rich text JSON) | `prose` blocks (one per top-level node, `format: "markdown"` when nested marks present) | follows the same node-type table as the Contentful Rich Text mapping (`./contentful.md`) |
| Rich-text fenced code | `code` block with `lang` from the editor | |
| `image` field | `marketing:image` (Plus) or markdown image link in surrounding `prose` (Standard) | resolved to the Storyblok asset URL |
| Blok matching a `mappings.<component>.blocks` rule | the configured `marketing:*` block | required block fields validated; missing fields fall back to `marketing:placeholder` |
| Blok with no rule | `marketing:placeholder` (Plus) or warn + skip (Standard) | carries `metadata.extracted_via: "component-contract"` and `metadata.component: "<blok-component>"` |
| Plain-text long-text field | `prose` block with `format: "plain"` | |
| Markdown long-text field (Storyblok markdown editor) | `markdown` block in coarse mode; `prose`/`code`/`data`/`callout` in fine mode (per `./markdown.md`) | |

Block order matches the depth-first walk order of the story
component tree.

## Stories API query construction

The adapter calls `GET /v2/cdn/stories` with:

- `version=published` (default) or `draft` (when `preview: true`).
- `per_page=100` and explicit `page` paging until the response
  `total` is exhausted.
- `starts_with=<contentRoot>` when a content root is configured.
- `resolve_relations=<refField1>,<refField2>` per
  `resolveRefs.fields`, with bounded depth.
- `language=<locale>` per locale fan-out (NOT the `*` wildcard, so
  per-locale ETag derivation is sound).
- `filter_query[component][in]=<comp1>,<comp2>` to constrain to the
  configured `componentTypes`.

Yield order is stable: sorted by `full_slug`, then `id`.

## Manifest emission

Contributed manifest fields:

- `site.canonical_url` ← from generator config.
- `locales.default` ← `locale.default` (or the space's first
  language code).
- `locales.available` ← `locale.available` (or the space's
  configured languages).
- `capabilities` ← `etag: true`, `subtree: true` (when emitted),
  `i18n: true` when `>1` locale.
- `delivery: "static"`.

## Index emission

One node-ref per (story, locale) pair, in stable order. Folder
stories synthesize branches whose `children` follow the API's
`position` ordering when present, else slug order.

## i18n

When `>1` locale is in scope, the default is **Pattern 1**
(locale-prefixed IDs):

- One node per (story, locale) pair, computed by issuing per-locale
  Stories API requests.
- ID = `<namespace>/<locale-lower>/<full_slug>` (translated_slugs
  honored: a story with `translated_slugs: [{ lang: "es", path:
  "introduccion", ... }]` yields the Spanish-locale node at
  `cms/es/introduccion`).
- `metadata.locale` on every node (BCP-47 form).

**Pattern 2** (per-locale manifests) is opt-in via
`locale.pattern: 2`.

`metadata.translations` is populated densely from the cross-locale
`translated_slugs` array.

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by Storyblok's
`/stories?published_at_gt=<RFC3339>` filter. Deletions surface as
absences across runs (the framework reconciles via the previous
build's index). Cache version (`cv`) bumping by Storyblok requires
a one-time fetch to the new `cv` value.

## Concurrency and rate limiting

Default `concurrency_max: 6`. The adapter MUST honor 429 responses
with exponential backoff and respect Storyblok's per-second rate
limits, which vary by plan. Per-locale fan-out multiplies request
counts; large catalogs SHOULD use `delta(since)` for incremental
rebuilds.

## Failure surface

- **Recoverable**: missing default heuristic field → partial node;
  unresolved relation field → bare reference; image asset 404 →
  block reference omitted.
- **Unrecoverable**: HTTP 401/403, sustained 429/5xx after retries,
  empty `componentTypes`, configured reserved-metadata-key
  violations.

## Conformance target

- **Standard:** single-locale, default heuristics, rich text →
  `prose`/`code` blocks, image references inlined.
- **Strict:** + multi-locale fan-out via `translated_slugs`, + dense
  `metadata.translations`, + `marketing:*` block extraction via
  `mappings.<component>.blocks`, + `delta(since)`.

## Examples

A space with components `page` (root: hero, sections, cta), `hero`
(headline, image), `cta` (label, href), `section` (heading, body),
configured as:

```json
{
  "spaceId": 12345,
  "accessToken": "<published token>",
  "componentTypes": ["page"],
  "defaults": { "page": "page" },
  "mappings": {
    "page": {
      "blocks": [
        { "when": { "ofType": "hero" }, "type": "marketing:hero",
          "fields": { "headline": "headline", "image": "image" } },
        { "when": { "ofType": "cta" }, "type": "marketing:cta",
          "fields": { "label": "label", "href": "href" } }
      ]
    }
  },
  "locale": { "available": ["en", "es"], "default": "en" }
}
```

emits two nodes per page story (one per locale), each composed of
`marketing:hero` + `prose` (from sections) + `marketing:cta` blocks,
with cross-locale `metadata.translations` populated from
`translated_slugs`.

## Open questions / extension points

- **Releases** — operators wanting to preview content from a release
  set `from_release: <id>`; the adapter MUST emit a build warning
  marking the build as non-canonical.
- **Datasource entries as nodes** — additive ASP candidate.
- **Visual editor preview integration** — runtime concern; out of
  scope for the build-time adapter.

## Sources

- `./contentful.md` for the rich-text-to-block mapping pattern.
- `./i18n.md` for cross-locale composition.
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---
title: WordPress adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# WordPress adapter

> The WordPress adapter projects a WordPress site onto an ACT tree
> via the WP REST API. Posts and pages become nodes, categories
> become branches, tags become metadata, Gutenberg blocks become
> ACT prose blocks, and the Polylang / WPML extensions map to ACT
> locales. A faithful implementation reaches Standard out of the box
> and Strict when locales and `marketing:*` mappings are configured.

> **Live example.** A built copy of the
> [`wordpress-blog`](https://github.com/act-spec/act/tree/main/examples/wordpress-blog)
> example (sourced from a recorded REST fixture) is deployed at
> [`/examples/wordpress-blog/`](/examples/wordpress-blog/).
> Open it in the
> [site browser](/browser/?site=%2Fexamples%2Fwordpress-blog%2F.well-known%2Fact.json)
> to walk the post / category tree.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-wordpress`, new in v0.2. The mapping below is
normative. The adapter is read-only — it consumes the public
`wp/v2/*` REST endpoints. Auth is OPTIONAL: public posts are
readable without credentials; private content requires an
application-password bearer token.

## Source content model

A WordPress site exposes (via `wp-json/wp/v2/`):

- **Posts** (`posts`) — dated articles keyed by numeric `id`, with a
  `slug`, `title`, `excerpt`, `content` (rendered HTML and/or
  Gutenberg block JSON), and references to authors, categories,
  tags, and featured media.
- **Pages** (`pages`) — hierarchical static pages with a `parent`
  field linking to a parent page.
- **Categories** (`categories`) — taxonomies grouping posts; each
  carries a `name`, `slug`, `description`, and optional `parent`
  for hierarchical category trees.
- **Tags** (`tags`) — flat taxonomies; metadata only.
- **Users** (`users`) — author records; surfaced as
  `metadata.author`.
- **Media** (`media`) — uploaded assets with URL, MIME type, and
  alt text.
- **Custom post types** (configured by the WordPress site) — exposed
  under `wp-json/wp/v2/<cpt-slug>` when `show_in_rest: true`. The
  adapter accepts an explicit `customPostTypes` list.
- **Gutenberg blocks** — when the site stores content as block JSON
  (recent WordPress versions), the `?context=edit` endpoint exposes
  the block tree directly. Otherwise the adapter falls back to
  parsing rendered HTML.

Auth modes:

- **Public**: no credentials. Only `status: publish` content is
  visible.
- **Application password** (recommended for private content): basic
  auth with a user-scoped application password. The token is
  treated as a secret.
- **Bearer (JWT plugin)**: alternative for sites running a JWT auth
  plugin; configured via `auth.bearer`.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Post | leaf | `id`, `type` (default `"article"`), `locale`, `title`, `content`, `parents` | parent is the synthetic `posts` branch unless categories take precedence |
| Page (root, no `parent`) | branch | `id`, `type` (default `"page"`), `children` | children are sibling pages whose `parent` matches |
| Page (nested) | branch | as above | walks the page hierarchy via the `parent` field |
| Category (with assigned posts) | branch | `id`, `type` (`"category"`), `children`, `title` | hierarchical via the category's `parent`; OPT-OUT via `taxonomies.categories: false` |
| Tag | EXCLUDED (metadata only) | — | tags surface as `node.tags[]` on associated posts; not nodes themselves unless OPT-IN via `taxonomies.tags: true` |
| User (author) | EXCLUDED | — | surfaced as `metadata.author: { id, name, slug }` on associated posts |
| Featured media (image) | block-level reference | — | inlined as `marketing:image` (Plus) at the top of the post's `content[]` or as a markdown image link (Standard) |
| Custom post type entry whose slug is in `customPostTypes` | leaf | as for posts | `type` derived from `defaults.<cpt-slug>` or `"article"` |

**Default field heuristics**:

- `title` ← `title.rendered` (HTML decoded). Missing title is
  recoverable: emit a partial node titled `"Untitled <type> <id>"`.
- `summary` ← `excerpt.rendered` stripped of HTML tags. Otherwise
  extracted from the body via the Markdown adapter's algorithm
  (`./markdown.md`).
- `body` (the `content` array) ← Gutenberg block tree when available
  (per the table below); otherwise rendered-HTML conversion to
  prose blocks via a sanitizer pipeline.
- `tags` ← associated tag names (resolved via the `tags` array of
  numeric IDs).
- `related` ← reference fields configured under `mappings.<type>.related`.

**ID derivation** (per `idStrategy`):

- `from: "slug"` (default) → `<namespace>/<slug>` for posts;
  `<namespace>/pages/<slug>` for pages; `<namespace>/categories/<slug>`
  for categories.
- `from: "id"` → `<namespace>/<numeric-id>`.
- `from: "permalink"` → derived from the rendered URL path.

A meta field named `act_id` (configurable; visible via
`?_fields=meta`) wins over the strategy. Default namespace is `wp`.

## Gutenberg block → ACT block mapping

| Gutenberg block | ACT block | Notes |
|---|---|---|
| `core/paragraph` | `prose` (`format: "markdown"` if marks/links present, else `"plain"`) | inline marks preserved as markdown |
| `core/heading` | `prose` with leading `#` markers, `format: "markdown"` | level from the block's `level` attribute |
| `core/list` | `prose` with markdown list syntax | ordered vs unordered from block attributes |
| `core/quote` | `prose` with `>` quoting | citation appended on a new line |
| `core/code`, `core/preformatted` | `code` block with `lang` from the `className` (e.g., `language-js`) | |
| `core/image` | `marketing:image` (Plus) or markdown image link (Standard) | resolved via the embedded URL |
| `core/embed` (YouTube, Twitter, etc.) | `marketing:embed` (Plus) or `code` block with the URL (Standard) | |
| `core/table` | `prose` with markdown table syntax | |
| `core/separator` | `prose` with `text: "---"` | |
| `core/html` | `prose` with `format: "html"` (Plus) or sanitized to markdown (Standard) | |
| `core/columns`, `core/group`, `core/cover` (layout) | container only — children are walked at the parent's level | layout discarded; ACT does not model visual layout |
| Block matching `mappings.<type>.blocks.<blockName>` | the configured `marketing:*` block | required block fields validated; missing fields fall back to `marketing:placeholder` |
| Block with no rule | `marketing:placeholder` (Plus) or warn + skip (Standard) | carries `metadata.extracted_via: "component-contract"` and `metadata.component: "<blockName>"` |

When Gutenberg block JSON is unavailable (older sites, classic
editor), the adapter falls back to parsing `content.rendered` HTML
through a sanitizer that converts standard tags into the same prose
blocks listed above.

## REST query construction

The adapter calls the standard endpoints with explicit pagination:

- `GET /wp-json/wp/v2/posts?per_page=100&page=N&_embed=author,wp:featuredmedia,wp:term&context=view&lang=<L>`
- `GET /wp-json/wp/v2/pages?per_page=100&page=N&_embed=...`
- `GET /wp-json/wp/v2/categories?per_page=100&page=N&hide_empty=true`

`_embed` is REQUIRED for efficient resolution of authors, featured
media, and taxonomies in a single request. Pagination continues
until the response's `X-WP-TotalPages` header is exhausted.
Yield order is stable: sorted by `id`, then locale.

## Manifest emission

Contributed manifest fields (`../wire-format/manifest.md`):

- `site.canonical_url` ← from generator config (or the WP site's
  `home_url`).
- `site.name` ← the WP site's `name` (from `/wp-json/`).
- `locales.default` ← `locale.default` (or the i18n plugin's
  default).
- `locales.available` ← `locale.available` (or the i18n plugin's
  configured locales).
- `capabilities` ← `etag: true`, `subtree: true` (when emitted),
  `i18n: true` when `>1` locale.
- `delivery: "static"`.

## Index emission

One node-ref per (entry, locale) pair, in stable order. Posts
attach to either the synthetic `posts` branch or to their primary
category (when `taxonomies.categories.posts_under_category: true`).
Pages attach to their `parent` page or to the synthetic root.

## i18n

The adapter detects the i18n plugin from the site's `/wp-json/`
discovery output:

- **Polylang** — exposes per-language endpoints via `?lang=<L>` and
  cross-translation references via the `translations` field on
  posts / pages.
- **WPML** — exposes per-language endpoints via `?lang=<L>` and
  cross-translation references via WPML's REST extension.
- **Neither** — single-locale build.

When `>1` locale is in scope, the default is **Pattern 1**
(locale-prefixed IDs):

- Per-locale REST requests (`?lang=<L>`).
- ID = `<namespace>/<locale-lower>/<entry-derived-id>`.
- `metadata.locale` on every node.

**Pattern 2** (per-locale manifests) is opt-in via
`locale.pattern: 2`.

`metadata.translations` is populated densely from the cross-locale
references the i18n plugin exposes.

## Incremental rebuilds

The adapter MAY implement `delta(since)` backed by REST queries
filtering on `modified`:
`?modified_after=<RFC3339>&orderby=modified&order=desc`.

Deletions surface as absences across runs (the framework reconciles
via the previous build's index). Trash and revision endpoints are
out of scope for v0.2.

## Concurrency and rate limiting

Default `concurrency_max: 4`. WordPress has no built-in rate
limiting, but managed-WP hosts (WP Engine, Kinsta, Pressable) apply
edge limits; the adapter MUST honor 429 responses with exponential
backoff. Per-locale fan-out multiplies request counts; large
catalogs SHOULD use `delta(since)` for incremental rebuilds.

## Failure surface

- **Recoverable**: missing default heuristic field → partial node;
  unresolved featured-media reference → block omitted; one
  Gutenberg block fails to parse → that block becomes
  `marketing:placeholder` and the rest of the post is intact.
- **Unrecoverable**: HTTP 401/403 (when auth is configured),
  sustained 429/5xx after retries, REST endpoints disabled
  site-wide, reserved-metadata-key violations.

## Conformance target

- **Standard:** single-locale, default heuristics, Gutenberg blocks
  → `prose`/`code` blocks, featured media inlined.
- **Strict:** + multi-locale fan-out via Polylang/WPML, + dense
  `metadata.translations`, + `marketing:*` block extraction via
  `mappings.<type>.blocks`, + `delta(since)`.

## Examples

A WordPress site with the `polylang` plugin, configured as:

```json
{
  "baseUrl": "https://blog.example.com",
  "auth": { "mode": "appPassword", "user": "act-bot",
            "password": "<app password>" },
  "include": { "posts": true, "pages": true, "categories": true },
  "customPostTypes": ["recipe"],
  "defaults": { "post": "article", "page": "page", "recipe": "article" },
  "idStrategy": { "from": "slug", "namespace": "wp" },
  "locale": { "available": ["en", "fr"], "default": "en" }
}
```

emits two nodes per post (one per locale), with `marketing:image`
blocks for featured media at Plus and `metadata.translations`
cross-linking the locale variants from Polylang's `translations`
field.

## Open questions / extension points

- **ACF (Advanced Custom Fields)** — exposes custom fields via
  REST when `show_in_rest: true`. The adapter SHOULD surface ACF
  fields under `metadata.acf.*` by default; richer mapping is a
  v0.3 ASP candidate.
- **WooCommerce products** — a separate REST endpoint
  (`wp-json/wc/v3/products`) with auth differences; out of scope
  for v0.2; users with WooCommerce sites can fall back to the
  programmatic adapter (`./programmatic.md`) for now.
- **Comments** — out of scope for v0.2; they are not content nodes
  in the ACT model.
- **Multisite** — each subsite is treated as a separate adapter
  instance pointed at its own `baseUrl`.

## Sources

- `./markdown.md` for body extraction.
- `./i18n.md` for cross-locale composition.
- `../wire-format/node.md`, `../wire-format/etag.md`.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

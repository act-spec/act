---
title: Jekyll adapter mapping
spec: act-spec
spec-version: 0.2.0
status: Informative (community implementation expected)
last-updated: 2026-05-03
---

# Jekyll adapter mapping

> The Jekyll adapter projects a Jekyll site (Ruby-built; `_posts/`,
> `_pages`, user-defined collections, `_config.yml`; the default
> generator behind GitHub Pages) onto an ACT tree. A faithful Jekyll
> plugin can reach Standard, and Strict when a multi-language plugin
> (`jekyll-polyglot`, `jekyll-multiple-languages-plugin`) is in use.
> No first-party Jekyll plugin ships in v0.2.x.

## Status

This is a **spec-only mapping**. No first-party reference adapter ships
in v0.2.x. Community implementations are welcome — file an ASP to have
one adopted as first-party. The natural distribution channel is a
`jekyll-act` rubygem. Jekyll's Generator, Converter, and Hooks APIs
map cleanly onto the ACT pipeline; the plugin runs in-process during
`jekyll build`, so no wrapper script is required.

GitHub Pages's default Jekyll allowlist constrains plugin choice. An
adapter targeting GitHub Pages-default sites SHOULD be loadable via
the `gh-pages` gem's allowlist or, alternatively, via a GitHub Actions
workflow that runs `jekyll build` outside the Pages-default sandbox.

## Source content model

Jekyll's first-class buckets:

- **`_posts/`** — dated posts. Filenames follow `YYYY-MM-DD-slug.md`;
  Jekyll parses the date as `page.date`.
- **`_pages` / root pages** — any `.md` / `.html` with front matter
  at the project root or under `_pages/`. URL from `permalink:` or
  Jekyll defaults.
- **Collections** — user-defined groupings declared in `_config.yml`'s
  `collections:` block. Each in `_<name>/` with its own permalink.
- **Data files** (`_data/*.yml`) — metadata, not pages; not nodes by
  default.
- **`_config.yml`** — declares `url`, `baseurl`, `title`, plugins,
  collections, permalinks, i18n.
- **Layouts and includes** — templates; not content.
- **Multilingual support** via `jekyll-polyglot` (per-locale build
  passes) or `jekyll-multiple-languages-plugin` (per-locale
  `_i18n/<locale>/` subdirectories).

Front matter is YAML, `---`-delimited at file head.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| `_posts/` post | leaf | `id`, `type` (`"article"`), `locale`, `title`, `content`, `parents` | filename date → `metadata.published_at`; `categories:` / `tags:` from front matter |
| Page (`*.md` / `*.html` at root or `_pages/`) | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | front-matter `type` overrides; `permalink:` controls URL, NOT the ACT ID |
| Collection document (`_<name>/*.md`) | leaf | `id`, `type`, ... | the collection itself MAY be emitted as a branch (next row) |
| Collection bucket | branch (OPTIONAL) | `id` (the name), `type` (`"section"`), `children` | OPT-IN via `[act].collections_as_branches`; default OFF |
| Category / Tag value | branch (OPTIONAL) | `id`, `type` (`"category"`), `children` | OPT-IN; aggregates posts sharing the value |
| Data file (`_data/*.yml`) | EXCLUDED by default | — | OPT-IN per-file via `[act].data_as_nodes`; rare |
| Draft (`_drafts/*.md`) | EXCLUDED unless `--drafts` | — | honors Jekyll's `--drafts` flag |

**ID derivation:** when no front-matter `id:` is present, the ID is
the page's site-relative URL path with leading `/` stripped, trailing
slash stripped, `index` collapsed to parent. A post with permalink
`/2026/05/03/intro/` yields `2026/05/03/intro`; a collection document
at `_recipes/pancakes.md` with permalink `/recipes/pancakes/` yields
`recipes/pancakes`. Front-matter `id:` overrides.

The default `type` is `"article"`; a front-matter `type` overrides.
Branches synthesized from collections / categories / tags emit
`type: "section"` or `"category"`.

Recognized front-matter keys:

| Key | ACT mapping | Default if absent |
|---|---|---|
| `title` | node `title` | first H1, else file stem |
| `description` / `summary` | node `summary`, `summary_source: "author"` | extracted first paragraph |
| `id` / `type` | explicit overrides | derived / `"article"` |
| `tags` / `categories` | node `tags` (merged); optional category-branch parents | absent |
| `permalink` | `metadata.canonical_url`; NOT the ID | Jekyll default |
| `date` | `metadata.published_at` (RFC 3339) | posts: from filename; pages: absent |
| `author` | `metadata.author` | absent |
| `published: false` | EXCLUDE node | `true` |
| `lang` (polyglot) | node `locale` | `_config.yml`'s `lang` / `default_lang` |

Reserved ACT metadata keys MUST NOT be settable from front matter.

## Manifest emission

The adapter MUST emit `/.well-known/act.json`:

- `site.canonical_url` ← `url + baseurl` (Jekyll's conventional split).
- `site.name` ← `title`.
- `locales.default` ← `lang` (or polyglot's `default_lang`);
  `locales.available` ← polyglot's `languages`, or
  `jekyll-multiple-languages-plugin`'s `languages`, or `[lang]`.
- `capabilities` ← computed from observed emissions.
- `indexes[].url` ← from plugin config (default `/act/index.json`).
- `delivery: "static"`.

## Index emission

The adapter MUST emit an index by walking `site.documents` (posts +
collection documents) plus `site.pages`. Node-ref shape conforms to
`wire-format/index.md`:

- `id`, `type`, `locale`, `href`, `etag` hint, `parent`.
- `_posts/` items take a synthesized `posts` parent; collection items
  take the collection's ID when emitted as a branch, otherwise the
  synthetic root. Root pages attach to the synthetic root `index`.

Subtrees (Standard) — emit per-collection or per-category subtree
files when immediate-child counts exceed a configurable threshold;
blogs with 1000+ posts SHOULD opt in. A Strict build additionally emits
an NDJSON index.

## Per-node emission

Per-node JSONs are written under `<destination>/act/nodes/<id>.json`
(default `destination = "_site"`). ETag derivation operates on
JCS-canonicalized bytes per `wire-format/etag.md`. A Ruby JCS
implementation (or an inline RFC 8785 helper) is typical.

Body-to-block mapping defaults to coarse: the post/page body becomes
a single `markdown` block. Fine-grained mode is opt-in via
`[act].parse_mode = "fine"`. The adapter SHOULD honor `kramdown`'s
extensions (footnotes, tables, attribute lists, IAL); kramdown classes
on fenced code map to `code.lang`.

## i18n

Detect the multilingual plugin in `_config.yml`'s `plugins`:

- `jekyll-polyglot` — invokes the build once per locale; hook each
  pass and emit per-locale ACT output. Default: **Pattern 2**
  (per-locale manifests at `/{locale}/.well-known/act.json`).
- `jekyll-multiple-languages-plugin` — uses `_i18n/<locale>/`
  subdirectories. Maps to Pattern 2 by default; Pattern 1 is opt-in.
- Neither plugin + a single `lang` — single-locale manifest.

Cross-locale linking maps to `metadata.translations`. The adapter
SHOULD consume the plugin's translation-pair data rather than
re-inferring filename conventions.

## Conformance target

- **Core:** single-locale, manifest + index + nodes, ETag, atomic
  writes, capability flags from observed emissions.
- **Standard:** + subtree files, + i18n Pattern 2, + build-report
  sidecar, + fine-grained body-to-block mapping.
- **Strict:** + NDJSON index, + i18n Pattern 1 (when chosen).
- **Strict:** not reachable from Jekyll alone (no runtime layer).

## Recommended impl shape

The natural integration is a **Ruby gem** (e.g., `jekyll-act`) hooking
Jekyll's plugin lifecycle. Two reasonable styles: a `Jekyll::Generator`
subclass observing `site.documents` / `site.pages` plus a
`Jekyll::Hooks.register :site, :post_write` hook that runs the
pipeline (compute ETags; emit manifest, index, nodes, build report);
or a pure-hook style (`:post_render` + `:post_write`) that composes
better with other plugins. For GitHub Pages compatibility, avoid
require-time side effects and work within the gh-pages allowlist, or
document the GitHub Actions workflow alternative.

## Examples

A site with `index.md`, `about.md`,
`_posts/2026-04-01-hello.md`, `_posts/2026-05-01-update.md`,
`_recipes/pancakes.md`, and `_config.yml`:

```yaml
url: https://example.com
title: Example Site
lang: en
collections:
  recipes:
    output: true
    permalink: /recipes/:path/
```

emits a manifest at `/.well-known/act.json`, an index with five
node-refs (`index`, `about`, `2026/04/01/hello`, `2026/05/01/update`,
`recipes/pancakes`), and five node JSONs at `/act/nodes/<id>.json`.
With `[act].collections_as_branches = ["recipes"]`, a sixth `recipes`
branch is added with `children: ["recipes/pancakes"]`, and the
`recipes/pancakes` node carries `parent: "recipes"`.

## Open questions / extension points

- **GitHub Pages allowlist.** Pages whitelists a fixed plugin set;
  `jekyll-act` would not be on it initially. Recommended path: a
  GitHub Actions workflow that runs `jekyll build` and publishes to
  Pages, bypassing the allowlist. An adapter MAY also pursue
  inclusion via the `github-pages` gem.
- **Liquid in front matter.** Rare but legal. The adapter MUST
  resolve Liquid before reading front-matter values.
- **Custom permalink templates.** The adapter MUST follow the
  post-resolution URL for ID derivation, never the raw template.
- **Pagination plugins** (`jekyll-paginate`, `-v2`). Paginator pages
  are derivative views; SHOULD NOT be emitted as nodes.
- **Atom/RSS feeds.** Generated by `jekyll-feed`; not nodes. An
  adapter MAY advertise the feed URL under `metadata.feeds[]` on
  the synthesized `posts` branch.

## Sources

- New in v0.2; no prior PRD.
- Hugo adapter mapping (`./hugo.md`) for cross-generator conventions.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec mapping authored by BDFL |

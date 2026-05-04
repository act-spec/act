---
title: MkDocs adapter mapping
spec: act-spec
spec-version: 0.2.0
status: Informative (community implementation expected)
last-updated: 2026-05-03
---

# MkDocs adapter mapping

> The MkDocs adapter projects an MkDocs site (Python-built; `docs/`
> tree, `mkdocs.yml` declarative `nav`, Material-for-MkDocs theme
> ecosystem) onto an ACT tree. A faithful MkDocs plugin can reach
> Standard, and Strict with `mkdocs-static-i18n`. No first-party plugin
> ships in v0.2.x.

## Status

This is a **spec-only mapping**. No first-party reference adapter ships
in v0.2.x. Community implementations are welcome — file an ASP to have
one adopted as first-party. The natural distribution channel is a
`mkdocs-act` PyPI package. MkDocs's plugin hook points (`on_files`,
`on_nav`, `on_page_markdown`, `on_post_build`) map cleanly onto the
ACT pipeline; the plugin runs in-process during `mkdocs build`, so no
wrapper script is required.

## Source content model

MkDocs coordinates three places:

- **`docs/` tree.** Markdown files with optional YAML front matter
  (`---`-delimited). Navigation is derived alphabetically by default;
  a declarative `nav` in `mkdocs.yml` overrides.
- **`mkdocs.yml`.** Declares `site_url`, `site_name`, theme,
  plugins, `markdown_extensions`, and the `nav` tree. The `nav` is
  normative: it defines canonical ordering, hierarchy, and titles.
- **Plugin pipeline.** The `plugins:` list runs registered Python
  plugins through MkDocs's hook lifecycle. The ACT plugin sits here.

Material for MkDocs adds front-matter conventions (`description`,
`tags`, `hide`, `icon`, section-index pages) that SHOULD be honored.
i18n is handled by community plugins, most commonly
`mkdocs-static-i18n`, via filename suffixes (`page.es.md`) or
per-locale folders (`docs/es/page.md`).

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| MkDocs page (a `.md` file resolved by `nav`) | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | front-matter `type` overrides default `"article"`; ordering follows `nav` order |
| MkDocs section (a `nav` group, possibly backed by an `index.md`) | branch | `id`, `type` (`"section"`), `children`, `title` | when no `index.md` backs the section, the adapter synthesizes a stub branch carrying `nav`-declared `title` and no prose |
| MkDocs section-index page (Material's section-index pattern, an `index.md` inside a folder referenced as a section in `nav`) | branch | as above; also carries prose | branch + content; the `index.md`'s body becomes the section node's content |
| MkDocs link entry (`nav: - "External": https://...`) | EXCLUDED | — | external URLs are not ACT nodes; the adapter MUST skip them and SHOULD emit a build warning if any are encountered |
| Tags (Material's `tags:` plugin) | branch (OPTIONAL) | `id`, `type` (`"category"`), `children` | OPT-IN; tag nodes anchor at `tags/<slug>` and list pages tagged with the term |

**ID derivation:** when no front-matter `id:` is present, the ID is
the page's site-relative URL path with leading `/` stripped, trailing
slash stripped, `index` collapsed to parent. So
`docs/getting-started/install.md` rendered at
`/getting-started/install/` yields `getting-started/install`. A
front-matter `id:` overrides. The `slug` plugin's output MUST NOT
influence the ACT ID; `metadata.canonical_url` carries the URL.

The default `type` is `"article"`; a front-matter `type` overrides.
Section-index pages emit `type: "section"`.

Recognized front-matter keys:

| Key | ACT mapping | Default if absent |
|---|---|---|
| `title` | node `title` | first H1, else file stem |
| `description` / `summary` | node `summary`, `summary_source: "author"` | extracted first paragraph |
| `id` | explicit ID override | derived |
| `type` | node type | `"article"` (or `"section"` for section-index) |
| `tags` | node `tags` | absent |
| `hide` | `metadata.hide: ["toc", "nav", ...]` | absent |
| `icon` | `metadata.icon` | absent |

Reserved ACT metadata keys MUST NOT be settable from front matter.

## Manifest emission

The adapter MUST emit `/.well-known/act.json`:

- `site.canonical_url` ← `mkdocs.yml`'s `site_url`. If unset, fail
  unless the operator supplies `[plugins.act].site_url` explicitly.
- `site.name` ← `site_name`.
- `locales.default` ← `mkdocs-static-i18n`'s `default_language` (or
  `theme.language`); `locales.available` ← the plugin's locales list.
- `capabilities` ← computed from observed emissions, never from
  configuration alone.
- `indexes[].url` ← from plugin config (default `/act/index.json`).
- `delivery: "static"`.

## Index emission

The adapter MUST emit an index by walking MkDocs's resolved `nav` tree
(post-plugin), not the raw `docs/` filesystem — `nav` ordering and
section grouping is normative. Each entry resolves to:

- A page entry → one node-ref with `id`, `type`, `locale`, `href`,
  `etag` hint, `parent` set to the containing section.
- A section entry with a backing `index.md` → one branch node-ref
  whose `children` enumerate the section's contents in `nav` order.
- A section entry without a backing page → a synthesized branch
  node-ref with `title` from `nav` and an empty content array.

Subtrees (Standard) — emit per-section subtree files when an
immediate-child count exceeds a configurable threshold; usually
unnecessary for the typical MkDocs site. A Strict build additionally
emits an NDJSON index, useful for `mkdocstrings`-generated API
references with thousands of pages.

## Per-node emission

Per-node JSONs are written under `<site_dir>/act/nodes/<id>.json`
(default `site_dir = "site"`). The adapter SHOULD pretty-print; ETag
derivation operates on JCS-canonicalized bytes per
`wire-format/etag.md`. A Python JCS library (`pyjcs`,
`json-canonicalization`, or equivalent) is the typical choice.

Body-to-block mapping defaults to coarse: each page's rendered
markdown becomes a single `markdown` block. Fine-grained mode
(`prose` / `code` / `data` / `callout` blocks) is opt-in via
`[plugins.act].parse_mode = "fine"` and requires Standard-or-higher
emission. The adapter SHOULD honor MkDocs's `markdown_extensions`
(admonitions → `callout`; fenced code → `code.lang`; tables → `data`
blocks of type `table`).

## i18n

The adapter SHOULD detect `mkdocs-static-i18n`. When present:

- Default: **Pattern 2** (per-locale manifests at
  `/{locale}/.well-known/act.json`).
- Opt-in: **Pattern 1** (locale-prefixed IDs).
- The adapter MUST NOT mix patterns within a single build.

When the plugin is absent and `theme.language` declares a single
locale, the adapter emits a single-locale manifest. Cross-locale
linking maps to `metadata.translations` — an array of `{ locale, id }`
references; the adapter SHOULD consume the plugin's translation-pair
data rather than re-inferring filename conventions.

## Conformance target

- **Core:** single-locale site, manifest + index + nodes, ETag, atomic
  writes, capability flags from observed emissions.
- **Standard:** + subtree files, + i18n Pattern 2, + build-report
  sidecar, + fine-grained body-to-block mapping.
- **Strict:** + NDJSON index, + i18n Pattern 1 (when chosen).
- **Strict:** not reachable from MkDocs alone (no runtime layer).

## Recommended impl shape

The natural integration is a **PyPI package** (e.g., `mkdocs-act`)
registered via the `mkdocs.plugins` entry-point group. The plugin
attaches to the canonical hook lifecycle:

- `on_config` — validate options, populate the manifest skeleton.
- `on_files` — observe the file set; build the ID-to-source map.
- `on_nav` — capture the resolved navigation tree (source of truth
  for index ordering).
- `on_page_markdown` / `on_page_content` — capture per-page markdown
  and rendered HTML for body-to-block mapping.
- `on_post_build` — run the canonical pipeline (compute ETags, emit
  manifest, index, nodes, and build report).

This composes with Material for MkDocs and other plugins without
requiring a wrapper script.

## Examples

A `docs/` tree with `index.md`, `getting-started/install.md`,
`getting-started/quickstart.md`, `api/overview.md`, `api/reference.md`,
and `mkdocs.yml`:

```yaml
site_url: https://docs.example.com
nav:
  - Home: index.md
  - Getting Started:
    - Install: getting-started/install.md
    - Quickstart: getting-started/quickstart.md
  - API:
    - Overview: api/overview.md
    - Reference: api/reference.md
```

emits a manifest at `/.well-known/act.json`, an index with seven
node-refs (`index`, `getting-started`, `getting-started/install`,
`getting-started/quickstart`, `api`, `api/overview`, `api/reference`),
and seven node JSONs at `/act/nodes/<id>.json`. The `getting-started`
and `api` nodes are synthesized branches (no backing page); their
`children` follow `nav` order, not alphabetical.

## Open questions / extension points

- **`mkdocstrings` and other content-generating plugins.** Plugins
  that synthesize pages appear in `on_files` like authored pages. The
  adapter MUST emit them as nodes; `metadata.source.adapter` SHOULD
  identify them as plugin-generated when feasible.
- **`awesome-pages`.** Reorders `nav` via per-folder `.pages` files.
  The adapter MUST consume the post-plugin `nav`, not raw `docs/`.
- **Custom theme variables.** The adapter MAY map theme-specific
  keys under `metadata.<theme_namespace>.*`.
- **Search backend.** MkDocs ships a built-in lunr search; the
  adapter MAY emit `capabilities.search.template_advertised` pointing
  at it. OPTIONAL.

## Sources

- New in v0.2; no prior PRD.
- Hugo adapter mapping (`./hugo.md`) for cross-generator conventions.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec mapping authored by BDFL |

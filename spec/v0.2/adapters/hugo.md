---
title: Hugo adapter mapping
spec: act-spec
spec-version: 0.2.0
status: Informative (community implementation expected)
last-updated: 2026-05-03
---

# Hugo adapter mapping

> The Hugo adapter projects a Hugo site (a Go-built static site generator
> with a `content/` tree, TOML/YAML/JSON front matter, sections, and a
> multilingual mode) onto an ACT tree. A faithful Hugo adapter can reach
> Standard conformance and, with i18n enabled, Strict. No first-party Hugo
> module ships in v0.2.x; the mapping below is the contract a community
> Go module SHOULD satisfy.

## Status

This is a **spec-only mapping**. No first-party reference adapter ships
in v0.2.x. Community implementations are welcome — file an ASP to have
one adopted as first-party. The natural distribution channel is a Go
module path such as `github.com/{org}/act-hugo`. The Go reference core
that ships in v0.2 provides the ETag / atomic-write / manifest plumbing
a Hugo module can sit on top of.

## Source content model

Hugo organizes content as a filesystem tree rooted at `contentDir`
(default `content/`):

- A directory containing an `_index.md` is a **section**; sibling
  `.md` files are leaves; subdirectories with their own `_index.md`
  are nested sections.
- A directory without an `_index.md` is a logical grouping; its leaf
  files attach to the nearest ancestor section or the synthetic root.
- A `*.md` file is a **single page**. A directory whose `index.md`
  (no underscore) is the page is a **page bundle**; sibling files are
  bundled resources.
- **Taxonomies** (`tags`, `categories`, …) are aggregations generated
  from front matter; Hugo emits taxonomy-term and taxonomy-list pages
  at build time.
- **Multilingual mode** (`languages` block in `hugo.toml`) declares
  one or more locales. Per-locale content lives in per-language
  `contentDir`s (e.g., `content/en/`) or via filename suffixes
  (e.g., `intro.es.md`).

Front matter MAY be TOML (`+++`), YAML (`---`), or JSON (`{ … }` at
file head). A Hugo adapter MUST recognize all three.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| Hugo page (`kind="page"`) | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | front-matter `type` overrides default `"article"`; `weight` → `metadata.hugo_weight` (ordering hint) |
| Hugo section (`_index.md`, `kind="section"`) | branch | `id`, `type` (`"section"`), `children`, `title` | derived from the `_index.md`; `children` lists leaf-page IDs and nested-section IDs |
| Hugo page bundle (leaf or branch bundle) | leaf | as for page; bundled assets emitted as `links` | `index.md` carries the node; sibling files become `links[]` entries with relative href |
| Hugo taxonomy term page | branch (OPTIONAL) | `id`, `type` (`"category"`), `children` | OPT-IN via `[params.act].taxonomies = ["tags", "categories"]`; default OFF |
| Hugo taxonomy list (e.g., `/tags/`) | branch (OPTIONAL) | as above | OPT-IN; emitted only when at least one taxonomy term is opted in |

The default node `type` is `"article"`; a front-matter `type` value
overrides it (Hugo already uses `type` for layout selection — the
adapter reuses the key). Section nodes MUST emit `type: "section"`.

**ID derivation:** drop the file extension; collapse `_index` to its
parent directory; lowercase ASCII; replace path separators with `/`. A
front-matter `id:` overrides. Hugo `slug:` is honored as an alias for
the ID's last segment, but explicit `id:` wins. Hugo `permalinks`
configuration MUST NOT influence the ID — the resolved permalink is
emitted as `metadata.canonical_url` only, so the ACT ID stays stable
across permalink-rewrite changes.

Reserved ACT metadata keys (`metadata.source`, `metadata.locale`,
`metadata.translations`, `metadata.extraction_status`,
`metadata.extracted_via`) MUST NOT be settable from front matter.

## Manifest emission

The adapter MUST emit `/.well-known/act.json` populated as follows:

- `site.canonical_url` ← Hugo's `baseURL` (or `[params.act].siteUrl` if
  the operator overrides).
- `locales.default` ← Hugo's `defaultContentLanguage`; `locales.available`
  ← keys of Hugo's `languages` table.
- `capabilities` ← computed from observed emissions, never from
  configuration alone. A Core build advertises `{ etag: true }`; a
  Standard build adds `{ subtree: true }` once subtree files exist; a
  Strict build adds `{ ndjson_index: true }` and i18n flags.
- `indexes[].url` ← resolves from `[params.act].urlTemplates.index_url`
  (default `/act/index.json`).
- `delivery: "static"` — Hugo is a pure static generator; the runtime
  delivery mode is not reachable from a Hugo module.

## Index emission

The adapter MUST emit an index document that walks the content tree
once, breadth-first, emitting one node-ref per Hugo page and section.
Node-ref shape MUST conform to `wire-format/index.md`:

- `id`, `type`, `locale`, `href`, `etag` (hint).
- `parent` set to the containing section's ID; the synthetic root is
  the literal ID `index`.
- Subtrees (Standard) — the adapter MAY emit a per-section subtree file
  for any section whose immediate descendant count exceeds a
  configurable threshold (default 50). Operators with very large
  taxonomies SHOULD opt in.

A Strict build additionally emits an NDJSON index at
`{index_ndjson_url}` (one node-ref per line, gzip-friendly), useful
for streaming consumers.

## Per-node emission

Per-node JSONs are written under `<outputDir>/act/nodes/<id>.json`
(default `outputDir = "public"`). The adapter MAY pretty-print for
readability; ETag derivation operates on canonical JCS-encoded bytes
per `wire-format/etag.md`. A Go JCS library
(`github.com/cyberphone/json-canonicalization`) is the typical choice.

Atomic writes: tmp-then-rename — write to `*.tmp.<pid>.<nanos>` then
`os.Rename`. POSIX `rename(2)` is atomic within a filesystem; on
Windows `os.Rename` maps to `MoveFileEx` with
`MOVEFILE_REPLACE_EXISTING`. A signal handler MUST clean up lingering
`.tmp.*` files on `SIGINT` / `SIGTERM`.

## i18n

Hugo's `languages` table maps to ACT locales:

- Default: **Pattern 2** (per-locale manifests). Each locale gets its
  own manifest at `/{locale}/.well-known/act.json` and its own
  index/node tree under `/{locale}/act/`.
- Opt-in: **Pattern 1** (locale-prefixed IDs like `en/intro`,
  `es/intro`) via `[params.act].i18n.pattern = "1"`; stamps
  `metadata.locale` on every node.
- The adapter MUST NOT mix patterns within a single build.

Hugo's translation linking (front-matter `translationKey:` or
filename-suffix conventions) maps to `metadata.translations` — an
array of `{ locale, id }` cross-references.

## Conformance target

A faithful Hugo adapter can hit:

- **Core:** single-locale site, manifest + index + nodes, ETag, atomic
  writes, capability flags computed from observed emissions. Achievable
  by the smallest reasonable implementation.
- **Standard:** + subtree files for large sections, + i18n Pattern 2,
  + build-report sidecar.
- **Strict:** + NDJSON index, + i18n Pattern 1 (when chosen), +
  search-fulfillment artifact (when `search_url_template` declared).
- **Strict:** not reachable from Hugo alone. Strict requires a runtime
  adapter that signs and serves on demand; Hugo is build-time only. An
  operator who needs Strict pairs the static output with a runtime
  layer (e.g., via the FastAPI or Rails spec-only mappings).

## Recommended impl shape

The natural integration is a **Go module** at a stable path (e.g.,
`github.com/{org}/act-hugo`) consumed via `hugo.toml`'s `[module]`
block, plus a binary entry point named `act-hugo` invoked **after**
`hugo` runs. Hugo does not expose a post-build hook; the wrapper-script
pattern `hugo && act-hugo emit` is the recommended integration.
Operators MAY wrap it in a Makefile target, npm script, or CI step.

The adapter SHOULD detect stale state at the start of `act-hugo emit`:
when a previous build report exists, compare its `completedAt` against
the most recent mtime under `public/`; if `public/` is older, surface a
warning. When `public/` does not exist at all, fail non-zero. A future
Hugo upstream change introducing a real post-build hook would unblock
a single-command path.

## Examples

A `content/` tree:

```
content/
  _index.md            # site root
  posts/
    _index.md          # section
    2026/
      _index.md        # nested section
      intro.md         # leaf
  about.md             # leaf
```

emits a manifest at `/.well-known/act.json` advertising
`indexes[0].url = "/act/index.json"`, an index with five node-refs
(`index`, `posts`, `posts/2026`, `posts/2026/intro`, `about`), and five
node JSONs at `/act/nodes/<id>.json`. The `posts/2026/intro` node
carries `parent: "posts/2026"`, the section nodes carry their
`children` arrays, and every node carries an ETag derived per
`wire-format/etag.md`.

## Open questions / extension points

- **Hugo shortcodes.** Closest analogue to a component-contract seam,
  but their lifecycle differs from React/Vue components. v0.2 does not
  constrain shortcode handling; an adapter MAY render shortcodes
  during the content-walk and emit the result as prose, or MAY emit
  them as opaque `markdown` blocks. A future spec amendment may add a
  shortcode-as-component-contract seam.
- **Hugo Output Formats.** An adapter MAY use Output Formats to emit
  ACT files alongside HTML in a single `hugo` invocation, removing
  the wrapper-script step at the cost of complexity. Not prescribed.
- **Custom front matter.** Operators with non-standard keys
  (`cascade` inheritance, custom taxonomies) MAY extend under
  `metadata.*`; conformance fixtures are the test.

## Sources

- `spec/v0.2/adapters/hugo.md` (this file; spec-only Hugo module contract).

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec mapping authored by BDFL |

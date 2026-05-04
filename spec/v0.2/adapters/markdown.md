---
title: Markdown / MDX adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Markdown / MDX adapter

> The Markdown adapter is the canonical reference adapter and the
> simplest ACT producer: it walks a directory tree of `.md` / `.mdx`
> files with frontmatter and emits a conformant manifest, index, and
> per-node JSON. Most other adapters compose Markdown semantics for
> their prose payload, so this document also pins the body-to-block
> mapping shared across adapters.

> **Live examples.** Most deployed examples exercise this adapter:
> [astro-docs](/examples/astro-docs/),
> [eleventy-blog](/examples/eleventy-blog/),
> [starlight-docs](/examples/starlight-docs/),
> [vitepress-docs](/examples/vitepress-docs/), and
> [docusaurus-docs](/examples/docusaurus-docs/) all source their content
> from `.md` files via this adapter. Pick any of them in the
> [site browser](/browser/) to see the emitted ACT tree.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-markdown`. Its default export satisfies the adapter
contract documented under `../wire-format/` and is the pattern every
other adapter follows. The mapping in this document is normative.

## Source content model

A Markdown corpus is rooted at a configured `sourceDir`. The adapter
walks a glob set (default `["**/*.md", "**/*.mdx"]`) honoring an
ignore set (default `node_modules`, `.git`, `.act`). Each file has:

- An OPTIONAL frontmatter block at the very start of the file:
  - YAML 1.2 frontmatter delimited by `---` lines.
  - TOML 1.0 frontmatter delimited by `+++` lines.
- A markdown body (CommonMark 0.31 + GFM extensions: tables, alerts,
  task lists; MDX 3.x grammar in `.mdx`).

The adapter does NOT introspect React, Vue, or Angular component
trees. MDX components are surfaced as opaque placeholders with
`metadata.extracted_via: "component-contract"` so a downstream
component-contract layer can supply real extracted blocks via the
multi-source merge step.

## Mapping to ACT nodes

| Source | ACT node type | Required ACT fields | Notes |
|---|---|---|---|
| `.md` file | leaf | `id`, `type`, `locale`, `title`, `content`, `parents` | front-matter `type` overrides default `"article"`; default ID derived from path |
| `.mdx` file | leaf | as above | each component embed becomes a `marketing:placeholder` block; MUST run against a Standard-or-higher target |
| `index.md` inside a section | branch | `id`, `type` (`"section"`), `children`, `title` | the surrounding directory becomes a section node; `index.md` collapses to the directory's ID |
| `_drafts/` (or other config-excluded path) | EXCLUDED | — | drafts skipped unless explicitly included via the `include` glob |

**Recognized frontmatter keys** (all OPTIONAL; defaults applied per
the rules in the next section):

| Key | Type | ACT mapping | Default if absent |
|---|---|---|---|
| `id` | string | explicit ID override | derived from path |
| `title` | string | node `title` | first H1, else file stem |
| `summary` | string | node `summary`, `summary_source: "author"` | extracted first paragraph |
| `summary_source` | string | open enum (`"author"` / `"extracted"` / etc.) | stamped per derivation |
| `type` | string | node `type` | `"article"` (or `"section"` for an `index.md`) |
| `tags` | array of strings | node `tags` | absent |
| `parent` | string (ID) | node `parent` | absent |
| `related` | array of `{ id, relation }` or plain ID strings | `related[]` | absent; plain strings upgraded to `{ id, relation: "see-also" }` |
| `metadata` | object | merged into node `metadata` | absent |

Reserved metadata keys (`metadata.source`, `metadata.locale`,
`metadata.translations`, `metadata.translation_status`,
`metadata.fallback_from`, `metadata.extraction_status`,
`metadata.extracted_via`) MUST NOT be settable from frontmatter.
Attempted assignment to a reserved key is unrecoverable: the build
fails non-zero with an error citing the offending file and key.

**ID derivation** (when no frontmatter `id:` is present):

1. Drop the file extension.
2. Replace path separators with `/`.
3. Collapse `index` (the file stem) to its parent directory — so
   `docs/intro/index.md` yields `docs/intro`, not `docs/intro/index`.
4. Lowercase ASCII; non-grammar characters (anything outside
   `[a-z0-9./-]`) are replaced with `-`; runs of `-` collapse to one.
5. The result MUST satisfy the node-ID grammar pinned in
   `../wire-format/node.md`.

Precedence: explicit frontmatter `id:` wins over a config rule
(`idStrategy.stripPrefix`, glob-keyed overrides), which wins over
the default derivation.

## Body-to-block mapping

The adapter operates in one of two modes:

- **Coarse mode (Core, default).** The full markdown body becomes a
  single `markdown` block. Round-trip fidelity is highest; consumers
  must re-parse to extract structure.
- **Fine mode (Standard, opt-in via `mode: "fine"`).** The body is
  split into typed blocks following the content-block taxonomy:
  - Prose paragraphs / headings / lists / blockquotes → `prose`
    blocks with `format: "markdown"`.
  - Fenced code blocks → `code` blocks with `lang` set from the fence
    info string.
  - Data fences (`json data`, `yaml data`, `toml data`) → `data`
    blocks with `format` derived from the fence info string.
  - Admonition (`:::note`) and GFM-alert (`> [!NOTE]`) syntax →
    `callout` blocks with `level` from the recognized triggers
    (`note` / `info` / `tip` / `warning` / `danger` / `important`).
  - MDX components → `marketing:placeholder` with
    `metadata.component` (the component tag) and `metadata.props`
    (a JSON-serializable snapshot of the props), plus
    `metadata.extracted_via: "component-contract"`.

Block ordering in `content[]` matches source order.

## Summary derivation

1. If frontmatter `summary` is present, use it verbatim and stamp
   `summary_source: "author"`.
2. Otherwise, walk the body:
   - Skip the frontmatter block.
   - Skip HTML comments (`<!-- ... -->`).
   - Skip headings.
   - Take the first contiguous paragraph; trim leading and trailing
     whitespace.
   - Stamp `summary_source: "extracted"`.
3. The extracted summary is capped at the validator's summary-token
   warning threshold; an over-cap summary surfaces a build warning,
   not an error.

## Manifest emission

The adapter contributes the following to the build's manifest
(`../wire-format/manifest.md`):

- `site.canonical_url` ← from generator config.
- `locales` ← single locale derived from frontmatter or generator
  config; multi-locale Markdown corpora compose with the i18n adapter.
- `capabilities` ← computed from observed emissions, never inflated.
  Coarse-mode runs advertise `{ etag: true }`; fine-mode runs add
  `{ subtree: true }` once subtree files exist.
- `delivery: "static"` (the Markdown adapter is build-time only).

## Index emission

The adapter contributes one node-ref per emitted node to the build's
index document (`../wire-format/index.md`). Section nodes
(synthesized from directories) carry their `children` array in
filesystem-walk order; explicit ordering MAY be supplied via a
sibling `_order.json` file when deterministic ordering matters.

## i18n

A single Markdown adapter instance emits one locale per file. Mixed
per-file locales MAY be supported by configuring per-glob locale
assignment, but the canonical pattern is:

- **Pattern 2** (per-locale subtree, default): one Markdown adapter
  instance per locale, each rooted at `<sourceDir>/<locale>/`.
- **Pattern 1** (locale-prefixed IDs, opt-in): a single instance
  walks `<sourceDir>` and reads a `lang:` frontmatter key, with the
  locale prefixed into the ID.

Cross-locale `metadata.translations` arrays are populated by the i18n
adapter (`./i18n.md`) via the multi-source merge step; the Markdown
adapter does not emit them on its own.

## Failure surface

- **Recoverable** (build warning, exit 0):
  - Missing optional frontmatter key: silent default applied.
  - Body extraction fails for one block (e.g., a data fence has
    invalid JSON): emit the rest of the node with
    `metadata.extraction_status: "partial"` and
    `metadata.extraction_error` describing the cause.
- **Unrecoverable** (build fails non-zero):
  - Malformed frontmatter (YAML/TOML parse error, or delimiter
    mismatch when `frontmatter.format` is explicit).
  - Reserved-metadata-key assignment from frontmatter.
  - ID-grammar violation that survives normalization.
  - Within-adapter ID collision (two files emit the same ID before
    the multi-source merge step runs).

## Conformance target

- **Core:** coarse mode, frontmatter-or-derived summary, single
  locale, manifest + index + nodes, ETag, atomic writes.
- **Standard:** + fine-grained body-to-block splitting, + `delta(since)`
  via mtime for incremental rebuilds, + subtree files where eligible,
  + Pattern 2 i18n composition.
- **Strict:** reachable when composed with the i18n adapter
  (Pattern 1 with `metadata.translations`) and a component-contract
  layer that resolves MDX placeholders.

## Examples

A `docs/` tree:

```
docs/
  index.md                 # site root → id: "index"
  getting-started/
    index.md               # → id: "getting-started"
    install.md             # → id: "getting-started/install"
  api/
    overview.md            # → id: "api/overview"
```

emits a manifest at `/.well-known/act.json`, an index with five
node-refs (`index`, `getting-started`, `getting-started/install`,
`api`, `api/overview`), and five node JSONs at
`/act/nodes/<id>.json`. The `getting-started` node carries
`children: ["getting-started/install"]` and the
`getting-started/install` node carries `parent: "getting-started"`.

## Open questions / extension points

- **JSON frontmatter.** Some Hugo / Eleventy corpora use `{ ... }`
  JSON blocks at file head. Not supported in v0.2; an additive ASP
  could enable it.
- **Per-key translation tracking** for MDX components that wrap
  message-catalog calls. Tracked alongside the component-contract
  layer; the markdown adapter only emits the placeholder seam.
- **Custom fence handlers** (e.g., `mermaid`, `vega-lite`) MAY be
  registered to emit `data` blocks with adapter-defined `format`
  values; conformance fixtures are the test.

## Sources

- `./hugo.md`, `./mkdocs.md`, `./jekyll.md` for cross-generator
  conventions.
- `../wire-format/node.md` for the node envelope grammar.
- `../wire-format/etag.md` for ETag derivation.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

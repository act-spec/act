---
title: Eleventy generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Eleventy generator

> The Eleventy generator is an Eleventy 2.0+ plugin that emits ACT
> during `eleventy --build`. It composes with the source markdown
> corpus (NOT Eleventy's rendered output), honors Eleventy's permalink
> exclusions, and threads Eleventy's collection definitions into the
> [Markdown adapter](../adapters/markdown.md). This document defines
> the plugin shape, the `eleventy.after` lifecycle integration, the
> permalink-aware filtering, and the build-output contract.

> **Live example.** A built copy of the
> [`eleventy-blog`](https://github.com/act-spec/act/tree/main/examples/eleventy-blog)
> example is deployed at [`/examples/eleventy-blog/`](/examples/eleventy-blog/).
> Open it in the
> [site browser](/browser/?site=%2Fexamples%2Feleventy-blog%2F.well-known%2Fact.json)
> to walk its tree and compare ACT vs HTML payload sizes across 33 posts.

## Overview

`@act-spec/plugin-eleventy` is a standard Eleventy plugin. Operators
register it once in their Eleventy config:

```js
// .eleventy.js (or eleventy.config.mjs / eleventy.config.cjs)
const actPlugin = require("@act-spec/plugin-eleventy");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(actPlugin, { target: "core" });
};
```

Internally the plugin constructs a generator-plugin object (per
`@act-spec/generator-core`) and runs the canonical pipeline at
Eleventy's `eleventy.after` event, after Eleventy's build is complete
and every output file is written. The plugin composes with three
upstream pieces of Eleventy:

- **Eleventy's input directory and `.eleventyignore`** — auto-wired
  to the [Markdown adapter](../adapters/markdown.md). The adapter's
  `sourceDir` defaults to `eleventyConfig.dir.input` (default `.`);
  the glob defaults to `**/*.md{,x}` per the markdown adapter; ignored
  paths from `.eleventyignore` are threaded into the adapter's
  options. Template files (`.njk`, `.liquid`, `.hbs`, `.ejs`,
  `.webc`, `.11ty.js`) are NOT walked — template-engine output is
  post-build, not source.
- **Permalink resolution** — the `eleventy.after` callback receives
  a `results` array (Eleventy 2.0+'s documented signature). The
  plugin cross-references each markdown source the adapter
  enumerated against the `results` array. Sources NOT present in
  `results` are excluded from Eleventy's public output (typically
  `permalink: false`, `eleventyExcludeFromCollections: true`, or a
  data-cascade exclusion); these MUST be filtered from ACT emission
  BEFORE the merge stage runs.
- **Eleventy collections (optional)** — when the host has defined
  collections via `eleventyConfig.addCollection(name, fn)`, the
  plugin MAY thread those collections into the markdown adapter's
  `collectionHints` field. Each hint MAY drive `parent` / `children`
  derivation: a node belonging to the collection `"posts"` may have
  its `parent` set to a synthetic posts-index node when the host opts
  in via `act.collections.synthesizeIndices: true`. This feature is
  OPTIONAL; default behavior is to ignore Eleventy's collections.

Eleventy is template-driven (Nunjucks / Liquid / Handlebars / EJS /
WebC / 11ty.js — multiple template engines per file), not
component-driven. The plugin therefore has **no binding surface**:
the plugin's options MUST NOT accept a `bindings` array. Authors who
need component-driven extraction must adopt a component-driven
framework — see the [Astro](./astro.md), [Next.js](./nextjs.md), or
[Nuxt](./nuxt.md) generators.

The plugin's peer-dependency floor is Eleventy 2.0+. Eleventy 1.x is
out of scope (the `eleventy.after` hook surface stabilized in 2.x);
Eleventy 3.0+ versions that retain the `eleventy.after` surface are
permitted.

## Configuration

The plugin options shape is a strict subset of
`@act-spec/generator-core`'s `GeneratorConfig`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. |
| `urlTemplates` | object | see Astro generator | Override the default URL templates. |
| `adapters` | array | auto-detected (Markdown) | Override the auto-wired adapter list. |
| `collections` | `{ synthesizeIndices?: boolean }` | `{}` | When `synthesizeIndices: true`, Eleventy collections produce synthetic parent nodes. |
| `emit` | object | `{ llmsTxt: true, llmsFullTxt: true }` | Auto-emit toggles for `/llms.txt` and `/llms-full.txt`. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block (rare for Eleventy) fails the build. |
| `outputDir` | string | `eleventyConfig.dir.output` | Resolved from Eleventy's internal config; operators MAY override but the path MUST resolve inside the project root. |
| `hooks` | object | `{}` | `{ preBuild?, postBuild?, onError? }` host-level hooks. |

The plugin MUST validate its options before the build hook fires;
when an invalid `bindings` field is supplied, the plugin surfaces a
configuration error pointing to the component-driven generators.

The default `outputDir` is the host's resolved Eleventy output
directory (`eleventyConfig.dir.output`, default `_site/`). The plugin
resolves this from Eleventy's internal config so non-default
configurations work correctly.

## Build hooks

The plugin uses exactly one Eleventy event:

| Event | Purpose |
|---|---|
| `eleventy.after` | Invoke the canonical pipeline against `eleventyConfig.dir.output`. The callback receives the `results` array used for permalink-aware filtering. |

The plugin MUST NOT run the pipeline at `eleventy.before` (build
hasn't happened), at `eleventy.beforeWatch` (watch-mode signal only),
or at any per-template hook.

Watch-mode (`eleventy --watch`) is supported: the pipeline re-runs at
each `eleventy.after` invocation. To prevent overlapping runs when
`after` fires concurrently with an in-flight build, the plugin
installs a build-scoped re-entry guard (an in-flight
`Promise<BuildReport>`); subsequent `after` invocations await the
in-flight build before starting a new one.

## Source-of-truth contract

The plugin treats the **source markdown corpus** (the `.md` / `.mdx`
files in Eleventy's input directory) as the canonical input for ACT,
not Eleventy's rendered output. Frontmatter parsing, body-to-block
mapping, summary derivation, and ID assignment — all owned by the
markdown adapter — operate on the source files directly. Eleventy's
frontmatter cascade (data inherited from `*.json` data files,
`_data/`, layout chains) is NOT part of the source the adapter sees;
if the host wants cascaded frontmatter present in ACT emission, they
MUST set those keys explicitly in the source `.md` frontmatter.

The plugin MUST NOT introspect template-engine ASTs. Template content
beyond the markdown body is opaque to ACT under this generator. A
markdown file with embedded `{% include "header.njk" %}` shortcodes
is treated as plain markdown by the adapter; the shortcode text
appears in the markdown source as-is.

## URL space independence

The ACT manifest's URL space (the templates declared in `urlTemplates`)
is INDEPENDENT of Eleventy's site URL space (`permalink` and `url`).
The plugin emits ACT files at paths derived from `urlTemplates` per
[`wire-format/manifest.md`](../wire-format/manifest.md). A markdown
source at `posts/2026-05-01-hello.md` whose Eleventy-rendered URL is
`/posts/hello/` emits an ACT node at the path produced by substituting
the source-derived ID (e.g., `posts/2026-05-01-hello`) into
`node_url_template`. The plugin MUST NOT attempt to mirror Eleventy's
URL space; the ACT URLs live at `/act/...`.

## Output contract

After `eleventy --build`, the resolved `outputDir` (default `_site/`)
contains:

```
_site/
  .well-known/act.json
  act/
    index.json
    n/<id>.json                         # one per markdown source not filtered by permalinks
    sub/<id>.json                       # Standard+ only
    index.ndjson                        # Strict only
  llms.txt                              # auto-emitted by generator-core
  llms-full.txt                         # auto-emitted by generator-core
  .act-build-report.json                # local sidecar
```

The plugin delegates file emission to `@act-spec/generator-core` so
atomic writes (tmp-then-rename) per
[`wire-format/etag.md`](../wire-format/etag.md) are inherited
unchanged. The plugin MUST NOT modify Eleventy-owned paths (rendered
HTML, copied passthrough assets).

The build report enumerates emitted ACT files, `excluded_by_permalink`
warnings (filtered sources), and the achieved conformance level.

## Examples

### Minimum Core blog

```js
// .eleventy.js
const actPlugin = require("@act-spec/plugin-eleventy");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(actPlugin);
  return { dir: { input: "src", output: "_site" } };
};
```

```bash
$ npx @11ty/eleventy
```

Builds to a Core-conformant tree under `_site/`: manifest, index, one
node per published markdown post, ETag, atomic writes, `/llms.txt`,
`/llms-full.txt`. Drafts (`permalink: false`) are excluded.

### Standard with synthesized collection indices

```js
const actPlugin = require("@act-spec/plugin-eleventy");

module.exports = function (eleventyConfig) {
  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/posts/*.md")
  );
  eleventyConfig.addPlugin(actPlugin, {
    target: "standard",
    urlTemplates: { subtree_url_template: "/act/sub/{id}.json" },
    collections: { synthesizeIndices: true },
  });
};
```

The plugin synthesizes a `posts` parent node and emits a subtree file
listing the post nodes.

## Conformance

| Level | Reachable when |
|---|---|
| **Core** | Any successful `eleventy --build`. Manifest, index, node files, ETag, atomic writes. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted (typically via `collections.synthesizeIndices: true`). |
| **Strict** | Standard + NDJSON index emitted. |

A target that exceeds the achieved level emits a build warning; the
manifest's `conformance.level` reflects the achieved (not configured)
level. Eleventy is template-driven, so component-extraction-related
parts of Standard / Strict are not reachable from this generator;
operators who need component extraction must adopt a component-driven
framework.

## Sources

- `prd/408-eleventy-plugin.md` — Eleventy plugin contract.
- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---
title: Docusaurus generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Docusaurus generator

> The Docusaurus generator is a Docusaurus plugin that emits ACT during
> `docusaurus build`. It maps Docusaurus's docs / blog / pages plugins
> to ACT branches and leaves, derives `parent` / `children` from
> `sidebars.js`, mounts versioned-docs sets via the manifest's `mounts`
> array, and integrates with Docusaurus's `i18n` system. This document
> defines the plugin shape, the lifecycle hook placement, the
> sidebar-driven hierarchy, and the build-output contract.

> **Reference example.** The
> [`docusaurus-docs`](https://github.com/act-spec/act/tree/main/examples/docusaurus-docs)
> example exercises this generator end-to-end in CI. The companion
> `docusaurus build` step is currently blocked on an upstream
> `require.resolveWeak` / aliased-import issue when Docusaurus's SSG
> evaluator runs against Node 22, so the example is not deployed yet;
> clone the repo and run `pnpm -F @act-spec/example-docusaurus-docs build`
> to walk the emitted tree and inspect the sidebar-derived hierarchy
> locally.

## Overview

`@act-spec/plugin-docusaurus` is a standard Docusaurus plugin (the
default-export shape Docusaurus's plugin API expects). Operators
register it once in `docusaurus.config.js`:

```js
module.exports = {
  // ...
  plugins: ["@act-spec/plugin-docusaurus"],
};
```

For options:

```js
plugins: [
  ["@act-spec/plugin-docusaurus", { target: "standard" }],
],
```

Internally the plugin constructs a generator-plugin object (per
`@act-spec/generator-core`) and runs the canonical pipeline at
Docusaurus's `postBuild` hook. The plugin composes with three
upstream pieces of the Docusaurus ecosystem:

- **`@docusaurus/plugin-content-docs`** — auto-wired to the
  [Markdown adapter](../adapters/markdown.md). The plugin reads the
  resolved docs corpus (including front-matter, `_category_.json`
  files, and the resolved sidebar items) and supplies it as adapter
  input. Versioned docs (a `versions.json` plus
  `versioned_docs/<v>/`) are emitted as `mounts` per
  [`wire-format/manifest.md`](../wire-format/manifest.md).
- **`@docusaurus/plugin-content-blog`** — auto-wired as a separate
  Markdown-adapter instance with `type: "post"` defaulting per node.
- **MDX components** — when MDX docs embed React components
  (`<Tabs>`, `<TabItem>`, `<Hero>`), the plugin loads
  `@act-spec/binding-react` and dispatches component extraction.

The plugin supports multiple instances per Docusaurus site (Docusaurus
multi-docs). When two or more instances are configured, each one MUST
declare distinct `urlTemplates` paths to avoid collision.

The plugin's peer-dependency floor is `@docusaurus/core ^3.0.0`.
Docusaurus 2.x and earlier are out of scope; the plugin emits a
configuration error when instantiated against an older version.

## Configuration

The options object is a strict subset of `@act-spec/generator-core`'s
`GeneratorConfig`, with Docusaurus-specific defaults:

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. The achieved level is computed from observed emissions. |
| `extractMode` | `"static-ast" \| "ssr-walk"` | `"static-ast"` | MDX-component extraction mode. Static-AST is the Docusaurus default because it is faster against compiled MDX output. |
| `i18n` | `boolean` | auto | When Docusaurus's `i18n.locales` length > 1, the plugin auto-wires the i18n adapter. Operators can force-disable via `i18n: false`. |
| `urlTemplates` | object | see below | Override default URL templates. |
| `adapters` | array | auto-detected | Override the auto-wired docs/blog/pages list. |
| `emit` | object | `{ llmsTxt: true, llmsFullTxt: true }` | Auto-emit toggles for `/llms.txt` and `/llms-full.txt`. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block causes `docusaurus build` to exit non-zero. |
| `versions` | object | auto | Versioned-docs handling: `mountPrefix: "/v{version}"` (default) and `includeUnreleased: false`. |

Default URL templates:

```ts
{
  index_url: "/act/index.json",
  node_url_template: "/act/n/{id}.json",
  // Standard target adds:
  subtree_url_template: "/act/sub/{id}.json",
  // Strict target adds:
  index_ndjson_url: "/act/index.ndjson",
}
```

The `outputDir` MUST equal Docusaurus's resolved `outDir` (typically
`build/`); operators MUST NOT override it. The plugin writes only to
ACT-owned subpaths under `outDir`.

## Build hooks

The plugin implements three of Docusaurus's lifecycle methods:

| Hook | Purpose |
|---|---|
| `loadContent` | Inspect installed Docusaurus plugins, discover docs/blog/pages instances and their resolved corpora, capture sidebar definitions and `i18n` config. |
| `contentLoaded` | Build the adapter input (one entry per source file, with frontmatter, body, sidebar position, and version). Register the React binding when MDX components are detected. |
| `postBuild` | Invoke the canonical pipeline against Docusaurus's resolved `outDir` (default `build/`). Atomic writes, ETag derivation, capability computation. |

The plugin MUST NOT register hooks Docusaurus does not document;
experimental hooks are out of scope. The pipeline runs **exclusively**
at `postBuild`, after Docusaurus's static output is finalized.

The plugin MUST NOT run during `docusaurus start` (dev mode); ACT
artifacts are produced only by `docusaurus build`. The plugin MAY
surface a one-time logger message under `docusaurus start` indicating
that ACT artifacts are not generated.

## Sidebar-to-parent/children mapping

Docusaurus's `sidebars.js` is the canonical source of doc hierarchy.
The plugin reads each declared sidebar and derives ACT relations:

- A sidebar `category` becomes a synthetic branch node with
  `type: "section"`, `id` derived from the category label (slugified,
  lowercase ASCII), and `children` listing the docs and nested
  categories beneath it.
- A sidebar `doc` reference attaches `parent` to the containing
  category's synthetic ID; the doc's own `id` is its source-file ID.
- A doc that appears in NO sidebar is reported as a `sidebar_orphan`
  warning in the build report and emits a node with no `parent` (it
  hangs off the synthetic root).
- An autogenerated category (Docusaurus's `type: "autogenerated"`)
  resolves to its directory's `_category_.json` label or the directory
  name; the plugin walks the directory the same way Docusaurus does.

When more than one sidebar references the same doc (multi-sidebar
configurations), the doc's primary `parent` MUST be the first
encountered category; additional references appear in
`metadata.also_under` (an array of `{sidebar, parent}` references).

## Versioned docs

Docusaurus's versioned-docs feature (a `versions.json` file and
`versioned_docs/<version>/` plus `versioned_sidebars/<version>.json`)
maps to the manifest's `mounts` array per
[`wire-format/manifest.md`](../wire-format/manifest.md). Each version
appears as a separate ACT manifest under a configurable prefix
(default `/v{version}/`):

- `/v1.0/.well-known/act.json` — the v1.0 manifest.
- `/v1.1/.well-known/act.json` — the v1.1 manifest.
- `/.well-known/act.json` — the "current" (next/dev) manifest, with a
  `mounts` array referencing each version's manifest URL.

Mounts MUST NOT recurse — a versioned mount's manifest MUST NOT itself
declare a `mounts` array. Each version's `conformance.level` is
computed independently per its observed emissions.

Operators MAY exclude unreleased versions (`includeUnreleased: false`,
default) or include them (`true`) for staging deployments.

## i18n

When Docusaurus's `i18n.locales` array length > 1, the plugin
auto-wires the [i18n adapter](../adapters/i18n.md) and emits per-locale
manifests at `/{locale}/.well-known/act.json` (Pattern 2). Each
per-locale manifest declares its own index, node tree, and (when
versioned) `mounts` array. Pattern 1 (locale-prefixed IDs in a single
tree) is opt-in via `act({ i18n: { pattern: "1" } })`.

The plugin MUST NOT mix patterns within a single build. When
`i18n: false` is explicit but Docusaurus declares > 1 locale, the
plugin emits a build warning and proceeds with single-locale
emission.

## Output contract

After `docusaurus build`, the resolved `outDir` (default `build/`)
contains the following ACT-owned paths in addition to Docusaurus's
HTML:

```
build/
  .well-known/act.json                  # current/dev manifest, with mounts
  act/
    index.json
    n/<id>.json                         # docs + blog posts + pages
    sub/<id>.json                       # Standard+ only
    index.ndjson                        # Strict only
  v1.0/                                 # one subtree per version
    .well-known/act.json
    act/index.json
    act/n/<id>.json
  en/                                   # one subtree per non-default locale
    .well-known/act.json
    act/index.json
    act/n/<id>.json
  llms.txt                              # auto-emitted by generator-core
  llms-full.txt                         # auto-emitted by generator-core
  .act-build-report.json                # local sidecar
```

The plugin MUST NOT modify Docusaurus's own emitted files. Atomic
writes (tmp-then-rename) per [`wire-format/etag.md`](../wire-format/etag.md)
are honored. The build report enumerates emitted ACT files,
sidebar-orphan warnings, MDX-extraction placeholders, and the
achieved conformance level.

The `/llms.txt` / `/llms-full.txt` files are auto-emitted by
`@act-spec/generator-core` by default; opt out via
`act({ emit: { llmsTxt: false, llmsFullTxt: false } })`.

## Examples

### Minimum Core docs site

```js
// docusaurus.config.js
module.exports = {
  title: "My Docs",
  url: "https://docs.example.com",
  plugins: ["@act-spec/plugin-docusaurus"],
  presets: [["classic", { docs: { sidebarPath: "./sidebars.js" } }]],
};
```

Builds to a Core-conformant tree: manifest, index, one node per doc,
ETag, atomic writes, `/llms.txt`, `/llms-full.txt`.

### Standard with sidebar-derived hierarchy

```js
plugins: [
  ["@act-spec/plugin-docusaurus", {
    target: "standard",
    urlTemplates: { subtree_url_template: "/act/sub/{id}.json" },
  }],
],
```

Sidebar categories become synthetic branch nodes; the plugin emits
one subtree file per top-level category.

### Versioned + multi-locale

```js
module.exports = {
  i18n: { defaultLocale: "en", locales: ["en", "es"] },
  presets: [["classic", {
    docs: {
      sidebarPath: "./sidebars.js",
      versions: { current: { label: "Next" } },
    },
  }]],
  plugins: [
    ["@act-spec/plugin-docusaurus", {
      target: "strict",
      urlTemplates: { index_ndjson_url: "/act/index.ndjson" },
    }],
  ],
};
```

Emits per-version mounts under `/v<version>/` and per-locale manifests
under `/<locale>/`. The current/dev manifest's `mounts` array
references each version.

## Conformance

The plugin auto-detects the achieved conformance level from observed
emissions per [`wire-format/conformance.md`](../wire-format/conformance.md).

| Level | Reachable when |
|---|---|
| **Core** | Always achieved on any successful build. Manifest, index, node files, ETag, atomic writes. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted (sidebar-derived). Adds MDX-component extraction wiring and `mounts` for versioned docs. |
| **Strict** | Standard + NDJSON index emitted + (when multi-locale) per-locale manifests emitted. |

A target that exceeds the achieved level emits a build warning; the
manifest's `conformance.level` reflects the achieved (not configured)
level.

## Sources

- `prd/404-docusaurus-plugin.md` — Docusaurus plugin contract.
- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

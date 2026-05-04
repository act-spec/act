---
title: VitePress generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# VitePress generator

> The VitePress generator is a VitePress plugin that emits ACT during
> `vitepress build`. It composes with VitePress's markdown content
> pipeline, its sidebar / nav config, and its `locales` table to
> produce a multi-locale ACT tree alongside VitePress's own static
> output. This document defines the plugin shape, the build hooks
> consumed (`transformPageData` and `buildEnd`), the VitePress-specific
> sidebar-derived hierarchy, and the build-output contract.

## Overview

VitePress is the Vue ecosystem's de facto static documentation
generator. `@act-spec/plugin-vitepress` is a standard VitePress
config entry that mounts the ACT generator pipeline at the end of a
`vitepress build`. Operators register it once in
`.vitepress/config.ts`:

```ts
import { defineConfig } from "vitepress";
import { actVitePress } from "@act-spec/plugin-vitepress";

export default defineConfig({
  title: "My Docs",
  themeConfig: { sidebar: { /* ... */ } },
  ...actVitePress({ target: "standard" }),
});
```

Internally `actVitePress(options)` returns a partial VitePress
config: a `transformPageData` hook (per-page metadata capture) and a
`buildEnd` hook (canonical pipeline invocation). Both hooks are
documented VitePress extension points; the plugin uses no
VitePress-internal APIs.

The plugin composes with three upstream pieces:

- **`@act-spec/adapter-markdown`** — auto-wired against VitePress's
  resolved `srcDir` (default the docs root). VitePress's markdown
  pipeline already parses frontmatter, derives titles, and resolves
  relative links; the plugin reads the resolved page data via
  `transformPageData` rather than re-parsing source files. The
  markdown body and frontmatter as VitePress sees them are the
  canonical adapter input.
- **`@act-spec/generator-core`** — the canonical pipeline. The
  plugin delegates manifest construction, index emission, per-node
  emission, ETag derivation, and atomic writes to generator-core; it
  contributes only the VitePress-specific input shape.
- **VitePress `locales` config** — when the host declares more than
  one locale in `themeConfig.locales` (or the top-level `locales`
  table), the plugin auto-detects them, threads them into the
  generator config, and emits per-locale manifests at
  `/<locale>/.well-known/act.json` (Pattern 2). The default locale
  is determined by VitePress's own `locales.root` entry.

The plugin is **net-new in ACT v0.2** (there is no predecessor PRD).
Its design intentionally mirrors the [Astro](./astro.md),
[Docusaurus](./docusaurus.md), and [Nuxt](./nuxt.md) generators so
operators familiar with those patterns find no surprises.

The plugin's peer-dependency floor is `vitepress ^1.0.0`. VitePress
0.x is out of scope.

This generator covers static export only. Runtime ACT under VitePress
is not a meaningful shape — VitePress is build-time-only by
construction; any runtime layer would sit in front of VitePress's
output and is reachable via the [Runtime SDK](../runtime.md).

## Configuration

The `actVitePress` factory accepts an options object whose shape is
a strict subset of `@act-spec/generator-core`'s `GeneratorConfig`,
with VitePress-specific defaults:

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. |
| `urlTemplates` | object | see Astro generator | Override the default URL templates. |
| `adapters` | array | auto-detected (Markdown) | Override the auto-wired adapter list. |
| `i18n` | `boolean` | auto | When VitePress declares > 1 locale, the [i18n adapter](../adapters/i18n.md) is auto-wired. Force-disable via `i18n: false`. |
| `sidebar` | `{ derive: boolean }` | `{ derive: true }` | When `derive: true`, the plugin walks `themeConfig.sidebar` and synthesizes branch nodes for sections. |
| `emit` | object | `{ llmsTxt: true, llmsFullTxt: true }` | Auto-emit toggles for `/llms.txt` and `/llms-full.txt`. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block (rare for VitePress — Vue components are not extracted in v0.2) fails the build. |
| `outputDir` | string | resolved from VitePress | Defaults to VitePress's resolved `outDir` (typically `.vitepress/dist`). Operators MUST NOT override. |
| `hooks` | object | `{}` | `{ preBuild?, postBuild?, onError? }` host-level hooks. |

The default URL templates match the other generators
(`/act/index.json`, `/act/n/{id}.json`, with Standard adding
`/act/sub/{id}.json` and Strict adding `/act/index.ndjson`).

## Build hooks

The plugin consumes exactly two of VitePress's documented hooks:

| Hook | Purpose |
|---|---|
| `transformPageData(pageData, ctx)` | Fired once per page during build. The plugin captures the resolved page data (frontmatter, title, headings, relative path, locale) into an in-memory build accumulator keyed on `pageData.relativePath`. The plugin MUST NOT mutate `pageData` (no side effects on VitePress's render). |
| `buildEnd(siteConfig)` | Fired after VitePress finalizes its static output in `outDir`. The plugin invokes the canonical pipeline against the in-memory accumulator, emitting the manifest, index, per-node files, and (Standard+) subtree files. |

The plugin MUST NOT register hooks VitePress does not document;
experimental hooks are out of scope. The pipeline runs **exclusively**
at `buildEnd`, after VitePress's static output is finalized.

The plugin MUST NOT run the canonical pipeline during `vitepress dev`;
ACT artifacts are produced only by `vitepress build`. The plugin MAY
surface a one-time logger message under `vitepress dev` indicating
that ACT artifacts are not generated.

## Sidebar-derived hierarchy

VitePress's `themeConfig.sidebar` is the canonical source of doc
hierarchy in the typical theme. When `sidebar.derive: true` (the
default), the plugin walks the resolved sidebar tree and synthesizes
ACT relations:

- A sidebar group with a `text` and `items` array becomes a synthetic
  branch node with `type: "section"`, `id` slugified from the group's
  text, and `children` listing the linked docs and nested groups.
- A sidebar item linking to a markdown page (`{ text, link }`)
  attaches `parent` to the containing group's synthetic ID.
- A page that appears in NO sidebar emits a node with no `parent` (it
  hangs off the synthetic root); the plugin records a `sidebar_orphan`
  warning in the build report.
- VitePress supports per-path sidebars (`sidebar: { '/guide/': […], '/api/': […] }`).
  The plugin walks each per-path sidebar independently; pages
  belonging to two per-path sidebars get a primary `parent` from the
  first encountered group and an `also_under` entry for the
  additional reference.

When `sidebar.derive: false`, the plugin falls back to the markdown
adapter's default ID-only walk; no synthetic branches are emitted.
This is appropriate for sites without a sidebar (single-page docs,
landing pages).

VitePress's `nav` config is NOT consumed for hierarchy derivation —
nav entries typically link to top-level pages whose hierarchical
position is already captured by the sidebar walk.

## i18n

When VitePress's `locales` table declares more than one entry, the
plugin auto-detects each locale's `lang`, `link` prefix, and
per-locale `themeConfig.sidebar`. The plugin emits per-locale
manifests at `/{locale}/.well-known/act.json` (Pattern 2). Each
per-locale manifest declares its own index, node tree, and
sidebar-derived branches.

The default locale (VitePress's `locales.root`) emits its manifest
at `/.well-known/act.json` without a locale prefix; non-default
locales emit at the prefix VitePress declares (e.g.,
`locales.es.link === "/es/"` produces `/es/.well-known/act.json`).

Pattern 1 (locale-prefixed IDs in a single tree) is opt-in via
`actVitePress({ i18n: { pattern: "1" } })`. The plugin MUST NOT mix
patterns within a single build.

When `i18n: false` is explicit but VitePress declares > 1 locale,
the plugin emits a build warning and proceeds with single-locale
emission against the default locale's content only.

## Output contract

After `vitepress build`, the resolved `outDir` (typically
`.vitepress/dist/`) contains:

```
.vitepress/dist/
  .well-known/act.json                  # default-locale manifest
  act/
    index.json
    n/<id>.json                         # one per markdown page
    sub/<id>.json                       # Standard+ only (sidebar-derived)
    index.ndjson                        # Strict only
  es/                                   # one subtree per non-default locale
    .well-known/act.json
    act/index.json
    act/n/<id>.json
  llms.txt                              # auto-emitted by generator-core
  llms-full.txt                         # auto-emitted by generator-core
  .act-build-report.json                # local sidecar
```

The plugin MUST NOT modify VitePress-owned paths (HTML, asset
bundles, hashed JS chunks). Atomic writes per
[`wire-format/etag.md`](../wire-format/etag.md). The build report
enumerates emitted ACT files, sidebar-orphan warnings, and the
achieved conformance level.

The `/llms.txt` / `/llms-full.txt` files are auto-emitted by
`@act-spec/generator-core` by default; opt out via
`actVitePress({ emit: { llmsTxt: false, llmsFullTxt: false } })`.

## Examples

### Minimum Core docs site

```ts
// .vitepress/config.ts
import { defineConfig } from "vitepress";
import { actVitePress } from "@act-spec/plugin-vitepress";

export default defineConfig({
  title: "My Docs",
  themeConfig: {
    sidebar: [
      { text: "Guide", items: [
        { text: "Intro", link: "/guide/intro" },
        { text: "Setup", link: "/guide/setup" },
      ]},
    ],
  },
  ...actVitePress(),
});
```

```bash
$ vitepress build
```

Builds to a Core-conformant tree under `.vitepress/dist/`: manifest,
index, one node per markdown page (with sidebar-derived parents),
ETag, atomic writes, `/llms.txt`, `/llms-full.txt`.

### Standard with subtree

```ts
export default defineConfig({
  // ... themeConfig.sidebar as above
  ...actVitePress({
    target: "standard",
    urlTemplates: { subtree_url_template: "/act/sub/{id}.json" },
  }),
});
```

The plugin emits one subtree file per top-level sidebar group.

### Strict multi-locale

```ts
export default defineConfig({
  locales: {
    root: { label: "English", lang: "en" },
    es: { label: "Español", lang: "es", link: "/es/" },
  },
  themeConfig: { sidebar: { /* ... */ } },
  ...actVitePress({
    target: "strict",
    urlTemplates: { index_ndjson_url: "/act/index.ndjson" },
  }),
});
```

Emits per-locale manifests at `/.well-known/act.json` (English) and
`/es/.well-known/act.json` (Spanish), plus an NDJSON index per
manifest.

## Conformance

The plugin auto-detects the achieved conformance level from observed
emissions per [`wire-format/conformance.md`](../wire-format/conformance.md).

| Level | Reachable when |
|---|---|
| **Core** | Any successful `vitepress build`. Manifest, index, node files, ETag, atomic writes. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted (sidebar-derived). |
| **Strict** | Standard + NDJSON index + (when multi-locale) per-locale manifests emitted. |

A target that exceeds the achieved level emits a build warning; the
manifest's `conformance.level` reflects the achieved (not configured)
level. Vue-component extraction (`<script setup>` `defineActContract`
macros) is NOT in scope for this generator in v0.2 — VitePress's
component model is intentionally narrower than Nuxt's; operators who
need Vue-component extraction should use the [Nuxt generator](./nuxt.md).

## Sources

- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.
- (No predecessor PRD — generator designed from scratch in v0.2.)

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---
title: Astro generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Astro generator

> The Astro generator is an Astro integration that emits ACT during
> `astro build`. It composes with content collections, the
> [Markdown adapter](../adapters/markdown.md), MDX, and Starlight, and
> writes the manifest, index, and node tree into the build output. This
> document defines the integration shape, the lifecycle hooks the plugin
> consumes, the configuration surface, and the build-output contract.

## Overview

Astro is the flagship first-party host integration for ACT. The
`@act-spec/plugin-astro` package exports an `act()` factory that returns
an [`AstroIntegration`](https://docs.astro.build/en/reference/integrations-reference/);
its underlying generator object satisfies the
`GeneratorPlugin` contract from `@act-spec/generator-core`. Consumers
register it once in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import act from "@act-spec/plugin-astro";

export default defineConfig({
  site: "https://docs.example.com",
  integrations: [act()],
});
```

A working Astro site needs no other ACT configuration to reach
**Core** conformance. Standard and Strict are reachable additively
(see [Conformance](#conformance) below).

> **Live example.** A built copy of the
> [`astro-docs`](https://github.com/act-spec/act/tree/main/examples/astro-docs)
> example is deployed at [`/examples/astro-docs/`](/examples/astro-docs/).
> Open it in the
> [site browser](/browser/?site=%2Fexamples%2Fastro-docs%2F.well-known%2Fact.json)
> to walk its tree and see ACT-vs-HTML payload sizes side-by-side.

The integration composes with two upstream pieces of the Astro
ecosystem in particular:

- **Content Collections.** Any directory under `src/content/{name}/`
  defined via `src/content/config.ts` is auto-detected, and one
  [Markdown adapter](../adapters/markdown.md) instance is wired per
  collection. The collection's Zod schema informs the markdown
  adapter's expected frontmatter shape; mismatches surface as build
  warnings and the integration supplies defaults rather than failing
  the build.
- **Starlight.** A Starlight site is just an Astro site with a
  particular collection structure (`src/content/docs/`) and
  sidebar-driven hierarchy. The integration auto-detects Starlight's
  `docs` collection and derives `parent` / `children` from the
  `astro:content` collection schema's `sidebar`-style fields when
  present, reaching Standard out of the box.

The integration only supports Astro's `output: "static"` and
`output: "hybrid"` modes. Astro's `output: "server"` (full SSR) is
rejected at config-resolve time with a build error — runtime ACT under
Astro is reachable today via the [Runtime SDK](../runtime.md) and a
custom Astro endpoint, but is not auto-wired by `@act-spec/plugin-astro`.

## Configuration

The `act()` factory accepts an options object whose shape is a strict
subset of `@act-spec/generator-core`'s `GeneratorConfig`, with
Astro-specific defaults:

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. The achieved level is computed from observed emissions and MAY downgrade. |
| `extractMode` | `"ssr-walk" \| "static-ast"` | `"ssr-walk"` | React-island extraction mode. SSR-walk uses Astro's existing render pass; static-AST is a pure-AST scan. |
| `i18n` | `boolean \| { pattern: "1" \| "2" }` | `false` | Opt-in i18n wiring. When `true`, the integration reads Astro's resolved `i18n` config and wires the i18n adapter. Default emission is Pattern 2 (per-locale manifests). |
| `urlTemplates` | object | see below | Override the default URL templates for the manifest, index, node, subtree, and NDJSON-index endpoints. |
| `adapters` | array | auto-detected | Override the auto-wired adapter list. When set, content-collection auto-detection is skipped. |
| `emit` | object | see below | Auto-emit toggles for `/llms.txt` and `/llms-full.txt`. Default-on. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block causes `astro build` to exit non-zero. CI builds SHOULD enable. |
| `astro` | object | `{}` | Astro-specific extensions: `ignoreCollections: string[]`, `skipReactBinding: boolean`. Non-normative. |

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

Default `emit`:

```ts
{
  llmsTxt: true,        // emit /llms.txt
  llmsFullTxt: true,    // emit /llms-full.txt
  llmsFullTxtMaxBytes: 5 * 1024 * 1024,
}
```

The `outputDir` MUST equal Astro's resolved `outDir` (typically
`dist/`); operators MUST NOT override it. `baseUrl` defaults to
Astro's resolved `site` config; when `site` is unset and a Strict
feature is requested, the integration emits a build error before the
pipeline starts.

## Build hooks

The integration registers the following Astro lifecycle hooks. All
other Astro hooks are off-limits to the integration:

| Hook | Purpose |
|---|---|
| `astro:config:setup` | Validate options, resolve defaults, reject `output: "server"`, register the integration's logger. |
| `astro:build:start` | Invoke the generator's `preBuild` hook. |
| `astro:build:setup` | Register the static-AST Vite plugin shim when `extractMode: "static-ast"`. |
| `astro:build:done` | Invoke the canonical pipeline (`runPipeline`). The pipeline runs to completion before the Astro build returns. |
| `astro:server:setup` | Install dev-mode middleware that serves in-memory ACT artifacts. |
| `astro:server:start` | Install the file watcher (`src/content/**`, `src/pages/**`, `src/components/**`) for incremental dev rebuilds. |

The canonical pipeline runs **exclusively** at `astro:build:done`, after
Astro's static output is finalized in `dist/`. The integration MUST
NOT write outside the ACT-owned subtree (`.well-known/act.json`,
`act/**`, `.act-build-report.json`, and the optional
`/llms.txt` / `/llms-full.txt` files). Atomic writes (tmp-then-rename)
per [`wire-format/etag.md`](../wire-format/etag.md) are honored.

Under `astro dev`, the integration MUST NOT write to `dist/`. Dev-mode
artifacts are served from in-memory caches by the
`astro:server:setup` middleware; the canonical on-disk artifact is
produced exclusively by `astro build`. Watcher debounce SHOULD be at
least 100ms to coalesce burst edits.

## React-island extraction

The integration auto-detects React islands via three signals:

1. A `.tsx` or `.jsx` file under `src/pages/` or `src/components/`.
2. A `client:*` directive on a React component in any `.astro` route.
3. An explicit `import` of a React component in any `.astro` page.

When any signal is present, `@act-spec/binding-react` is loaded and
dispatched per the binding's `BindingCapabilities`. The default
SSR-walk path uses Astro's own render pipeline; `static-AST` is opted
in via `act({ extractMode: "static-ast" })`. `client:only` islands are
not reachable by the SSR walk and fall back to static-AST. Every
emitted block carries `metadata.extraction_method` reflecting the
mode actually used.

When no React islands are detected, the binding is NOT loaded
(avoiding cold-start cost on docs sites with no components). Operators
MAY force-skip via `act({ astro: { skipReactBinding: true } })`.

## Page-level boundary

When a route module (`src/pages/**.astro`, `**.tsx`, or `**.mdx`)
exports a top-level `act` constant, the integration reads it at build
time and supplies it to the React binding's `extractRoute`:

```astro
---
// src/pages/pricing.astro
export const act = {
  type: "landing",
  id: "pricing",
  contract_version: "0.2",
  extract: () => ({
    title: "Pricing",
    summary: "Tiers, plans, and FAQs",
  }),
};
---
<MainLayout>...</MainLayout>
```

The export is read via Astro's static module-resolution path (Vite's
`import` at integration time). A route whose `act` export references a
runtime value not resolvable at build time emits a build warning and
is skipped.

## Output contract

After `astro build`, the resolved `outDir` (default `dist/`) contains
the following ACT-owned paths (in addition to Astro's HTML pages and
asset bundles):

```
dist/
  .well-known/
    act.json                       # manifest, see ../wire-format/manifest.md
  act/
    index.json                     # index, see ../wire-format/index.md
    n/
      <id>.json                    # one file per node, see ../wire-format/node.md
    sub/                           # Standard+ only
      <id>.json
    index.ndjson                   # Strict only
  llms.txt                         # auto-emitted by generator-core, see below
  llms-full.txt                    # auto-emitted by generator-core, see below
  .act-build-report.json           # local sidecar; not uploaded to the CDN
```

The integration MUST NOT modify Astro's own emitted files (HTML pages,
`_astro/**` assets). The build report is a local artifact that
enumerates every emitted ACT file, every warning (collection-schema
defaults, extraction placeholders), and the achieved conformance
level.

### `/llms.txt` and `/llms-full.txt` auto-emit

`@act-spec/generator-core` emits `/llms.txt` and `/llms-full.txt` at
the site root by default — a free upgrade path from
[llms.txt](https://llmstxt.org/) / `llms-full.txt` consumers to ACT.
The Astro integration honors per-emitter opt-out via the `emit` option:

```js
act({
  emit: {
    llmsTxt: true,                        // default
    llmsFullTxt: true,                    // default
    llmsFullTxtMaxBytes: 5 * 1024 * 1024, // 5 MB cap
  },
})
```

Disabling either emitter (`llmsTxt: false`) suppresses the
corresponding file. The format follows the public llmstxt.org
convention; ACT files at `/.well-known/act.json` are the structured
superset.

## Examples

### Minimum Core docs site

A single Content Collection at `src/content/docs/` with markdown files
and frontmatter `title`, `summary`. `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import act from "@act-spec/plugin-astro";

export default defineConfig({
  site: "https://docs.example.com",
  integrations: [act()],
});
```

Builds to a Core-conformant tree: manifest, index, one node per
collection entry, ETag headers, atomic writes, and auto-emitted
`/llms.txt` / `/llms-full.txt`.

### Standard with subtree

```js
integrations: [act({
  target: "standard",
  urlTemplates: { subtree_url_template: "/act/sub/{id}.json" },
})],
```

The integration auto-derives subtree-roots from collection entries
whose schema includes a `section` or `parent` field. The pipeline
emits `dist/act/sub/<section>.json` for each subtree root.

### Strict with React islands and i18n

```js
import react from "@astrojs/react";
import act from "@act-spec/plugin-astro";

export default defineConfig({
  site: "https://example.com",
  i18n: { defaultLocale: "en-US", locales: ["en-US", "es-ES"] },
  integrations: [
    react(),
    act({
      target: "strict",
      i18n: { pattern: "2" },
      urlTemplates: {
        subtree_url_template: "/act/sub/{id}.json",
        index_ndjson_url: "/act/index.ndjson",
      },
    }),
  ],
});
```

Auto-detects React islands, loads the React binding, dispatches
SSR-walk extraction, and emits per-locale manifests at
`dist/en-US/.well-known/act.json` and `dist/es-ES/.well-known/act.json`.

### Starlight site

Starlight is auto-detected; no extra config is needed beyond the
standard Starlight setup:

```js
import starlight from "@astrojs/starlight";
import act from "@act-spec/plugin-astro";

export default defineConfig({
  integrations: [
    starlight({ title: "My Docs" }),
    act(),
  ],
});
```

The integration reads Starlight's `docs` collection and the sidebar
config, derives `parent` / `children`, and reaches Standard out of the
box.

## Conformance

The integration auto-detects the achieved conformance level from
observed emissions per [`wire-format/conformance.md`](../wire-format/conformance.md);
it never inflates from configuration intent.

| Level | Reachable when |
|---|---|
| **Core** | Always achieved on any successful build. Manifest, index, node files, ETag, atomic writes. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted. The integration auto-derives subtree-eligible content from collection schemas with a `parent` or `section` field. Adds component extraction wiring and dev-server incremental rebuild. |
| **Strict** | Standard + NDJSON index emitted + (when `i18n: true`) per-locale manifests emitted. |

A configuration that targets Strict but produces only Standard
artifacts emits a build warning and the manifest's
`conformance.level` reflects the achieved (not configured) level.

## Sources

- `prd/401-astro-plugin.md` — Astro plugin contract.
- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

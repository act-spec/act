---
title: Nuxt generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Nuxt generator

> The Nuxt generator is a Nuxt module that emits ACT during `nuxt
> generate` (static export). It integrates with Nuxt Content for the
> markdown corpus, with `@nuxtjs/i18n` for locale layouts, and with
> `@act-spec/binding-vue` for Vue-component extraction. This document
> defines the module shape, the Nuxt lifecycle hooks consumed, the
> Nuxt Content / Nuxt i18n auto-wiring, and the build-output contract.

## Overview

`@act-spec/plugin-nuxt` is a Nuxt module produced by Nuxt's
`defineNuxtModule` factory. Operators register it once in
`nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ["@act-spec/plugin-nuxt"],
  act: {
    target: "standard",
  },
});
```

Internally the module constructs a generator-plugin object (per
`@act-spec/generator-core`) and runs the canonical pipeline at Nuxt's
`build:done` hook, after Nitro has finalized the static-export tree
(`nuxt generate`). The module composes with three upstream pieces of
the Nuxt ecosystem:

- **Nuxt Content (`@nuxt/content`)** — when installed, auto-wired to
  the [Markdown adapter](../adapters/markdown.md) against Nuxt
  Content's resolved input directory (typically `content/`). The
  adapter walks `content/**/*.md{,x}`; the host MAY override via
  `act.adapters` to add explicit adapter entries.
- **`@nuxtjs/i18n`** — when installed and configured with more than
  one locale, the module auto-detects `locales` and `strategy`,
  threads them into the generator config, and auto-wires the
  [i18n adapter](../adapters/i18n.md). Default emission is Pattern 2
  (per-locale manifests) since Nuxt i18n produces locale-prefixed URLs
  naturally.
- **`@act-spec/binding-vue`** — when a Vue route's SFC declares an
  `act` static field, a `defineActContract({…})` macro at the top of
  `<script setup>`, or an `<ActSection>` boundary, the binding is
  loaded and dispatched per route per locale. SSR-walk is the default
  extraction mode; static-AST is opt-in.

The module's peer-dependency floor is Nuxt 3.x (and any forward-
compatible Nuxt 4.x that retains the `defineNuxtModule` /
`build:done` / `pages:extend` hook surface). Nuxt 2 / Vue 2 are out
of scope.

This generator covers **static export only** in v0.2. Runtime ACT
under Nuxt (a Nitro-served manifest / index / node tree) is reachable
manually today via the [Runtime SDK](../runtime.md) and a custom
`server/api/` route, but is not auto-wired by `@act-spec/plugin-nuxt`.

## Configuration

The module options shape is a strict subset of
`@act-spec/generator-core`'s `GeneratorConfig`, with Nuxt-specific
defaults:

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. |
| `extractionMode` | `"ssr-walk" \| "static-ast"` | `"ssr-walk"` | Vue-component extraction mode. |
| `i18n` | `boolean` | auto | When `@nuxtjs/i18n` declares > 1 locale, the i18n adapter is auto-wired. Force-disable via `i18n: false`. |
| `urlTemplates` | object | see Astro generator | Override the default URL templates. |
| `adapters` | array | auto-detected | Override the auto-wired adapter list. |
| `routeFilter` | `(route) => boolean` | passes all | Optional callback to exclude subsets of routes from component extraction. |
| `emit` | object | `{ llmsTxt: true, llmsFullTxt: true }` | Auto-emit toggles for `/llms.txt` and `/llms-full.txt`. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block fails the build. |
| `outputDir` | string | `.output/public/` | Resolved from Nuxt's internal config; operators MAY override but the path MUST resolve inside the project root. |
| `hooks` | object | `{}` | `{ preBuild?, postBuild?, onError? }` host-level hooks; run after the module's own. |

The default `outputDir` is the host's Nitro static-export directory
(`.output/public/` for default Nuxt 3.x). The module resolves this
path from Nuxt's internal config rather than hard-coding the literal,
so non-default Nitro configurations (e.g., `nitro.output.publicDir`
overrides) work correctly.

## Build hooks

The module registers the following Nuxt hooks:

| Hook | Purpose |
|---|---|
| `nitro:build:before` | Module-side preparation: register virtual imports, install the Vue provider, register the Vite macro plugin. The canonical pipeline does NOT run here. |
| `pages:extend` | Capture the resolved Nuxt route enumeration (route IDs, file paths, dynamic-segment metadata) and feed them into the binding-extraction stage. |
| `app:created` | Install `@act-spec/binding-vue`'s `installActProvider(app)` for every per-route SSR app instance, so any `useActContract(contract)` composable invocation has the provider available. |
| `build:done` | Invoke the canonical pipeline (`runPipeline`). The pipeline runs **exactly once** per build, gated by a re-entry guard that prevents double-execution. |

The pipeline runs **exclusively** at `build:done`. The module
detects whether Nuxt is producing a static-export tree (`nuxt
generate` / `_generate === true`) or a full Node.js server build
(`nuxt build`); when the latter is detected, the module surfaces an
explicit error and aborts (runtime ACT under Nuxt is out of scope
for v0.2's auto-wiring).

The module MUST NOT run the canonical pipeline at `nitro:build:before`,
`app:created`, or any per-request hook. Nuxt's documented hook
surface is the only legitimate target.

## Vue-component extraction

The module enumerates routes via Nuxt's `pages:extend` hook. Routes
whose host SFC declares any of the following are eligible for
component extraction:

- A static `act` field (e.g., `defineComponent({ name: "Page", act: {…} })`).
- A `defineActContract({…})` macro at the top of `<script setup>`.
- An `<ActSection>` boundary in the template.

For each eligible route, the module dispatches
`@act-spec/binding-vue`'s `extractRoute(input)` per route per locale
per declared variant. The dispatch honors the binding's capability
declaration: SSR-walk is the canonical default; `static-ast` is
selected only when explicitly opted in via
`act.extractionMode: "static-ast"`.

Routes without any contract declaration emit no component-extracted
nodes, but markdown content sourced via Nuxt Content still emits
independently.

## Vue auto-imports

The module registers `@act-spec/binding-vue`'s `defineActContract`
macro and `useActContract` composable as Nuxt auto-imports via
Nuxt's `imports` module API, so authors do NOT need explicit
`import { defineActContract } from "@act-spec/binding-vue"` or
`import { useActContract } from "@act-spec/binding-vue"` in SFCs.

The auto-import does NOT extend to the `<ActSection>` wrapper
component (component imports follow Nuxt's `components` module
convention; the host opts in by listing
`@act-spec/binding-vue/components` in `nuxt.config.ts`'s `components`
array). The auto-imports MUST NOT collide with Nuxt's own
`definePageMeta`.

## i18n auto-wiring

When `@nuxtjs/i18n` is installed and declares > 1 locale, the module
maps Nuxt i18n's `strategy` to ACT's i18n pattern:

| Nuxt i18n `strategy` | ACT pattern | Emission |
|---|---|---|
| `prefix_except_default` | Pattern 2 | Per-locale manifests at `/{locale}/.well-known/act.json` for non-default locales; default locale at `/.well-known/act.json`. |
| `prefix` | Pattern 2 | Per-locale manifests at `/{locale}/.well-known/act.json` for every locale. |
| `prefix_and_default` | Pattern 2 | Per-locale manifests at `/{locale}/.well-known/act.json` for every locale; default locale ALSO available at `/.well-known/act.json`. |
| `no_prefix` | Pattern 1 (locale-prefixed IDs) | Single tree; node IDs carry locale prefix. |

Operators MAY force-disable i18n auto-wiring via `act.i18n: false`.

## Output contract

After `nuxt generate`, the resolved `outputDir` (default
`.output/public/`) contains:

```
.output/public/
  .well-known/act.json
  act/
    index.json
    n/<id>.json
    sub/<id>.json                       # Standard+ only
    index.ndjson                        # Strict only
  <locale>/.well-known/act.json         # per-locale (Pattern 2)
  llms.txt                              # auto-emitted by generator-core
  llms-full.txt                         # auto-emitted by generator-core
  .act-build-report.json                # local sidecar
```

The module delegates file emission to `@act-spec/generator-core` so
atomic writes (tmp-then-rename) per
[`wire-format/etag.md`](../wire-format/etag.md) are inherited
unchanged. The module MUST NOT write any ACT-protocol file directly
bypassing the runtime — doing so would break the atomic-write
guarantee.

## Examples

### Minimum Nuxt Content site

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@nuxt/content", "@act-spec/plugin-nuxt"],
});
```

```bash
$ nuxt generate
```

Builds to a Core-conformant tree under `.output/public/`: manifest,
index, one node per markdown file, ETag, atomic writes, and
auto-emitted `/llms.txt` / `/llms-full.txt`.

### Standard with component extraction

```ts
// pages/index.vue
<script setup>
defineActContract({
  type: "landing",
  id: "home",
  contract_version: "0.2",
});
</script>
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@nuxt/content", "@act-spec/plugin-nuxt"],
  act: {
    target: "standard",
    urlTemplates: { subtree_url_template: "/act/sub/{id}.json" },
  },
});
```

The module auto-detects the contract via `pages:extend`, dispatches
SSR-walk extraction, and emits subtree files for sections with nested
content.

### Strict multi-locale Nuxt + i18n

```ts
export default defineNuxtConfig({
  modules: ["@nuxt/content", "@nuxtjs/i18n", "@act-spec/plugin-nuxt"],
  i18n: {
    locales: ["en", "es"],
    defaultLocale: "en",
    strategy: "prefix_except_default",
  },
  act: {
    target: "strict",
    urlTemplates: { index_ndjson_url: "/act/index.ndjson" },
  },
});
```

Emits per-locale manifests under `/<locale>/`, an NDJSON index, and
honors per-locale node trees.

## Conformance

| Level | Reachable when |
|---|---|
| **Core** | Any successful `nuxt generate`. Manifest, index, node files, ETag, atomic writes. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted. Adds Vue-component extraction wiring and the Vue auto-imports. |
| **Strict** | Standard + NDJSON index + (when multi-locale) per-locale manifests. |

A target that exceeds the achieved level emits a build warning; the
manifest's `conformance.level` reflects the achieved (not configured)
level.

## Sources

- `prd/407-nuxt-module.md` — Nuxt module contract.
- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

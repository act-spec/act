---
title: Remix generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Remix generator

> The Remix generator emits ACT for Remix apps in two complementary
> shapes: a Remix-Vite plugin that emits a static ACT tree alongside
> Remix's prerendered output, and a set of resource-route handlers
> that compose with Remix's loader pattern for runtime delivery. The
> plugin targets Remix-Vite (the supported Remix shape since Remix
> 2.x) and is forward-compatible with React Router v7's resource-route
> conventions. This document defines both shapes, the Vite hook
> placement, and the loader integration.

## Overview

`@act-spec/plugin-remix` is a **Vite plugin** (not a Remix-internal
plugin). It exports an `act()` factory consumed from `vite.config.ts`
alongside Remix's `vitePlugin`:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { vitePlugin as remix } from "@remix-run/dev";
import { act } from "@act-spec/plugin-remix";

export default defineConfig({
  plugins: [remix(), act()],
});
```

Vite resolves plugin order by array position; `act()` runs AFTER
`remix()` so Remix-Vite has populated the route tree before the
plugin reads it. The plugin's `closeBundle` hook is the canonical
post-build entry point, gated on the client build (Vite invokes
`closeBundle` once per build target — client AND server bundles for
SSR-prerender configurations; the server invocation is a no-op).

The plugin composes with three upstream pieces:

- **Remix's route enumeration** — exposed via Remix-Vite's published
  API (`getRoutes()` / `routesManifest`). The plugin enumerates the
  resolved tree, identifies routes that prerender (Remix's static
  export emits an HTML file for them), and treats them as ACT-node
  candidates. Routes that do not prerender are skipped (they are
  runtime-only).
- **Markdown content** — auto-wired to the
  [Markdown adapter](../adapters/markdown.md) for `content/**/*.{md,mdx}`.
  `.mdx` files under `app/routes/**` are route modules and go to the
  React binding; files under `content/**` go to the markdown adapter.
- **`@act-spec/binding-react`** — when a route module exports a
  top-level `act` constant or contains React-binding contracts, the
  binding is loaded and dispatched.

The static plugin's peer-dependency floor is `@remix-run/dev ^2.0.0`
and `vite ^5.0.0`. React Router v7's matching resource-route
conventions are forward-compatible: when an operator migrates from
Remix v2 to React Router v7, the plugin's resource-route handlers and
the loader composition pattern continue to work; the Vite-plugin
peer-dependency floor will be re-pinned in a future MAJOR.

The runtime side ships as `@act-spec/runtime-remix` and exposes a set
of resource-route handlers that compose with any Remix loader.

## Configuration

The static plugin's options object is a strict subset of
`@act-spec/generator-core`'s `GeneratorConfig`, with Remix-specific
defaults:

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. |
| `content` | `{ roots: string[] }` | `{ roots: ["content/**/*.{md,mdx}"] }` | Content source globs auto-wired to the Markdown adapter. |
| `adapters` | array | auto-detected | Override the auto-wired adapter list. |
| `extractMode` | `"ssr-walk" \| "static-ast"` | `"ssr-walk"` | React-component extraction mode. |
| `urlTemplates` | object | see Astro generator | Override the default URL templates. |
| `emit` | object | `{ llmsTxt: true, llmsFullTxt: true }` | Auto-emit toggles for `/llms.txt` / `/llms-full.txt`. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block fails the build. |
| `buildReportPath` | string | `./.act-build-report.json` | Build report sidecar path; project root by default to avoid CDN upload. |

The plugin MUST inspect, at config-resolve time, whether Remix-Vite
is configured for prerendering — specifically, whether the resolved
Remix configuration includes a `prerender` directive or whether
routes export `prerender: true`. When neither signal is present, the
plugin emits a build error: "Configure Remix prerendering, or use
`@act-spec/runtime-remix` for runtime ACT."

## Build hook

The plugin invokes the generator pipeline **exclusively** from Vite's
`closeBundle` hook, gated to the client build:

- The plugin gates on `this.environment?.name === 'client'` (Vite 5+)
  or the `ssr` build flag for older configurations; the server bundle
  invocation is a no-op.
- After Remix-Vite finalizes the client bundle and writes
  `build/client/`, the plugin reads the route tree, enumerates
  prerendered routes, and runs the canonical pipeline against
  `build/client/` as the output directory.

The plugin MUST NOT run during `remix vite:dev`. The `closeBundle`
hook is a no-op in dev. The plugin MAY emit a one-time logger message
indicating that ACT artifacts are produced only by `vite build`.

## Resource routes

`@act-spec/runtime-remix` exposes resource-route handlers that
compose with Remix's loader pattern. The full runtime contract —
request shape, ETag, cache headers, freshness — is defined in
[`runtime.md`](../runtime.md); this section documents the
Remix-specific wiring.

```ts
// app/routes/[.]well-known.act[.]json.ts
import { actManifestLoader } from "@act-spec/runtime-remix";
import { source } from "~/lib/act-source";

export const loader = actManifestLoader({ source });
```

```ts
// app/routes/act.index[.]json.ts
import { actIndexLoader } from "@act-spec/runtime-remix";
export const loader = actIndexLoader({ source });
```

```ts
// app/routes/act.n.$id[.]json.ts
import { actNodeLoader } from "@act-spec/runtime-remix";
export const loader = actNodeLoader({ source });
```

The handlers accept a `source` factory (a host-supplied function
that resolves a node ID to a node-shaped object) and return Remix's
standard `Response` with the correct `Content-Type`, strong `ETag`,
`Cache-Control`, and `Vary` headers per
[`runtime.md`](../runtime.md). The handlers honor `If-None-Match` and
emit `304 Not Modified` when appropriate.

Composition with host loaders is straightforward: Remix loaders are
plain functions, so a host can wrap the ACT loader to add auth,
rate-limiting, or tracing:

```ts
import { actNodeLoader } from "@act-spec/runtime-remix";

const baseLoader = actNodeLoader({ source });

export const loader = async (args) => {
  await requireAuth(args.request);
  return baseLoader(args);
};
```

Routes that do not prerender at build time are runtime-only by
construction; `@act-spec/runtime-remix` is the only way to serve ACT
for those routes.

## Output contract (static)

After `remix vite:build`, `build/client/` contains:

```
build/client/
  .well-known/act.json
  act/
    index.json
    n/<id>.json
    sub/<id>.json                       # Standard+ only
    index.ndjson                        # Strict only
  llms.txt
  llms-full.txt
.act-build-report.json                  # at project root, NOT in build/client/
```

The plugin MUST NOT touch Remix-Vite-owned paths (HTML pages, asset
bundles, client manifest). Atomic writes per
[`wire-format/etag.md`](../wire-format/etag.md). The build report
sits at the project root by default to avoid CDN upload.

## Examples

### Minimum static prerender site

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { vitePlugin as remix } from "@remix-run/dev";
import { act } from "@act-spec/plugin-remix";

export default defineConfig({
  plugins: [
    remix({ prerender: true }),
    act(),
  ],
});
```

Builds to a Core-conformant tree under `build/client/`.

### Runtime resource routes

```ts
// app/routes/[.]well-known.act[.]json.ts
import { actManifestLoader } from "@act-spec/runtime-remix";
import { source } from "~/lib/act-source";
export const loader = actManifestLoader({ source });
```

The handler emits `delivery: "runtime"` and serves the manifest on
demand.

### Hybrid: static manifest mounting a runtime subtree

```ts
// vite.config.ts — emits static manifest with mounts
act({
  target: "standard",
  // ... static config
});
```

```ts
// app/routes/act.runtime.... — runtime subtree
export const loader = actSubtreeLoader({ source });
```

The static manifest declares a `mounts` array referencing
`/act/runtime/.well-known/act.json` per
[`wire-format/manifest.md`](../wire-format/manifest.md).

## Conformance

| Level | Static reachable when | Runtime reachable when |
|---|---|---|
| **Core** | Any successful `remix vite:build` with prerendering enabled. | Manifest + index + node loaders wired; ETag per `If-None-Match` honored. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted. Adds component extraction. | + Subtree loader wired. |
| **Strict** | Standard + NDJSON index emitted. | Standard + NDJSON-index loader + (when authenticated) `auth.schemes` declared. |

The achieved level is computed from observed emissions (static) or
from observed loader registrations (runtime); never from
configuration intent alone.

## Sources

- `prd/406-remix-plugin.md` — Remix plugin contract.
- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

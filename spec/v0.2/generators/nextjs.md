---
title: Next.js generator
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Next.js generator

> The Next.js generator emits ACT for Next.js sites in two modes:
> static-export builds (build-time emit, the focus of this document)
> and runtime mode (route handlers serving the manifest, index, and
> nodes on demand). Static and runtime are separately published —
> `@act-spec/plugin-nextjs` covers static; `@act-spec/runtime-next`
> covers runtime. This document defines both shapes and the App Router
> vs Pages Router differences.

> **Live example.** A built copy of the
> [`nextjs-marketing`](https://github.com/act-spec/act/tree/main/examples/nextjs-marketing)
> example is deployed at [`/examples/nextjs-marketing/`](/examples/nextjs-marketing/).
> Open it in the
> [site browser](/browser/?site=%2Fexamples%2Fnextjs-marketing%2F.well-known%2Fact.json)
> to walk the marketing-site corpus.

## Overview

Next.js has two reachable delivery profiles for ACT:

- **Static** — `next build` followed by `next export` (or `output:
  "export"` in `next.config.js`) produces a fully static `out/` tree.
  `@act-spec/plugin-nextjs` integrates as a Next.js plugin (the
  `withAct(nextConfig, options)` wrap-the-config pattern that mirrors
  `withMDX`, `withBundleAnalyzer`, etc.) and runs the generator pipeline
  after Next finalizes the static export.
- **Runtime** — a deployed Next.js server (Node, Edge, or serverless)
  responds to ACT requests on demand. `@act-spec/runtime-next` provides
  App-Router route handlers and Pages-Router API routes that synthesize
  the manifest, index, and nodes from a host-supplied content source
  per [`runtime.md`](../runtime.md).

Hybrid deployments combine both: a static `/.well-known/act.json`
declares a `mounts` array referencing a runtime-mode subtree, or
vice-versa. See [`wire-format/manifest.md`](../wire-format/manifest.md)
for the mounts contract.

The plugin's peer-dependency floor is `next ^14.0.0 || ^15.0.0`.
Next.js 13.x and earlier are out of scope. Next.js 16+ support is a
future MAJOR change.

## Static mode

### Configuration

`@act-spec/plugin-nextjs` exports a `withAct` factory consumed from
`next.config.js`:

```js
const { withAct } = require("@act-spec/plugin-nextjs");

module.exports = withAct({
  output: "export",
  // ... rest of nextConfig
}, {
  target: "standard",
});
```

`withAct` MUST be composable: a project that already wraps its config
with `withMDX`, `withBundleAnalyzer`, or other Next plugins MUST be
able to wrap `withAct` around the result without conflict. The plugin
adds: a webpack plugin entry (the post-build hook), a content-source
resolver, and an env sentinel for the build-event listener. All other
config is passed through.

| Option | Type | Default | Notes |
|---|---|---|---|
| `target` | `"core" \| "standard" \| "strict"` | `"core"` | Target conformance level. The achieved level is computed from observed emissions. |
| `content` | `{ roots: string[] }` | `{ roots: ["content/**/*.{md,mdx}"] }` | Content source globs auto-wired to the [Markdown adapter](../adapters/markdown.md). When `adapters` is set explicitly, auto-wiring is skipped. |
| `adapters` | array | auto-detected | Override the auto-wired adapter list. |
| `extractMode` | `"ssr-walk" \| "static-ast"` | `"ssr-walk"` | React-component extraction mode. |
| `i18n` | `boolean \| { pattern: "1" \| "2" } \| "auto"` | `"auto"` | When `auto` and Next declares `i18n.locales` (Pages Router) or `next-intl` is installed (App Router), the [i18n adapter](../adapters/i18n.md) is auto-wired. |
| `urlTemplates` | object | see Astro generator | Override the default URL templates. |
| `emit` | object | `{ llmsTxt: true, llmsFullTxt: true }` | Auto-emit toggles for `/llms.txt` and `/llms-full.txt`. |
| `failOnExtractionError` | boolean | `false` | When `true`, any extraction-placeholder block causes `next build` to exit non-zero. |
| `buildReportPath` | string | `./.act-build-report.json` | Build report sidecar path. The default is the project root, NOT `out/`, to avoid CDN upload. |

The plugin MUST inspect the resolved `nextConfig.output` at
config-resolve time:

- `output: "export"` — proceeds as static.
- `output: "server" \| "standalone"` (or unset, defaulting to a
  non-export build) — emits a build error pointing operators to the
  runtime SDK: "Set `output: 'export'` for static ACT, or migrate to
  `@act-spec/runtime-next` for runtime ACT."

### Build hook

The plugin invokes the generator pipeline **exclusively** after Next's
static export completes. The exact hook surface has evolved across
Next 14 and 15:

- **Next 15+** uses the documented `nextBuildDone` build-event entry
  (or its current published equivalent — verify against Next.js
  documentation at the time of implementation).
- **Next 14** uses a webpack `done` callback gated on the existence
  of Next's static-export marker.

The normative contract is **post-static-export emission**: the
pipeline MUST run after Next's static export to `out/` is complete and
only then. A change to the underlying Next.js hook name is NOT a
MAJOR change to this generator (the hook name is implementation
detail, not a wire-format concern).

The plugin MUST NOT run the canonical pipeline during `next dev`. The
post-build hook is a no-op when `NODE_ENV !== "production"` or when
Next's dev invocation is detected. Operators preview ACT artifacts via
`next build && npx serve out/`.

### Content sources and routing

The plugin auto-wires one Markdown adapter instance per content root
(default `content/**/*.{md,mdx}`). It disambiguates `.mdx` files based
on filesystem location: files under `content/**` go to the markdown
adapter; files under `app/**` or `pages/**` are route modules and go
to the React binding.

When a route module under `app/` or `pages/` exports a top-level
`act` constant (the page-level boundary pattern), the plugin reads
the export at build time and supplies it to
`@act-spec/binding-react`'s `extractRoute`. A route whose `act`
export references a runtime value not resolvable at build time emits
a build warning and is skipped.

React routes are auto-detected; when detected, `@act-spec/binding-react`
is loaded and dispatched per the binding's capabilities. Default
extraction mode is SSR-walk (using Next's existing render pipeline);
static-AST is opt-in for faster builds.

### Output

After `next build && next export`, the resolved `out/` directory
contains:

```
out/
  .well-known/act.json
  act/
    index.json
    n/<id>.json
    sub/<id>.json                       # Standard+ only
    index.ndjson                        # Strict only
  <locale>/.well-known/act.json         # per-locale (Pattern 2)
  llms.txt
  llms-full.txt
.act-build-report.json                  # at project root, NOT in out/
```

The plugin MUST NOT modify Next-owned paths. Atomic writes per
[`wire-format/etag.md`](../wire-format/etag.md). The build report sits
at the project root by default to avoid CDN upload via `next export`.

## Runtime mode

`@act-spec/runtime-next` is the runtime SDK for Next.js. It composes
with the App Router's route handlers (`app/.well-known/act.json/route.ts`)
and the Pages Router's API routes (`pages/api/act/...`). The full
runtime contract — request shape, freshness model, cache headers — is
defined in [`runtime.md`](../runtime.md); this section documents the
Next.js-specific wiring.

### App Router

```ts
// app/.well-known/act.json/route.ts
import { createManifestHandler } from "@act-spec/runtime-next";
import { source } from "@/lib/act-source";

export const GET = createManifestHandler({ source });
```

```ts
// app/act/index.json/route.ts
import { createIndexHandler } from "@act-spec/runtime-next";
export const GET = createIndexHandler({ source });
```

```ts
// app/act/n/[id]/route.ts
import { createNodeHandler } from "@act-spec/runtime-next";
export const GET = createNodeHandler({ source });
```

The handlers accept a `source` factory (a host-supplied function that
resolves a node ID to a node-shaped object) and return Next's standard
`Response` with the correct `Content-Type`, `ETag`, `Cache-Control`,
and `Vary` headers per [`runtime.md`](../runtime.md). The handlers
honor `If-None-Match` and emit `304 Not Modified` when appropriate.

### Pages Router

```ts
// pages/api/act/manifest.ts
import { createPagesManifestHandler } from "@act-spec/runtime-next";
export default createPagesManifestHandler({ source });
```

Pages-Router handlers operate on `NextApiRequest` / `NextApiResponse`
and emit the same shape and headers.

### Streaming and Edge runtime

The Node runtime is the canonical target. Edge runtime is supported
when the host's `source` factory does not depend on Node-only APIs;
the generator returns a standard `Response` either way. Streaming is
NOT used for the manifest, index, or per-node handlers (each response
fits comfortably in a single chunk); the NDJSON-index handler MAY
stream when the index is large.

### Conformance declaration

Runtime handlers MUST declare `delivery: "runtime"` in the manifest.
The `capabilities` object reflects runtime-specific features
(`auth.schemes` when set, freshness flags). A runtime manifest MUST
NOT advertise the `etag: true` capability without honoring
`If-None-Match`; per [`runtime.md`](../runtime.md), the runtime
contract is normative.

## Examples

### Minimum static Core site

```js
// next.config.js
const { withAct } = require("@act-spec/plugin-nextjs");
module.exports = withAct({ output: "export" });
```

Builds to a Core-conformant tree under `out/`.

### Static Strict site with i18n

```js
const { withAct } = require("@act-spec/plugin-nextjs");
module.exports = withAct({
  output: "export",
  i18n: { defaultLocale: "en", locales: ["en", "es"] },
}, {
  target: "strict",
  urlTemplates: {
    subtree_url_template: "/act/sub/{id}.json",
    index_ndjson_url: "/act/index.ndjson",
  },
});
```

### App Router runtime SaaS

```ts
// app/.well-known/act.json/route.ts
import { createManifestHandler } from "@act-spec/runtime-next";
import { source } from "@/lib/act-source";
export const GET = createManifestHandler({ source });
```

The handler emits `delivery: "runtime"` and serves the manifest,
index, and per-node responses on demand.

## Conformance

| Level | Static reachable when | Runtime reachable when |
|---|---|---|
| **Core** | Any successful `next build && next export`. | Manifest + index + node handlers wired; ETag per `If-None-Match` honored. |
| **Standard** | `subtree_url_template` configured AND at least one subtree file emitted. Adds component extraction. | + Subtree handler wired. |
| **Strict** | Standard + NDJSON index + (multi-locale) per-locale manifests. | Standard + NDJSON-index handler + (when authenticated) `auth.schemes` declared. |

The achieved level is computed from observed emissions (static) or
from observed handler registrations (runtime), never from
configuration intent alone.

## Sources

- `prd/405-nextjs-plugin.md` — Next.js static plugin contract.
- `prd/501-nextjs-runtime-sdk.md` — Next.js runtime SDK contract.
- `prd/400-generator-architecture.md` — generator pipeline and `GeneratorPlugin` interface.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

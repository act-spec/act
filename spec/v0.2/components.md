---
title: Component contract
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Component contract

> A component-driven site has no flat content files — its content lives
> in component props composed at runtime, sourced from CMSes, message
> catalogues, and feature flags. The component contract is how a
> producer instructs an ACT generator to extract structured content from
> those component trees: every page, every component, and every
> structured block declares a small contract object whose `extract`
> function produces ACT-shaped blocks at build time. This document
> defines the framework-agnostic contract surface, the React, Vue, and
> Angular bindings that implement it, and the producer rules a
> component-instrumented site MUST follow.

## Why components are first-class in ACT

Documentation and marketing sites built on Astro, Next.js, Nuxt,
VitePress, Remix, Docusaurus, or Angular Universal do not have content
files in the way a CMS-backed or markdown-based site does. Their
content is composed by the framework — a `<Hero>` component reads its
headline from a CMS API, a `<PricingTable>` reads its tiers from a
content layer, a `<FAQAccordion>` reads its items from a translated
message catalogue. Re-emitting that content as ACT-readable JSON
requires looking inside the component tree, not at filesystem text.

The component contract is the producer-side interface the framework
plugins consume. A component author declares an ACT contract on their
component or page; the generator's binding (React, Vue, or Angular)
walks the rendered tree at build time and asks each contract to emit
the corresponding ACT block. The output is byte-for-byte the same as
what a markdown adapter would emit — typed nodes and blocks per
[node.md](./wire-format/node.md) — but the input is a component tree
rather than a file tree.

## The canonical contract object

Every framework binding desugars its idiomatic declaration syntax to a
single canonical contract object with the following shape. Producers
SHOULD treat the canonical shape as the unit of authoring; bindings
provide framework-native conveniences on top.

```ts
interface ActContract<P = unknown> {
  /** Block type for component- or block-level contracts (per
   *  [node.md](./wire-format/node.md)) — e.g., "marketing:hero",
   *  "code". Node type for page-level contracts — e.g., "landing",
   *  "tutorial". */
  type: string;

  /** REQUIRED on page-level contracts; OPTIONAL on
   *  component- or block-level contracts. When present MUST conform
   *  to the ID grammar in node.md. */
  id?: string;

  /** One-sentence summary; honored on page-level contracts as the
   *  enclosing node's summary. */
  summary?: string;

  /** Cross-references emitted on the page node. */
  related?: Array<{ id: string; relation: string }>;

  /** Variant emission policy. Defaults to "default". */
  variants?: "default" | "all" | string[];

  /** Contract surface revision; matches `^[0-9]+\.[0-9]+$`. ACT v0.2
   *  contracts MUST set this to "0.2". */
  contract_version: string;

  /** Synchronous extraction function. Returns one ContractOutput or
   *  an array of them. */
  extract: (props: P, ctx: ExtractionContext) => ContractOutput | ContractOutput[];
}

interface ExtractionContext {
  /** Active locale; undefined for non-i18n builds. */
  locale: string | undefined;
  /** Variant key for this extraction pass; undefined for canonical. */
  variant: string | undefined;
  /** Enclosing page-level node id; undefined outside a page contract. */
  parentId: string | undefined;
  /** The binding name (e.g., "@act-spec/binding-react"). */
  binding: string;
  /** Emit a build warning attached to the current extraction. */
  warn: (message: string) => void;
}

type ContractOutput = { type: string; [field: string]: unknown };
```

The contract object is **inert to delivery profile**: a contract
behaves identically whether the generator runs at static build time,
under runtime SSR, or via a headless render. The binding declares its
execution mode through a capability matrix; the generator chooses the
strategy. Producers MUST NOT condition `extract` on `delivery` or on
any per-request context.

The `extract` function MUST be synchronous in v0.2. A binding that
detects a Promise-returning `extract` MUST emit a placeholder block
(see "Failure modes" below). Async extraction is reserved for a future
MAJOR.

## Three declaration patterns

Every binding MUST accept a contract through three syntactic surfaces.
All three desugar to the canonical object above; output MUST be
byte-identical given identical authored inputs.

### Static field

The component carries a static `act` member referencing an
`ActContract<P>`. This is the canonical pattern when a component is
declared as a class or a function with attached static properties.

### Hook / composable

The component invokes a registration hook from inside its
render/`setup` lifecycle. The hook captures the contract once per
component instance per variant; it is not a re-render trigger. A
binding MUST guarantee `extract` runs **at most once per (component
instance, variant) tuple** during a single extraction pass. Re-running
`extract` on every render is non-conformant.

### Page-level boundary

A page (route) declares a `PageContract` — an `ActContract` with a
required `id` — via either an exported module-level constant or a
framework-native wrapper component. The page contract aggregates every
descendant component contract into the page node's `content[]` array
in **render order, top-to-bottom, depth-first**. The binding MUST NOT
reorder, deduplicate, or skip blocks based on visual presentation.

## Page-level aggregation rules

A page-level contract object MUST include `id`. The `id` MUST match
the ID grammar in [node.md](./wire-format/node.md) and MUST be at most
256 UTF-8 bytes. A page-level contract whose `id` is missing or
invalid MUST cause the generator to emit a build error and skip the
route; no placeholder applies at the page level. Two page-level
contracts producing the same `id` in a single build MUST cause a
build error citing both source locations.

Pages do not nest. A page contract whose subtree contains another
page contract MUST cause a build error.

A page-level contract MAY include a `related` array; the binding MUST
emit it verbatim on the page node and MUST NOT inject implicit
`related` entries (e.g., one per variant — variant relations are
emitted only when the variant emission rules apply).

## Variant handling

A page-level contract MAY declare `variants`. When omitted or set to
`"default"`, the binding extracts the contract once and emits one node.
When set to `"all"` or to an array of variant keys, the binding MUST
replay the page render once per declared variant key and emit one node
per replay. Variant emission MUST be opt-in per page; the binding MUST
NOT enable variants globally.

Each variant node's `id` MUST be `{base_id}@{variant_key}`. The base
node (canonical) MUST also be emitted. Each variant node MUST set
`metadata.variant` to `{ base_id, key, source }` where `source` comes
from the documented-open enum `{ "experiment", "personalization",
"locale" }`. Each variant node SHOULD emit at least one direction of
the variant relation — typically `{ id: base_id, relation:
"variant_of" }`.

The total number of variants emitted for a single base page node MUST
NOT exceed **64** in a single build. The binding MUST emit a build
error when the variant matrix exceeds the cap.

## Capability declaration

Every binding MUST publish a static capability declaration enumerating
which extraction modes it supports. The capability surface is closed
for v0.2:

| Flag | Meaning |
|---|---|
| `ssr-walk` | The binding walks a server-rendered tree (SSG/SSR with the framework's renderer). |
| `static-ast` | The binding scans source files via an AST plugin and extracts statically-resolvable contracts. |
| `headless-render` | The binding renders the app via jsdom or Playwright (legacy SPA fallback). |
| `rsc` | The binding supports React Server Components or framework-equivalent server-only trees. |
| `streaming` | The binding supports framework streaming and waits for stream completion before yielding. |
| `suspense` | The binding waits for suspended boundaries to resolve before yielding. |
| `concurrent` | The binding is safe to invoke concurrently across distinct routes. |

A binding MUST set every flag truthfully. Generators dispatch
extraction strategy based on these flags. Adding a new capability flag
in a future revision is a MINOR change; removing one is MAJOR.

Every emitted block MUST carry `metadata.extraction_method` reflecting
the actual mode used for that extraction pass: `"ssr-walk"`,
`"static-ast"`, or `"headless-render"`. This field is binding-owned;
authors MUST NOT set it inside `extract`.

## Extraction guarantees

Every block emitted by a binding MUST satisfy the per-block contract in
[node.md](./wire-format/node.md): the block discriminator (`type`)
MUST be present, core block types MUST satisfy their per-type schemas,
and `marketing:*`-namespaced blocks MUST match the regex
`^marketing:[a-z][a-z0-9-]*$`. Bindings MUST validate each block
against these constraints before emitting; any violation produces a
placeholder block and a build warning.

Every block emitted by component-contract extraction MUST set
`metadata.extracted_via: "component-contract"`. The binding MUST add
this field automatically; authors MUST NOT be required to set it
inside `extract`. A block whose extracted output already carries
`metadata.extracted_via` set to a different value MUST be rejected and
substituted with a placeholder; the field is binding-owned.

## Failure modes

When extraction fails — `extract` throws, returns malformed output,
returns blocks that violate the per-block contract, or returns a
Promise — the binding MUST emit a `marketing:placeholder` block with
the following metadata:

- `extracted_via: "component-contract"`,
- `extraction_status: "failed"`,
- `extraction_method` reflecting the actual mode used,
- `error` (optional, ≤ 200 characters, MUST NOT include stack traces,
  filesystem paths beyond the source file basename, environment
  variables, or strings matching the secret-pattern set described in
  [security.md](./wire-format/security.md)),
- `component` (optional component name),
- `location` (optional source location).

The binding MUST emit a build warning to stderr or the generator's log
channel at the same time. Bindings MUST install their framework's
error-boundary mechanism so that render continues past the failed
component and descendants can still contribute their contracts.

When extraction is **partial** — `extract` returns a block that
satisfies the per-type REQUIRED fields but is missing optional
fields — the binding MUST emit the partial block with
`metadata.extraction_status: "partial"`. When the REQUIRED set is not
satisfied, the binding falls back to placeholder emission.

## Security posture

The build-time `extract` function runs in the main JS context — there
is no sandbox in v0.2. Producers SHOULD review every `extract` they
ship the same way they review any other build-time code. Hostile or
buggy contracts can read environment variables and filesystem paths.

The `extract` function MUST be supplied only with props that came from
build-time data sources (markdown frontmatter, CMS API responses
fetched at build time, message catalogues, generator config). Bindings
MUST NOT pass request-scoped or user-scoped data (cookies, sessions,
headers, user IDs, tenant IDs) into `extract`, even when the binding
wraps a runtime SDK. Authors writing `extract` functions MUST treat
the props as build-time-only.

The `metadata.error` field on placeholder blocks MUST be truncated to
≤ 200 characters. Bindings MUST redact strings matching the v0.2
secret-pattern set: `Bearer `, `sk_live_[A-Za-z0-9]+`,
`AKIA[A-Z0-9]{16}`, `ghp_[A-Za-z0-9]{36}`, `xoxb-[A-Za-z0-9-]+`.
Stack traces MUST NOT be included; only the `Error.message` (truncated
and redacted) is emitted.

## React binding

The reference React binding implements the contract for React 18 and
later. It is published as `@act-spec/binding-react` (peer dependency
on `react ^18.0.0`) and exports the symbols required by the binding
interface plus React-specific declaration types (`useActContract`,
`<ActProvider>`, `<ActContractWrapper>`).

Capability declaration:

```ts
{
  "ssr-walk": true,         // canonical via react-dom/server
  "static-ast": true,        // Babel/SWC plugin scans literal contracts
  "headless-render": false,  // opt-in via @act-spec/binding-react/headless
  "rsc": true,               // server-tree-only walk under RSC
  "streaming": true,         // hooks renderToPipeableStream onAllReady
  "suspense": true,
  "concurrent": true
}
```

The canonical extraction mode is SSR-walk via `react-dom/server`'s
`renderToString` (or `renderToPipeableStream` for streaming). The
binding wraps the route in an `<ActProvider>` collector that captures
contract registrations during render and aggregates them after the
React commit phase completes. Under streaming SSR the binding waits
for React 18's `onAllReady` callback before yielding extracted
contracts.

Under React Server Components the binding walks the **server tree
only**; client-only components contribute via their static contract.
A `useActContract` call detected inside a component whose module is a
server component (per the `"use client"` boundary convention) is a
build error — the static field is the supported pattern for client
components participating in an RSC tree.

The static-AST mode (a Babel/SWC plugin) recognizes:

- `Component.act = { object literal }` assignments,
- `useActContract({ object literal })` calls inside component bodies,
- `export const act = { object literal }` on route modules.

The static-AST scanner emits no contract for declarations whose
`extract` references runtime values that the AST cannot resolve;
SSR-walk is the canonical fallback.

## Vue binding

The reference Vue binding implements the contract for Vue 3 and later.
It is published as `@act-spec/binding-vue` (peer dependency on
`vue ^3.0.0`) and exports `useActContract`, the compile-time macro
`defineActContract`, and the `<ActSection>` wrapper component. Vue 2
is out of scope for v0.2.

Capability declaration:

```ts
{
  "ssr-walk": true,         // canonical via @vue/server-renderer
  "static-ast": true,        // @vue/compiler-sfc parser plugin
  "headless-render": false,
  "rsc": false,              // no first-class RSC equivalent in v0.2
  "streaming": true,         // serverPrefetch waits for completion
  "suspense": true,
  "concurrent": true
}
```

The canonical extraction mode is SSR-walk via
`@vue/server-renderer.renderToString`. The binding installs a
`provide`/`inject` collector at the app level (component-level
providers, never global) and accumulates contracts during the SSR
render. The binding awaits Vue's `serverPrefetch` lifecycle to settle
before yielding; for `<Suspense>`-bounded async setup, the binding
waits for `Promise.all(serverPrefetchPromises)`.

The macro form `defineActContract({...})` is the preferred page-level
declaration in `<script setup>` SFCs because it integrates cleanly
with Vue's compile-time macros. The binding's Vite plugin desugars the
macro to the equivalent runtime `useActContract` call. The macro is
orthogonal to Nuxt's `definePageMeta` — both MAY appear in the same
SFC.

## Angular binding

The reference Angular binding implements the contract for Angular 17
and later. It is published as `@act-spec/binding-angular` (peer
dependency on `@angular/core ^17.0.0`) and exports
`ActContractService` (the service-based registration entry point), the
`*actSection` structural directive, and the `<act-section>` wrapper
component. Angular 16 and earlier and AngularJS are out of scope for
v0.2.

Capability declaration:

```ts
{
  "ssr-walk": true,         // canonical via @angular/platform-server
  "static-ast": true,        // TypeScript compiler API scanner
  "headless-render": false,
  "rsc": false,
  "streaming": false,        // no public streaming SSR API in Angular 17
  "suspense": false,
  "concurrent": true
}
```

The canonical extraction mode is SSR-walk via
`@angular/platform-server.renderApplication`. The binding installs the
collector service at the **component-level providers** of its
bootstrap component — never at root, which would leak per-render state
across SSR runs. Each route render uses a fresh `ApplicationRef` and
`EnvironmentInjector` to scope state.

Because Angular's SSR pipeline does not expose a public streaming API,
the binding satisfies the streaming-completion requirement by awaiting
`ApplicationRef.isStable`'s first `true` emission before yielding
collected contracts. A runaway zone task that prevents stability from
emitting MUST be terminated by the generator's deadline; the binding
emits whatever contracts it has collected and warns.

The `*actSection="contract"` structural directive MUST NOT nest inside
another `*actSection` (page-contract nesting prohibition); the binding
emits a build error at registration time.

## Examples

### A page-level contract aggregating descendants (React)

```tsx
// app/pricing/page.tsx
import type { PageContract } from "@act-spec/contract";

export const act: PageContract = {
  type: "landing",
  id: "pricing",
  contract_version: "0.2",
  summary: "Acme pricing tiers and plan comparison.",
  related: [{ id: "products", relation: "see-also" }],
  extract: () => ({ type: "landing" }),
};

export default function PricingPage() {
  return (
    <>
      <Hero title="Pricing" subtitle="Plans that scale with you" />
      <PricingTable tiers={tiers} />
      <FAQAccordion items={faqs} />
    </>
  );
}
```

The `<Hero>` component declares `Hero.act` (static field), the
`<PricingTable>` uses `useActContract({...})` (hook), and the
`<FAQAccordion>` uses a static field. The React binding aggregates the
three contracts in render order and emits a `landing` node with three
blocks in `content[]`.

### A component contract via the static field (any binding)

```ts
Hero.act = {
  type: "marketing:hero",
  contract_version: "0.2",
  extract: (props) => ({
    type: "marketing:hero",
    headline: props.title,
    subhead: props.subtitle,
    cta: props.ctaText
      ? { label: props.ctaText, href: props.ctaUrl ?? "#" }
      : undefined,
  }),
};
```

The emitted block satisfies the `marketing:hero` shape from
[node.md](./wire-format/node.md) and carries
`metadata.extracted_via: "component-contract"` and
`metadata.extraction_method: "ssr-walk"` automatically.

### A failure-mode placeholder

If `Hero` throws during render because a CMS field is missing, the
binding emits:

```json
{
  "type": "marketing:placeholder",
  "metadata": {
    "extracted_via": "component-contract",
    "extraction_method": "ssr-walk",
    "extraction_status": "failed",
    "error": "Cannot read properties of undefined (reading 'title')",
    "component": "Hero",
    "location": "design-system/Hero.tsx:14"
  }
}
```

Render continues past the failed component, so `<PricingTable>` and
`<FAQAccordion>` still contribute their blocks.

## Conformance

Components are an OPTIONAL feature at every conformance level. A
producer MAY emit ACT nodes without using the component contract at
all (a markdown-only or CMS-only adapter satisfies every conformance
band without it). When a producer does use the component contract:

| Requirement | Core | Standard | Strict |
|---|---|---|---|
| Canonical contract object shape | MUST | MUST | MUST |
| Three-pattern equivalence | MUST | MUST | MUST |
| Page-level aggregation in render order | MUST | MUST | MUST |
| Page-level `id` validated against ID grammar | MUST | MUST | MUST |
| Page-contract nesting prohibition | MUST | MUST | MUST |
| Placeholder on extraction failure | MUST | MUST | MUST |
| `metadata.extracted_via` auto-stamped | MUST | MUST | MUST |
| `metadata.extraction_method` auto-stamped | MUST | MUST | MUST |
| `marketing:*` block emission | OPTIONAL | OPTIONAL | OPTIONAL |
| Variant emission | OPTIONAL | OPTIONAL | OPTIONAL |
| Variant matrix ≤ 64 per page | MUST when emitting | MUST when emitting | MUST when emitting |
| Truncated, secret-redacted `metadata.error` | MUST | MUST | MUST |
| `extract` MUST NOT receive request-scoped data | MUST | MUST | MUST |

Consumers are unaffected by component-contract internals: the wire
format they see is the same node and block envelopes documented in
[node.md](./wire-format/node.md). Consumers MUST tolerate
`marketing:placeholder` blocks (they are a documented block type) and
MUST tolerate the `metadata.extraction_method` field as an open
metadata key.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

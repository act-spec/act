---
title: Programmatic adapter
spec: act-spec
spec-version: 0.2.0
status: Normative (first-party reference adapter)
last-updated: 2026-05-03
---

# Programmatic adapter

> The programmatic adapter is the lowest-level escape hatch: producers
> implement a small interface that yields ACT nodes directly,
> bypassing any specific CMS or file-format mapping. This document
> pins the factory API, the per-emission validation contract, the
> error-handling policy, and the source-attribution semantics every
> custom programmatic adapter MUST satisfy.

## Status

This is a **first-party reference adapter** distributed as
`@act-spec/adapter-programmatic`. The contract is normative. The
adapter is a *wrapper*: it accepts user-supplied `enumerate` and
`transform` functions and turns them into a conformant adapter that
the generator can compose with packaged adapters in a multi-source
build.

## When to choose programmatic

- A hand-curated catalog where each item is computed from multiple
  sources (a SKU file plus inventory data plus a CMS reference).
- A sitemap of dynamic pages whose URLs are produced by a custom
  routing function.
- A SaaS-internal data source whose backing store is a proprietary
  database.
- A build-time computation that derives content from a generative
  pipeline.
- A bridge to a CMS for which no first-party adapter exists yet.

If a packaged adapter exists for the source system (Contentful,
Sanity, Storyblok, Strapi, Builder, WordPress, Notion, Markdown),
prefer that adapter. Programmatic emission lacks the field-mapping,
rich-text conversion, sync, and locale fan-out semantics the packaged
adapters provide.

## Factory API

The package exports a factory function:

```ts
export function defineProgrammaticAdapter<TConfig = void, TItem = unknown>(
  spec: ProgrammaticAdapterSpec<TConfig, TItem>,
): Adapter<TConfig, TItem>;
```

The returned adapter satisfies the framework's adapter contract. The
spec shape is:

```ts
interface ProgrammaticAdapterSpec<TConfig, TItem> {
  name?: string;                                 // default "programmatic"
  precheck?(config: TConfig): Promise<void>;     // optional
  init?(config: TConfig, ctx: AdapterContext): Promise<AdapterCapabilities>;
  enumerate(ctx: AdapterContext):
    AsyncIterable<TItem> | Iterable<TItem> | TItem[];
  transform(item: TItem, ctx: AdapterContext):
    Promise<EmittedNode | null> | EmittedNode | null;
  delta?(since: string, ctx: AdapterContext): AsyncIterable<TItem>;
  dispose?(ctx: AdapterContext): Promise<void> | void;
  capabilities?: AdapterCapabilities;            // declared once; init MAY override
  strict?: boolean;                              // see "Strict mode" below
  namespaceIds?: boolean;                        // default true
  validate?: "before-emit" | "off";              // default "before-emit"
}
```

The user supplies AT LEAST `enumerate` and `transform`. All other
fields are optional. When `init` is omitted, the factory's `init`
returns `spec.capabilities` (or a default `AdapterCapabilities` per
the level-declaration rules below). When `dispose` is omitted, the
factory's `dispose` is a no-op.

A convenience shorthand for static-array sources:

```ts
export function defineSimpleAdapter<TItem>(spec: {
  name?: string;
  items: TItem[];
  transform: (item: TItem, ctx: AdapterContext) => EmittedNode | null;
}): Adapter<void, TItem>;
```

`defineSimpleAdapter` wraps `defineProgrammaticAdapter` with
`enumerate: () => spec.items`.

## Per-emission validation

By default (`validate: "before-emit"`), the factory validates every
emitted node against the wire-format node schema AND every content
block against its applicable block schema before passing the node to
the framework:

- For full-node emissions: validate the envelope, then validate each
  block in the `content[]` array per its `type`
  (`markdown`/`prose`/`code`/`data`/`callout`/`marketing:*`).
- For partial emissions (carrying `_actPartial: true`): validate that
  `id` is present and conforms to the node-ID grammar; if a partial
  supplies a `content` array, each block is also validated.
- For `null` returns (deliberate skip): no validation.

Validation failure is unrecoverable: the build fails non-zero with
an error message citing the node's `id` (when present), the offending
block's index in `content[]` (when block-level), and the specific
schema violation. When `validate: "off"` is set, the factory skips
validation but emits a build warning at `init` flagging the operator's
opt-out.

## Mutation guards

The factory enforces the framework's invariants on user code:

- `Object.freeze`s the `ctx.config` object before passing to user
  code; mutation attempts surface a runtime error.
- `ctx.emit` is NOT exposed to user code by default — emission is
  via the `transform` return value. Advanced cases needing
  mid-`transform` fan-out can opt in by setting
  `spec.allowImperativeEmit: true`.
- The lifecycle order pinned by the adapter contract is enforced
  externally; user code MUST NOT call back into `enumerate` from
  inside `transform` and MUST NOT mutate other adapters' emitted
  nodes.

## Source attribution

Every emitted node carries `metadata.source.adapter` set to the
spec's `name` (default `"programmatic"`). This lets the framework's
`metadata.source.contributors` audit trail attribute fields back to
user code, distinguishing it from packaged adapters in a multi-source
build.

When two programmatic adapters are configured in the same build,
each MUST have a distinct `name`; identical names produce a
configuration warning at `init`.

## Capability declaration

The user supplies an `AdapterCapabilities` object via `spec.capabilities`
(or returns one from `init`). The factory does NOT auto-promote level —
the user declares what their content satisfies. Common shapes:

```ts
// A Standard programmatic adapter that emits article-shaped nodes:
{ level: "standard", concurrency_max: 4 }

// A Strict programmatic adapter with marketing blocks:
{
  level: "strict",
  concurrency_max: 8,
  manifestCapabilities: { etag: true, subtree: true },
  componentContract: false,
}

// A secondary programmatic adapter contributing partials:
{ level: "strict", precedence: "fallback", concurrency_max: 1 }
```

The factory periodically samples emissions (every Nth node, default
N=20) for level consistency. When a Strict-declared adapter emits
zero `marketing:*` blocks across the sample, the factory surfaces a
build warning. Deeper conformance probing is owned by the validator
package.

## Namespacing

By default (`namespaceIds: true`), the factory namespaces user-emitted
IDs under `<spec.name>/<user-id>`. Users opting out
(`namespaceIds: false`) accept responsibility for collision avoidance
across the multi-source merge.

The factory MUST validate emitted IDs against the node-ID grammar
before emission; ID grammar violations are unrecoverable.

## Strict mode

By default, errors thrown from user code during `transform` are
**recoverable**: the factory catches the throw, emits a partial node
with `metadata.extraction_status: "failed"` and
`metadata.extraction_error` describing the cause, and the build
continues with a warning.

`spec.strict: true` promotes `transform`-throw to **unrecoverable**:
the throw propagates and the build fails non-zero. Strict mode is
recommended for high-stakes Strict deployments where partial-output
silence is undesirable. Other warning sources (capability mismatch,
ID drift) are NOT promoted by `strict` — they remain informational
so `strict` cannot mask configuration mistakes that need human
attention.

## Failure surface

- **Recoverable**: user `transform` throws (default mode) → partial
  node with `extraction_status: "failed"`; user emits a node missing
  optional fields covered by defaults.
- **Unrecoverable** (always):
  - User `enumerate` throws (no items can be processed).
  - User `init` throws.
  - User code emits a malformed node (envelope or block) caught by
    the per-emission validator.
  - User code emits an ID that violates the grammar.
  - User code attempts to mutate `ctx.config`.
  - With `strict: true`: user `transform` throws.

## Conformance target

The programmatic adapter is a **wrapper**; the level the resulting
adapter declares is determined entirely by the user-supplied content.
The factory's own invariants (schema validation, source attribution,
mutation guards) apply at every level.

- A user emitting only Core-shaped content declares
  `level: "core"`.
- A user emitting `prose`/`code`/`callout`/`data` blocks plus
  `summary` from authored fields declares `level: "standard"`.
- A user emitting `marketing:*` blocks plus multi-locale fan-out
  declares `level: "strict"`.

## Lifecycle

The factory wraps user-supplied functions:

- `precheck(config)` — passed through if user-supplied; no-op
  otherwise.
- `init(config, ctx)` — runs user `init` if supplied; otherwise
  returns `spec.capabilities` or a default `{ level: "core",
  concurrency_max: 8 }`.
- `enumerate(ctx)` — passed through; the factory normalizes
  array / iterable / async-iterable returns to a single async
  iterable.
- `transform(item, ctx)` — runs user `transform`, then validates
  (when `validate !== "off"`), then attaches
  `metadata.source.adapter` if not already set.
- `delta(since, ctx)` — passed through if user-supplied.
- `dispose(ctx)` — runs user `dispose` if supplied; no-op otherwise.
  Idempotent.

## Examples

An e-commerce catalog computed from a SKU file plus an inventory API:

```ts
import { defineProgrammaticAdapter } from "@act-spec/adapter-programmatic";

export default defineProgrammaticAdapter({
  name: "shop-catalog",
  capabilities: { level: "standard", concurrency_max: 4 },
  async *enumerate(ctx) {
    const skus = await readSkuFile(ctx.config.skuPath);
    for (const sku of skus) yield sku;
  },
  async transform(sku, ctx) {
    const inventory = await fetchInventory(sku.id);
    return {
      act_version: ctx.config.actVersion,
      id: `products/${sku.slug}`,
      type: "product",
      title: sku.name,
      summary: sku.shortDescription,
      content: [
        { type: "prose", format: "markdown", text: sku.longDescription },
      ],
      metadata: {
        in_stock: inventory.qty > 0,
        price_cents: sku.priceCents,
      },
    };
  },
});
```

A Strict adapter contributing only metadata (a partial-emission
contributor):

```ts
import { defineProgrammaticAdapter } from "@act-spec/adapter-programmatic";

export default defineProgrammaticAdapter({
  name: "review-aggregator",
  capabilities: {
    level: "strict",
    precedence: "fallback",
    concurrency_max: 8,
  },
  async *enumerate(ctx) {
    yield* await fetchReviewSummaries();
  },
  async transform(reviewSummary) {
    return {
      id: `products/${reviewSummary.slug}`,
      _actPartial: true,
      metadata: {
        review_avg: reviewSummary.average,
        review_count: reviewSummary.count,
      },
    };
  },
});
```

## Open questions / extension points

- **Sandboxed user code.** The factory runs user code in the build's
  main process with no sandbox. A v0.3 ASP could add a worker-thread
  isolate option for hostile-input deployments.
- **`validate` hook for user-side custom validation** — additive ASP
  candidate; for now users throw from `transform` to signal custom
  failures.
- **`delta` shorthand** comparing item arrays across runs — additive
  ASP candidate; for now users supply their own implementation.

## Sources

- `../wire-format/node.md` for the node envelope grammar.
- `../wire-format/etag.md` for ETag derivation (the generator
  computes; the adapter MAY pre-compute).
- `./i18n.md` for partial-node composition with the i18n adapter.

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

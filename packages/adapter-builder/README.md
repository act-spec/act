# @act-spec/adapter-builder

Builder.io adapter for ACT (Agent Content Tree). Consumes the Builder.io
Content API and emits ACT envelopes against the shared adapter framework
(`@act-spec/adapter-framework`). Two emission modes:

- **pass-through** — wraps the raw Builder tree in a single
  `marketing:builder-page` block carrying `payload`. Lossless for downstream
  Builder rendering.
- **extraction** — walks Builder primitives (`Text`, `Image`, `Button`,
  `CustomCode`, `Section`, `Symbol`) into `prose` / `code` / `marketing:*`
  blocks per a configured mapping.

Other behaviors: public-key kind validation (private keys are rejected with
a redacted error), draft / published version selection, optional locale
fan-out via Builder targeting, opt-in experiment / variant emission,
reference resolution with cycle tolerance, Symbol recursion bound,
`lastUpdated` delta marker, and HMAC-SHA256 webhook signature verification.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-builder": "workspace:*" } }
```

For out-of-tree hand-test, run `pnpm pack` inside `packages/adapter-builder`
and install the resulting tarball locally.

## Usage

```ts
import { createBuilderAdapter } from '@act-spec/adapter-builder';

const adapter = createBuilderAdapter({
  config: {
    apiKey: process.env.BUILDER_PUBLIC_KEY!,
    model: 'page',
    mode: 'extraction',
    referenceDepth: 2,
    symbolRecursionMax: 2,
  },
});
```

Pass-through mode keeps the Builder payload intact for the host renderer:

```ts
const adapter = createBuilderAdapter({
  config: { apiKey, model: 'page', mode: 'pass-through' },
});
```

Webhook signatures:

```ts
import { verifyWebhookSignature } from '@act-spec/adapter-builder';

const ok = verifyWebhookSignature(rawBody, headers['x-builder-signature'], secret);
```

## Conformance / what's tested

Every public API has a citing test in `src/builder.test.ts`. The
conformance gate runs `@act-spec/validator` against the bundled
`test-fixtures/` corpus and fails on any structural gap or capability-band
mismatch.

```bash
pnpm -F @act-spec/adapter-builder conformance
```

## Configuration (selected)

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | (required) | Public API key. Private keys are rejected. |
| `model` | `'page'` | Builder model name. |
| `mode` | `'extraction'` | `'pass-through'` keeps the raw Builder tree. |
| `referenceDepth` | `2` | Reference resolution depth (0–3). |
| `symbolRecursionMax` | `2` | Symbol recursion bound (1–3). |
| `concurrency` | `4` | Adapter framework parallelism. |
| `version` | `'published'` | `'draft'` selects unpublished content. |
| `locale` | `undefined` | Enables locale fan-out via Builder targeting. |

## Compatibility

No Builder SDK peer dependency; the adapter speaks HTTP to the Builder
Content API directly.

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>

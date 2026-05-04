# @act-spec/adapter-sanity

Sanity adapter for ACT (Agent Content Tree). Consumes the Sanity Content
Lake (GROQ + Portable Text) and emits ACT envelopes against the shared
adapter framework (`@act-spec/adapter-framework`). Supports content-type
and field mapping, Portable Text → block conversion, reference resolution
with cycle detection, locale fan-out, and Sanity transaction-ID delta.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-sanity": "workspace:*" } }
```

## Usage

```ts
import { createSanityAdapter } from '@act-spec/adapter-sanity';

const adapter = createSanityAdapter({
  config: {
    projectId: process.env.SANITY_PROJECT_ID!,
    dataset: 'production',
    apiToken: { from_env: 'SANITY_TOKEN' },
    apiVersion: '2024-10-01',
    perspective: 'published',
    mappings: {
      article: {
        type: 'article',
        title: 'title',
        summary: 'summary',
        body: { from: 'body', as: 'portableText' },
      },
    },
  },
});
```

The Portable Text walker is exposed standalone:

```ts
import { walkPortableText } from '@act-spec/adapter-sanity';

const blocks = walkPortableText(doc.body, ctx);
```

## Conformance / what's tested

Every public API has a citing test in `src/sanity.test.ts` covering
Portable Text → block conversion, reference cycle detection, locale
fan-out, and transaction-ID delta. The conformance gate runs
`@act-spec/validator` against the bundled fixtures.

```bash
pnpm -F @act-spec/adapter-sanity conformance
```

## Configuration (selected)

| Option | Default | Notes |
| --- | --- | --- |
| `projectId` | (required) | Sanity project identifier. |
| `dataset` | (required) | Dataset name (e.g. `'production'`). |
| `apiToken` | (required) | Inline string OR `{ from_env: 'NAME' }`. |
| `apiVersion` | `'2024-10-01'` | Sanity API version pin. |
| `perspective` | `'published'` | Or `'previewDrafts'` / `'raw'`. |
| `mappings` | `{}` | Content-type → field-mapping DSL. |
| `concurrency` | `4` | Adapter framework parallelism. |

## Peer dependencies

Optional peers; install when consuming the live Sanity client:

| Peer | Range |
| --- | --- |
| `@sanity/client` | `^6.22.0` |
| `@portabletext/types` | `^2.0.13` |

The Portable Text walker only uses `@portabletext/types`; the live client
peer is only needed when wiring the adapter to a real Sanity dataset.

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>

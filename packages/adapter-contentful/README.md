# @act-spec/adapter-contentful

Contentful adapter for ACT (Agent Content Tree). Consumes the Contentful
Content Delivery API and emits ACT envelopes against the shared adapter
framework (`@act-spec/adapter-framework`). Supports a field-mapping DSL,
Rich Text → block conversion, locale fan-out, and sync-API delta.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-contentful": "workspace:*" } }
```

For out-of-tree hand-test, run `pnpm pack` inside
`packages/adapter-contentful` and install the resulting tarball locally.

## Usage

```ts
import { createContentfulAdapter } from '@act-spec/adapter-contentful';

const adapter = createContentfulAdapter({
  config: {
    spaceId: process.env.CONTENTFUL_SPACE_ID!,
    accessToken: { from_env: 'CONTENTFUL_CDA_TOKEN' },
    environment: 'master',
    mappings: {
      blogPost: {
        type: 'article',
        title: 'fields.title',
        summary: 'fields.summary',
        body: { from: 'fields.body', as: 'richtext' },
      },
    },
    locales: { available: ['en-US', 'fr-FR'] },
  },
});
```

Rich Text conversion is exposed standalone for callers that already have
a Contentful entry in hand:

```ts
import { richTextToBlocks } from '@act-spec/adapter-contentful';

const blocks = richTextToBlocks(entry.fields.body, ctx);
```

## Conformance / what's tested

Every public API has a citing test in `src/contentful.test.ts`. Inline
`accessToken` triggers a one-time warning; the `{ from_env }` form is the
spec-preferred shape. The conformance gate runs `@act-spec/validator`
against the bundled `test-fixtures/` corpus.

```bash
pnpm -F @act-spec/adapter-contentful conformance
```

## Configuration (selected)

| Option | Default | Notes |
| --- | --- | --- |
| `spaceId` | (required) | Contentful space identifier. |
| `accessToken` | (required) | Inline string OR `{ from_env: 'NAME' }` (preferred). |
| `environment` | `'master'` | Contentful environment. |
| `mappings` | `{}` | Content-type → field-mapping DSL. |
| `locales.available` | `[]` | Locale fan-out. |
| `concurrency` | `4` | Adapter framework parallelism. |

## Peer dependencies

`@contentful/rich-text-types` is bundled (used for the Rich Text walker).
No Contentful SDK peer; the adapter speaks HTTP to the CDA directly.

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>

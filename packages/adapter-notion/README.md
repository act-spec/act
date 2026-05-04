# @act-spec/adapter-notion

Notion adapter for ACT (Agent Content Tree). Consumes the
[Notion API](https://developers.notion.com) (`databases.query`,
`pages.retrieve`, `blocks.children.list`) and emits ACT envelopes against the
shared adapter framework (`@act-spec/adapter-framework`).

- Database -> branch ACT node (`type: 'collection'` by default).
- Page     -> leaf ACT node (`type: 'article'` by default).
- Block tree -> ACT prose / code / callout / data blocks.
- Per-page locale extraction from a configurable Notion property
  (default: a `select` named `Locale`).

## Install

```bash
pnpm add @act-spec/adapter-notion
```

The adapter has zero runtime dependencies outside the ACT workspace
packages. HTTP traffic uses the global `fetch`.

## Usage

```ts
import { notionAdapter } from '@act-spec/adapter-notion';
import { runAdapter } from '@act-spec/adapter-framework';

const adapter = notionAdapter();

await runAdapter(
  adapter,
  {
    accessToken: { from_env: 'NOTION_TOKEN' },
    databaseId: 'abcd1234abcd1234abcd1234abcd1234',
    properties: { tags: 'Tags' },
    locale: { property: 'Locale', default: 'en-US' },
  },
  ctx, // your AdapterContext
);
```

To run against recorded API responses (tests, deterministic CI):

```ts
import { notionAdapter, corpusProvider } from '@act-spec/adapter-notion';

const adapter = notionAdapter({ corpus: { database, pages, pageBlocks } });
```

## Notion API version

Pinned to `Notion-Version: 2022-06-28` (Notion's current stable as of this
release). Override via `notionApiVersion` in the config when Notion ships a
newer stable that you want to opt in to.

## Authentication

Pass a Notion integration token via:

- `accessToken: { from_env: 'NOTION_TOKEN' }` — preferred; the adapter reads
  the env var at `init()` time.
- `accessToken: '<raw token>'` — accepted but logged with a warning.

The token is sent as `Authorization: Bearer <token>` on every request.

The integration must be invited to the database (Notion Settings ->
Connections -> Add) or the API returns `404` and the adapter throws
`NotionAdapterError({ code: 'database_not_found' })`.

## Block-type coverage

| Notion block type          | ACT block                                |
| -------------------------- | ---------------------------------------- |
| `paragraph`                | `prose` (`format: 'plain'`)              |
| `heading_1` / `_2` / `_3`  | `prose` with `level: 1 / 2 / 3`          |
| `bulleted_list_item`       | grouped run -> single `prose:markdown`   |
| `numbered_list_item`       | grouped run -> single `prose:markdown`   |
| `to_do`                    | grouped run -> single `prose:markdown`   |
| `code`                     | `code` (with `language`)                 |
| `quote`                    | `callout` (`variant: 'quote'`)           |
| `divider`                  | `data` (`shape: 'divider'`)              |
| _anything else_            | `text` block with `notion_type` recorded |

Unknown block types are deliberately preserved in a `text` fallback so the
emitted tree remains lossless at the block level. Each unmapped type is
also surfaced as a warning on the adapter logger.

## Configuration

| Option              | Default              | Notes                                                                                    |
| ------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `accessToken`       | (required)           | Inline string OR `{ from_env: 'NOTION_TOKEN' }`.                                          |
| `databaseId`        | (required)           | Notion database UUID.                                                                    |
| `databaseType`      | `'collection'`       | ACT type for the branch envelope.                                                        |
| `pageType`          | `'article'`          | ACT type for leaf envelopes.                                                             |
| `databaseTitle`     | (Notion title)       | Override the branch title.                                                               |
| `databaseSummary`   | (Notion description) | Override the branch summary.                                                             |
| `properties.title`  | first `type:'title'` | Notion property name to read as the page title.                                          |
| `properties.summary`| (none)               | Notion property name to read as the page summary (rich-text).                            |
| `properties.tags`   | (none)               | Notion property name (`select` or `multi_select`) to map to ACT `tags`.                  |
| `locale.property`   | `'Locale'`           | Notion property name. Reads `select` / `multi_select` / `rich_text`.                     |
| `locale.default`    | (none)               | Default to stamp when the property is missing / empty.                                   |
| `idStrategy.namespace` | `'cms'`           | ID prefix. Emitted ids look like `<namespace>/[<locale>/]<page-uuid>`.                   |
| `apiBaseUrl`        | `https://api.notion.com` | Override Notion API host.                                                            |
| `notionApiVersion`  | `2022-06-28`         | Override Notion API version header.                                                      |
| `concurrency.transform` | `4`              | Adapter framework transform parallelism.                                                 |

## Conformance

Conformance target: `standard`.

Every public API is exercised by a citing test in `src/notion.test.ts`
(block-tree -> prose, locale extraction, integration-token auth header,
config-validation error paths, full adapter pipeline against a recorded
corpus). The conformance gate runs `@act-spec/validator` against the
adapter's emitted nodes.

```bash
pnpm -F @act-spec/adapter-notion conformance
```

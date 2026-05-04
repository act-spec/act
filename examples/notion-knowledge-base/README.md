# Notion knowledge base — ACT example

A runnable example that mirrors a Notion database into [ACT (Agent Content Tree)](https://act-spec.org) static artefacts. The corpus lives in `test-fixtures/` as recorded Notion API responses, so the build is reproducible and never touches the network.

## Quickstart

```sh
pnpm install
pnpm -F @act-spec/example-notion-knowledge-base conformance
```

`conformance` runs `build` then `validate`:

- `build` reads the fixture corpus, runs the `@act-spec/adapter-notion` adapter through the `@act-spec/generator-core` pipeline, and writes the static ACT layout under `public/`.
- `validate` walks `public/` with `@act-spec/validator` at the `standard` conformance level and exits non-zero on any gap.

To browse the output locally:

```sh
pnpm -F @act-spec/example-notion-knowledge-base start
# serves public/ on http://localhost:8083
curl http://localhost:8083/.well-known/act.json
```

## What it shows

- **Notion adapter wired with a recorded corpus.** `scripts/build.ts` calls `notionAdapter({ corpus })` against the fixture JSON in `test-fixtures/`. The same adapter, configured with a real Notion integration token (`{ from_env: 'NOTION_TOKEN' }`) and database id, produces byte-equivalent output against the live Notion API; only the provider wiring changes.
- **Database -> branch + page -> leaf mapping.** The Notion database becomes the root branch node (`type: collection`); every database row becomes a leaf node (`type: article`). The branch's `children[]` lists every leaf id in deterministic order.
- **Block-tree to ACT prose.** Notion blocks (`heading_2`, `paragraph`, `bulleted_list_item`, `numbered_list_item`, `code`) are converted into a single prose block per page, preserving headings, lists, and fenced code blocks.
- **Locale extraction from a Notion property.** Notion has no native locale field. The adapter reads a configurable `Locale` select property; the fixture has pages in both `en-US` and `es-ES`, which both round-trip into emitted `metadata.locale`.
- **Static artefacts at conformance level `standard`.** The pipeline emits the manifest, index, per-node files, subtrees, build-report sidecar, and the `/llms.txt` + `/llms-full.txt` back-compat surface in a single pass.

## How to run

```sh
# from the repo root
pnpm install

# run the build
pnpm -F @act-spec/example-notion-knowledge-base build

# validate emitted output
pnpm -F @act-spec/example-notion-knowledge-base validate

# both at once (typical CI gate)
pnpm -F @act-spec/example-notion-knowledge-base conformance

# typecheck the example
pnpm -F @act-spec/example-notion-knowledge-base typecheck
```

## Verifying ACT output

After `build`, the `public/` directory contains:

```
public/
  .well-known/
    act.json                   manifest (entry point for AI agents)
  act/
    index.json                 flat index of every node
    nodes/
      kb/<database-uuid>.json    the database root (collection)
      kb/en-us/<page-uuid>.json  one per en-US row (locale prefix is lowercased in the path; metadata.locale preserves the canonical case)
      kb/es-es/<page-uuid>.json  one per es-ES row
    subtrees/
      <root-id>.json           root subtree (depth 2)
  llms.txt                     back-compat (auto-emitted)
  llms-full.txt                back-compat (auto-emitted)
  .act-build-report.json       operator-facing build report sidecar
```

Useful spot checks:

```sh
# manifest
jq . public/.well-known/act.json

# the database root node and one of its rows
jq . public/act/nodes/kb/*.json

# every locale that survived the adapter pass
jq -r '.[] | .metadata.locale' public/act/nodes/kb/**/*.json
```

A green run prints:

```
Notion knowledge-base conformance: OK — gaps: 0;
  declared.level: standard; achieved.level: standard;
  delivery: static; nodes: 6; locales: en-US, es-ES.
```

## Pointing at a real Notion workspace

Swap the corpus-backed provider for the HTTP provider in `scripts/build.ts`:

```ts
const adapterConfig: NotionAdapterConfig = {
  accessToken: { from_env: 'NOTION_TOKEN' },
  databaseId: process.env.ACT_NOTION_DB!,
  properties: { title: 'Name', summary: 'Summary', tags: 'Tags' },
  locale: { property: 'Locale', default: 'en-US' },
};

const config: GeneratorConfig = {
  // ...same shape as in the fixture build...
  adapters: [
    {
      adapter: notionAdapter(),       // <-- no `corpus`; uses httpProvider
      config: adapterConfig as unknown as Record<string, unknown>,
      actVersion: '0.1',
    },
  ],
};
```

Then:

```sh
NOTION_TOKEN=secret_… ACT_NOTION_DB=<database-uuid> \
  pnpm -F @act-spec/example-notion-knowledge-base build
```

The integration must be granted access to the database in Notion. Never commit the token.

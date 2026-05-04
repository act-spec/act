# @act-spec/adapter-i18n

i18n adapter for ACT (Agent Content Tree). Reads message catalogs for the
configured i18n library (`next-intl`, `react-intl`, `i18next`) from the
filesystem and emits partial nodes carrying ACT i18n metadata
(`metadata.locale`, `metadata.translations`, `metadata.translation_status`,
`metadata.fallback_from`) keyed against IDs that a primary content adapter
(markdown, Contentful, programmatic, etc.) emits.

The adapter declares `precedence: "fallback"` so the primary adapter's
scalar fields survive the merge step. Filesystem fixtures only — no live
i18n service calls.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-i18n": "workspace:*" } }
```

## Usage

```ts
import { createI18nAdapter } from '@act-spec/adapter-i18n';

const adapter = createI18nAdapter({
  config: {
    library: 'next-intl',
    messagesDir: './messages',
    locales: { available: ['en', 'fr', 'de'], default: 'en' },
    targetLevel: 'strict',
  },
});
```

The adapter requires `targetLevel: "strict"` and at least two locales.
Catalog detection is exposed standalone for tests and tooling:

```ts
import { detectLibraryLayout, loadLocaleCatalog } from '@act-spec/adapter-i18n';

const layout = await detectLibraryLayout('./messages', 'next-intl');
const catalog = await loadLocaleCatalog(layout, 'fr');
```

## Conformance / what's tested

Every public API has a citing test in `src/i18n.test.ts`, covering
library-layout detection (`next-intl`/`react-intl`/`i18next`), BCP-47
normalization, fallback derivation, and the merge precedence contract
against the Contentful adapter. The conformance gate runs
`@act-spec/validator` against the bundled fixtures.

```bash
pnpm -F @act-spec/adapter-i18n conformance
```

## Configuration (selected)

| Option | Default | Notes |
| --- | --- | --- |
| `library` | (required) | One of `'next-intl' \| 'react-intl' \| 'i18next'`. |
| `messagesDir` | (required) | Path to the i18n catalog directory. |
| `locales.available` | (required) | Minimum two locales. |
| `locales.default` | (required) | Default locale; used for `fallback_from`. |
| `targetLevel` | (required) | Must be `'strict'`. |
| `concurrency` | `4` | Adapter framework parallelism. |

## Compatibility

Composes with any primary adapter that emits stable IDs. Tested against
`@act-spec/adapter-contentful` (used as a dev-dependency in tests).

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>

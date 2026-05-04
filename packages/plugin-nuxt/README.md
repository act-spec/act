# @act-spec/plugin-nuxt

Nuxt module for ACT (Agent Content Tree). Wraps the ACT generator pipeline
(`@act-spec/generator-core`) against Nuxt 3+ static export
(`nuxt generate`). Detects Nuxt Content + `@nuxtjs/i18n` when present and
wires their data into the pipeline; otherwise runs over the configured
adapters.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/plugin-nuxt": "workspace:*" } }
```

## Usage

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@act-spec/plugin-nuxt'],
  act: {
    conformanceTarget: 'core',
    manifest: { siteName: 'Acme' },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
    },
  },
});
```

The module runs after `nuxt generate` finishes and emits the ACT file
set into the configured Nitro public directory.

Programmatic API (test harnesses, custom orchestration):

```ts
import { runActBuild, resolveConfig, detectI18n } from '@act-spec/plugin-nuxt';

const resolved = resolveConfig(opts, nuxtLike);
const i18n = detectI18n(nuxtLike);
const report = await runActBuild(resolved, { i18n });
```

## Conformance / what's tested

Every public API has a citing test in the package's test suite, including
the Nuxt version gate (`isNuxtVersionSupported`), the `isGenerateMode`
discriminator (the module is a no-op outside `nuxt generate`), Nuxt
Content + `@nuxtjs/i18n` detection, the route filter, and the
build-report write path. The conformance gate runs `@act-spec/validator`
against the emitted file set.

```bash
pnpm -F @act-spec/plugin-nuxt conformance
```

## Configuration (selected)

| Option | Default | Notes |
| --- | --- | --- |
| `urlTemplates` | (required) | `indexUrl` + `nodeUrlTemplate`. |
| `manifest` | (required) | Manifest seed. |
| `conformanceTarget` | `'core'` | `'core' \| 'standard' \| 'strict'`. |
| `outputDir` | Nitro public dir | Override per `resolveOutputDir`. |
| `routes` | (Nuxt's prerender routes) | Filter via `applyRouteFilter`. |
| `bindings` | `[vueBinding]` | Defaults to the Vue binding. |

## Peer dependencies

| Peer | Range |
| --- | --- |
| `nuxt` | `>=3.0.0 <5.0.0` |
| `@nuxt/kit` | `>=3.0.0 <5.0.0` |
| `vue` | `>=3.4 <4` |

All peers are optional from npm's perspective; the module is a no-op
without Nuxt.

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Vue binding: [`@act-spec/component-vue`](../component-vue)
- Repository: <https://github.com/act-spec/act>

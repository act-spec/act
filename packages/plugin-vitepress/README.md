# @act-spec/plugin-vitepress

VitePress plugin for ACT (Agent Content Tree). Wraps the ACT generator
pipeline (`@act-spec/generator-core`) against VitePress 1.x / 2.x via the
`transformPageData` (per-page) and `buildEnd` (final emit) hooks. The
markdown adapter is consumed unchanged from `@act-spec/adapter-markdown`.

VitePress's `locales` config is read at `transformPageData` time and
threaded into the ACT locale tree. The plugin emits `/llms.txt` and
`/llms-full.txt` by default; opt out via `emit.llmsTxt: false` /
`emit.llmsFullTxt: false`.

## Install

```sh
pnpm add -D @act-spec/plugin-vitepress
```

## Usage

```ts
// .vitepress/config.ts
import { defineConfig } from 'vitepress';
import { actPlugin } from '@act-spec/plugin-vitepress';

const act = actPlugin({
  baseUrl: 'https://example.com',
  manifest: { site: { name: 'Example Docs' } },
  urlTemplates: { indexUrl: '/act/index.json', nodeUrlTemplate: '/act/n/{id}.json' },
});

export default defineConfig({
  title: 'Example Docs',
  transformPageData: act.transformPageData,
  buildEnd: act.buildEnd,
});
```

After `vitepress build`, the ACT file set lands inside VitePress's
`outDir` (default `.vitepress/dist/`):

- `/.well-known/act.json` — manifest
- `/act/index.json` — index
- `/act/nodes/*.json` — per-node files
- `/llms.txt`, `/llms-full.txt` — back-compat surfaces (default-on)

## Configuration

| Option              | Default      | Notes                                                      |
| ------------------- | ------------ | ---------------------------------------------------------- |
| `baseUrl`           | (required)   | Site origin; used as `manifest.site.canonical_url`.        |
| `manifest`          | (required)   | `{ site: { name } }` minimum.                              |
| `urlTemplates`      | (required)   | `indexUrl` + `nodeUrlTemplate`.                            |
| `conformanceTarget` | `'standard'` | `'core' \| 'standard' \| 'strict'`.                        |
| `outputDir`         | VitePress's `outDir` | Override target dir for ACT artifacts.            |
| `parseMode`         | `'coarse'`   | `'fine'` requires `conformanceTarget >= "standard"`.       |
| `emit.llmsTxt`      | `true`       | Set `false` to skip `/llms.txt`.                            |
| `emit.llmsFullTxt`  | `true`       | Set `false` to skip `/llms-full.txt`.                       |
| `adapters`          | auto-wired   | Replaces the default markdown adapter.                     |
| `hooks`             | none         | `preBuild` / `postBuild` / `onError`.                      |

## Peer dependencies

| Peer        | Range            |
| ----------- | ---------------- |
| `vitepress` | `^1.0.0 \|\| ^2.0.0` |

Optional from npm's perspective; the plugin is a no-op without VitePress.

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Markdown adapter: [`@act-spec/adapter-markdown`](../adapter-markdown)
- Repository: <https://github.com/act-spec/act>

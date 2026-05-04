# @act-spec/plugin-astro

Astro integration for ACT (Agent Content Tree). Wraps the ACT generator pipeline as an Astro integration so an Astro site can emit a conformant ACT file set alongside its static build.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/plugin-astro": "workspace:*" } }
```

## Usage

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import act from '@act-spec/plugin-astro';
import { markdown } from '@act-spec/adapter-markdown';

export default defineConfig({
  integrations: [
    act({
      output: { dir: 'public/act' },
      manifest: { site: { name: 'Example' } },
      adapters: [markdown({ rootDir: './src/content' })],
    }),
  ],
});
```

See [`examples/astro-docs/`](../../examples/astro-docs) for a complete project.

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Repository: <https://github.com/act-spec/act>

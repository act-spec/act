# @act-spec/plugin-remix

Remix-Vite static-export generator for ACT (Agent Content Tree).

Public surface: `act(options)` — a Vite plugin that runs the canonical generator pipeline from Vite's `closeBundle` hook (client build only) after `remix vite:build` finishes prerendering. Add it to `vite.config.ts` alongside Remix's `vitePlugin`.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/plugin-remix": "workspace:*" } }
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { vitePlugin as remix } from '@remix-run/dev';
import { act } from '@act-spec/plugin-remix';

export default defineConfig({
  plugins: [
    remix(),
    act({
      manifest: { site: { name: 'Example' } },
      conformanceTarget: 'standard',
    }),
  ],
});
```

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Repository: <https://github.com/act-spec/act>

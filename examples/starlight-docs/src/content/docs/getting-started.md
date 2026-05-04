---
title: Getting started
description: Install the ACT Astro plugin alongside Starlight and ship structured content on your next build.
summary: Install the ACT Astro plugin alongside Starlight and ship structured content on your next build.
type: tutorial
parent: root
related:
  - reference/configuration
  - reference/cli
---

# Getting started

This page walks through the two-file change that takes a vanilla
Starlight site to a Starlight site that also publishes an ACT tree.

## Install

```sh
pnpm add @act-spec/plugin-astro @act-spec/adapter-markdown
```

## Wire it up

Add the ACT integration *after* the Starlight integration in
`astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default defineConfig({
  site: 'https://your-site.example',
  integrations: [
    starlight({ title: 'Your Docs' }),
    act({
      level: 'standard',
      site: { name: 'Your Docs' },
      adapters: [
        {
          adapter: createMarkdownAdapter(),
          config: { sourceDir: './src/content/docs', mode: 'fine', targetLevel: 'standard' },
          actVersion: '0.1',
        },
      ],
    }),
  ],
});
```

## Build

```sh
pnpm build
```

`dist/` now contains both the Starlight HTML site and the ACT artifact
set under `dist/.well-known/` and `dist/act/`.

Move on to [Configuration](./reference/configuration.md) for the full
option surface.

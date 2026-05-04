---
title: ACT Starter Docs
description: Minimal Astro Starlight starter that ships an ACT tree alongside its HTML build.
summary: Minimal Astro Starlight starter that ships an ACT (Agent Content Tree) alongside its HTML build.
type: index
children:
  - getting-started
  - reference/configuration
  - reference/cli
template: doc
---

# ACT Starter Docs

This is a tiny Astro [Starlight](https://starlight.astro.build) site
demonstrating how to drop ACT (Agent Content Tree) into an existing
Starlight project.

The build emits the normal Starlight HTML site **and** a conformant ACT
artifact set (`/.well-known/act.json`, `/act/`, `/llms.txt`,
`/llms-full.txt`) — all in one `astro build`.

## What's here

- A handful of markdown pages under `src/content/docs/`.
- One French page under `src/content/docs/fr/` to show the i18n shape.
- A single `astro.config.mjs` registering both `@astrojs/starlight` and
  `@act-spec/plugin-astro`.

Read [Getting started](./getting-started.md) for the install + config
walkthrough.

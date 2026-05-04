---
title: Configuration
description: Configure the ACT integration's conformance level, URL templates, and adapter list.
summary: Configure the ACT integration's conformance level, URL templates, and adapter list.
type: reference
parent: root
related:
  - getting-started
  - reference/cli
---

# Configuration

The `act()` integration accepts a single options object.

## `level`

Conformance band the build targets. One of `'core'`, `'standard'`,
`'strict'`. Defaults to `'core'`. This starter declares `'standard'` so
the produced manifest carries `conformance.level: "standard"`.

## `site`

Identity block written into `.well-known/act.json` under `site`.

```js
act({ site: { name: 'Your Docs', canonical_url: 'https://docs.example' } })
```

When `canonical_url` is omitted, the integration falls back to Astro's
`config.site`.

## `urlTemplates`

Where the ACT artifacts live, relative to the site root. Defaults are
shown below; override only if you serve the tree from a non-default
path.

```js
urlTemplates: {
  indexUrl: '/act/index.json',
  nodeUrlTemplate: '/act/nodes/{id}.json',
  subtreeUrlTemplate: '/act/subtrees/{id}.json',
}
```

## `adapters`

The list of source adapters the pipeline consumes. Most Starlight sites
need exactly one — `createMarkdownAdapter()` pointed at
`src/content/docs/`.

See [CLI](./cli.md) for the post-build inspection commands.

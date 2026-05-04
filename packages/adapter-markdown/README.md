# @act-spec/adapter-markdown

Filesystem markdown adapter for ACT (Agent Content Tree). Walks a content
directory of `.md` / `.mdx` files, parses front-matter, and emits ACT
envelopes against the shared adapter framework
(`@act-spec/adapter-framework`).

This is the canonical first-party adapter for static-site setups (Astro,
Eleventy, Docusaurus) where authors write markdown by hand.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-markdown": "workspace:*" } }
```

## Usage

```ts
import { markdown } from '@act-spec/adapter-markdown';

const adapter = markdown({
  rootDir: './content',
});
```

Wire it into a generator config:

```ts
import { defineConfig } from '@act-spec/cli';
import { markdown } from '@act-spec/adapter-markdown';

export default defineConfig({
  output: { dir: 'public/act' },
  manifest: { site: { name: 'Example' } },
  adapters: [markdown({ rootDir: './content' })],
});
```

See [`examples/eleventy-blog/`](../../examples/eleventy-blog) and [`examples/astro-docs/`](../../examples/astro-docs) for complete projects.

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>

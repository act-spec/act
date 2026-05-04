---
title: Quickstart
description: Drop ACT into an existing project, or bootstrap a new one with create-act-app.
summary: Drop ACT into Astro, Next.js, VitePress, Nuxt, Eleventy, or Docusaurus with one config block — or scaffold a fresh project with npm create act-app@latest.
type: tutorial
---

ACT works as a build-time plugin in every supported framework. The output is
the same regardless of stack: a `.well-known/act.json` discovery document plus
typed JSON envelopes under `/act/`.

## Have an existing project?

Pick your framework. Each plugin reads your existing markdown / collection /
content source and emits ACT alongside the normal build output — no parallel
content tree, no duplication.

### Astro

```bash
pnpm add @act-spec/plugin-astro @act-spec/adapter-markdown
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default defineConfig({
  integrations: [
    act({
      level: 'standard',
      site: { name: 'My Site' },
      adapters: [
        {
          adapter: createMarkdownAdapter(),
          config: { sourceDir: './src/content/docs', mode: 'fine' },
        },
      ],
    }),
  ],
});
```

Run `astro build` and you'll find the manifest at
`dist/.well-known/act.json` and the index at `dist/act/index.json`.

### Next.js

```bash
pnpm add @act-spec/plugin-nextjs @act-spec/adapter-markdown
```

```js
// next.config.mjs
import withAct from '@act-spec/plugin-nextjs';

export default withAct({
  act: {
    level: 'standard',
    site: { name: 'My Site' },
    sourceDir: './content',
  },
})({
  reactStrictMode: true,
});
```

### VitePress

```bash
pnpm add @act-spec/plugin-vitepress
```

```js
// .vitepress/config.ts
import { defineConfig } from 'vitepress';
import act from '@act-spec/plugin-vitepress';

export default defineConfig({
  title: 'My Site',
  vite: { plugins: [act({ level: 'standard' })] },
});
```

### Other frameworks

- **Nuxt** — [`@act-spec/plugin-nuxt`](/spec/v0.2/generators/nuxt/)
- **Eleventy** — [`@act-spec/plugin-eleventy`](/spec/v0.2/generators/eleventy/)
- **Docusaurus** — [`@act-spec/plugin-docusaurus`](/spec/v0.2/generators/docusaurus/)
- **Remix** — [`@act-spec/plugin-remix`](/spec/v0.2/generators/remix/)

## No project yet?

Bootstrap a runnable example with the project generator:

```bash
npm create act-app@latest
```

You'll be prompted to pick from the [examples gallery](/examples/) — pick one
that matches your stack, give it a name, and the generator copies the example
into a fresh directory with `^0.2.0` deps swapped in.

To pre-select an example:

```bash
npm create act-app@latest -- --template astro-docs my-docs
```

## Try it with your AI agent

Once your site emits ACT, any MCP-capable agent can browse it. The fastest
path is the hosted MCP server — see the
[homepage](/#try-act-with-your-ai-agent) for the copy-paste config block.
For self-hosted MCP, see the
[`hybrid-static-runtime-mcp`](https://github.com/act-spec/act/tree/main/examples/hybrid-static-runtime-mcp)
example.

## Verify conformance

Run the validator against your built site:

```bash
npx @act-spec/cli actree validate ./dist
```

Or hit the hosted validator at
[validator.act-spec.org](https://act-spec.github.io/act/validator/).

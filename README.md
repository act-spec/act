# ACT — the Agent Content Tree

An open standard for publishing structured, AI-discoverable content from any website, CMS, or app.

The web is full of content that AI agents can read but can't *understand* the structure of: which pages are siblings, what type of content lives where, which version is canonical, what locale a translation falls back to. ACT fixes that by sitting on top of your existing site as a small set of well-known JSON files (or live HTTP endpoints) that any agent can crawl in O(1) lookups instead of brittle HTML scraping.

## Why ACT

- **Drop-in adoption** — one plugin per stack (Astro, Next, Nuxt, VitePress, Eleventy, Docusaurus, Remix). No content rewrite, no new CMS, no new build pipeline.
- **Set-and-forget** — emits `.well-known/act.json` plus a typed JSON tree on every build, alongside your normal site output. When your content changes, ACT changes with it.
- **One spec / every stack** — TypeScript and Go reference implementations share one wire format and one conformance test suite. Community adapters are welcome on the same contract.
- **Conformance-first** — schema-validated wire format with three conformance levels (Core / Standard / Strict) and a public test suite. Every official adapter and generator passes the same validator that consumers run.

## Quick start

Drop a plugin into your existing build, ship one config block, and ACT files emit alongside your normal output on the next build. No content rewrite. No new CMS. No runtime cost (unless you opt into runtime mode).

Three of the most common stacks are below. The full set of examples — Nuxt, Eleventy, Docusaurus, Remix, programmatic, runtime, hybrid — lives in [`examples/`](./examples).

### Astro

```bash
pnpm add @act-spec/plugin-astro @act-spec/adapter-markdown
```

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default defineConfig({
  site: 'https://your-site.dev',
  integrations: [
    act({
      level: 'standard',
      site: { name: 'Your Site' },
      adapters: [
        {
          adapter: createMarkdownAdapter(),
          config: { sourceDir: './src/content/docs', mode: 'fine', targetLevel: 'standard' },
          actVersion: '0.2',
        },
      ],
    }),
  ],
});
```

Full pattern: [`examples/astro-docs`](./examples/astro-docs).

### Next.js

```bash
pnpm add @act-spec/plugin-nextjs
```

```ts
// next.config.mjs — wrap your existing config with `withAct`
import { withAct } from '@act-spec/plugin-nextjs';

export default withAct(
  {
    output: 'export',
    // ...your existing Next config
  },
  {
    manifest: { site: { name: 'Your Site' } },
    conformanceTarget: 'standard',
  },
);
```

Full pattern: [`examples/nextjs-marketing`](./examples/nextjs-marketing).

### VitePress

```bash
pnpm add @act-spec/plugin-vitepress
```

```ts
// .vitepress/config.ts
import { defineConfig } from 'vitepress';
import act from '@act-spec/plugin-vitepress';

export default defineConfig({
  vite: { plugins: [act()] },
});
```

Full pattern: [`examples/vitepress-docs`](./examples/vitepress-docs).

After the build runs, the following appear at the site root:

- `/.well-known/act.json` — manifest pointing to the index, declared capabilities, conformance level, and version
- `/act/index.json` — flat enumeration of every node (summary-level entries; full bodies live elsewhere)
- `/act/subtrees/{id}.json` — **the load-bearing primitive for progressive disclosure.** One file per inner node with children. Each subtree carries the root in full plus every descendant as a summary-only entry (`content: []`). Agents walk `subtree → subtree → … → node` recursively; bodies are fetched lazily per-node only when an agent decides what to read.
- `/act/nodes/{id}.json` — one file per node, full body included
- `/llms.txt` and `/llms-full.txt` — auto-emitted for back-compat with consumers expecting those formats

Verify with:

```bash
actree validate https://your-site.dev
```

For more stacks (Nuxt, Eleventy, Docusaurus, Remix, programmatic / runtime patterns), see [Examples](#examples) below — every example is a real, runnable site with a copy-paste config.

## Don't have a project yet?

Bootstrap a new project from any of the bundled examples:

```bash
npm create act-app@latest astro-docs
# or: docusaurus-docs, nextjs-marketing, eleventy-blog, ecommerce-catalog,
#     nextjs-saas-runtime, hybrid-static-runtime-mcp, vitepress-docs,
#     starlight-docs, wordpress-blog, notion-knowledge-base
```

The bootstrapper copies the example into a new directory, rewrites `workspace:*` dependencies to the latest published versions of `@act-spec/*`, strips monorepo-only fields, and prints the next steps. Pass `--install` to auto-run the package manager. See [`examples/`](./examples) for the full gallery.

## Try it with your AI agent

Browse any ACT-emitting site from Claude Desktop, Cursor, or Continue via our MCP server. The server exposes four tools — `act_load_site`, `act_walk_subtree`, `act_get_node`, `act_search` — that let an agent navigate any ACT site without scraping HTML.

Paste this into your agent's MCP config:

```json
{
  "mcpServers": {
    "act-spec": {
      "command": "npx",
      "args": ["-y", "@act-spec/mcp-server", "https://act-spec.org"]
    }
  }
}
```

Or use the hosted instance — point any MCP-capable agent at any ACT-emitting site at `mcp.act-spec.org`. See the [docs](https://act-spec.org/quickstart#mcp).

## Examples

Each example is a real, runnable site that ACT plugs into. Pick the one closest to your stack to see how a few lines of config produce a fully-conformant ACT tree. Every example is wired up with the same conformance gate that runs in CI — `pnpm -F <example> conformance` validates the built ACT output against the spec.

| Example | Stack | What it shows |
| --- | --- | --- |
| [astro-docs](./examples/astro-docs) | Astro 4 + markdown | Minimal documentation site — the smallest possible ACT integration. |
| [docusaurus-docs](./examples/docusaurus-docs) | Docusaurus 3 | Large docs site (200–500 pages, deep sidebar hierarchy). |
| [nextjs-marketing](./examples/nextjs-marketing) | Next.js 14 + Contentful + next-intl | Localized marketing site pulling from a headless CMS, with React component-level content extraction. |
| [eleventy-blog](./examples/eleventy-blog) | Eleventy 2 + markdown | Chronological blog with drafts and frontmatter-driven summaries. |
| [ecommerce-catalog](./examples/ecommerce-catalog) | Programmatic adapter | 500-SKU product catalog generated directly from a database/API — no markdown, no CMS. |
| [nextjs-saas-runtime](./examples/nextjs-saas-runtime) | Next.js runtime | Multi-tenant B2B SaaS workspace serving ACT live, with per-tenant identity scoping. |
| [hybrid-static-runtime-mcp](./examples/hybrid-static-runtime-mcp) | CLI + Next.js runtime + MCP | Marketing site (static) + app (runtime) + an MCP bridge serving both to AI agents. |
| [vitepress-docs](./examples/vitepress-docs) | VitePress 1.x | Docs site, plugin-vitepress, with a second locale. |
| [wordpress-blog](./examples/wordpress-blog) | WordPress (REST API) | Blog sourced from a baked WP REST fixture via adapter-wordpress. |
| [notion-knowledge-base](./examples/notion-knowledge-base) | Notion API | Knowledge base sourced from a Notion API fixture via adapter-notion. |
| [starlight-docs](./examples/starlight-docs) | Astro Starlight | Minimal Starlight starter (the act-spec.org website is itself a Starlight + ACT site). |

## Packages

ACT ships as a focused set of TypeScript packages — grouped by purpose below. Use the ones you need; ignore the rest. A Go reference implementation ships alongside the TS one and shares the same conformance fixtures — see [`go/`](./go).

**Core**:

- [`@act-spec/core`](./packages/core) — wire-format types and shared utilities
- [`@act-spec/validator`](./packages/validator) — `act-validate` CLI + library
- [`@act-spec/inspector`](./packages/inspector) — `act-inspect` CLI for crawling and inspecting ACT trees

**CLI**:

- [`@act-spec/cli`](./packages/cli) — provides the `actree` binary (validate, inspect, flatten, build)

**Adapters** — pull content from where you keep it:

- [`@act-spec/adapter-markdown`](./packages/adapter-markdown) — markdown / MDX
- [`@act-spec/adapter-contentful`](./packages/adapter-contentful) — Contentful
- [`@act-spec/adapter-sanity`](./packages/adapter-sanity) — Sanity
- [`@act-spec/adapter-storyblok`](./packages/adapter-storyblok) — Storyblok
- [`@act-spec/adapter-strapi`](./packages/adapter-strapi) — Strapi
- [`@act-spec/adapter-builder`](./packages/adapter-builder) — Builder.io
- [`@act-spec/adapter-i18n`](./packages/adapter-i18n) — next-intl / react-intl / i18next
- [`@act-spec/adapter-programmatic`](./packages/adapter-programmatic) — your database, API, or anywhere else
- [`@act-spec/adapter-framework`](./packages/adapter-framework) — shared adapter contract + helpers
- [`@act-spec/adapter-wordpress`](./packages/adapter-wordpress) — WordPress REST API
- [`@act-spec/adapter-notion`](./packages/adapter-notion) — Notion API

**Generators / framework plugins** — drop into your existing build:

- [`@act-spec/generator-core`](./packages/generator-core) — pipeline framework shared by every plugin
- [`@act-spec/plugin-astro`](./packages/plugin-astro) — Astro integration (also covers Starlight)
- [`@act-spec/plugin-docusaurus`](./packages/plugin-docusaurus) — Docusaurus plugin
- [`@act-spec/plugin-nextjs`](./packages/plugin-nextjs) — Next.js wrapper (`withAct`)
- [`@act-spec/plugin-nuxt`](./packages/plugin-nuxt) — Nuxt module
- [`@act-spec/plugin-remix`](./packages/plugin-remix) — Remix static export
- [`@act-spec/plugin-eleventy`](./packages/plugin-eleventy) — Eleventy plugin
- [`@act-spec/plugin-vitepress`](./packages/plugin-vitepress) — VitePress plugin

**Runtime SDK** — serve ACT live from your app instead of pre-building:

- [`@act-spec/runtime-core`](./packages/runtime-core) — core runtime types and helpers
- [`@act-spec/runtime-next`](./packages/runtime-next) — Next.js bindings
- [`@act-spec/runtime-express`](./packages/runtime-express) — Express middleware
- [`@act-spec/runtime-fetch`](./packages/runtime-fetch) — any WHATWG `fetch`-compatible runtime

**Component-level extraction** — pull structured content out of your React / Vue / Angular components:

- [`@act-spec/component-contract`](./packages/component-contract) — shared component contract
- [`@act-spec/component-react`](./packages/component-react) — React bindings
- [`@act-spec/component-vue`](./packages/component-vue) — Vue bindings
- [`@act-spec/component-angular`](./packages/component-angular) — Angular bindings

**Tooling**:

- [`@act-spec/mcp-bridge`](./packages/mcp-bridge) — expose any ACT site as an MCP server (self-host pattern)
- [`@act-spec/mcp-server`](./packages/mcp-server) — universal MCP server: point at any ACT URL and serve it to any MCP-capable agent
- [Hosted validator SPA](./apps/validator-web) — drop a manifest into a browser, get a report

## The spec

The ACT specification lives at [`spec/v0.2/`](./spec/v0.2/) in this repo and is rendered at [act-spec.org/spec/v0.2/](https://act-spec.org/spec/v0.2/). The wire-format JSON Schemas are in [`schemas/`](./schemas/). Conformance fixtures are in [`fixtures/`](./fixtures/).

Spec changes go through the [ASP process](./spec/proposals/) (ACT Spec Proposal) — public PRs against the spec, modeled on Rust RFCs and MCP SEPs. Each ASP gets a number, a public discussion thread, and a recorded decision; merges are gated on a BDFL accept and at least one round of public review.

If you're implementing ACT in a language other than TypeScript or Go, the spec, schemas, and fixtures are everything you need. Spec-only adapter mappings for Hugo, MkDocs, and Jekyll are at [`spec/v0.2/adapters/`](./spec/v0.2/adapters/).

## Status

v0.2 is the **first public release** of ACT.

- Conformance gate runs on every PR (every example, every adapter, every plugin).
- npm publishes are OIDC-signed with provenance — the npm tarball links back to the GitHub commit and workflow run that produced it.
- A W3C Community Group submission is filed during the RC phase.

## Why ACT vs llms.txt and llms-full.txt

ACT is a strict superset, not a replacement.

ACT plugins auto-emit `/llms.txt` and `/llms-full.txt` for back-compat with consumers that expect those formats. ACT itself adds typed nodes, hierarchy, i18n, schema validation, runtime mode, component-level extraction, and conformance levels — useful when your site has more structure than a single file can express. For small static sites, `/llms.txt` alone is fine; for a production product site with locales, versions, and structure that matters to agents, ACT carries the extra signal.

See [`spec/v0.2/why-act.md`](./spec/v0.2/why-act.md) and [act-spec.org/why-act](https://act-spec.org/why-act) for the full comparison table and the interop story.

## Requirements

- Node.js ≥ 20.18
- pnpm ≥ 10 (for the monorepo / examples)
- Any package manager (`npm`, `pnpm`, `yarn`, `bun`) for consuming `@act-spec/*` packages in your own project

## License

- Code: [Apache-2.0](./LICENSE) — every package in `packages/`, every example, every adapter, the website, the validator and inspector tools.
- Specification text: [CC BY 4.0](./LICENSE-spec) — `spec/`, the JSON Schemas, conformance fixtures, and the rendered docs at `act-spec.org/spec/v0.2/`.

## Contributing

ACT is BDFL-led with a public ASP process for normative spec changes. See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and [GOVERNANCE.md](./GOVERNANCE.md) for how decisions get made. All commits require DCO sign-off (`git commit -s`). For vulnerabilities, see [SECURITY.md](./SECURITY.md) — please report privately, not via public issues.

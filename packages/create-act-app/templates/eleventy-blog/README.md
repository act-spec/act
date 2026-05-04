# Eleventy blog with ACT

A flat chronological [Eleventy 2.x](https://www.11ty.dev) blog with markdown posts, a synthetic chronological index, draft handling, and an ACT tree generated alongside the HTML build.

If you're already running an Eleventy blog, this is the smallest possible integration: install one package, register it as an Eleventy plugin, build as normal.

## The stack

- **Eleventy 2.x** with the default `_site/` output
- **Markdown posts** under `posts/` (filename pattern `YYYY-MM-DD-slug.md`)
- **`@act-spec/plugin-eleventy`** registered via `addPlugin`
- **`@act-spec/adapter-markdown`** auto-wired against Eleventy's input dir — no manual wiring needed

## How ACT plugs in

`@act-spec/plugin-eleventy` hooks into Eleventy's `eleventy.after` build event. After Eleventy renders your HTML, the plugin walks Eleventy's template registry, builds an ACT tree, and writes the JSON envelopes into `_site/.well-known/` and `_site/act/`.

Drafts (frontmatter `permalink: false`) are dropped from the ACT tree automatically, mirroring how Eleventy treats them in the HTML build.

```
_site/
├── index.html              # your blog's home page
├── posts/...               # rendered post HTML
├── .well-known/act.json    # discovery manifest
└── act/
    ├── index.json
    ├── nodes/<id>.json
    └── subtrees/posts.json # the chronological subtree
```

There's nothing to configure per post. Frontmatter you already have (`title`, `description`, `date`) feeds the ACT envelopes; ACT regenerates on every `eleventy` build.

## Quick start (your project)

Add ACT to your existing Eleventy blog in **two steps**:

**1. Install:**

```sh
pnpm add @act-spec/plugin-eleventy @act-spec/adapter-markdown
```

**2. Register the plugin in `eleventy.config.mjs`:**

```js
import actPlugin from '@act-spec/plugin-eleventy';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(actPlugin, {
    conformanceTarget: 'standard',
    baseUrl: 'https://your-blog.example',
    manifest: { site: { name: 'Your Blog' } },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
    },
    parseMode: 'fine',
  });

  return { dir: { input: '.', output: '_site' } };
}
```

`eleventy` now emits `_site/.well-known/act.json` and `_site/act/...` alongside your blog's HTML.

## Run this example

```sh
pnpm install                                       # from the repo root

# View the human-facing site (Eleventy dev server with HMR)
pnpm -F @act-spec/example-eleventy-blog dev        # http://localhost:8080

# Build everything to _site/
pnpm -F @act-spec/example-eleventy-blog build

# Validate the ACT output
pnpm -F @act-spec/example-eleventy-blog validate
pnpm -F @act-spec/example-eleventy-blog conformance # build + validate
```

## What the corpus shows

- 30 published posts spanning April–September 2026, plus an `index.md`, `about.md`, and a chronological `posts.md` index.
- One draft post (`posts/2026-06-01-draft-deep-dive.md`) with `permalink: false`. The plugin drops it from the ACT output — verify by inspecting `_site/act/index.json`.
- Per-post frontmatter `description` populates the ACT summary; posts without one fall back to extracted prose.

# @act-spec/website

Astro Starlight homepage for ACT (Agent Content Tree). Deploys to
[`act-spec.org`](https://act-spec.org) (via GitHub Pages, custom domain
configured in `public/CNAME`).

The site eats its own dogfood: it registers
[`@act-spec/plugin-astro`](../../packages/plugin-astro) so that every build
emits ACT artifacts at `dist/.well-known/act.json` and `dist/act/` alongside
the rendered HTML.

## Status

v0.2 internal candidate. Not deployed publicly until Phase 3 of the v0.2
release plan flips the Pages workflow to push-triggered.

## Differences from `examples/starlight-docs/`

`examples/starlight-docs/` is a **tiny minimal starter** — meant to be cloned
or scaffolded via `npm create act-app@latest`. This package is the **full
homepage** for the project, with marketing pages, the rendered v0.2 spec,
the examples gallery, the blog, and the governance + community pages.

## Layout

```
apps/website/
├── astro.config.mjs            # Starlight + @act-spec/plugin-astro
├── conformance.ts              # post-build conformance gate
├── package.json
├── public/
│   ├── CNAME                   # act-spec.org
│   ├── favicon.svg
│   └── robots.txt
├── scripts/
│   ├── sync-spec.mjs           # mirrors ../../spec/v0.2/
│   └── sync-spec-integration.mjs
└── src/
    ├── assets/logo.svg
    ├── components/             # Hero, FeatureRow, MCPConfigSnippet, …
    ├── content/
    │   ├── config.ts           # Starlight + blog collections
    │   ├── docs/               # marketing + spec content
    │   │   ├── index.mdx       # / homepage
    │   │   ├── quickstart.mdx
    │   │   ├── why-act.md
    │   │   ├── community.md
    │   │   └── spec/v0.2/      # mirrored at build time (gitignored)
    │   └── blog/               # /blog/* posts
    ├── pages/
    │   ├── examples.astro      # /examples — programmatic gallery
    │   ├── governance.astro    # /governance — renders ../../GOVERNANCE.md
    │   └── blog/[...slug].astro
    └── styles/site.css
```

## Spec content

The canonical spec lives at `../../spec/v0.2/`. It is mirrored into
`src/content/docs/spec/v0.2/` by `scripts/sync-spec.mjs`, which runs as an
Astro integration on `astro:config:setup` (covers both `dev` and `build`).
The mirrored directory is `.gitignore`d — edit the spec under
`spec/v0.2/`, not under `src/content/docs/spec/`.

## Scripts

```bash
pnpm dev          # local Starlight dev server (mirrors spec on start)
pnpm build        # static build → dist/
pnpm preview      # preview the built site
pnpm conformance  # build + run @act-spec/validator over dist/
pnpm typecheck    # astro check
```

## Verification

After `pnpm build`, expected artifacts in `dist/`:

- `index.html` — homepage
- `quickstart/index.html`, `why-act/index.html`, `examples/index.html`,
  `governance/index.html`, `community/index.html`
- `spec/v0.2/index.html` and one HTML page per spec doc
- `blog/index.html` plus per-post pages
- `.well-known/act.json` — ACT manifest (the dogfood)
- `act/index.json` and `act/nodes/*.json` and `act/subtrees/*.json`
- `sitemap-index.xml` (from Starlight's bundled sitemap integration)
- `CNAME`, `robots.txt`, `favicon.svg`

`pnpm conformance` exits zero when the emitted ACT meets `standard` level
and zero gaps.

## Custom domain + DNS

`public/CNAME` contains `act-spec.org`. After GitHub Pages publish, the
CNAME triggers GitHub's custom-domain setup; Cloudflare DNS is configured
out of band (see the v0.2 release plan).

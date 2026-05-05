// next.config.mjs — Next.js config for the dev / build:site flow.
//
// This example renders a real Next.js App Router site so you can browse
// the human-facing pages alongside the ACT artifacts. ACT generation runs
// from `scripts/build.ts` (a programmatic invocation of the ACT pipeline)
// and writes into `public/.well-known/act.json` + `public/act/...` so the
// Next dev server serves both sides at the same origin.
//
// In your own Next.js project, you'd typically wrap this config with
// `withAct(...)` from `@act-spec/plugin-nextjs` to run the ACT pipeline
// as part of `next build`. See the README for that shape.
// `ACT_PAGES_BASE` (e.g. `/examples/nextjs-marketing/`) tells Next to
// serve the site under a sub-path. Next consumes `basePath` without the
// trailing slash. Combined with `output: 'export'`, the build emits a
// static `out/` we can publish to GitHub Pages. When the env var is
// unset (local `next dev` / conformance), Next serves at root.
const PAGES_BASE_RAW = process.env.ACT_PAGES_BASE ?? '';
const PAGES_BASE = PAGES_BASE_RAW.replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(PAGES_BASE.length > 0 ? { basePath: PAGES_BASE } : {}),
};

export default config;

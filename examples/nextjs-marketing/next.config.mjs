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
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
};

export default config;

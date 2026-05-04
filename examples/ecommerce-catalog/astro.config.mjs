// astro.config.mjs — Astro storefront for the ACT example.
//
// A tiny storefront whose product pages are fed by the same
// `data/products.json` dataset the ACT pipeline reads from. ACT artifacts
// are written into Astro's `public/` folder by `scripts/build.ts` so the
// dev server serves them at /.well-known/act.json + /act/* alongside the
// rendered HTML pages.
//
// In your own Astro project, you'd typically wire the @act-spec/plugin-astro
// integration into `integrations: [...]` so the ACT pipeline runs as part
// of `astro build`. See the README for that shape.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://example.com',
  output: 'static',
});

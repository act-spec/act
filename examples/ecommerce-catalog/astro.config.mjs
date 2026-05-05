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

// Honor ACT_PAGES_BASE so the same example builds locally with `/` (for
// dev + conformance) and under `/examples/ecommerce-catalog/` for the
// hosted Pages deploy. Internal links in `src/pages/**` and the Site
// layout use `import.meta.env.BASE_URL` so Astro rewrites them under
// the configured base.
const PAGES_BASE = process.env.ACT_PAGES_BASE ?? '/';

export default defineConfig({
  site: 'https://example.com',
  base: PAGES_BASE,
  output: 'static',
});

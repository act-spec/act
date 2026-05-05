// VitePress + ACT example.
//
// `@act-spec/plugin-vitepress` returns a plain object exposing the two
// VitePress build hooks the ACT pipeline needs:
//
//   - `transformPageData` — accumulates per-page metadata (incl. locale)
//   - `buildEnd`          — runs the ACT pipeline once over the full set
//
// The markdown adapter (`@act-spec/adapter-markdown`) is auto-wired
// against VitePress's resolved `srcDir` — no separate adapter wiring
// needed for the default file-system layout.
import { defineConfig } from 'vitepress';
import { actPlugin } from '@act-spec/plugin-vitepress';

const act = actPlugin({
  baseUrl: 'https://example.com',
  conformanceTarget: 'standard',
  parseMode: 'fine',
  manifest: {
    site: {
      name: 'Tinybox Docs',
      description: 'Quickstart, configuration, and reference for the Tinybox storage SDK.',
    },
  },
  urlTemplates: {
    indexUrl: '/act/index.json',
    nodeUrlTemplate: '/act/nodes/{id}.json',
    subtreeUrlTemplate: '/act/subtrees/{id}.json',
  },
});

// Honor ACT_PAGES_BASE so the same example builds locally with `/` and
// under `/examples/vitepress-docs/` for the hosted deploy. ACT artefacts
// land under `dist/.well-known/` and `dist/act/` regardless.
const PAGES_BASE = process.env['ACT_PAGES_BASE'] ?? '/';

export default defineConfig({
  title: 'Tinybox Docs',
  description: 'Quickstart, configuration, and reference for the Tinybox storage SDK.',
  base: PAGES_BASE,
  cleanUrls: true,
  lastUpdated: true,
  // Site-wide default locale; per-locale subtrees override below.
  lang: 'en-US',
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/getting-started' },
          { text: 'Reference', link: '/reference/configuration' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: 'Guide',
              items: [
                { text: 'Getting Started', link: '/guide/getting-started' },
                { text: 'Installation', link: '/guide/installation' },
                { text: 'Concepts', link: '/guide/concepts' },
              ],
            },
          ],
          '/reference/': [
            {
              text: 'Reference',
              items: [
                { text: 'Configuration', link: '/reference/configuration' },
                { text: 'CLI', link: '/reference/cli' },
                { text: 'API', link: '/reference/api' },
              ],
            },
          ],
        },
      },
    },
    es: {
      label: 'Español',
      lang: 'es-ES',
      link: '/es/',
      themeConfig: {
        nav: [{ text: 'Guía', link: '/es/guide/getting-started' }],
        sidebar: {
          '/es/': [
            {
              text: 'Guía',
              items: [
                { text: 'Primeros pasos', link: '/es/guide/getting-started' },
                { text: 'Instalación', link: '/es/guide/installation' },
              ],
            },
          ],
        },
      },
    },
  },
  // Wire the ACT plugin's two hooks into VitePress's build lifecycle.
  transformPageData: act.transformPageData,
  buildEnd: act.buildEnd,
});

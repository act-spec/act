// docusaurus.config.mjs — ACT example
//
// Drop the @act-spec/plugin-docusaurus plugin into a standard Docusaurus 3.x
// config. The plugin runs in postBuild and writes the ACT artifact set
// alongside Docusaurus' HTML output under build/.
//
// We import the plugin as an ES module and pass its factory function
// directly to the plugins[] entry — Docusaurus accepts either a string
// ("module-name") or a function form. The function form lets us load
// ESM-only plugins without going through the CJS plugin resolver.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import actDocusaurusPlugin from '@act-spec/plugin-docusaurus';

const here = path.dirname(fileURLToPath(import.meta.url));

// `ACT_PAGES_BASE` is set by `.github/workflows/pages.yml` so the
// deployed copy at `act-spec.org/examples/docusaurus-docs/` resolves
// its CSS/JS assets and internal links under that sub-path. Defaults
// to `/` for local builds (`pnpm run build:site`) and CI conformance.
const baseUrl = process.env.ACT_PAGES_BASE ?? '/';

export default {
  title: 'Tinybox SDK',
  url: 'https://example.com',
  baseUrl,
  // The ACT artefacts (`/.well-known/act.json`, `/act/index.json`,
  // `/act/nodes/*.json`, `/act/subtrees/*.json`) are emitted by the
  // `@act-spec/plugin-docusaurus` postBuild hook after Docusaurus's
  // broken-links check has already run. The check can't see them, so
  // the references in `src/pages/index.mdx` look broken at build time
  // even though they resolve correctly in the published output.
  onBrokenLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: { sidebarPath: path.join(here, 'sidebars.cjs') },
        blog: false,
        theme: { customCss: path.join(here, 'src', 'css', 'custom.css') },
      },
    ],
  ],
  plugins: [
    [
      actDocusaurusPlugin,
      {
        target: 'standard',
        parseMode: 'fine',
        urlTemplates: {
          indexUrl: '/act/index.json',
          nodeUrlTemplate: '/act/nodes/{id}.json',
          subtreeUrlTemplate: '/act/subtrees/{id}.json',
        },
        docusaurus: {
          skipBlog: true,
        },
      },
    ],
  ],
};

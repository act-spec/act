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

export default {
  title: 'Tinybox SDK',
  url: 'https://example.com',
  baseUrl: '/',
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

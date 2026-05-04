// Minimal Astro Starlight + ACT example.
//
// Two integrations work side-by-side:
//
//  - `@astrojs/starlight` renders the human-facing docs site from
//    `src/content/docs/`.
//  - `@act-spec/plugin-astro` walks the SAME markdown tree and emits an
//    ACT (Agent Content Tree) artifact set under `dist/.well-known/`,
//    `dist/act/`, and `dist/llms{,-full}.txt`.
//
// Drop both into your own Starlight site to ship AI-readable structured
// content alongside your normal HTML build.
import { defineConfig } from 'astro/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(here, 'src', 'content', 'docs');

export default defineConfig({
  site: 'https://example.com',
  output: 'static',
  integrations: [
    // Pin a sitemap version compatible with Astro 4 (Starlight would
    // otherwise auto-add its own at a version that depends on Astro 5
    // hooks). When user-supplied, Starlight skips its built-in.
    sitemap(),
    starlight({
      title: 'ACT Starter Docs',
      description: 'Minimal Astro Starlight + ACT starter.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        fr: { label: 'Français', lang: 'fr' },
      },
    }),
    act({
      level: 'standard',
      site: { name: 'ACT Starter Docs' },
      urlTemplates: {
        indexUrl: '/act/index.json',
        nodeUrlTemplate: '/act/nodes/{id}.json',
        subtreeUrlTemplate: '/act/subtrees/{id}.json',
      },
      adapters: [
        {
          adapter: createMarkdownAdapter(),
          config: {
            sourceDir: contentDir,
            mode: 'fine',
            targetLevel: 'standard',
          },
          actVersion: '0.1',
        },
      ],
    }),
  ],
});

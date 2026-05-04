// Minimal Astro + ACT example.
//
// The `act()` integration walks the markdown collection at
// `src/content/docs/`, builds an ACT tree from it, and emits the JSON
// envelopes alongside Astro's HTML output.
import { defineConfig } from 'astro/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(here, 'src', 'content', 'docs');

export default defineConfig({
  site: 'https://example.com',
  output: 'static',
  integrations: [
    act({
      level: 'standard',
      site: { name: 'Tinybox API' },
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

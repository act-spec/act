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

// Honor ACT_PAGES_BASE so the same example builds locally with `/` (for
// conformance + dev) and under `/examples/astro-docs/` for the hosted
// deploy. The ACT plugin writes to `dist/.well-known/` and `dist/act/`
// regardless of `base`, so the local walkStatic gate still works when
// the env var is unset.
const PAGES_BASE = process.env.ACT_PAGES_BASE ?? '/';

// Source markdown uses `[label](./sibling.md)` style links so the files
// stay editor-friendly. Astro emits each `<slug>.md` at `/<slug>/index.html`
// (one directory deeper than the source), so the literal `.md` href would
// 404. Rewrite relative `*.md` links to clean `*/` URLs and shift one
// directory up unless the source is itself an `index.md` (which lives at
// the same depth as its emitted output).
function rewriteMdLink(url, sourcePath) {
  if (typeof url !== 'string' || !url.endsWith('.md')) return url;
  if (/^(?:[a-z]+:|\/|#)/i.test(url)) return url;
  const isIndexSource = path.basename(sourcePath) === 'index.md';
  let next = url.slice(0, -3) + '/';
  next = next.replace(/\/index\/$/, '/');
  if (!isIndexSource) {
    if (next.startsWith('./')) next = '../' + next.slice(2);
    else next = '../' + next;
  }
  return next;
}

function remarkRewriteRelativeMdLinks() {
  return (tree, file) => {
    const sourcePath = file?.path ?? file?.history?.[0] ?? '';
    const walk = (node) => {
      if (node && node.type === 'link') node.url = rewriteMdLink(node.url, sourcePath);
      if (node && Array.isArray(node.children)) for (const c of node.children) walk(c);
    };
    walk(tree);
  };
}

export default defineConfig({
  site: 'https://example.com',
  base: PAGES_BASE,
  output: 'static',
  markdown: {
    remarkPlugins: [remarkRewriteRelativeMdLinks],
  },
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

// SPDX-License-Identifier: Apache-2.0
/**
 * Static list of ACT example sites that ship with the spec repo and are
 * deployed alongside the site-browser on GitHub Pages (see `pages.yml`
 * and `scripts/assemble-examples.mjs`). Clicking an example button
 * prefills the URL form with the example's manifest URL and triggers a
 * walk.
 *
 * The URL is root-relative so the same SPA build works on any origin
 * that hosts both the browser and the examples (act-spec.org, a fork's
 * Pages site, etc.). Local dev (`pnpm dev`) doesn't host the examples,
 * so the buttons still display but produce a network error which the
 * existing error renderer surfaces as a helpful message.
 */
export interface ActExample {
  /** URL slug under `/examples/` and the human-facing label. */
  readonly slug: string;
  /** Short blurb shown as a tooltip / aria-label. */
  readonly description: string;
}

export const ACT_EXAMPLES: readonly ActExample[] = [
  { slug: 'astro-docs', description: 'Astro + markdown docs' },
  { slug: 'docusaurus-docs', description: 'Docusaurus + sidebar synth' },
  { slug: 'ecommerce-catalog', description: 'E-commerce catalog' },
  { slug: 'eleventy-blog', description: 'Eleventy blog' },
  { slug: 'nextjs-marketing', description: 'Next.js marketing site' },
  { slug: 'notion-knowledge-base', description: 'Notion knowledge base' },
  { slug: 'starlight-docs', description: 'Starlight docs' },
  { slug: 'vitepress-docs', description: 'VitePress docs' },
  { slug: 'wordpress-blog', description: 'WordPress blog' },
];

export function exampleManifestUrl(slug: string): string {
  return `/examples/${slug}/.well-known/act.json`;
}

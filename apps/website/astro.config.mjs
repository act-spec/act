// Astro config for the ACT homepage at https://act-spec.org.
//
// Two integrations of note:
//
//   1. Starlight — Astro's docs framework. Powers the spec rendering at
//      `/spec/v0.2/*`, the why-act page, governance page, and the
//      docs-style sidebar / search / table-of-contents UX. Marketing
//      pages (`/`, `/quickstart`, `/examples`, `/blog`) live as
//      Starlight `splash` or `none` template pages or as plain Astro
//      pages outside the docs collection.
//
//   2. `@act-spec/plugin-astro` — the project's own Astro integration.
//      Walks the markdown collection at `src/content/docs/` (which
//      includes the spec mirrored from `../../spec/v0.2/` plus the
//      blog and bespoke pages) and emits the ACT artifact set into
//      `dist/.well-known/act.json` + `dist/act/`. This is the
//      eat-own-dogfood loop: the homepage publishes itself as
//      structured ACT content.
//
// Source content for the spec lives canonically at `../../spec/v0.2/`
// and is mirrored into `src/content/docs/spec/v0.2/` by
// `scripts/sync-spec.mjs`, which runs as part of the `predev` and
// `prebuild` Astro hooks via the integration below. The mirrored
// directory is gitignored — the spec source remains the single
// editable copy.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import act from '@act-spec/plugin-astro';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

import { syncSpecIntegration } from './scripts/sync-spec-integration.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDocsDir = path.join(here, 'src', 'content', 'docs');

export default defineConfig({
  site: 'https://act-spec.org',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    // Mirror `../../spec/v0.2/` into `src/content/docs/spec/v0.2/` before
    // Starlight reads the collection.
    syncSpecIntegration(),

    starlight({
      title: 'ACT',
      description:
        'Agent Content Tree — an open standard for publishing structured, AI-readable content.',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      social: {
        github: 'https://github.com/act-spec/act',
      },
      editLink: {
        baseUrl: 'https://github.com/act-spec/act/edit/main/apps/website/',
      },
      components: {
        // Custom homepage hero handled via splash template.
      },
      customCss: ['./src/styles/site.css'],
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'application/json',
            href: '/.well-known/act.json',
            title: 'ACT manifest',
          },
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Home', link: '/' },
            { label: 'Quickstart', link: '/quickstart/' },
            { label: 'Why ACT', link: '/why-act/' },
            { label: 'Examples', link: '/examples/' },
          ],
        },
        {
          label: 'Specification (v0.2)',
          autogenerate: { directory: 'spec/v0.2' },
        },
        {
          label: 'Tools',
          items: [
            { label: 'Validator', link: '/validator/' },
            { label: 'Site Browser', link: '/browser/' },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'Blog', link: '/blog/' },
            { label: 'Governance', link: '/governance/' },
            { label: 'Community', link: '/community/' },
          ],
        },
      ],
    }),

    // Eat own dogfood. The Starlight docs corpus drives the ACT artifact
    // set emitted into `dist/.well-known/` and `dist/act/`.
    act({
      level: 'standard',
      site: { name: 'ACT — Agent Content Tree' },
      urlTemplates: {
        indexUrl: '/act/index.json',
        nodeUrlTemplate: '/act/nodes/{id}.json',
        subtreeUrlTemplate: '/act/subtrees/{id}.json',
      },
      adapters: [
        {
          adapter: createMarkdownAdapter(),
          config: {
            sourceDir: contentDocsDir,
            mode: 'fine',
            targetLevel: 'standard',
          },
          actVersion: '0.1',
        },
      ],
    }),
  ],
});

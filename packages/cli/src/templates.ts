/**
 * PRD-409-R8 — `actree init` scaffolding templates.
 *
 * Three named starter templates:
 *   - `markdown`        — default; PRD-201 markdown adapter against `content/`.
 *   - `programmatic`    — PRD-208 stub emitting one example node.
 *   - `cms-contentful`  — PRD-202 stub with env-var-driven config.
 *
 * Each template lists its target files (relative paths) and contents.
 *
 * The contents below are intentionally TypeScript with the shared
 * `defineConfig(...)` helper — operators install `tsx` (or another loader)
 * to use them, matching PRD-409-R5.
 */

export type InitTemplate = 'markdown' | 'programmatic' | 'cms-contentful';

const MARKDOWN_CONFIG = `import { defineConfig } from '@act-spec/cli';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

export default defineConfig({
  conformanceTarget: 'core',
  outputDir: 'dist',
  adapters: [
    {
      adapter: createMarkdownAdapter(),
      config: { sourceDir: 'content' },
      actVersion: '0.1',
    },
  ],
  site: { name: 'My ACT site' },
});
`;

const MARKDOWN_INDEX = `---
title: Welcome
type: doc
---

This is the starter page for your ACT site. Edit \`content/index.md\` to get going.
`;

const MARKDOWN_GITIGNORE = `node_modules
dist
.act-build-report.json
`;

const PROGRAMMATIC_CONFIG = `import { defineConfig } from '@act-spec/cli';
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';

const adapter = defineProgrammaticAdapter({
  name: 'demo',
  enumerate(): Array<{ id: string; title: string }> {
    return [{ id: 'home', title: 'Hello, ACT!' }];
  },
  transform(item) {
    return {
      act_version: '0.1',
      id: item.id,
      type: 'page',
      title: item.title,
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      summary: 'A starter node emitted by the programmatic-adapter stub.',
      content: [{ type: 'markdown', text: 'Welcome to ACT.' }],
      tokens: { summary: 8, body: 4 },
    };
  },
  capabilities: { level: 'core' },
});

export default defineConfig({
  conformanceTarget: 'core',
  outputDir: 'dist',
  adapters: [{ adapter, config: {}, actVersion: '0.1' }],
  site: { name: 'My ACT site' },
});
`;

const PROGRAMMATIC_GITIGNORE = `node_modules
dist
.act-build-report.json
`;

const CONTENTFUL_CONFIG = `import { defineConfig } from '@act-spec/cli';
// PRD-202 adapter — replace with the real Contentful adapter once installed:
//   import { createContentfulAdapter } from '@act-spec/adapter-contentful';
//
// export default defineConfig({
//   conformanceTarget: 'core',
//   outputDir: 'dist',
//   adapters: [
//     {
//       adapter: createContentfulAdapter(),
//       config: {
//         space: process.env.CONTENTFUL_SPACE,
//         token: process.env.CONTENTFUL_TOKEN,
//       },
//       actVersion: '0.1',
//     },
//   ],
//   site: { name: 'My ACT site' },
// });

export default defineConfig({
  conformanceTarget: 'core',
  outputDir: 'dist',
  adapters: [],
  site: { name: 'My ACT site' },
});
`;

const CONTENTFUL_ENV_EXAMPLE = `# Contentful credentials (PRD-202).
# Copy to .env and fill in real values; do NOT commit .env.
CONTENTFUL_SPACE=
CONTENTFUL_TOKEN=
`;

const CONTENTFUL_GITIGNORE = `node_modules
dist
.act-build-report.json
.env
`;

export interface TemplateFile {
  /** Relative path under the target directory. */
  relPath: string;
  /** UTF-8 file contents. */
  contents: string;
}

export function getTemplateFiles(template: InitTemplate): TemplateFile[] {
  switch (template) {
    case 'markdown':
      return [
        { relPath: 'act.config.ts', contents: MARKDOWN_CONFIG },
        { relPath: 'content/index.md', contents: MARKDOWN_INDEX },
        { relPath: '.gitignore', contents: MARKDOWN_GITIGNORE },
      ];
    case 'programmatic':
      return [
        { relPath: 'act.config.ts', contents: PROGRAMMATIC_CONFIG },
        { relPath: '.gitignore', contents: PROGRAMMATIC_GITIGNORE },
      ];
    case 'cms-contentful':
      return [
        { relPath: 'act.config.ts', contents: CONTENTFUL_CONFIG },
        { relPath: '.env.example', contents: CONTENTFUL_ENV_EXAMPLE },
        { relPath: '.gitignore', contents: CONTENTFUL_GITIGNORE },
      ];
    default:
      // exhaustive switch — TS will error if a new template is added without a case.
      /* v8 ignore next 2 */
      throw new Error(`PRD-409-R8: unknown template "${template as string}"`);
  }
}

export function isInitTemplate(value: unknown): value is InitTemplate {
  return value === 'markdown' || value === 'programmatic' || value === 'cms-contentful';
}

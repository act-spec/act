// SPDX-License-Identifier: Apache-2.0
/**
 * SPA-side conformance gate for the site browser.
 *
 * The site-browser SPA shares its validator codepath with `@act-spec/validator`
 * and the validator-web SPA. The structural gate already lives in the
 * validator's conformance script. What this file asserts are the SPA-only
 * contracts that tests can't easily express:
 *
 *  - The page exists and is titled correctly.
 *  - The CORS notice + remediation banner are wired (PRD-600-R23 / Q8).
 *  - Schemas are seeded via `compileSchemasFromRaw` + `setCompiledSchemas`
 *    (no node:fs in the browser bundle).
 *  - The footer surfaces version + build provenance (PRD-600-R28).
 *  - All ACT block kinds have render branches (regression guard).
 *  - Related-nav and provenance rendering are wired end-to-end.
 *
 * Failures exit non-zero; the CI matrix runs `pnpm -r conformance`.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Check {
  id: string;
  description: string;
  pass: () => boolean;
}

function read(rel: string): string {
  return readFileSync(path.join(here, rel), 'utf8');
}

const indexHtml = read('index.html');
const schemasBundle = read('src/schemas-bundle.ts');
const main = read('src/main.ts');
const fetchSrc = read('src/fetch.ts');
const render = read('src/render.ts');

const checks: Check[] = [
  {
    id: 'index-html-title',
    description: 'index.html title is "ACT Site Browser".',
    pass: () => /<title>ACT Site Browser<\/title>/.test(indexHtml),
  },
  {
    id: 'PRD-600-R23-cors-banner',
    description:
      'SPA renders a top-of-page CORS limitation notice (PRD-600-R23 / Q8).',
    pass: () =>
      /CORS/.test(main) && /cors-notice/.test(main) && /drag/i.test(main),
  },
  {
    id: 'PRD-600-R23-cors-remediation',
    description:
      'SPA wires a CORS-blocked remediation banner with paste/drop guidance.',
    pass: () =>
      /cors-warning/.test(render) &&
      /drag-and-drop|drag/i.test(render) &&
      /CORS/.test(render),
  },
  {
    id: 'browser-schema-injection',
    description:
      'SPA seeds the validator schema cache from a build-time bundle (no node:fs in the browser path).',
    pass: () =>
      /compileSchemasFromRaw/.test(schemasBundle) &&
      /setCompiledSchemas/.test(schemasBundle) &&
      /import\.meta\.glob/.test(schemasBundle),
  },
  {
    id: 'PRD-600-R28-footer-metadata',
    description:
      'SPA footer surfaces ACT_VERSION, build SHA, build timestamp.',
    pass: () =>
      /ACT_VERSION/.test(main) &&
      /__SITE_BROWSER_BUILD_SHA__/.test(main) &&
      /__SITE_BROWSER_BUILD_TIMESTAMP__/.test(main),
  },
  {
    id: 'inspector-uses-validator',
    description:
      'fetch.ts and render.ts depend on @act-spec/validator (shared codepath).',
    pass: () =>
      /from '@act-spec\/validator'/.test(fetchSrc) &&
      /from '@act-spec\/validator'/.test(render),
  },
  {
    id: 'marked-only-for-prose',
    description: 'marked is imported only by render.ts (no stray markdown paths).',
    pass: () => /from 'marked'/.test(render) && !/from 'marked'/.test(main) && !/from 'marked'/.test(fetchSrc),
  },
  {
    id: 'block-render-coverage',
    description:
      'render.ts references all ACT block kinds (prose, data, callout, code).',
    pass: () =>
      /'prose'/.test(render) &&
      /'data'/.test(render) &&
      /'callout'/.test(render) &&
      /'code'/.test(render),
  },
  {
    id: 'related-nav-emit',
    description:
      'render.ts emits related[] chips with data-action="goto-node".',
    pass: () => /data-action="goto-node"/.test(render),
  },
  {
    id: 'related-nav-handle',
    description:
      'main.ts handles the goto-node action on chip click.',
    pass: () => /'goto-node'/.test(main),
  },
  {
    id: 'provenance-rendered',
    description:
      'render.ts surfaces metadata.locale, translation_status, source.adapter.',
    pass: () =>
      /metadata\.locale|locale:/.test(render) &&
      /translation_status/.test(render) &&
      /adapter/.test(render),
  },
];

let failed = 0;
for (const check of checks) {
  const ok = check.pass();
  if (ok) {
    console.log(`PASS  ${check.id} — ${check.description}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${check.id} — ${check.description}`);
  }
}

if (failed > 0) {
  console.error(`\nsite-browser conformance: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nsite-browser conformance: ${checks.length} check(s) passed.`);

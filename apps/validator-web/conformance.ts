// SPDX-License-Identifier: Apache-2.0
/**
 * SPA-side conformance gate.
 *
 * The hosted validator's "function" IS validating ACT sites; the structural
 * gate already lives in `@act-spec/validator`'s conformance script. What this
 * file asserts are the SPA-only contracts that the library can't enforce:
 *
 *  - The SPA's HTML surfaces the CORS limitation prominently per
 *    PRD-600-R23 / Q8 (string match in `index.html`).
 *  - The SPA wires `compileSchemasFromRaw` + `setCompiledSchemas` so the
 *    Node-only `loadSchemas()` path is never reached (string match in
 *    `src/schemas-bundle.ts`).
 *  - The footer surfaces the bundled `act_version` and a build SHA / build
 *    timestamp per PRD-600-R28.
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
const validate = read('src/validate.ts');
const render = read('src/render.ts');

const checks: Check[] = [
  {
    id: 'PRD-600-R23-cors-banner',
    description:
      'SPA renders a top-of-page CORS limitation notice (PRD-600-R23 / Q8).',
    pass: () =>
      /CORS/i.test(main) &&
      /paste/i.test(main) &&
      /cors-notice/.test(main),
  },
  {
    id: 'PRD-600-R23-cors-remediation',
    description:
      'SPA wires a CORS-blocked remediation banner that points at paste mode.',
    pass: () =>
      /cors-warning/.test(render) &&
      /switch-to-paste/.test(render) &&
      /switch-to-paste/.test(main),
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
      'SPA footer surfaces act_version, validator version, build SHA, build timestamp.',
    pass: () =>
      /ACT_VERSION/.test(main) &&
      /VALIDATOR_VERSION/.test(main) &&
      /__VALIDATOR_WEB_BUILD_SHA__/.test(main) &&
      /__VALIDATOR_WEB_BUILD_TIMESTAMP__/.test(main),
  },
  {
    id: 'shared-validation-codepath',
    description:
      'SPA dispatches to @act-spec/validator (shared codepath; no second parser implementation).',
    pass: () =>
      /from '@act-spec\/validator'/.test(validate) &&
      /validateSite|validateManifest|validateNode/.test(validate),
  },
  {
    id: 'index-html-cors-callout',
    description: 'index.html title and entry HTML reference the validator (sanity).',
    pass: () => /<title>ACT Validator<\/title>/.test(indexHtml),
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
  console.error(`\nvalidator-web conformance: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nvalidator-web conformance: ${checks.length} check(s) passed.`);

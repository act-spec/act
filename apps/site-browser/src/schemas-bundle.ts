// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-side schema bundle.
 *
 * Vite's `import.meta.glob` statically resolves every JSON file under the
 * `@schemas` alias (resolved to `<repoRoot>/schemas/`) at build time. The
 * resulting object is keyed by source path; we strip keys and hand the array
 * to `compileSchemasFromRaw` from `@act-spec/validator`.
 *
 * This is the load-bearing seam that lets the SPA share a single code path
 * with the Node CLI and library — the Node-only `loadSchemas()` (which reads
 * from `node:fs`) is never executed in the browser build.
 */
import { compileSchemasFromRaw, setCompiledSchemas } from '@act-spec/validator';

interface RawSchema {
  $id?: string;
  [k: string]: unknown;
}

// `eager: true` inlines the JSON modules directly; no async fetch on startup.
// `import: 'default'` returns the parsed JSON object (Vite handles
// `?json` automatically for files matching `*.json`).
const modules = import.meta.glob<RawSchema>('@schemas/**/*.schema.json', {
  eager: true,
  import: 'default',
});

const RAW_SCHEMAS: readonly RawSchema[] = Object.values(modules);

let initialised = false;

/**
 * Initialise the validator's schema cache from the build-time bundle.
 * Idempotent — safe to call multiple times.
 */
export function initBrowserSchemas(): void {
  if (initialised) return;
  if (RAW_SCHEMAS.length === 0) {
    throw new Error(
      'validator-web: no schemas were bundled. Check vite.config.ts @schemas alias and import.meta.glob pattern.',
    );
  }
  setCompiledSchemas(compileSchemasFromRaw(RAW_SCHEMAS));
  initialised = true;
}

/** Number of bundled schemas — surfaced in the SPA footer for diagnostics. */
export function bundledSchemaCount(): number {
  return RAW_SCHEMAS.length;
}

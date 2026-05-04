// SPDX-License-Identifier: Apache-2.0
/**
 * Vite config for the hosted ACT validator SPA (PRD-600-R28).
 *
 * Build target: ES2022, browser, single-page bundle. Deployed to GitHub
 * Pages under `/validator/` per Q8 / PRD-600-R28; the `base` setting controls
 * asset URL rewriting at build time.
 *
 * Bundling notes:
 *  - The `schemas/` JSON files live at the repo root. We expose them to the
 *    browser via Vite's `?raw` query (resolved at build time) — the SPA's
 *    bootstrap then hands them to `compileSchemasFromRaw` from
 *    `@act-spec/validator`. The validator's Node-only `loadSchemas()` is
 *    never called in this build.
 *  - `process.env` shims fall away because the validator's browser code path
 *    never reads from it; we set `define` only for the build-time constants
 *    PRD-600-R28 surfaces in the SPA footer.
 */
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const BUILD_SHA = gitSha();
const BUILD_TIMESTAMP = new Date().toISOString();

export default defineConfig({
  // PRD-600-R28: SPA served at /validator/ on GitHub Pages.
  base: process.env['VALIDATOR_WEB_BASE'] ?? '/validator/',
  root: here,
  publicDir: path.join(here, 'public'),
  build: {
    target: 'es2022',
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5174,
  },
  // Allow Vite to read JSON via `?raw` from outside the project root.
  resolve: {
    alias: {
      '@schemas': path.join(repoRoot, 'schemas'),
    },
  },
  // Surface the build metadata that PRD-600-R28 / R29 require in the footer.
  define: {
    __VALIDATOR_WEB_BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __VALIDATOR_WEB_BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
  },
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Vite config for the v0.2 site browser SPA.
 *
 * Build target: ES2022, browser, single-page bundle. Deployed to GitHub
 * Pages under `/browser/`; the `base` setting controls asset URL rewriting
 * at build time.
 *
 * Bundling notes:
 *  - The `schemas/` JSON files live at the repo root. We expose them to the
 *    browser via Vite's `import.meta.glob` (resolved at build time) — the
 *    SPA's bootstrap then hands them to `compileSchemasFromRaw` from
 *    `@act-spec/validator`. The validator's Node-only `loadSchemas()` is
 *    never called in this build. Required for the in-browser validator-gap
 *    surfacing pass alongside walk/render.
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
  base: process.env['SITE_BROWSER_BASE'] ?? '/browser/',
  root: here,
  publicDir: path.join(here, 'public'),
  build: {
    target: 'es2022',
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5175,
  },
  // Allow Vite to read JSON via `import.meta.glob` from outside the project root.
  resolve: {
    alias: {
      '@schemas': path.join(repoRoot, 'schemas'),
    },
  },
  define: {
    __SITE_BROWSER_BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __SITE_BROWSER_BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
  },
});

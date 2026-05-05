#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Build-time helper for the GitHub Pages deployment.
//
// Iterates the static-buildable examples, copies each example's built
// artefacts into `_site/examples/<name>/`, and rewrites the manifests so
// their root-relative URL templates resolve under the deployed sub-path.
//
// Each example must already have been built by `pnpm -r conformance`
// (or equivalent) — this helper does NOT trigger builds. It assumes
// conformance has produced the dist directory listed in EXAMPLES below
// and refuses to copy if the manifest is missing.
//
// Usage:
//   node scripts/assemble-examples.mjs <site-out-dir>
//
// where <site-out-dir> is the Pages assembly root (the parent of
// `_site/examples/`).
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Single source of truth for which examples ship to GitHub Pages.
// `dist` is the example-relative folder containing `.well-known/act.json`
// + the framework-rendered HTML site after `pnpm conformance` runs.
// `humanUrlStrategy` is forwarded to `rebase-act-output.mjs` and selects
// how each node's `source.human_url` is rewritten to point at the
// deployed location:
//
//   `prefix`             — replace the placeholder origin with the public
//                          origin + sub-path. Fits frameworks that emit
//                          `<id>/index.html` (Astro, Starlight, Eleventy,
//                          Next.js with trailingSlash).
//   `prefix-strip-slash` — same, then strip the trailing `/`. Fits
//                          frameworks that emit `<id>.html` and serve via
//                          extension-less URLs (VitePress with cleanUrls
//                          on GitHub Pages).
//
// Only examples whose conformance build emits a real, runnable HTML site
// appear here — we publish exactly what the example produces, never a
// synthesized landing page. Excluded:
//
//   - notion-knowledge-base, wordpress-blog: pure-data examples, no
//     companion HTML site.
//   - docusaurus-docs: has a Docusaurus site but `docusaurus build`
//     trips a `require.resolveWeak is not a function` SSG bug under
//     Docusaurus 3.6.3 / Node 22; tracked for re-enable when upstream
//     ships the fix.
//   - hybrid-static-runtime-mcp, nextjs-saas-runtime: runtime-only,
//     require a live Node process and can't be served by Pages.
export const EXAMPLES = [
  { slug: 'astro-docs', dist: 'dist', humanUrlStrategy: 'prefix' },
  { slug: 'ecommerce-catalog', dist: 'dist', humanUrlStrategy: 'prefix' },
  { slug: 'eleventy-blog', dist: '_site', humanUrlStrategy: 'prefix' },
  { slug: 'nextjs-marketing', dist: 'out', humanUrlStrategy: 'prefix' },
  { slug: 'starlight-docs', dist: 'dist', humanUrlStrategy: 'prefix' },
  { slug: 'vitepress-docs', dist: 'docs/.vitepress/dist', humanUrlStrategy: 'prefix-strip-slash' },
];

const PUBLIC_ORIGIN = process.env.ACT_PAGES_ORIGIN ?? 'https://act-spec.org';

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error('usage: assemble-examples.mjs <site-out-dir>');
    process.exit(2);
  }
  const siteOut = path.resolve(outArg);
  const examplesOut = path.join(siteOut, 'examples');
  await fs.mkdir(examplesOut, { recursive: true });

  let assembled = 0;
  let skipped = 0;
  for (const ex of EXAMPLES) {
    const exRoot = path.join(repoRoot, 'examples', ex.slug);
    const distAbs = path.join(exRoot, ex.dist);
    const manifestPath = path.join(distAbs, '.well-known', 'act.json');
    if (!(await exists(manifestPath))) {
      console.warn(
        `assemble-examples: skipping ${ex.slug} (missing ${path.relative(repoRoot, manifestPath)} — did conformance run?)`,
      );
      skipped += 1;
      continue;
    }
    const dest = path.join(examplesOut, ex.slug);
    await fs.rm(dest, { recursive: true, force: true });
    await copyDir(distAbs, dest);
    // Refuse to publish an example whose conformance build did not emit a
    // landing page — we only deploy what the example actually produces, so
    // a missing `index.html` here means the slug URL would 404. Either
    // wire the example to emit an HTML site or drop it from EXAMPLES.
    if (!(await exists(path.join(dest, 'index.html')))) {
      console.error(
        `assemble-examples: ${ex.slug} produced no index.html under ${ex.dist}/ — this example does not ship a runnable site, so it must not be in EXAMPLES.`,
      );
      process.exit(1);
    }
    const prefix = `/examples/${ex.slug}`;
    const rebase = spawnSync(
      'node',
      [
        path.join('scripts', 'rebase-act-output.mjs'),
        dest,
        prefix,
        '--strategy',
        ex.humanUrlStrategy,
        '--public-origin',
        PUBLIC_ORIGIN,
      ],
      { cwd: repoRoot, stdio: 'inherit' },
    );
    if (rebase.status !== 0) {
      console.error(`assemble-examples: rebase failed for ${ex.slug}`);
      process.exit(rebase.status ?? 1);
    }
    assembled += 1;
  }

  // Drop a tiny landing page so `https://act-spec.org/examples/` resolves.
  const indexHtml = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>ACT Examples</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font: 16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         max-width: 48rem; margin: 0 auto; padding: 2rem 1.25rem; color: #0f172a; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .muted { color: #475569; margin-top: 0; }
  ul { padding: 0; list-style: none; }
  li { padding: 0.4rem 0; border-bottom: 1px solid #e2e8f0; }
  a { color: #0369a1; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #475569; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b1220; color: #e2e8f0; }
    .muted, code { color: #94a3b8; }
    a { color: #38bdf8; }
    li { border-bottom-color: #1e293b; }
  }
</style>
<h1>ACT examples</h1>
<p class="muted">Each example below ships its own <code>/.well-known/act.json</code> manifest.
  Open any one in the <a href="/validator/">validator</a> or the <a href="/browser/">site browser</a>.</p>
<ul>
${EXAMPLES.map(
  (e) =>
    `  <li><a href="/examples/${e.slug}/.well-known/act.json">${e.slug}</a></li>`,
).join('\n')}
</ul>
`;
  await fs.writeFile(path.join(examplesOut, 'index.html'), indexHtml);

  console.log(
    `assemble-examples: assembled=${assembled} skipped=${skipped} -> ${path.relative(process.cwd(), examplesOut)}`,
  );
  if (assembled === 0) {
    console.error('assemble-examples: no examples assembled — failing.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

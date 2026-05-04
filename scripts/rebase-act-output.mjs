#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Rewrites a built ACT site so its envelope URLs resolve when the site is
// hosted under a sub-path on a multi-tenant origin (e.g. GitHub Pages).
//
// Two URL families need rewriting:
//
//   1. Manifest URL templates (`index_url`, `node_url_template`,
//      `subtree_url_template`). Each example builds with root-relative
//      paths like `/act/index.json` so its conformance gate can validate
//      via `walkStatic`. Hosted under `/examples/<slug>/`, the leading
//      `/` resolves at the wrong origin path. Prepend the public prefix.
//
//   2. Per-node `source.human_url`. Examples bake in a placeholder origin
//      (`https://example.com`, `http://localhost:8083`, …) at build time.
//      When deployed under `/examples/<slug>/`, the HTML budget feature
//      in the site browser fetches that URL and 404s. Replace the
//      placeholder origin with `${publicOrigin}${prefix}` so the URL
//      points to the deployed HTML page.
//
// Usage:
//   node scripts/rebase-act-output.mjs <dist-dir> <public-prefix> [--strategy <s>] [--public-origin <origin>]
//
// where:
//   <public-prefix>  e.g. `/examples/astro-docs`. Trailing slash normalised.
//   --strategy       one of:
//                      `prefix`             — replace placeholder origin
//                                             with `${publicOrigin}${prefix}`
//                                             in `human_url`. (default)
//                      `prefix-strip-slash` — same, but strip trailing `/`
//                                             from the rewritten human_url
//                                             (vitepress with cleanUrls).
//                      `drop`               — strip `human_url` entirely
//                                             (examples that don't deploy
//                                             real HTML pages).
//   --public-origin  origin to splice into rewritten human_urls. Defaults
//                    to `$ACT_PAGES_ORIGIN` env var, then to empty string
//                    (which produces a root-relative human_url).
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

function parseArgs(argv) {
  const positional = [];
  const opts = { strategy: 'prefix', publicOrigin: process.env.ACT_PAGES_ORIGIN ?? '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strategy') {
      const next = argv[i + 1];
      if (next === 'prefix' || next === 'prefix-strip-slash' || next === 'drop') {
        opts.strategy = next;
      } else {
        console.error(`rebase-act-output: unknown --strategy "${next}"`);
        process.exit(2);
      }
      i += 1;
    } else if (a === '--public-origin') {
      opts.publicOrigin = argv[i + 1] ?? '';
      i += 1;
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.positional.length < 2) {
  console.error('usage: rebase-act-output.mjs <dist-dir> <public-prefix> [--strategy <s>] [--public-origin <origin>]');
  process.exit(2);
}

const distDir = path.resolve(parsed.positional[0]);
const rawPrefix = parsed.positional[1];
const prefix = normalizePrefix(rawPrefix);
const strategy = parsed.opts.strategy;
const publicOrigin = parsed.opts.publicOrigin.replace(/\/+$/, '');

function normalizePrefix(p) {
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function rebaseRootRelative(url) {
  if (typeof url !== 'string') return url;
  if (!url.startsWith('/')) return url;
  if (url.startsWith(`${prefix}/`)) return url;
  return `${prefix}${url}`;
}

function rebaseManifest(manifest) {
  if (typeof manifest !== 'object' || manifest === null) return manifest;
  if (typeof manifest.index_url === 'string') {
    manifest.index_url = rebaseRootRelative(manifest.index_url);
  }
  if (typeof manifest.node_url_template === 'string') {
    manifest.node_url_template = rebaseRootRelative(manifest.node_url_template);
  }
  if (typeof manifest.subtree_url_template === 'string') {
    manifest.subtree_url_template = rebaseRootRelative(manifest.subtree_url_template);
  }
  // Update site.canonical_url to point at the deployed location too, so
  // sniffing the manifest tells operators where the real site lives.
  if (
    manifest.site &&
    typeof manifest.site === 'object' &&
    typeof manifest.site.canonical_url === 'string'
  ) {
    manifest.site.canonical_url = `${publicOrigin}${prefix}/`;
  }
  return manifest;
}

/**
 * Compute the deployed human_url for a node given the placeholder origin
 * baked into the build (manifest.site.canonical_url) and the example's
 * public prefix.
 */
function rewriteHumanUrl(originalUrl, placeholderOrigin) {
  if (typeof originalUrl !== 'string') return originalUrl;
  const target = `${publicOrigin}${prefix}`;
  if (placeholderOrigin && originalUrl.startsWith(placeholderOrigin)) {
    let next = `${target}${originalUrl.slice(placeholderOrigin.length)}`;
    if (strategy === 'prefix-strip-slash' && next.endsWith('/')) {
      next = next.slice(0, -1);
    }
    return next;
  }
  // Fallback: treat root-relative paths the same way the manifest URL
  // templates are handled.
  if (originalUrl.startsWith('/')) {
    let next = rebaseRootRelative(originalUrl);
    if (publicOrigin) next = `${publicOrigin}${next}`;
    if (strategy === 'prefix-strip-slash' && next.endsWith('/')) {
      next = next.slice(0, -1);
    }
    return next;
  }
  return originalUrl;
}

function rebaseNodeSource(obj, placeholderOrigin) {
  if (typeof obj !== 'object' || obj === null) return false;
  let changed = false;
  const src = obj.source;
  if (src && typeof src === 'object' && typeof src.human_url === 'string') {
    if (strategy === 'drop') {
      delete src.human_url;
      changed = true;
    } else {
      const rewritten = rewriteHumanUrl(src.human_url, placeholderOrigin);
      if (rewritten !== src.human_url) {
        if (rewritten === undefined) delete src.human_url;
        else src.human_url = rewritten;
        changed = true;
      }
    }
  }
  // Subtrees nest node envelopes under `nodes[]`.
  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes) {
      if (rebaseNodeSource(n, placeholderOrigin)) changed = true;
    }
  }
  return changed;
}

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj));
}

async function listJsonRecursive(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
    }
  }
  await walk(root);
  return out;
}

async function main() {
  try {
    const s = await fs.stat(distDir);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch (err) {
    console.error(`rebase-act-output: ${distDir}: ${err.message}`);
    process.exit(2);
  }

  // Read the placeholder origin from the manifest BEFORE we rewrite it, so
  // node files can match their old human_urls against it.
  const manifestPath = path.join(distDir, '.well-known', 'act.json');
  let placeholderOrigin = '';
  try {
    const manifest = await readJson(manifestPath);
    if (
      manifest.site &&
      typeof manifest.site === 'object' &&
      typeof manifest.site.canonical_url === 'string'
    ) {
      placeholderOrigin = manifest.site.canonical_url.replace(/\/+$/, '');
    }
  } catch {
    // No manifest is unusual but not fatal — node-only rewrites still
    // work if human_url uses absolute URLs we can pattern-match.
  }

  const files = await listJsonRecursive(distDir);
  let manifestRewrites = 0;
  let nodeRewrites = 0;
  for (const f of files) {
    const rel = path.relative(distDir, f).replaceAll(path.sep, '/');
    const obj = await readJson(f);
    if (typeof obj !== 'object' || obj === null) continue;
    let changed = false;
    if (rel === '.well-known/act.json') {
      rebaseManifest(obj);
      changed = true;
      manifestRewrites += 1;
    } else if (rebaseNodeSource(obj, placeholderOrigin)) {
      changed = true;
      nodeRewrites += 1;
    }
    if (changed) await writeJson(f, obj);
  }
  console.log(
    `rebase-act-output: dist=${path.relative(process.cwd(), distDir) || '.'} prefix=${prefix} strategy=${strategy} publicOrigin=${publicOrigin || '(empty)'} placeholder=${placeholderOrigin || '(none)'} manifestRewrites=${manifestRewrites} nodeRewrites=${nodeRewrites}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

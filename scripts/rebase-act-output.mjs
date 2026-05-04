#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Rewrites a built ACT site so its envelope URLs resolve when the site is
// hosted under a sub-path on a multi-tenant origin (e.g. GitHub Pages).
//
// Use case: each example builds with root-relative URL templates
// (`/act/index.json`, `/act/nodes/{id}.json`, …) so the local conformance
// gate can validate it via `walkStatic`. When we deploy multiple examples
// under `/examples/<name>/` on `act-spec.org`, those root-relative URLs
// resolve to the wrong location. This script prefixes every root-relative
// ACT URL with the public path so the deployed manifest links to the
// example's own artifacts instead of the origin root.
//
// Usage:
//   node scripts/rebase-act-output.mjs <dist-dir> <public-prefix>
//
// where <public-prefix> is something like `/examples/astro-docs`. The
// trailing slash is normalized away.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: rebase-act-output.mjs <dist-dir> <public-prefix>');
  process.exit(2);
}

const distDir = path.resolve(args[0]);
const rawPrefix = args[1];
const prefix = normalizePrefix(rawPrefix);

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
  return manifest;
}

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj));
}

async function rebaseFile(p) {
  const obj = await readJson(p);
  if (typeof obj !== 'object' || obj === null) return false;
  const rel = path.relative(distDir, p).replaceAll(path.sep, '/');
  if (rel === '.well-known/act.json') {
    rebaseManifest(obj);
    await writeJson(p, obj);
    return true;
  }
  // Other envelope kinds (index, node, subtree) don't carry URL templates;
  // their content stays untouched. We still touch the file iff manifest.
  return false;
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

  const files = await listJsonRecursive(distDir);
  let touched = 0;
  for (const f of files) {
    if (await rebaseFile(f)) touched += 1;
  }
  console.log(
    `rebase-act-output: dist=${path.relative(process.cwd(), distDir) || '.'} prefix=${prefix} files-rewritten=${touched}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

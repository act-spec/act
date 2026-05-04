/**
 * Conformance gate for the ACT homepage.
 *
 * After `astro build`, walks `dist/` and asserts:
 *
 *  - `dist/.well-known/act.json` exists.
 *  - `dist/act/index.json` exists.
 *  - `walkStatic` from `@act-spec/validator` returns zero gaps.
 *  - `declared.level === 'standard'`.
 *  - `achieved.level === 'standard'`.
 *  - `delivery === 'static'`.
 *
 * Mirrors the example conformance gates (`examples/astro-docs/scripts/validate.ts`,
 * `examples/docusaurus-docs/scripts/validate.ts`) so the homepage holds itself
 * to the same bar it asks adopters to meet.
 *
 * Invoked by `pnpm -F @act-spec/website conformance` (after `astro build`).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist');

interface Envelope {
  [k: string]: unknown;
}

async function readJson(p: string): Promise<Envelope> {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw) as Envelope;
}

async function listJsonRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
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

async function main(): Promise<void> {
  const manifestPath = path.join(distDir, '.well-known', 'act.json');
  const indexPath = path.join(distDir, 'act', 'index.json');
  const nodesDir = path.join(distDir, 'act', 'nodes');
  const subtreesDir = path.join(distDir, 'act', 'subtrees');

  for (const f of [manifestPath, indexPath]) {
    try {
      await fs.access(f);
    } catch {
      console.error(`FAIL: required artifact missing: ${f}`);
      process.exit(2);
    }
  }

  const manifest = await readJson(manifestPath);
  const index = await readJson(indexPath);
  const nodeFiles = await listJsonRecursive(nodesDir);
  const subtreeFiles = await listJsonRecursive(subtreesDir);

  const nodes = await Promise.all(nodeFiles.map(readJson));
  const subtrees = await Promise.all(subtreeFiles.map(readJson));

  const report = walkStatic({
    url: `file://${manifestPath}`,
    manifest,
    index,
    nodes,
    subtrees,
    passedAt: new Date().toISOString(),
  });

  console.log(`@act-spec/website conformance — ${nodeFiles.length} nodes, ${subtreeFiles.length} subtrees.`);
  console.log(`  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`);
  console.log(`  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`);
  console.log(`  gaps:      ${report.gaps.length}`);
  console.log(`  warnings:  ${report.warnings.length}`);

  let failed = 0;
  if (report.gaps.length > 0) {
    failed += 1;
    console.error(`FAIL: ${report.gaps.length} gap(s)`);
    for (const g of report.gaps) {
      console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
    }
  }
  if (report.declared.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: declared.level is "${report.declared.level}", expected "standard".`);
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: achieved.level is "${report.achieved.level}", expected "standard".`);
  }
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(`FAIL: delivery profile is not "static".`);
  }
  if (nodeFiles.length === 0) {
    failed += 1;
    console.error(`FAIL: no node files emitted under ${nodesDir}.`);
  }

  if (failed > 0) {
    console.error(`\n@act-spec/website conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\n@act-spec/website conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

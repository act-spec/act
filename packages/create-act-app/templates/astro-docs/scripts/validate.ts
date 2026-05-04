/**
 * PRD-700-R12 / R14 — example conformance gate.
 *
 * Walks `dist/` after `astro build`, validates every emitted ACT envelope
 * via `@act-spec/validator`'s static walk, and asserts:
 *
 *  - The reporter's `gaps` array is empty.
 *  - `achieved.level === 'standard'`.
 *  - `declared.level === 'standard'`.
 *  - `delivery === 'static'`.
 *
 * Any mismatch exits non-zero so the surrounding `pnpm conformance` /
 * `pnpm -r conformance` matrix fails the build.
 *
 * Invoked by `pnpm -F @act-spec/example-astro-docs validate` (after `build`).
 * The conformance entry point (`pnpm conformance`) chains the two.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const distDir = path.join(exampleRoot, 'dist');

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

  // PRD-700-R9 — the file-by-file emission target. Verify presence first.
  const required = [manifestPath, indexPath];
  for (const f of required) {
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
    passedAt: '2026-05-02T00:00:00Z',
  });

  console.log(`PRD-700 conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree files.`);
  console.log(`  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`);
  console.log(`  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`);
  console.log(`  gaps:      ${report.gaps.length}`);
  console.log(`  warnings:  ${report.warnings.length}`);

  let failed = 0;
  if (report.gaps.length > 0) {
    failed += 1;
    console.error(`FAIL: ${report.gaps.length} gap(s)`);
    for (const g of report.gaps) console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
  }
  if (report.declared.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: declared.level is "${report.declared.level}", expected "standard" (PRD-700-R7).`);
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: achieved.level is "${report.achieved.level}", expected "standard" (PRD-700-R12).`);
  }
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(`FAIL: delivery profile is not "static" (PRD-700-R8).`);
  }

  // PRD-700-R6 — at least one subtree-eligible parent must be emitted.
  if (subtreeFiles.length === 0) {
    failed += 1;
    console.error(`FAIL: no subtree files emitted under ${subtreesDir} (PRD-700-R6).`);
  }

  // PRD-700-R3 — corpus envelope (10–25 nodes).
  if (nodeFiles.length < 10 || nodeFiles.length > 25) {
    failed += 1;
    console.error(
      `FAIL: corpus has ${nodeFiles.length} nodes; PRD-700-R3 envelope is 10–25.`,
    );
  }

  if (failed > 0) {
    console.error(`\nPRD-700 conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nPRD-700 conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/**
 * PRD-701-R12 / R13 / R15 / R16 — example conformance gate.
 *
 * Walks `build/` after `pnpm build` and validates every emitted ACT
 * envelope via `@act-spec/validator`'s `walkStatic` (the static-walk
 * variant that consumes preloaded envelopes — equivalent to the
 * PRD-600-R26 `--sample all` walk for a static corpus that is fully
 * inspectable on disk). Asserts:
 *
 *  - `gaps.length === 0` (PRD-701-R12 / R16).
 *  - `declared.level === 'standard'` (PRD-701-R13).
 *  - `achieved.level === 'standard'` (PRD-701-R12).
 *  - `delivery === 'static'` (PRD-701-R10 / PRD-105).
 *  - At least one subtree file emitted (PRD-701-R6).
 *  - Corpus envelope: 200 ≤ nodes ≤ 500 (PRD-701-R3).
 *  - The reporter's static walk visits every node ID enumerated in
 *    `build/act/index.json` (PRD-701-R12 last clause).
 *
 * Any mismatch exits non-zero so the surrounding `pnpm conformance` /
 * `pnpm -r conformance` matrix fails the build.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
// `pnpm build` writes ACT files into Docusaurus' `static/` folder so the
// dev server serves them; the validator reads from the same location.
const buildDir = path.join(exampleRoot, 'static');

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
  const manifestPath = path.join(buildDir, '.well-known', 'act.json');
  const indexPath = path.join(buildDir, 'act', 'index.json');
  const nodesDir = path.join(buildDir, 'act', 'nodes');
  const subtreesDir = path.join(buildDir, 'act', 'subtrees');

  // Verify the file-by-file emission target (PRD-701-R10) before walking.
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
  const index = (await readJson(indexPath)) as { nodes?: Array<{ id: string }> };
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

  const indexIds = new Set((index.nodes ?? []).map((n) => n.id));
  const nodeIdsOnDisk = new Set(nodes.map((n) => String(n['id'])));

  console.log(`PRD-701 conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree files.`);
  console.log(`  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`);
  console.log(`  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`);
  console.log(`  gaps:      ${report.gaps.length}`);
  console.log(`  warnings:  ${report.warnings.length}`);
  console.log(`  index IDs: ${indexIds.size}; node files: ${nodeIdsOnDisk.size}; subtree files: ${subtreeFiles.length}`);

  let failed = 0;
  if (report.gaps.length > 0) {
    failed += 1;
    console.error(`FAIL: ${report.gaps.length} gap(s) (PRD-701-R12)`);
    for (const g of report.gaps) console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
  }

  // PRD-701-R16 — the canonical run MUST NOT emit `summary-length` or
  // `body-token` warnings. Other warnings (e.g. capability-band
  // observations) are non-blocking.
  const blockingWarningCodes = new Set(['summary-length', 'body-token']);
  const blockingWarnings = report.warnings.filter((w) =>
    blockingWarningCodes.has(String((w as unknown as { code?: unknown }).code ?? '')),
  );
  if (blockingWarnings.length > 0) {
    failed += 1;
    console.error(`FAIL: ${blockingWarnings.length} blocking warning(s) (PRD-701-R16)`);
    for (const w of blockingWarnings) console.error(`  ${JSON.stringify(w)}`);
  }

  if (report.declared.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: declared.level is "${report.declared.level}", expected "standard" (PRD-701-R13).`);
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: achieved.level is "${report.achieved.level}", expected "standard" (PRD-701-R12).`);
  }
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(`FAIL: delivery profile is not "static" (PRD-701-R10 / PRD-105).`);
  }

  // PRD-701-R6 — at least one subtree file emitted (per sidebar category).
  if (subtreeFiles.length === 0) {
    failed += 1;
    console.error(`FAIL: no subtree files emitted under ${subtreesDir} (PRD-701-R6).`);
  }

  // PRD-701-R3 — corpus envelope (200-500 nodes after PRD-201/PRD-404 emission).
  if (nodeFiles.length < 200 || nodeFiles.length > 500) {
    failed += 1;
    console.error(
      `FAIL: corpus has ${nodeFiles.length} nodes; PRD-701-R3 envelope is 200-500.`,
    );
  }

  // PRD-701-R12 last clause — every index ID is reachable on disk.
  const missingFromDisk = [...indexIds].filter((id) => !nodeIdsOnDisk.has(id));
  if (missingFromDisk.length > 0) {
    failed += 1;
    console.error(
      `FAIL: ${missingFromDisk.length} index ID(s) absent from node files (PRD-701-R12). e.g. ${missingFromDisk.slice(0, 3).join(', ')}`,
    );
  }

  // PRD-701-R12 last clause — every node file shows up in the index.
  const missingFromIndex = [...nodeIdsOnDisk].filter((id) => !indexIds.has(id));
  if (missingFromIndex.length > 0) {
    failed += 1;
    console.error(
      `FAIL: ${missingFromIndex.length} node file(s) absent from index (PRD-701-R12). e.g. ${missingFromIndex.slice(0, 3).join(', ')}`,
    );
  }

  if (failed > 0) {
    console.error(`\nPRD-701 conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nPRD-701 conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static; nodes: ${nodeFiles.length}; subtrees: ${subtreeFiles.length}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

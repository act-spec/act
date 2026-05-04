/**
 * PRD-707-R12 / R14 / R15 — example conformance gate.
 *
 * Walks `_site/` after `npx @11ty/eleventy`, validates every emitted
 * ACT envelope via `@act-spec/validator`'s static walk, and asserts
 * the PRD-707 acceptance shape:
 *
 *  - The reporter's `gaps` array is empty (PRD-707-R14).
 *  - `declared.level === 'standard'` (PRD-707-R11 / R15).
 *  - `achieved.level === 'standard'` (PRD-707-R15).
 *  - `delivery === 'static'` (PRD-707-R12 manifest).
 *  - The synthetic `posts` subtree file is present (PRD-707-R6 / R12).
 *  - The build report sidecar is present (PRD-707-R12 / R13).
 *  - The corpus envelope is 30–100 nodes (PRD-707-R3).
 *  - The draft post is absent from index + nodes (PRD-707-R7).
 *
 * Any mismatch exits non-zero so `pnpm conformance` fails.
 *
 * Invoked by `pnpm -F @act-spec/example-eleventy-blog validate`.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const siteDir = path.join(exampleRoot, '_site');

interface Envelope {
  [k: string]: unknown;
}

const DRAFT_ID = 'posts/2026-06-01-draft-deep-dive' as const;
const SYNTHETIC_PARENT_ID = 'posts' as const;

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
  const manifestPath = path.join(siteDir, '.well-known', 'act.json');
  const indexPath = path.join(siteDir, 'act', 'index.json');
  const nodesDir = path.join(siteDir, 'act', 'nodes');
  const subtreesDir = path.join(siteDir, 'act', 'subtrees');
  const buildReportPath = path.join(siteDir, '.act-build-report.json');

  // PRD-707-R12 — required artifacts must exist before the walker runs.
  const required = [manifestPath, indexPath, buildReportPath];
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

  const indexNodes = (index['nodes'] as Array<{ id?: unknown }> | undefined) ?? [];
  const indexIds = indexNodes.map((n) => String(n.id));
  const nodeIds = nodes.map((n) => String(n['id']));
  const subtreeIds = subtrees.map((s) => String(s['root']));

  console.log(
    `PRD-707 conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree files.`,
  );
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

  // PRD-707-R11 / R15 — declared.level MUST be standard.
  if (report.declared.level !== 'standard') {
    failed += 1;
    console.error(
      `FAIL: declared.level is "${report.declared.level}", expected "standard" (PRD-707-R11).`,
    );
  }

  // PRD-707-R15 — achieved == declared.
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(
      `FAIL: achieved.level is "${report.achieved.level}", expected "standard" (PRD-707-R15).`,
    );
  }

  // PRD-707-R12 — delivery is static.
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(
      `FAIL: delivery profile is not "static" (declared=${report.declared.delivery ?? '<unknown>'}, achieved=${report.achieved.delivery ?? '<unknown>'}; PRD-707-R12).`,
    );
  }

  // PRD-707-R6 / R12 — the synthetic `posts` subtree MUST be present.
  if (!subtreeIds.includes(SYNTHETIC_PARENT_ID)) {
    failed += 1;
    console.error(
      `FAIL: synthetic subtree for id "${SYNTHETIC_PARENT_ID}" is absent (PRD-707-R6 / R12). Subtree IDs: ${JSON.stringify(subtreeIds)}.`,
    );
  }

  // PRD-707-R3 — corpus envelope is 30-100 nodes.
  if (nodeFiles.length < 30 || nodeFiles.length > 100) {
    failed += 1;
    console.error(
      `FAIL: corpus has ${nodeFiles.length} nodes; PRD-707-R3 envelope is 30-100.`,
    );
  }

  // PRD-707-R7 — draft MUST be absent from index AND nodes.
  if (indexIds.includes(DRAFT_ID)) {
    failed += 1;
    console.error(
      `FAIL: draft post "${DRAFT_ID}" leaked into act/index.json (PRD-707-R7).`,
    );
  }
  if (nodeIds.includes(DRAFT_ID)) {
    failed += 1;
    console.error(
      `FAIL: draft post "${DRAFT_ID}" leaked into act/nodes/ (PRD-707-R7).`,
    );
  }

  if (failed > 0) {
    console.error(`\nPRD-707 conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nPRD-707 conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static; synthetic posts subtree: present; draft excluded.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

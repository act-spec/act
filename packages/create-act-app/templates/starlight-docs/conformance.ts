/**
 * Conformance gate for the Starlight + ACT starter.
 *
 * After `astro build` writes both Starlight HTML and ACT JSON into
 * `dist/`, this script:
 *
 *   1. Asserts the required ACT artifacts exist (`.well-known/act.json`,
 *      `act/index.json`, `llms.txt`, `llms-full.txt`).
 *   2. Walks every node + subtree envelope through `@act-spec/validator`.
 *   3. Asserts the gap list is empty and that declared + achieved level
 *      are both `standard` with `delivery: static`.
 *
 * Non-zero exit on any mismatch so `pnpm conformance` fails the build.
 */
/* eslint-disable no-console */
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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const manifestPath = path.join(distDir, '.well-known', 'act.json');
  const indexPath = path.join(distDir, 'act', 'index.json');
  const nodesDir = path.join(distDir, 'act', 'nodes');
  const subtreesDir = path.join(distDir, 'act', 'subtrees');
  const llmsTxtPath = path.join(distDir, 'llms.txt');
  const llmsFullPath = path.join(distDir, 'llms-full.txt');

  const required = [manifestPath, indexPath, llmsTxtPath, llmsFullPath];
  for (const f of required) {
    if (!(await exists(f))) {
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

  console.log(
    `Starlight + ACT conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree files.`,
  );
  console.log(
    `  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`,
  );
  console.log(
    `  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`,
  );
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
    console.error(`FAIL: declared.level is "${report.declared.level}", expected "standard".`);
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: achieved.level is "${report.achieved.level}", expected "standard".`);
  }
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(
      `FAIL: delivery profile is not "static" (declared=${report.declared.delivery ?? '<unknown>'}, achieved=${report.achieved.delivery ?? '<unknown>'}).`,
    );
  }

  if (failed > 0) {
    console.error(`\nStarlight + ACT conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nStarlight + ACT conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

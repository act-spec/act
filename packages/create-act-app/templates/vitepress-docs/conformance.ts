/**
 * Example conformance gate for `examples/vitepress-docs/`.
 *
 * Walks `docs/.vitepress/dist/` after `vitepress build`, validates every
 * emitted ACT envelope via `@act-spec/validator`'s static walk, and
 * asserts:
 *
 *  - The reporter's `gaps` array is empty.
 *  - `declared.level === 'standard'`.
 *  - `achieved.level === 'standard'`.
 *  - `delivery === 'static'`.
 *  - The required artifacts exist (`/.well-known/act.json`,
 *    `/act/index.json`, `/llms.txt`, `/llms-full.txt`).
 *  - At least one subtree file is present (the corpus has nested
 *    `guide/` and `reference/` parents).
 *
 * Any mismatch exits non-zero so `pnpm conformance` fails the build.
 *
 * Invoked by `pnpm -F @act-spec/example-vitepress-docs validate`.
 * The conformance entry point (`pnpm conformance`) chains build + validate.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here);
const distDir = path.join(exampleRoot, 'docs', '.vitepress', 'dist');

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
  const llmsFullTxtPath = path.join(distDir, 'llms-full.txt');

  // Required ACT artifacts must exist before the walker runs.
  for (const f of [manifestPath, indexPath]) {
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
    `vitepress-docs conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree files.`,
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
    console.error(
      `FAIL: declared.level is "${report.declared.level}", expected "standard".`,
    );
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(
      `FAIL: achieved.level is "${report.achieved.level}", expected "standard".`,
    );
  }
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(
      `FAIL: delivery profile is not "static" (declared=${report.declared.delivery ?? '<unknown>'}, achieved=${report.achieved.delivery ?? '<unknown>'}).`,
    );
  }
  if (subtreeFiles.length === 0) {
    failed += 1;
    console.error(`FAIL: no subtree files emitted under ${subtreesDir}.`);
  }
  if (!(await exists(llmsTxtPath))) {
    failed += 1;
    console.error(`FAIL: /llms.txt missing at ${llmsTxtPath}.`);
  }
  if (!(await exists(llmsFullTxtPath))) {
    failed += 1;
    console.error(`FAIL: /llms-full.txt missing at ${llmsFullTxtPath}.`);
  }

  if (failed > 0) {
    console.error(`\nvitepress-docs conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nvitepress-docs conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static; llms.txt + llms-full.txt present.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

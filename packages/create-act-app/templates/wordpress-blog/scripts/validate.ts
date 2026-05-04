/**
 * Conformance gate for the WordPress blog example.
 *
 * Walks `public/` after `pnpm build`, validates every emitted ACT envelope
 * via `@act-spec/validator`'s static walk, and asserts:
 *
 *  - Required artefacts exist: manifest, index, build report, llms.txt, llms-full.txt.
 *  - The validator returns zero gaps.
 *  - `declared.level === 'standard'` and `achieved.level === 'standard'`.
 *  - `delivery === 'static'`.
 *  - Every node carries `metadata.source.adapter === 'wordpress'`.
 *  - Each kind from the fixture is present (posts, pages, categories, tags).
 *
 * Any mismatch exits non-zero so `pnpm conformance` fails.
 *
 * Invoked by `pnpm -F @act-spec/example-wordpress-blog validate`.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const outDir = path.join(exampleRoot, 'public');

const ADAPTER_NAME = 'act-wordpress' as const;

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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const manifestPath = path.join(outDir, '.well-known', 'act.json');
  const indexPath = path.join(outDir, 'act', 'index.json');
  const nodesDir = path.join(outDir, 'act', 'nodes');
  const subtreesDir = path.join(outDir, 'act', 'subtrees');
  const buildReportPath = path.join(outDir, '.act-build-report.json');
  const llmsTxtPath = path.join(outDir, 'llms.txt');
  const llmsFullTxtPath = path.join(outDir, 'llms-full.txt');

  const required = [manifestPath, indexPath, buildReportPath, llmsTxtPath, llmsFullTxtPath];
  for (const f of required) {
    if (!(await fileExists(f))) {
      console.error(`FAIL: required artefact missing: ${f}`);
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
    `WordPress blog conformance — ${String(nodeFiles.length)} node files, ${String(subtreeFiles.length)} subtree files.`,
  );
  console.log(
    `  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`,
  );
  console.log(
    `  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`,
  );
  console.log(`  gaps:      ${String(report.gaps.length)}`);
  console.log(`  warnings:  ${String(report.warnings.length)}`);

  let failed = 0;

  if (report.gaps.length > 0) {
    failed += 1;
    console.error(`FAIL: ${String(report.gaps.length)} gap(s)`);
    for (const g of report.gaps) console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
  }

  if (report.declared.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: declared.level is "${String(report.declared.level)}", expected "standard".`);
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(`FAIL: achieved.level is "${String(report.achieved.level)}", expected "standard".`);
  }
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(
      `FAIL: delivery is not "static" (declared=${String(report.declared.delivery)}, achieved=${String(report.achieved.delivery)}).`,
    );
  }

  // Adapter source attribution — every node should advertise the WP adapter.
  let adapterMismatches = 0;
  const adapterMismatchSamples: string[] = [];
  for (const n of nodes) {
    const meta = (n['metadata'] as Envelope | undefined) ?? {};
    const source = (meta['source'] as Envelope | undefined) ?? {};
    if (source['adapter'] !== ADAPTER_NAME) {
      adapterMismatches += 1;
      if (adapterMismatchSamples.length < 3) {
        adapterMismatchSamples.push(
          `${String(n['id'])}: metadata.source.adapter=${JSON.stringify(source['adapter'])}`,
        );
      }
    }
  }
  if (adapterMismatches > 0) {
    failed += 1;
    console.error(`FAIL: ${String(adapterMismatches)} node(s) missing metadata.source.adapter="${ADAPTER_NAME}".`);
    for (const s of adapterMismatchSamples) console.error(`  ${s}`);
  }

  // Each WP kind from the fixture should be represented in the emission.
  // The adapter's default typeMap is: post -> article, page -> section,
  // category -> section, tag -> tag, user -> profile. Pass a `typeMap` in the
  // adapter config to remap.
  const types = new Set<string>();
  for (const n of nodes) {
    const t = n['type'];
    if (typeof t === 'string') types.add(t);
  }
  const expectedTypes = ['article', 'section', 'tag'] as const;
  for (const k of expectedTypes) {
    if (!types.has(k)) {
      failed += 1;
      console.error(
        `FAIL: no nodes of type "${k}" emitted (types observed: ${JSON.stringify([...types])}).`,
      );
    }
  }

  // Sanity: at least one node carries summary text (PRD-100-R21 behaviour
  // surfaces here as "the WP excerpt fed the summary").
  const withSummary = nodes.filter((n) => typeof n['summary'] === 'string' && (n['summary'] as string).length > 0);
  if (withSummary.length === 0) {
    failed += 1;
    console.error('FAIL: no emitted node carries a summary; the adapter should fill summary from the WP excerpt.');
  }

  // llms.txt + llms-full.txt should be non-trivial — these are the
  // back-compat surface every static producer emits by default.
  const llmsTxtBytes = (await fs.stat(llmsTxtPath)).size;
  const llmsFullBytes = (await fs.stat(llmsFullTxtPath)).size;
  if (llmsTxtBytes < 32) {
    failed += 1;
    console.error(`FAIL: llms.txt is suspiciously small (${String(llmsTxtBytes)} bytes).`);
  }
  if (llmsFullBytes < 32) {
    failed += 1;
    console.error(`FAIL: llms-full.txt is suspiciously small (${String(llmsFullBytes)} bytes).`);
  }

  if (failed > 0) {
    console.error(`\nWordPress blog conformance: FAILED (${String(failed)} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nWordPress blog conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static; adapter: ${ADAPTER_NAME}; nodes: ${String(nodes.length)}; types: ${JSON.stringify([...types])}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

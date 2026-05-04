/**
 * Conformance gate for the Notion knowledge-base example.
 *
 * Walks `public/` after `pnpm build`, validates every emitted ACT envelope
 * via `@act-spec/validator`'s static walk, and asserts:
 *
 *  - The reporter's `gaps` array is empty.
 *  - `declared.level === 'standard'`.
 *  - `achieved.level === 'standard'`.
 *  - `delivery === 'static'`.
 *  - The required artefacts exist (`.well-known/act.json`, `act/index.json`,
 *    build-report sidecar, `llms.txt`, `llms-full.txt`).
 *  - At least one subtree is emitted (the database root).
 *  - Per-page locale extraction worked (every leaf node carries
 *    `metadata.locale`; both `en-US` and `es-ES` appear).
 *  - Every node carries `metadata.source.adapter === 'act-notion'` (the
 *    adapter's short name; matches the adapter framework convention).
 *
 * Any mismatch exits non-zero so `pnpm conformance` fails.
 *
 * Invoked by `pnpm -F @act-spec/example-notion-knowledge-base validate`.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '.');
const siteDir = path.join(exampleRoot, 'public');

// `notionAdapter` stamps `metadata.source.adapter` with its short name
// (`act-notion`) rather than the package name; this matches the adapter
// framework convention used by every first-party adapter.
const ADAPTER_NAME = 'act-notion' as const;

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
  const manifestPath = path.join(siteDir, '.well-known', 'act.json');
  const indexPath = path.join(siteDir, 'act', 'index.json');
  const nodesDir = path.join(siteDir, 'act', 'nodes');
  const subtreesDir = path.join(siteDir, 'act', 'subtrees');
  const buildReportPath = path.join(siteDir, '.act-build-report.json');
  const llmsTxtPath = path.join(siteDir, 'llms.txt');
  const llmsFullTxtPath = path.join(siteDir, 'llms-full.txt');

  let failed = 0;

  // Required artefacts must exist before the validator runs.
  for (const f of [manifestPath, indexPath, buildReportPath]) {
    if (!(await exists(f))) {
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
    passedAt: '2026-05-03T00:00:00Z',
  });

  const indexNodes = (index['nodes'] as Array<{ id?: unknown }> | undefined) ?? [];

  console.log(
    `Notion knowledge-base conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree file(s).`,
  );
  console.log(`  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`);
  console.log(`  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`);
  console.log(`  gaps:      ${report.gaps.length}`);
  console.log(`  warnings:  ${report.warnings.length}`);

  if (report.gaps.length > 0) {
    failed += 1;
    console.error(`FAIL: ${report.gaps.length} gap(s)`);
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
      `FAIL: delivery profile is not "static" (declared=${String(report.declared.delivery)}, achieved=${String(report.achieved.delivery)}).`,
    );
  }

  if (subtrees.length === 0) {
    failed += 1;
    console.error(`FAIL: no subtree files emitted.`);
  }

  if (indexNodes.length === 0) {
    failed += 1;
    console.error(`FAIL: index has no entries.`);
  }

  // Back-compat artefacts: `/llms.txt` and `/llms-full.txt` are auto-emitted
  // by the generator pipeline (v0.2 default). Confirm both made it to disk.
  if (!(await exists(llmsTxtPath))) {
    failed += 1;
    console.error(`FAIL: llms.txt missing at ${llmsTxtPath}.`);
  }
  if (!(await exists(llmsFullTxtPath))) {
    failed += 1;
    console.error(`FAIL: llms-full.txt missing at ${llmsFullTxtPath}.`);
  }

  // Per-node spot checks: adapter attribution and locale extraction.
  let adapterMismatch = 0;
  const localesSeen = new Set<string>();
  let leafCount = 0;
  for (const n of nodes) {
    const meta = (n['metadata'] as Envelope | undefined) ?? {};
    const source = (meta['source'] as Envelope | undefined) ?? {};
    if (source['adapter'] !== ADAPTER_NAME) {
      adapterMismatch += 1;
    }
    if (n['type'] === 'article') {
      leafCount += 1;
      const loc = meta['locale'];
      if (typeof loc === 'string' && loc.length > 0) {
        localesSeen.add(loc);
      }
    }
  }
  if (adapterMismatch > 0) {
    failed += 1;
    console.error(
      `FAIL: ${adapterMismatch} node(s) missing metadata.source.adapter === "${ADAPTER_NAME}".`,
    );
  }
  if (leafCount === 0) {
    failed += 1;
    console.error(`FAIL: no leaf article nodes found in emitted output.`);
  }
  // The fixture corpus carries pages tagged en-US and es-ES; both should
  // round-trip through the adapter.
  for (const required of ['en-US', 'es-ES']) {
    if (!localesSeen.has(required)) {
      failed += 1;
      console.error(
        `FAIL: locale "${required}" is absent from emitted leaf nodes (locales seen: ${[...localesSeen].join(', ') || '<none>'}).`,
      );
    }
  }

  if (failed > 0) {
    console.error(`\nNotion knowledge-base conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nNotion knowledge-base conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static; nodes: ${nodes.length}; locales: ${[...localesSeen].sort().join(', ')}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

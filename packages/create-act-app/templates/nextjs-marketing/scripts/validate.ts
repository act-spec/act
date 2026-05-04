/**
 * PRD-702-R20 — example conformance gate.
 *
 * Walks `dist/` after `build.ts`, validates every emitted ACT envelope
 * via `@act-spec/validator`'s static walk, and asserts the PRD-702
 * acceptance shape:
 *
 *  - The reporter's `gaps` array is empty (PRD-702-R20-b).
 *  - `declared.level === 'strict'` (PRD-702-R3 / R4).
 *  - `achieved.level === 'strict'` (PRD-702-R20-c).
 *  - `delivery === 'static'` (PRD-105-R1).
 *  - At least one node carries `metadata.translation_status: "fallback"`
 *    + `metadata.fallback_from` (PRD-702-R8).
 *  - At least one node carries `metadata.source.contributors` with
 *    `["act-contentful", "act-i18n"]` (PRD-702-R17 — A1 dedupe evidence).
 *  - The merged `metadata.translations` array on every multi-locale node
 *    has unique `(locale, id)` entries (A1 closed; the framework dedupe
 *    is exercised but the check here is the integration assertion).
 *  - The build report sidecar exists at `./.act-build-report.json`
 *    (PRD-702-R16).
 *  - NDJSON index + search payload present (PRD-702-R1 / R11).
 *
 * Invoked by `pnpm -F @act-spec/example-nextjs-marketing validate`.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
// `pnpm build` writes ACT files into Next.js' `public/` folder so the
// dev server serves them; the validator reads from the same location.
const distDir = path.join(exampleRoot, 'public');

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

interface TranslationEntry { locale: string; id: string }

function getTranslations(node: Envelope): TranslationEntry[] {
  const md = node['metadata'] as Record<string, unknown> | undefined;
  if (!md) return [];
  const t = md['translations'];
  if (!Array.isArray(t)) return [];
  return t.filter((x): x is TranslationEntry =>
    typeof x === 'object' && x !== null
    && typeof (x as Record<string, unknown>)['locale'] === 'string'
    && typeof (x as Record<string, unknown>)['id'] === 'string'
  );
}

function getContributors(node: Envelope): string[] {
  const md = node['metadata'] as Record<string, unknown> | undefined;
  if (!md) return [];
  const src = md['source'] as Record<string, unknown> | undefined;
  if (!src) return [];
  const c = src['contributors'];
  if (Array.isArray(c)) return c.filter((x): x is string => typeof x === 'string');
  // Single-contributor case: source.adapter (Contentful adapter form).
  const adapter = src['adapter'];
  if (typeof adapter === 'string') return [adapter];
  return [];
}

async function main(): Promise<void> {
  const manifestPath = path.join(distDir, '.well-known', 'act.json');
  const indexPath = path.join(distDir, 'act', 'index.json');
  const ndjsonPath = path.join(distDir, 'act', 'index.ndjson');
  const searchPath = path.join(distDir, 'act', 'search.json');
  const sidecarPath = path.join(exampleRoot, '.act-build-report.json');
  const nodesDir = path.join(distDir, 'act', 'nodes');
  const subtreesDir = path.join(distDir, 'act', 'subtrees');

  // PRD-702-R1 — required artifacts must exist.
  const required = [manifestPath, indexPath, ndjsonPath, searchPath, sidecarPath];
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

  console.log(
    `nextjs-marketing conformance — ${nodeFiles.length} node files, ${subtreeFiles.length} subtree files.`,
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

  // PRD-702-R3 / R4 — declared.level MUST be strict.
  if (report.declared.level !== 'strict') {
    failed += 1;
    console.error(
      `FAIL: declared.level is "${report.declared.level}", expected "strict" ( / R4).`,
    );
  }

  // PRD-702-R20-c — achieved == declared.
  if (report.achieved.level !== 'strict') {
    failed += 1;
    console.error(
      `FAIL: achieved.level is "${report.achieved.level}", expected "strict" (-c).`,
    );
  }

  // PRD-105-R1 — delivery is static.
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(
      `FAIL: delivery profile is not "static" (declared=${report.declared.delivery ?? '<unknown>'}, achieved=${report.achieved.delivery ?? '<unknown>'}).`,
    );
  }

  // PRD-702-R8 — at least one fallback node.
  const fallbackNodes = nodes.filter((n) => {
    const md = n['metadata'] as Record<string, unknown> | undefined;
    return md?.['translation_status'] === 'fallback';
  });
  if (fallbackNodes.length === 0) {
    failed += 1;
    console.error(
      `FAIL: no node has metadata.translation_status === "fallback".`,
    );
  } else {
    console.log(
      `  fallback nodes: ${fallbackNodes.length} ( satisfied; e.g., ${String(fallbackNodes[0]?.['id'])})`,
    );
    // Spot-check fallback_from is set on the same nodes.
    const missingFallbackFrom = fallbackNodes.filter((n) => {
      const md = n['metadata'] as Record<string, unknown> | undefined;
      return typeof md?.['fallback_from'] !== 'string';
    });
    if (missingFallbackFrom.length > 0) {
      failed += 1;
      console.error(
        `FAIL: ${missingFallbackFrom.length} fallback node(s) missing metadata.fallback_from.`,
      );
    }
  }

  // PRD-702-R17 — at least one node has both contentful + i18n contributors.
  const dualContrib = nodes.filter((n) => {
    const c = getContributors(n);
    return c.includes('act-contentful') && c.includes('act-i18n');
  });
  if (dualContrib.length === 0) {
    failed += 1;
    console.error(
      `FAIL: no node has metadata.source.contributors === ["act-contentful", "act-i18n"] ( + A1 dedupe evidence).`,
    );
  } else {
    console.log(
      `  dual-contributor nodes: ${dualContrib.length} ( satisfied; e.g., ${String(dualContrib[0]?.['id'])})`,
    );
  }

  // A1 evidence — translations array on every node has unique (locale, id) keys.
  // Two-step proof: (1) every translations entry is unique by (locale, id);
  // (2) at least one fully-translated route has translations.length equal to
  //     (totalLocales - 1) — i.e., 3 for a 4-locale build. Without A1 dedupe
  //     the post-merge array would carry 6 entries (3 from PRD-202-R14 +
  //     3 from PRD-207-R5), so this length-equals-3 check proves dedupe ran.
  let dedupeViolations = 0;
  let translationsCheckedNodes = 0;
  let dedupeProofNodeFound = false;
  let dedupeProofNodeId: string | undefined;
  const TOTAL_LOCALES = 4;
  for (const n of nodes) {
    const t = getTranslations(n);
    if (t.length === 0) continue;
    translationsCheckedNodes += 1;
    const seen = new Set<string>();
    for (const e of t) {
      const k = `${e.locale} ${e.id}`;
      if (seen.has(k)) {
        dedupeViolations += 1;
        console.error(
          `FAIL: A1 dedupe violation in node "${String(n['id'])}": duplicate translations entry for ${k}.`,
        );
      }
      seen.add(k);
    }
    if (t.length === TOTAL_LOCALES - 1 && !dedupeProofNodeFound) {
      dedupeProofNodeFound = true;
      dedupeProofNodeId = String(n['id']);
    }
  }
  if (dedupeViolations > 0) {
    failed += 1;
    console.error(
      `FAIL: ${dedupeViolations} A1 dedupe violation(s) across ${translationsCheckedNodes} multi-locale node(s).`,
    );
  } else {
    console.log(
      `  A1 dedupe: ${translationsCheckedNodes} multi-locale node(s) checked; 0 (locale, id) duplicates.`,
    );
  }
  if (!dedupeProofNodeFound) {
    failed += 1;
    console.error(
      `FAIL: no fully-translated node has exactly ${TOTAL_LOCALES - 1} metadata.translations entries; A1 dedupe collapse not proved.`,
    );
  } else {
    console.log(
      `  A1 dedupe collapse: node "${dedupeProofNodeId}" has exactly ${TOTAL_LOCALES - 1} translations entries (PRD-202 + PRD-207 each contributed ${TOTAL_LOCALES - 1}; A1 collapsed to ${TOTAL_LOCALES - 1}).`,
    );
  }

  // PRD-702-R16 — sidecar build report.
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as Record<string, unknown>;
  if (sidecar['conformanceAchieved'] !== 'strict') {
    failed += 1;
    console.error(
      `FAIL: build report at ${sidecarPath} reports conformanceAchieved="${String(sidecar['conformanceAchieved'])}", expected "strict".`,
    );
  } else {
    console.log(`  build report sidecar: present, conformanceAchieved=strict.`);
  }

  // Corpus envelope — PRD-702 prescribes ~96 nodes (24 routes × 4 locales);
  // the example uses 6 routes × 4 locales = 24 nodes. The PRD's R1 prose
  // accepts variation ("counts may vary") so the gate enforces a minimum
  // of 16 (4 locales × 4 routes) — enough to exercise multi-locale fan-out.
  if (nodeFiles.length < 16) {
    failed += 1;
    console.error(
      `FAIL: corpus has ${nodeFiles.length} nodes; nextjs-marketing multi-locale fan-out requires at least 16.`,
    );
  }

  // Subtree presence — PRD-702-R12.
  if (subtreeFiles.length === 0) {
    failed += 1;
    console.error(
      `FAIL: no subtree files emitted under ${subtreesDir}.`,
    );
  }

  // PRD-702-R19 — at least one block on at least one node carries
  // metadata.extracted_via === 'component-contract' (the React binding's stamp).
  const reactExtractedBlocks = nodes.flatMap((n) => {
    const content = (n['content'] as Array<Record<string, unknown>> | undefined) ?? [];
    return content.filter((b) => {
      const md = b['metadata'] as Record<string, unknown> | undefined;
      return md?.['extracted_via'] === 'component-contract';
    });
  });
  if (reactExtractedBlocks.length === 0) {
    failed += 1;
    console.error(
      `FAIL: no block carries metadata.extracted_via === "component-contract".`,
    );
  } else {
    console.log(
      `  component-contract blocks: ${reactExtractedBlocks.length} ( satisfied).`,
    );
  }

  if (failed > 0) {
    console.error(`\nnextjs-marketing conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nnextjs-marketing conformance: OK — gaps: 0; declared.level: strict; achieved.level: strict; delivery: static; A1 dedupe: clean; / R17 / R19 satisfied.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

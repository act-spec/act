/**
 * PRD-704-R15 — example conformance gate.
 *
 * Walks `out/` after `pnpm build`, validates every emitted ACT envelope via
 * `@act-spec/validator`'s static walk, and asserts the PRD-704 acceptance
 * shape:
 *
 *  (a) PRD-704-R15(a) — build exited 0 (a precondition; if `pnpm build`
 *      failed, this script never runs).
 *  (b) PRD-704-R15(b) — reporter `gaps` is empty.
 *  (c) PRD-704-R15(c) — `achieved.level === 'standard'`.
 *  (d) PRD-704-R15(d) — cited PRDs are exercised (manifest, index, node,
 *      subtree, build report, source attribution, schema_org_type all
 *      present and well-formed).
 *
 * Additional PRD-704 spot-checks:
 *  - PRD-704-R2 — required artifacts exist (manifest, index, build report,
 *    one root subtree).
 *  - PRD-704-R3 — corpus is 500–2000 SKUs.
 *  - PRD-704-R4 — manifest declares the required fields and forbids
 *    `locales` / `index_ndjson_url` / `search_url_template`.
 *  - PRD-704-R5 — every product node carries `metadata.schema_org_type:
 *    "Product"` (PascalCase).
 *  - PRD-704-R6 — every product carries exactly two blocks (prose + data).
 *  - PRD-704-R7 — `related[]` capped at 8.
 *  - PRD-704-R9 — every node carries `metadata.source.adapter` =
 *    "act-catalog".
 *
 * Any mismatch exits non-zero so `pnpm conformance` fails.
 *
 * Invoked by `pnpm -F @act-spec/example-ecommerce-catalog validate`.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
// `pnpm build` writes ACT files into Astro's `public/` folder so the
// dev server serves them; the validator reads from the same location.
const outDir = path.join(exampleRoot, 'public');

const CATALOG_ROOT_ID = 'catalog' as const;
const ADAPTER_NAME = 'act-catalog' as const;

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

interface Block {
  type?: unknown;
}

async function main(): Promise<void> {
  const manifestPath = path.join(outDir, '.well-known', 'act.json');
  const indexPath = path.join(outDir, 'act', 'index.json');
  const nodesDir = path.join(outDir, 'act', 'nodes');
  const subtreesDir = path.join(outDir, 'act', 'subtrees');
  const buildReportPath = path.join(outDir, '.act-build-report.json');

  // PRD-704-R2 — required artifacts.
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

  const productNodes = nodes.filter((n) => n['type'] === 'product');
  const indexNodes = (index['nodes'] as Array<{ id?: unknown }> | undefined) ?? [];

  console.log(
    `PRD-704 conformance — ${nodeFiles.length} node files (${productNodes.length} products), ${subtreeFiles.length} subtree file(s).`,
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

  // PRD-704-R15(b)
  if (report.gaps.length > 0) {
    failed += 1;
    console.error(`FAIL: ${report.gaps.length} gap(s)`);
    for (const g of report.gaps) console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
  }

  // PRD-704-R1 / R15(c)
  if (report.declared.level !== 'standard') {
    failed += 1;
    console.error(
      `FAIL: declared.level is "${String(report.declared.level)}", expected "standard" (PRD-704-R1).`,
    );
  }
  if (report.achieved.level !== 'standard') {
    failed += 1;
    console.error(
      `FAIL: achieved.level is "${String(report.achieved.level)}", expected "standard" (PRD-704-R15(c)).`,
    );
  }

  // PRD-704-R4 — delivery is static.
  if (report.declared.delivery !== 'static' || report.achieved.delivery !== 'static') {
    failed += 1;
    console.error(
      `FAIL: delivery is not "static" (declared=${String(report.declared.delivery)}, achieved=${String(report.achieved.delivery)}; PRD-704-R4).`,
    );
  }

  // PRD-704-R3 — corpus envelope (500–2000 SKUs). Excludes the synthetic root.
  if (productNodes.length < 500 || productNodes.length > 2000) {
    failed += 1;
    console.error(
      `FAIL: corpus has ${productNodes.length} product nodes; PRD-704-R3 envelope is 500–2000.`,
    );
  }

  // PRD-704-R2 (post-A22 + A23) — at minimum the synthetic catalog root
  // subtree MUST be emitted, plus one subtree per category index node so
  // an agent can navigate root → category → product without scanning the
  // flat index. Per A23, descendant entries inside each subtree ship with
  // empty `content[]`; bodies are fetched lazily per-node.
  const subtreeIds = subtrees.map((s) => String(s['root']));
  if (!subtreeIds.includes(CATALOG_ROOT_ID)) {
    failed += 1;
    console.error(
      `FAIL: root subtree for id "${CATALOG_ROOT_ID}" is absent (PRD-704-R2). Subtree IDs: ${JSON.stringify(subtreeIds)}.`,
    );
  }
  // Every category index node should have its own subtree — that's how
  // agents resolve the SKU fanout for a category in a single fetch.
  const expectedCategorySubtrees = ['apparel', 'kitchen', 'tools', 'outdoor', 'office', 'lighting', 'audio', 'footwear'];
  for (const cat of expectedCategorySubtrees) {
    if (!subtreeIds.includes(cat)) {
      failed += 1;
      console.error(`FAIL: category subtree for id "${cat}" is absent (PRD-704-R2 + A22).`);
    }
  }

  // PRD-704-R4 — manifest required fields + forbidden fields.
  const requiredManifestPaths: Array<[string, unknown]> = [
    ['act_version', manifest['act_version']],
    ['site.name', (manifest['site'] as Envelope | undefined)?.['name']],
    ['delivery', manifest['delivery']],
    ['conformance.level', (manifest['conformance'] as Envelope | undefined)?.['level']],
    ['index_url', manifest['index_url']],
    ['node_url_template', manifest['node_url_template']],
    ['subtree_url_template', manifest['subtree_url_template']],
  ];
  for (const [key, val] of requiredManifestPaths) {
    if (val === undefined || val === null) {
      failed += 1;
      console.error(`FAIL: manifest is missing required field "${key}" (PRD-704-R4).`);
    }
  }
  const caps = (manifest['capabilities'] as Envelope | undefined) ?? {};
  if (caps['etag'] !== true) {
    failed += 1;
    console.error(`FAIL: manifest.capabilities.etag is not true (PRD-704-R4).`);
  }
  if (caps['subtree'] !== true) {
    failed += 1;
    console.error(`FAIL: manifest.capabilities.subtree is not true (PRD-704-R4).`);
  }
  for (const forbidden of ['index_ndjson_url', 'search_url_template', 'locales', 'mounts']) {
    if (manifest[forbidden] !== undefined) {
      failed += 1;
      console.error(`FAIL: manifest declares forbidden field "${forbidden}" (PRD-704-R4).`);
    }
  }
  for (const forbiddenCap of ['ndjson_index']) {
    if (caps[forbiddenCap] !== undefined) {
      failed += 1;
      console.error(`FAIL: manifest.capabilities declares forbidden flag "${forbiddenCap}" (PRD-704-R4).`);
    }
  }

  // PRD-704-R5 / R6 / R7 / R9 — per-product checks.
  let perProductFails = 0;
  const perProductSamples: string[] = [];
  for (const n of productNodes) {
    const id = String(n['id']);
    const meta = (n['metadata'] as Envelope | undefined) ?? {};
    const sot = meta['schema_org_type'];
    if (sot !== 'Product') {
      perProductFails += 1;
      if (perProductSamples.length < 3) {
        perProductSamples.push(`${id}: schema_org_type=${JSON.stringify(sot)} (PRD-704-R5)`);
      }
    }
    const content = n['content'] as Block[] | undefined;
    if (!Array.isArray(content) || content.length !== 2) {
      perProductFails += 1;
      if (perProductSamples.length < 3) {
        perProductSamples.push(
          `${id}: content has ${Array.isArray(content) ? content.length : 'no'} blocks (PRD-704-R6 requires exactly 2)`,
        );
      }
      continue;
    }
    if (content[0]?.type !== 'prose' || content[1]?.type !== 'data') {
      perProductFails += 1;
      if (perProductSamples.length < 3) {
        perProductSamples.push(
          `${id}: block order is [${String(content[0]?.type)}, ${String(content[1]?.type)}] (PRD-704-R6 requires [prose, data])`,
        );
      }
    }
    for (let i = 0; i < content.length; i += 1) {
      const blk = content[i] as { type?: unknown; metadata?: unknown };
      if (blk.type === 'prose' || blk.type === 'data') {
        const ev = (blk.metadata as Envelope | undefined)?.['extracted_via'];
        if (ev !== 'adapter') {
          perProductFails += 1;
          if (perProductSamples.length < 3) {
            perProductSamples.push(
              `${id}: block[${i}].metadata.extracted_via=${JSON.stringify(ev)} (PRD-704-R6 requires "adapter")`,
            );
          }
          break;
        }
      }
    }
    const related = n['related'];
    if (related !== undefined) {
      if (!Array.isArray(related)) {
        perProductFails += 1;
        if (perProductSamples.length < 3) {
          perProductSamples.push(`${id}: related is not an array (PRD-704-R7)`);
        }
      } else if (related.length > 8) {
        perProductFails += 1;
        if (perProductSamples.length < 3) {
          perProductSamples.push(
            `${id}: related has ${related.length} entries (PRD-704-R7 caps at 8)`,
          );
        }
      } else {
        // post-A5 schema: each item is {id, relation}.
        for (const r of related) {
          if (typeof r !== 'object' || r === null || typeof (r as { id?: unknown }).id !== 'string') {
            perProductFails += 1;
            if (perProductSamples.length < 3) {
              perProductSamples.push(
                `${id}: related entry is not {id, relation} (post-A5 schema; see A18)`,
              );
            }
            break;
          }
        }
      }
    }
    const source = (meta['source'] as Envelope | undefined) ?? {};
    if (source['adapter'] !== ADAPTER_NAME) {
      perProductFails += 1;
      if (perProductSamples.length < 3) {
        perProductSamples.push(
          `${id}: metadata.source.adapter=${JSON.stringify(source['adapter'])} (PRD-704-R9 requires "${ADAPTER_NAME}")`,
        );
      }
    }
  }
  if (perProductFails > 0) {
    failed += 1;
    console.error(`FAIL: ${perProductFails} per-product violation(s). Samples:`);
    for (const s of perProductSamples) console.error(`  ${s}`);
  }

  // Cited-PRD coverage spot check (PRD-704-R15(d)) — every coverage-table
  // entry has at least one observable artifact.
  const indexHasEntries = indexNodes.length > 0;
  const buildReport = await readJson(buildReportPath);
  const coverage: Array<[string, boolean]> = [
    ['PRD-100 (manifest envelope, schema_org_type)', manifest['act_version'] === '0.1' && productNodes[0] !== undefined],
    ['PRD-102 (prose + data blocks)', productNodes[0] !== undefined],
    ['PRD-103 (etag derivation)', typeof productNodes[0]?.['etag'] === 'string'],
    ['PRD-105 (static profile + layout)', manifest['delivery'] === 'static'],
    ['PRD-107 (Standard declaration)', report.declared.level === 'standard'],
    ['PRD-200 (single-source emission, metadata.source)', perProductFails === 0],
    ['PRD-208 (programmatic factory)', productNodes.length >= 500],
    ['PRD-400 (canonical pipeline + atomic writes)', typeof buildReport['durationMs'] === 'number'],
    ['PRD-600 (validator core)', report.gaps.length === 0],
  ];
  for (const [label, ok] of coverage) {
    if (!ok) {
      failed += 1;
      console.error(`FAIL: cited-PRD coverage missing for ${label} (PRD-704-R15(d)).`);
    }
  }
  if (!indexHasEntries) {
    failed += 1;
    console.error(`FAIL: index has no entries (PRD-704-R2).`);
  }

  if (failed > 0) {
    console.error(`\nPRD-704 conformance: FAILED (${failed} check(s)).`);
    process.exit(1);
  }
  console.log(
    `\nPRD-704 conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: static; products: ${productNodes.length}; root subtree: ${CATALOG_ROOT_ID}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

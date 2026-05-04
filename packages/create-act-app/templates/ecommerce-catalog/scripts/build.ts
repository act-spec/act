/**
 * PRD-704-R13 / R14 — example build entry point.
 *
 * Invokes PRD-400's canonical pipeline (`runPipeline` + `emitFiles` from
 * `@act-spec/generator-core`) against the act-catalog programmatic adapter.
 * Per PRD-704-R13 the example MUST NOT bypass the pipeline — atomic writes
 * (PRD-400-R23) and post-build validation (PRD-400-R24) apply.
 *
 * Cross-sell verification per PRD-704-R12 runs after the pipeline emits
 * nodes but before files are written; dangling `related[]` references are a
 * build error (we run with `strict: true`).
 *
 * Output layout (PRD-704-R2):
 *   out/.well-known/act.json          — manifest
 *   out/act/index.json                — index of every node
 *   out/act/nodes/{id}.json           — one per product (+ synthetic catalog root)
 *   out/act/subtrees/{id}.json        — exactly one root subtree (id=`catalog`)
 *   out/.act-build-report.json        — build report sidecar (PRD-400-R27)
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  emitFiles,
  runPipeline,
  verifyCapabilityBacking,
  type GeneratorConfig,
} from '@act-spec/generator-core';

import { createCatalogAdapter } from '../src/catalog-adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
// Write ACT artifacts into Astro's `public/` folder so the dev server
// (`pnpm dev`) serves them at /.well-known/act.json + /act/* alongside
// the rendered storefront pages.
const outputDir = path.join(exampleRoot, 'public');
const databasePath = path.join(exampleRoot, 'data', 'products.json');

interface ConsoleLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

function makeLogger(): ConsoleLogger {
  return {
    debug: (msg) => console.log(`  ${msg}`),
    info: (msg) => console.log(`[act] ${msg}`),
    warn: (msg) => console.warn(`[act][warn] ${msg}`),
    error: (msg) => console.error(`[act][error] ${msg}`),
  };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const logger = makeLogger();

  // Clean previous ACT-owned subtrees only — Astro's `public/` may also
  // hold static assets (thumbnails, favicons, etc) that aren't ours to
  // throw away. Byte-equivalence is preserved across re-runs because
  // `emitFiles` overwrites every file inside `.well-known/` and `act/`.
  await fs.rm(path.join(outputDir, '.well-known'), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, 'act'), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, '.act-build-report.json'), { force: true });

  const config: GeneratorConfig = {
    conformanceTarget: 'standard',
    outputDir,
    site: {
      name: 'Acme Catalog',
      // Set to the dev-server origin so the local hand-test loop works
      // end-to-end: the site browser fetches `source.human_url` for the
      // HTML-equivalent meter, and the storefront is served at the same
      // origin without CORS friction. Override via `ACT_CATALOG_SITE` env
      // var when deploying to a real domain.
      canonical_url: process.env.ACT_CATALOG_SITE ?? 'http://localhost:4321',
    },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
    },
    // Shallow root subtree — root + 8 category index nodes only. Agents
    // navigate further via each category node's `children[]`, so the root
    // subtree stays small (~3 KB) instead of inlining every product.
    subtreeDepth: 1,
    generator: '@act-spec/example-ecommerce-catalog@0.0.0',
    adapters: [
      {
        adapter: createCatalogAdapter({ databasePath }),
        config: {},
        // PRD-704-R14 — Stage 1 act_version pinning.
        actVersion: '0.1',
      },
    ],
  };

  logger.info(`enumerate + transform via @act-spec/adapter-programmatic`);
  const outcome = await runPipeline({ config, logger });
  logger.info(
    `pipeline emitted ${outcome.nodes.length} node(s) + ${outcome.subtrees.size} subtree(s); achieved level: ${outcome.achieved}`,
  );

  // PRD-704-R12 — referential integrity for related[] (build-time check).
  const knownIds = new Set(outcome.nodes.map((n) => n.id));
  const dangling: Array<{ from: string; to: string }> = [];
  for (const n of outcome.nodes) {
    const related = (n as { related?: unknown }).related;
    if (!Array.isArray(related)) continue;
    for (const r of related) {
      // post-A5 schema: items are `{id, relation}` objects.
      const targetId =
        typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string'
          ? (r as { id: string }).id
          : typeof r === 'string'
            ? r
            : undefined;
      if (targetId === undefined) continue;
      if (!knownIds.has(targetId)) dangling.push({ from: n.id, to: targetId });
    }
  }
  if (dangling.length > 0) {
    const sample = dangling
      .slice(0, 5)
      .map((d) => `${d.from} → ${d.to}`)
      .join(', ');
    throw new Error(
      `PRD-704-R12: ${dangling.length} dangling related[] reference(s) (strict: true). First: ${sample}`,
    );
  }

  const report = await emitFiles({
    outcome,
    outputDir: config.outputDir,
    config,
    startedAt,
  });

  // PRD-400-R18 — capability advertisement must be backed by emitted files.
  verifyCapabilityBacking(outcome.capabilities, report.files);

  logger.info(
    `wrote ${report.files.length} file(s) to ${config.outputDir} in ${report.durationMs}ms`,
  );
  logger.info(`build report sidecar: ${path.join(config.outputDir, '.act-build-report.json')}`);
  logger.info(`achieved.level: ${report.conformanceAchieved}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

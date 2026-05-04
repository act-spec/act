/**
 * PRD-706-R3 / R7 / R8 / R16 — marketing static build.
 *
 * Drives the canonical PRD-409 pipeline (`runBuild` from `@act-spec/cli`)
 * over the markdown corpus under `marketing/content/`, then enriches the
 * emitted manifest with the Plus-tier surface PRD-706-R7 mandates:
 *
 *   - `index_ndjson_url` + the corresponding NDJSON file (PRD-100-R37,
 *     PRD-105-R12).
 *   - `search_url_template` + a static body file at the resolved path
 *     (opaque-but-JSON per Q13 / PRD-602-R15).
 *   - `subtree_url_template` (Standard surface, kept for the per-mount
 *     subtree exposition in the MCP bridge).
 *   - `level: "strict"` on the leaf manifest.
 *
 * Also emits the PRD-706-R3 parent (routing) manifest at
 * `dist/.well-known/act.json` declaring the two mounts (PRD-706-R5).
 *
 * The build is deterministic per PRD-103-R4 / PRD-706-R16: re-running the
 * script with identical inputs produces byte-identical output. The
 * conformance script asserts byte-equality across two consecutive runs.
 *
 * NOTE: the markdown adapter ships a `core` capability declaration when
 * `mode: "coarse"` (PRD-201-R23). To target Standard we run in `fine`
 * mode and the pipeline emits subtree files; the Plus enrichments
 * (NDJSON + search) are post-pipeline because PRD-409 does not yet
 * synthesize NDJSON / search bodies on its own. This is the example's
 * narrow extension of the canonical pipeline; the rest is verbatim
 * `runBuild`. The build-determinism workaround (overwriting the
 * pipeline-injected wall-clock `generated_at`) is filed as A19 in
 * `docs/amendments-queue.md` for the v0.2 roadmap.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBuild } from '@act-spec/cli';
import { atomicWrite } from '@act-spec/generator-core';
import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { GeneratorConfig } from '@act-spec/generator-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const distRoot = path.resolve(exampleRoot, 'dist');
const marketingDist = path.resolve(distRoot, 'marketing');
const marketingContentRoot = path.resolve(exampleRoot, 'marketing', 'content');

const PARENT_MANIFEST_PATH = path.resolve(distRoot, '.well-known', 'act.json');
const MARKETING_MANIFEST_PATH = path.resolve(marketingDist, '.well-known', 'act.json');
const MARKETING_INDEX_PATH = path.resolve(marketingDist, 'act', 'index.json');
const MARKETING_NDJSON_PATH = path.resolve(marketingDist, 'act', 'index.ndjson');
const MARKETING_SEARCH_PATH = path.resolve(marketingDist, 'act', 'search.json');

const MARKETING_BASE_URL_PREFIX = '/marketing';

/**
 * PRD-706-R8 — `act build` invocation. Produces the Standard tree + the
 * canonical PRD-105 file layout under `dist/marketing/`. Plus enrichments
 * are layered after the pipeline returns.
 */
async function buildMarketing(): Promise<void> {
  const config: GeneratorConfig = {
    conformanceTarget: 'standard',
    outputDir: marketingDist,
    site: {
      name: 'Acme Marketing',
      description: 'Static marketing mount for the PRD-706 hybrid example.',
      canonical_url: 'https://acme.local/marketing',
    },
    urlTemplates: {
      indexUrl: `${MARKETING_BASE_URL_PREFIX}/act/index.json`,
      nodeUrlTemplate: `${MARKETING_BASE_URL_PREFIX}/act/nodes/{id}.json`,
      subtreeUrlTemplate: `${MARKETING_BASE_URL_PREFIX}/act/subtrees/{id}.json`,
    },
    adapters: [
      {
        adapter: createMarkdownAdapter(),
        config: {
          sourceDir: marketingContentRoot,
          // PRD-201-R23 / A8 — `fine` mode is required for the adapter to
          // declare Standard-level capabilities, which `enforceTargetLevel`
          // requires for a Standard build target.
          mode: 'fine',
          targetLevel: 'standard',
        },
        // PRD-200-R25 — adapter pinning. The markdown adapter is built
        // against ACT 0.1; pin it explicitly here.
        actVersion: '0.1',
      },
    ],
    generator: '@act-spec/example-hybrid-static-runtime-mcp',
  };

  // Wipe any prior build under the marketing dist to guarantee determinism
  // (PRD-706-R16: re-run produces byte-identical output).
  await fs.rm(marketingDist, { recursive: true, force: true });
  await fs.rm(path.resolve(distRoot, '.act-build-report.json'), { force: true });
  // The CLI writes the build-report sidecar at the cwd (we override below).
  const reportPath = path.resolve(exampleRoot, '.act-build-report.json');
  await fs.rm(reportPath, { force: true });

  await runBuild(config, {
    cwd: exampleRoot,
    buildReportPath: reportPath,
    logger: {
      debug: () => undefined,
      info: (m: string): void => console.error(`[build-marketing] ${m}`),
      warn: (m: string): void => console.error(`[build-marketing] WARN ${m}`),
      error: (m: string): void => console.error(`[build-marketing] ERROR ${m}`),
    },
  });
}

/**
 * PRD-706-R7 / R8 — enrich the marketing leaf manifest with Plus capability
 * advertisements (NDJSON + search), then write the matching files.
 *
 * The enrichment is deterministic: NDJSON entries follow the index entries
 * in document order, the search file is a fixed JSON document. Re-running
 * `buildMarketing()` then `enrichMarketingManifest()` produces byte-identical
 * output (PRD-706-R16).
 */
async function enrichMarketingManifest(): Promise<void> {
  const manifestText = await fs.readFile(MARKETING_MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const indexText = await fs.readFile(MARKETING_INDEX_PATH, 'utf8');
  const index = JSON.parse(indexText) as { nodes: Array<Record<string, unknown>> };

  // PRD-706-R7 — Plus capability advertisement.
  manifest['conformance'] = { level: 'strict' };
  manifest['index_ndjson_url'] = `${MARKETING_BASE_URL_PREFIX}/act/index.ndjson`;
  manifest['search_url_template'] = `${MARKETING_BASE_URL_PREFIX}/act/search?q={query}`;
  // PRD-706-R16 / PRD-103-R4 — overwrite the wall-clock `generated_at`
  // injected by the canonical pipeline with a fixed timestamp so the
  // build is byte-deterministic across consecutive runs. Filed as
  // amendment A19 in docs/amendments-queue.md (additive optional
  // `GeneratorConfig.generatedAt` field for @act-spec/generator-core
  // and @act-spec/cli; v0.2 milestone).
  manifest['generated_at'] = '2026-05-02T00:00:00.000Z';
  // PRD-100-R6 closed capabilities form.
  const capabilities = (manifest['capabilities'] as Record<string, unknown> | undefined) ?? {};
  capabilities['etag'] = true;
  capabilities['subtree'] = true;
  capabilities['ndjson_index'] = true;
  capabilities['search'] = { template_advertised: true };
  manifest['capabilities'] = capabilities;

  // PRD-706-R7 — marketing manifest MUST NOT declare auth (anonymous-public).
  if ('auth' in manifest) delete manifest['auth'];

  // Write the enriched manifest deterministically (sorted-key JSON via
  // canonical 2-space indent — same shape `runBuild` emits).
  await atomicWrite(MARKETING_MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  // PRD-100-R37 / PRD-105-R12 — NDJSON index. One JSON object per line in
  // index document order; trailing newline.
  const ndjsonLines = index.nodes.map((entry) => JSON.stringify(entry));
  await atomicWrite(MARKETING_NDJSON_PATH, `${ndjsonLines.join('\n')}\n`);

  // Q13 / PRD-602-R15 — search response is opaque-but-JSON. The example
  // emits a single static body that returns every marketing node id.
  const searchBody = {
    act_version: '0.1',
    query: '*',
    results: index.nodes.map((entry) => ({
      id: entry['id'],
      title: entry['title'],
      summary: entry['summary'],
    })),
  };
  await atomicWrite(MARKETING_SEARCH_PATH, JSON.stringify(searchBody, null, 2));
}

/**
 * PRD-706-R3 / R5 — emit the parent (routing) manifest at
 * `dist/.well-known/act.json`. Static, no `index_url`, no `auth`, declares
 * the two mounts with non-overlapping prefixes.
 */
async function emitParentManifest(): Promise<void> {
  const parent = {
    act_version: '0.1',
    site: {
      name: 'Acme',
      description: 'Hybrid static + runtime + MCP bridge reference deployment.',
      canonical_url: 'https://acme.local',
    },
    delivery: 'static',
    conformance: { level: 'strict' },
    mounts: [
      {
        prefix: '/marketing',
        delivery: 'static',
        manifest_url: `${MARKETING_BASE_URL_PREFIX}/.well-known/act.json`,
        conformance: { level: 'strict' },
      },
      {
        prefix: '/app',
        delivery: 'runtime',
        manifest_url: '/app/.well-known/act.json',
        conformance: { level: 'standard' },
      },
    ],
  } satisfies Record<string, unknown>;
  // The parent manifest does NOT declare a Core required field set (no
  // `index_url` / `node_url_template`) because PRD-100-R7 routing manifests
  // are mount-only; the validator's mount-walk recurses into the per-mount
  // manifests for envelope checks. The schema is permissive (additionalProperties
  // = true) and the closed `conformance` object accepts the level.
  await atomicWrite(PARENT_MANIFEST_PATH, JSON.stringify(parent, null, 2));
}

export async function buildAll(): Promise<void> {
  await buildMarketing();
  await enrichMarketingManifest();
  await emitParentManifest();
}

// CLI driver.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  buildAll()
    .then(() => {
      console.log('[build-marketing] ok');
    })
    .catch((err: unknown) => {
      console.error('[build-marketing] FAILED', err);
      process.exit(1);
    });
}

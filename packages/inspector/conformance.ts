/**
 * Conformance gate for @act-spec/inspector.
 *
 * Runs `walk(<file://manifest>)` against the astro-docs example tree
 * (examples/astro-docs/dist) via a synthetic fetcher that maps the
 * manifest's URL templates to local disk paths. The synthetic fetcher
 * mirrors the real-world layout: the manifest declares
 *   index_url:           /act/index.json
 *   node_url_template:   /act/n/{id}.json
 *   subtree_url_template:/act/sub/{id}.json
 * but the static build emits files at:
 *   /act/index.json
 *   /act/nodes/{id}.json
 *   /act/subtrees/{id}.json
 * The fetcher normalises the templated URLs onto the on-disk layout
 * (this is the rewrite a real static host would perform). The
 * inspector itself sees only WHATWG `Response` objects.
 *
 * Pass criterion (per PRD-601-R23 spirit): `walk` reports the same node
 * count as the validator's static walk — i.e. the inspector and the
 * validator agree on the size of the tree. Drift here would be the
 * "Inspector CLI spec drift" anti-pattern.
 *
 * Invoked by `pnpm -F @act-spec/inspector conformance`.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkStatic } from '@act-spec/validator';
import { walk } from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const distDir = path.join(repoRoot, 'examples', 'astro-docs', 'dist');

const ORIGIN = 'http://example.invalid';

/**
 * Map a templated `/act/n/{id}.json` URL onto the on-disk
 * `act/nodes/{id}.json` path; same for subtrees. Other URLs map
 * through unchanged.
 */
function urlToDiskPath(url: string): string | null {
  const u = new URL(url);
  const p = u.pathname;
  if (p === '/.well-known/act.json') return path.join(distDir, '.well-known', 'act.json');
  if (p === '/act/index.json') return path.join(distDir, 'act', 'index.json');
  // /act/n/{id}.json → /act/nodes/{id}.json (legacy templated form)
  let m = /^\/act\/n\/(.+)\.json$/.exec(p);
  if (m) return path.join(distDir, 'act', 'nodes', m[1]! + '.json');
  m = /^\/act\/sub\/(.+)\.json$/.exec(p);
  if (m) return path.join(distDir, 'act', 'subtrees', m[1]! + '.json');
  // /act/nodes/{id}.json — direct on-disk path (passthrough)
  m = /^\/act\/nodes\/(.+)\.json$/.exec(p);
  if (m) return path.join(distDir, 'act', 'nodes', m[1]! + '.json');
  m = /^\/act\/subtrees\/(.+)\.json$/.exec(p);
  if (m) return path.join(distDir, 'act', 'subtrees', m[1]! + '.json');
  return null;
}

const syntheticFetch: typeof globalThis.fetch = async (input) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const disk = urlToDiskPath(url);
  if (disk === null) {
    return new Response('not found', { status: 404 });
  }
  try {
    const body = await fs.readFile(disk, 'utf8');
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', etag: stableEtag(body) },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
};

function stableEtag(body: string): string {
  // Best-effort stable-but-cheap ETag: take the envelope's `etag`
  // field if present; otherwise emit a digest-style placeholder. The
  // inspector consumes this for cache_hit accounting only; the
  // validator owns determinism (PRD-103).
  try {
    const e = (JSON.parse(body) as { etag?: unknown }).etag;
    if (typeof e === 'string') return e;
  } catch {
    /* fall through */
  }
  return 's256:placeholder000000000000';
}

async function main(): Promise<void> {
  console.log('Conformance — running @act-spec/inspector walk against examples/astro-docs/dist via synthetic file:// fetcher.');

  // Validator's static walk gives us the truth-value: node count.
  const manifestPath = path.join(distDir, '.well-known', 'act.json');
  const indexPath = path.join(distDir, 'act', 'index.json');
  const nodesDir = path.join(distDir, 'act', 'nodes');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as Record<string, unknown>;
  const nodeFiles = (await fs.readdir(nodesDir)).filter((f) => f.endsWith('.json'));
  const nodes = await Promise.all(
    nodeFiles.map((f) => fs.readFile(path.join(nodesDir, f), 'utf8').then((s) => JSON.parse(s) as Record<string, unknown>)),
  );

  const validatorReport = walkStatic({
    url: `file://${manifestPath}`,
    manifest,
    index,
    nodes,
    passedAt: '2026-05-02T00:00:00Z',
  });

  const validatorNodeCount = (index['nodes'] as unknown[] | undefined)?.length ?? 0;

  // Inspector walk via synthetic fetcher.
  const inspectorReport = await walk(`${ORIGIN}/.well-known/act.json`, {
    fetch: syntheticFetch,
    sample: 'all',
  });

  console.log(`Validator (static walk):  ${validatorReport.gaps.length} gaps; index node count = ${validatorNodeCount}.`);
  console.log(
    `Inspector (walk):         ${inspectorReport.findings.length} findings; tree_summary.total_nodes = ${inspectorReport.tree_summary.total_nodes}; nodes walked = ${inspectorReport.nodes.length}.`,
  );

  let failed = 0;
  if (inspectorReport.tree_summary.total_nodes !== validatorNodeCount) {
    failed += 1;
    console.error(
      `FAIL: inspector reports ${inspectorReport.tree_summary.total_nodes} nodes but validator/index has ${validatorNodeCount}. Drift between PRD-600 and PRD-601 — anti-pattern "Inspector CLI spec drift".`,
    );
  }
  if (inspectorReport.nodes.length !== validatorNodeCount) {
    failed += 1;
    console.error(
      `FAIL: inspector walked ${inspectorReport.nodes.length} nodes but index advertises ${validatorNodeCount}.`,
    );
  }
  const erroredNodes = inspectorReport.nodes.filter((n) => n.status === 'error').length;
  if (erroredNodes > 0) {
    failed += 1;
    console.error(`FAIL: ${erroredNodes} of ${inspectorReport.nodes.length} node fetches errored.`);
    for (const n of inspectorReport.nodes) {
      if (n.status === 'error') console.error(`  - ${n.id}: ${n.findings?.[0]?.message ?? '(no detail)'}`);
    }
  }
  for (const f of inspectorReport.findings) {
    if (f.severity === 'error') {
      failed += 1;
      console.error(`FAIL: error finding from inspector: [${f.code}] ${f.message}`);
    }
  }

  if (failed > 0) {
    console.error(`\nFAIL — inspector conformance: ${failed} check(s).`);
    process.exit(1);
  }
  console.log(`\nPASS — inspector reports ${inspectorReport.nodes.length} nodes (= validator's index count); 0 error findings.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

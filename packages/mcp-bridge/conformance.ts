/**
 * Conformance gate for @act-spec/mcp-bridge.
 *
 * Implements the MCP-side enumeration probe per PRD-706 acceptance
 * criterion (e) — even though PRD-706 has not yet shipped, the harness
 * lives here so PRD-706 reuses it. The probe verifies that the union of
 * `act://...` URIs the bridge enumerates equals the static-emitted +
 * runtime-served node IDs across every mount.
 *
 * The conformance run constructs the multi-mount fixture
 * `fixtures/602/positive/hybrid-runtime-plus-static.json`: one runtime
 * mount under `/app` (Standard with subtree) plus one static mount under
 * `/marketing` (Core, no subtree). The probe then asserts:
 *   - per-mount manifest URIs are exposed (PRD-602-R6 / R7);
 *   - per-mount node URIs are exposed under their respective prefixes (R6);
 *   - the marketing mount surfaces NO subtree URIs while the app mount
 *     surfaces every node id as a subtree URI (R11 per-mount independence);
 *   - `createBridge` rejects the negative-fixture multi-mount config with
 *     overlapping prefixes (R24 / PRD-106-R20).
 *
 * Invoked by `pnpm -F @act-spec/mcp-bridge conformance`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveEtag } from '@act-spec/validator';

import {
  BridgeConfigurationError,
  buildManifestUri,
  buildResourceUri,
  buildSubtreeUri,
  createActMcpBridge,
  runMcpEnumerationProbe,
  type ActRuntime,
  type Manifest,
} from './src/index.js';

const HOST = 'workspace.example.com';
const FIXED_DATE = '2026-05-02T00:00:00Z';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolvePath(HERE, '..', '..', 'fixtures', '602');

interface HybridFixture {
  readonly mcp: { readonly name: string; readonly version: string; readonly host: string };
  readonly mounts: ReadonlyArray<{
    readonly prefix: string;
    readonly kind: 'runtime' | 'static';
    readonly manifest: Manifest;
    readonly index: { nodes: ReadonlyArray<{ id: string; title?: string; summary?: string; etag?: string }> };
    readonly nodes: ReadonlyArray<unknown>;
  }>;
}

function loadHybridFixture(): HybridFixture {
  const path = resolvePath(FIXTURE_ROOT, 'positive', 'hybrid-runtime-plus-static.json');
  return JSON.parse(readFileSync(path, 'utf8')) as HybridFixture;
}

function loadOverlapFixture(): { mounts: ReadonlyArray<{ prefix: string }> } {
  const path = resolvePath(
    FIXTURE_ROOT,
    'negative',
    'mounts-overlap-prefix',
    'mounts.json',
  );
  return JSON.parse(readFileSync(path, 'utf8')) as { mounts: ReadonlyArray<{ prefix: string }> };
}

function buildRuntimeFromFixture(
  manifest: Manifest,
  index: HybridFixture['mounts'][number]['index'],
  nodes: ReadonlyArray<unknown>,
): ActRuntime {
  return {
    resolveManifest(_req, _ctx) {
      return Promise.resolve({ kind: 'ok', value: manifest });
    },
    resolveIndex(_req, _ctx) {
      return Promise.resolve({
        kind: 'ok',
        value: {
          act_version: '0.1',
          nodes: index.nodes.map((n) => ({
            id: n.id,
            type: 'article',
            title: n.title ?? n.id,
            summary: n.summary ?? '',
            tokens: { summary: 8 },
            etag: n.etag ?? deriveEtag({ id: n.id }),
            updated_at: FIXED_DATE,
          })),
        },
      });
    },
    resolveNode(_req, _ctx, params) {
      const node = nodes.find((n) => (n as { id: string }).id === params.id);
      if (!node) return Promise.resolve({ kind: 'not_found' });
      return Promise.resolve({ kind: 'ok', value: node as never });
    },
    resolveSubtree(_req, _ctx, params) {
      const node = nodes.find((n) => (n as { id: string }).id === params.id);
      if (!node) return Promise.resolve({ kind: 'not_found' });
      return Promise.resolve({
        kind: 'ok',
        value: {
          act_version: '0.1',
          root: params.id,
          etag: deriveEtag({ id: params.id, kind: 'subtree' }),
          depth: params.depth,
          nodes: [node as never],
        },
      });
    },
  };
}

async function runHybridProbe(): Promise<void> {
  const fixture = loadHybridFixture();
  const appMount = fixture.mounts.find((m) => m.prefix === '/app');
  const marketingMount = fixture.mounts.find((m) => m.prefix === '/marketing');
  if (!appMount || !marketingMount) {
    throw new Error('hybrid fixture missing /app or /marketing mount');
  }
  const appRuntime = buildRuntimeFromFixture(appMount.manifest, appMount.index, appMount.nodes);
  const bridge = createActMcpBridge({
    runtime: appRuntime,
    httpHandler: () => Promise.resolve(null),
    mcp: fixture.mcp,
    mounts: [
      {
        prefix: '/marketing',
        source: {
          kind: 'static',
          manifestUrl: 'https://marketing.local/.well-known/act.json',
          envelopes: {
            manifest: marketingMount.manifest,
            index: marketingMount.index,
            nodes: marketingMount.nodes,
          },
        },
        manifest: marketingMount.manifest,
      },
      {
        prefix: '/app',
        source: appRuntime,
        manifest: appMount.manifest,
      },
    ],
  });

  const expectedNodeUris = [
    ...marketingMount.index.nodes.map((n) => buildResourceUri(HOST, '/marketing', n.id)),
    ...appMount.index.nodes.map((n) => buildResourceUri(HOST, '/app', n.id)),
  ];
  const expectedManifestUris = [
    buildManifestUri(HOST, null),
    buildManifestUri(HOST, '/marketing'),
    buildManifestUri(HOST, '/app'),
  ];
  const expectedSubtreeUris = appMount.index.nodes.map((n) => buildSubtreeUri(HOST, '/app', n.id));

  const report = await runMcpEnumerationProbe({
    bridge,
    expectedNodeUris,
    expectedManifestUris,
    expectedSubtreeUris,
  });

  console.log(
    `Hybrid enumeration probe — ${report.passed ? 'PASS' : 'FAIL'}: ${report.findings.length} checks`,
  );
  for (const f of report.findings) {
    const status = f.ok ? 'OK ' : 'BAD';
    console.log(`  ${status} [${f.requirement}] ${f.check}`);
    if (f.missing && f.missing.length > 0) {
      for (const m of f.missing) console.log(`         missing: ${m}`);
    }
    if (f.unexpected && f.unexpected.length > 0) {
      for (const m of f.unexpected) console.log(`         unexpected: ${m}`);
    }
  }
  if (!report.passed) {
    process.exit(1);
  }
  await bridge.dispose();
}

function runOverlapNegative(): void {
  const fixture = loadOverlapFixture();
  // Build dummy manifests for each mount so the construction-time check
  // reaches the overlap test.
  const mountsConfigured = fixture.mounts.map((m) => ({
    prefix: m.prefix,
    source: {
      kind: 'static' as const,
      manifestUrl: `https://example.com${m.prefix}/.well-known/act.json`,
    },
    manifest: {
      act_version: '0.1',
      site: { name: 'overlap' },
      delivery: 'runtime',
      conformance: { level: 'core' },
      auth: { schemes: [] },
      index_url: '/index.json',
      node_url_template: '/n/{id}',
    } as Manifest,
  }));
  try {
    createActMcpBridge({
      runtime: {} as ActRuntime,
      httpHandler: () => Promise.resolve(null),
      mcp: { name: 'x', version: '1', host: 'example.com' },
      mounts: mountsConfigured,
    });
    console.error('FAIL — createBridge accepted overlapping prefixes (PRD-602-R24 / PRD-106-R20)');
    process.exit(1);
  } catch (err) {
    if (err instanceof BridgeConfigurationError && err.code === 'OVERLAPPING_PREFIXES') {
      console.log(
        `Overlap negative probe — PASS: createBridge rejected overlapping prefixes with code ${err.code}`,
      );
      return;
    }
    console.error('FAIL — unexpected error from createBridge:', err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('Conformance — @act-spec/mcp-bridge (PRD-602)');
  console.log('  fixtures root:', FIXTURE_ROOT);

  await runHybridProbe();
  runOverlapNegative();

  console.log('\nPASS — @act-spec/mcp-bridge conformance: hybrid + overlap-negative.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

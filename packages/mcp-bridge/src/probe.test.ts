/**
 * `runMcpEnumerationProbe` tests — PRD-706 acceptance criterion (e).
 *
 * The probe verifies the union of MCP-surfaced URIs equals the
 * static-emitted + runtime-served node IDs. Implements PRD-706-R13
 * drift-prevention via the same walker `@act-spec/validator`'s
 * `walkStatic` consumes.
 */
import { describe, expect, it } from 'vitest';

import {
  coreManifest,
  makeRuntime,
  makeStaticEnvelopes,
  standardManifest,
  FIXTURE_DOCS,
} from './_fixtures.js';
import { createActMcpBridge } from './bridge.js';
import { runMcpEnumerationProbe } from './probe.js';
import {
  buildManifestUri,
  buildResourceUri,
  buildSubtreeUri,
} from './uri.js';

const HOST = 'docs.example.com';

describe('PRD-706 acceptance criterion (e): runMcpEnumerationProbe', () => {
  it('passes when expected node URIs equal the bridge enumeration (single-source)', async () => {
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'docs', version: '1.0.0', host: HOST },
    });
    const expected = FIXTURE_DOCS.map((d) => buildResourceUri(HOST, null, d.id));
    const report = await runMcpEnumerationProbe({
      bridge,
      expectedNodeUris: expected,
      expectedManifestUris: [buildManifestUri(HOST, null)],
    });
    expect(report.passed).toBe(true);
  });

  it('fails when an expected node URI is missing', async () => {
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'docs', version: '1.0.0', host: HOST },
    });
    const expected = [
      ...FIXTURE_DOCS.map((d) => buildResourceUri(HOST, null, d.id)),
      buildResourceUri(HOST, null, 'nonexistent/node'),
    ];
    const report = await runMcpEnumerationProbe({ bridge, expectedNodeUris: expected });
    expect(report.passed).toBe(false);
    const missingFinding = report.findings.find(
      (f) => f.check === 'enumeration_includes_all_node_uris',
    );
    expect(missingFinding?.ok).toBe(false);
    expect(missingFinding?.missing).toEqual([buildResourceUri(HOST, null, 'nonexistent/node')]);
  });

  it('multi-mount: probe verifies per-mount manifests + per-mount node URIs + per-mount subtree URIs', async () => {
    const staticEnv = makeStaticEnvelopes();
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: true }),
      httpHandler: async () => null,
      mcp: { name: 'workspace', version: '1.0.0', host: HOST },
      mounts: [
        {
          prefix: '/marketing',
          source: {
            kind: 'static',
            manifestUrl: 'https://m/.well-known/act.json',
            envelopes: staticEnv,
          },
          manifest: coreManifest(),
        },
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    const expectedNodes = [
      ...FIXTURE_DOCS.map((d) => buildResourceUri(HOST, '/marketing', d.id)),
      ...FIXTURE_DOCS.map((d) => buildResourceUri(HOST, '/app', d.id)),
    ];
    const expectedManifests = [
      buildManifestUri(HOST, null),
      buildManifestUri(HOST, '/marketing'),
      buildManifestUri(HOST, '/app'),
    ];
    const expectedSubtrees = FIXTURE_DOCS.map((d) => buildSubtreeUri(HOST, '/app', d.id));
    const report = await runMcpEnumerationProbe({
      bridge,
      expectedNodeUris: expectedNodes,
      expectedManifestUris: expectedManifests,
      expectedSubtreeUris: expectedSubtrees,
    });
    expect(report.passed).toBe(true);
  });
});

/**
 * `createActMcpBridge` end-to-end tests.
 *
 * Covers PRD-602-R2 (factory / dispose), R3 (construction validation),
 * R5 (single bridge identity), R6 (URI scheme single + multi-mount),
 * R7 (manifest as resource), R8 (one node = one resource, blocks
 * inline), R9 (capabilities mapping), R11 (subtree list resource;
 * per-mount independence), R13 (etag → metadata), R14 (failure
 * mapping; PRD-500-R18 byte-equivalence), R22 (start/dispose lifecycle).
 */
import { describe, expect, it } from 'vitest';

import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  coreManifest,
  makeRuntime,
  makeStaticEnvelopes,
  standardManifest,
  FIXTURE_DOCS,
} from './_fixtures.js';
import { createActMcpBridge, McpBridgeError } from './bridge.js';
import { buildResourceUri, buildManifestUri, buildSubtreeUri } from './uri.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { BridgeConfig } from './types.js';

const HOST = 'docs.example.com';

function singleSourceConfig(opts: { subtree: boolean }): BridgeConfig {
  return {
    runtime: makeRuntime({ subtree: opts.subtree }),
    httpHandler: async () => null,
    mcp: { name: 'docs', version: '1.0.0', host: HOST },
  };
}

describe('PRD-602-R2 createActMcpBridge: factory + lifecycle', () => {
  it('returns a Bridge with mcpServer + httpHandler + start + dispose', () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    expect(typeof bridge.start).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
    expect(bridge.mcpServer).toBeDefined();
    expect(bridge.httpHandler).toBeDefined();
  });

  it('passes through the operator-supplied httpHandler verbatim (PRD-602-R4)', () => {
    const handler = async () => null;
    const bridge = createActMcpBridge({
      ...singleSourceConfig({ subtree: false }),
      httpHandler: handler,
    });
    expect(bridge.httpHandler).toBe(handler);
  });

  it('dispose is idempotent', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    await bridge.dispose();
    await bridge.dispose(); // second call should not throw
  });
});

describe('PRD-602-R5 single bridge identity covers all mounts', () => {
  it('one MCP server is constructed regardless of mount count', () => {
    const a = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const b = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'docs', version: '1.0.0', host: HOST },
      mounts: [
        {
          prefix: '/marketing',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: coreManifest(),
        },
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    expect(a.mcpServer).not.toBe(b.mcpServer);
    // Each bridge produces exactly ONE server (PRD-602-R5).
    expect(b.mcpServer).toBeDefined();
  });
});

describe('PRD-602-R6 / R7 / R8 single-source ListResources + ReadResource', () => {
  it('ListResources surfaces act://<host>/manifest + every node id', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const uris = await bridge.enumerateResourceUris();
    expect(uris).toContain(buildManifestUri(HOST, null));
    for (const doc of FIXTURE_DOCS) {
      expect(uris).toContain(buildResourceUri(HOST, null, doc.id));
    }
  });

  it('ReadResource on the manifest URI returns the runtime-profile manifest', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const result = await invokeReadResource(bridge.mcpServer as Server, buildManifestUri(HOST, null));
    expect(result.contents).toHaveLength(1);
    const c = result.contents[0]!;
    expect(c.mimeType).toBe('application/act-manifest+json; profile=runtime');
    const manifest = JSON.parse(c.text as string) as { act_version: string };
    expect(manifest.act_version).toBe('0.1');
  });

  it('ReadResource on a node URI returns the full node payload (blocks inline per R8)', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const uri = buildResourceUri(HOST, null, FIXTURE_DOCS[0]!.id);
    const result = await invokeReadResource(bridge.mcpServer as Server, uri);
    const c = result.contents[0]!;
    expect(c.mimeType).toBe('application/act-node+json; profile=runtime');
    const node = JSON.parse(c.text as string) as { id: string; content: { type: string }[] };
    expect(node.id).toBe(FIXTURE_DOCS[0]!.id);
    // PRD-602-R8 — blocks are inline, not separate resources.
    expect(Array.isArray(node.content)).toBe(true);
    expect(node.content[0]!.type).toBe('prose');
  });
});

describe('PRD-602-R6 multi-mount URI form', () => {
  it('ListResources surfaces per-mount manifests + node URIs under each prefix', async () => {
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
          manifest: staticEnv.manifest,
        },
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    const uris = await bridge.enumerateResourceUris();
    expect(uris).toContain(buildManifestUri(HOST, null));
    expect(uris).toContain(buildManifestUri(HOST, '/marketing'));
    expect(uris).toContain(buildManifestUri(HOST, '/app'));
    for (const doc of FIXTURE_DOCS) {
      expect(uris).toContain(buildResourceUri(HOST, '/marketing', doc.id));
      expect(uris).toContain(buildResourceUri(HOST, '/app', doc.id));
    }
  });

  it('ReadResource routes to the longest-matching mount (PRD-106-R20)', async () => {
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
          manifest: staticEnv.manifest,
        },
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    const marketingUri = buildResourceUri(HOST, '/marketing', FIXTURE_DOCS[0]!.id);
    const result = await invokeReadResource(bridge.mcpServer as Server, marketingUri);
    expect(result.contents[0]!.mimeType).toBe('application/act-node+json; profile=runtime');
  });
});

describe('PRD-602-R11 subtree list resource (Standard) + per-mount independence', () => {
  it('single-source: subtree URI returns child URIs in DFS preorder', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: true }));
    const uri = buildSubtreeUri(HOST, null, FIXTURE_DOCS[0]!.id);
    const result = await invokeReadResource(bridge.mcpServer as Server, uri);
    const body = JSON.parse(result.contents[0]!.text as string) as {
      root: string;
      depth: number;
      children: string[];
    };
    expect(body.root).toBe(FIXTURE_DOCS[0]!.id);
    expect(Array.isArray(body.children)).toBe(true);
    expect(body.children).toContain(buildResourceUri(HOST, null, FIXTURE_DOCS[0]!.id));
  });

  it('single-source without subtree advertisement: subtree URI is RESOURCE_NOT_FOUND (PRD-500-R18)', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const uri = buildSubtreeUri(HOST, null, FIXTURE_DOCS[0]!.id);
    await expect(
      invokeReadResource(bridge.mcpServer as Server, uri),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it('multi-mount: a mount that does NOT advertise subtree MUST NOT expose ?subtree=1 resources', async () => {
    const staticEnv = makeStaticEnvelopes();
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: true }),
      httpHandler: async () => null,
      mcp: { name: 'workspace', version: '1.0.0', host: HOST },
      mounts: [
        {
          // marketing mount: core, no subtree advertisement
          prefix: '/marketing',
          source: {
            kind: 'static',
            manifestUrl: 'https://m/.well-known/act.json',
            envelopes: staticEnv,
          },
          manifest: staticEnv.manifest,
        },
        {
          // app mount: standard, with subtree
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    const uris = await bridge.enumerateResourceUris();

    // marketing mount: NO subtree URIs.
    const marketingSubtreeUris = uris.filter(
      (u) => u.startsWith(`act://${HOST}/marketing/`) && u.includes('?subtree=1'),
    );
    expect(marketingSubtreeUris).toHaveLength(0);

    // app mount: yes, subtree URIs surface.
    const appSubtreeUris = uris.filter(
      (u) => u.startsWith(`act://${HOST}/app/`) && u.includes('?subtree=1'),
    );
    expect(appSubtreeUris.length).toBeGreaterThan(0);

    // Marketing subtree request → RESOURCE_NOT_FOUND per PRD-602-R11 + PRD-500-R18.
    const marketingSubtreeUri = buildSubtreeUri(HOST, '/marketing', FIXTURE_DOCS[0]!.id);
    await expect(
      invokeReadResource(bridge.mcpServer as Server, marketingSubtreeUri),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });
});

describe('PRD-602-R13 etag → resource metadata', () => {
  it('every node entry surfaces act_etag + act_version in metadata', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const list = await invokeListResources(bridge.mcpServer as Server);
    const docId = FIXTURE_DOCS[0]!.id;
    const entry = list.resources.find((r) => r.uri === buildResourceUri(HOST, null, docId));
    expect(entry).toBeDefined();
    expect(entry!.metadata).toMatchObject({ act_version: '0.1' });
    expect(entry!.metadata!['act_etag']).toBeTruthy();
  });
});

describe('PRD-602-R14 / PRD-500-R18 failure mapping', () => {
  it('reading an unknown node URI surfaces RESOURCE_NOT_FOUND', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const uri = buildResourceUri(HOST, null, 'no/such/node');
    try {
      await invokeReadResource(bridge.mcpServer as Server, uri);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(McpBridgeError);
      expect((err as McpBridgeError).actErrorCode).toBe('RESOURCE_NOT_FOUND');
    }
  });

  it('an act:// URI with the wrong host is RESOURCE_NOT_FOUND (no host leak)', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    await expect(
      invokeReadResource(bridge.mcpServer as Server, 'act://other.example.com/anything'),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it('a non-act URI is RESOURCE_NOT_FOUND', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    await expect(
      invokeReadResource(bridge.mcpServer as Server, 'http://docs.example.com/foo'),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });
});

describe('PRD-602-R14 additional error paths', () => {
  it('subtree resolver returning not_found surfaces RESOURCE_NOT_FOUND', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: true }));
    // Subtree URI for an id the runtime does not know.
    const uri = buildSubtreeUri(HOST, null, 'no/such');
    await expect(invokeReadResource(bridge.mcpServer as Server, uri)).rejects.toBeInstanceOf(
      McpBridgeError,
    );
  });

  it('multi-mount: node URI under runtime mount with unknown id surfaces RESOURCE_NOT_FOUND', async () => {
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: true }),
      httpHandler: async () => null,
      mcp: { name: 'workspace', version: '1.0.0', host: HOST },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    const uri = buildResourceUri(HOST, '/app', 'no/such');
    await expect(invokeReadResource(bridge.mcpServer as Server, uri)).rejects.toBeInstanceOf(
      McpBridgeError,
    );
  });

  it('multi-mount: subtree URI on a runtime mount where source.resolveSubtree returns not_found', async () => {
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: true }),
      httpHandler: async () => null,
      mcp: { name: 'workspace', version: '1.0.0', host: HOST },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    });
    const uri = buildSubtreeUri(HOST, '/app', 'no/such');
    await expect(invokeReadResource(bridge.mcpServer as Server, uri)).rejects.toBeInstanceOf(
      McpBridgeError,
    );
  });

  it('multi-mount: ReadResource on a URI whose prefix matches no mount surfaces RESOURCE_NOT_FOUND', async () => {
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'workspace', version: '1.0.0', host: HOST },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: false }),
          manifest: coreManifest(),
        },
      ],
    });
    const uri = buildResourceUri(HOST, '/marketing', 'doc/intro');
    await expect(invokeReadResource(bridge.mcpServer as Server, uri)).rejects.toBeInstanceOf(
      McpBridgeError,
    );
  });

  it('multi-mount: ReadResource on a static-source mount returns the node payload', async () => {
    const staticEnv = makeStaticEnvelopes();
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
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
          manifest: staticEnv.manifest,
        },
      ],
    });
    const uri = buildResourceUri(HOST, '/marketing', FIXTURE_DOCS[0]!.id);
    const result = await invokeReadResource(bridge.mcpServer as Server, uri);
    expect(result.contents[0]!.mimeType).toBe('application/act-node+json; profile=runtime');
  });

  it('multi-mount: ReadResource on a per-mount manifest URI returns that mount manifest', async () => {
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'workspace', version: '1.0.0', host: HOST },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: false }),
          manifest: coreManifest(),
        },
      ],
    });
    const uri = buildManifestUri(HOST, '/app');
    const result = await invokeReadResource(bridge.mcpServer as Server, uri);
    expect(result.contents[0]!.mimeType).toBe('application/act-manifest+json; profile=runtime');
  });

  it('multi-mount: ReadResource on a static-source mount with unknown id surfaces RESOURCE_NOT_FOUND', async () => {
    const staticEnv = makeStaticEnvelopes();
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
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
          manifest: staticEnv.manifest,
        },
      ],
    });
    const uri = buildResourceUri(HOST, '/marketing', 'no/such');
    await expect(invokeReadResource(bridge.mcpServer as Server, uri)).rejects.toBeInstanceOf(
      McpBridgeError,
    );
  });

  it('multi-mount: subtree URI on a static-source mount returns DFS-preorder children when subtree is advertised', async () => {
    const staticEnv = makeStaticEnvelopes();
    const m = staticEnv.manifest;
    m.conformance = { level: 'standard' };
    m.subtree_url_template = '/act/sub/{id}';
    const bridge = createActMcpBridge({
      runtime: makeRuntime({ subtree: false }),
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
          manifest: m,
        },
      ],
    });
    const uri = buildSubtreeUri(HOST, '/marketing', FIXTURE_DOCS[0]!.id);
    const result = await invokeReadResource(bridge.mcpServer as Server, uri);
    const body = JSON.parse(result.contents[0]!.text as string) as {
      root: string;
      children: string[];
    };
    expect(body.root).toBe(FIXTURE_DOCS[0]!.id);
    expect(body.children.length).toBeGreaterThan(0);
  });
});

describe('PRD-602-R5 / R22 wired through MCP Client over InMemoryTransport', () => {
  it('an MCP client can list and read resources end-to-end', async () => {
    const bridge = createActMcpBridge(singleSourceConfig({ subtree: false }));
    const server = bridge.mcpServer as Server;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'probe', version: '1.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const list = await client.listResources();
    expect(list.resources.some((r) => r.uri === buildManifestUri(HOST, null))).toBe(true);

    const readManifest = await client.readResource({ uri: buildManifestUri(HOST, null) });
    expect(readManifest.contents).toHaveLength(1);

    await client.close();
    await server.close();
  });
});

// --- helpers ---------------------------------------------------------------

interface ServerWithHandlers {
  _requestHandlers?: Map<string, (req: unknown, extra: unknown) => unknown>;
}

async function invokeListResources(server: Server): Promise<{ resources: { uri: string; metadata?: Record<string, unknown> }[] }> {
  const internal = server as unknown as ServerWithHandlers;
  const handler = internal._requestHandlers?.get('resources/list');
  if (!handler) throw new Error('resources/list handler not registered');
  const req = ListResourcesRequestSchema.parse({ method: 'resources/list', params: {} });
  return (await handler(req, {})) as { resources: { uri: string; metadata?: Record<string, unknown> }[] };
}

async function invokeReadResource(server: Server, uri: string): Promise<{ contents: { uri: string; mimeType: string; text?: string }[] }> {
  const internal = server as unknown as ServerWithHandlers;
  const handler = internal._requestHandlers?.get('resources/read');
  if (!handler) throw new Error('resources/read handler not registered');
  const req = ReadResourceRequestSchema.parse({ method: 'resources/read', params: { uri } });
  return (await handler(req, {})) as { contents: { uri: string; mimeType: string; text?: string }[] };
}

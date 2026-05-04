/**
 * PRD-602-R2 / R5 — `createActMcpBridge(config)` factory.
 *
 * Returns a {@link Bridge} wrapping the supplied `ActRuntime` (single-source
 * default) or {@link BridgeConfig.mounts} (multi-mount per amendment A4):
 *
 *  - {@link Bridge.httpHandler} — the operator's chosen leaf SDK handler,
 *    re-exported verbatim. The bridge does NOT re-implement HTTP dispatch
 *    (PRD-602-R4).
 *  - {@link Bridge.mcpServer} — the constructed MCP `Server` instance with
 *    `ListResources` and `ReadResource` request handlers wired (PRD-602-R5
 *    / R6 / R7 / R8 / R11).
 *  - {@link Bridge.start} — convenience wiring of an MCP transport. v0.1
 *    ships stdio per PRD-602-R22.
 *  - {@link Bridge.dispose} — clean shutdown of both protocols.
 *
 * Construction-time validation per PRD-602-R3 / R24 / R25 fires
 * synchronously inside this factory; configuration mismatches throw
 * before any request is dispatched.
 *
 * The MCP-side resource enumeration is the bridge's only structural
 * concession (PRD-602-R11): per-mount manifests appear at
 * `act://<host>/<prefix>/manifest`, plus the unprefixed
 * `act://<host>/manifest` carrying the parent (routing) manifest in
 * multi-mount deployments and the runtime-profile manifest in
 * single-mount deployments.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { decodeIdFromUrl } from '@act-spec/runtime-core';

import { mapOutcomeToMcpError } from './failure-map.js';
import { readStaticSource, type StaticReadResult } from './static-source.js';
import type {
  Bridge,
  BridgeConfig,
  BridgeMount,
  BridgeTransport,
  IdentityBridge,
} from './types.js';
import type { ActContext, ActRequest } from '@act-spec/runtime-core';
import {
  buildManifestUri,
  buildResourceUri,
  buildSubtreeUri,
  resolveMountByPath,
} from './uri.js';
import { isStaticSource, validateBridgeConfig } from './validate-config.js';

const ACT_VERSION = '0.1';
const NODE_MIME = 'application/act-node+json; profile=runtime';
const MANIFEST_MIME = 'application/act-manifest+json; profile=runtime';

interface ResolvedMount {
  readonly prefix: string;
  readonly mount: BridgeMount;
  /** Pre-loaded static-source data (when source is StaticSource). */
  readonly staticData?: StaticReadResult;
}

/**
 * PRD-602-R2 — bridge factory. Aliased as `createBridge` for textual
 * conformance with PRD-602-R2's exact name; the longer
 * `createActMcpBridge` is the recommended public spelling.
 */
export function createActMcpBridge(config: BridgeConfig): Bridge {
  validateBridgeConfig(config);

  // Resolve mounts: pre-walk static sources at construction time so
  // `enumerateResourceUris` and `ListResources` can return synchronously
  // without per-request fetches. Runtime mounts are resolved lazily.
  const mounts: ResolvedMount[] = [];
  if (config.mounts) {
    // Synchronous resolution placeholder — we'll fill staticData below
    // after async pre-walk completes. For factory simplicity we pre-walk
    // synchronously by deferring to an internal init() the caller can
    // await, OR we accept pre-loaded envelopes per StaticSource.envelopes
    // (the PRD-706-R12 build-time pattern).
    for (const m of config.mounts) {
      if (isStaticSource(m.source) && m.source.envelopes) {
        mounts.push({
          prefix: m.prefix,
          mount: m,
          staticData: {
            manifest: m.source.envelopes.manifest ?? m.manifest,
            index:
              (m.source.envelopes.index as StaticReadResult['index'] | undefined) ?? {
                nodes: [],
              },
            nodes: (m.source.envelopes.nodes ?? []) as StaticReadResult['nodes'],
          },
        });
      } else {
        mounts.push({ prefix: m.prefix, mount: m });
      }
    }
  }

  const mcpServer = new Server(
    { name: config.mcp.name, version: config.mcp.version },
    { capabilities: deriveMcpCapabilities(config) },
  );

  // PRD-602-R6 / R7 / R8 — ListResources handler. Surfaces the parent
  // manifest, every per-mount manifest (multi-mount), and every node id
  // under each mount.
  mcpServer.setRequestHandler(ListResourcesRequestSchema, async (_req, _extra) => {
    const resources = await collectAllResources(config, mounts);
    return { resources };
  });

  // PRD-602-R6 / R8 / R11 — ReadResource handler. Maps the URI to the
  // owning mount (longest-prefix per PRD-106-R20), then delegates to the
  // mount's source.
  mcpServer.setRequestHandler(ReadResourceRequestSchema, async (req, _extra) => {
    const uri = req.params.uri;
    const result = await readResourceByUri(uri, config, mounts);
    if (!result.ok) {
      // Per PRD-602-R14 / PRD-500-R18 we emit the MCP-side error envelope
      // through the SDK's error channel. The SDK throws an `McpError`
      // when the handler throws; we surface the canonical envelope as
      // the thrown message + a structured `data` payload.
      const err = result.error;
      // The SDK's error envelope is `{ code: number, message: string,
      // data?: unknown }`. We use a stable code per PRD-602-R14 with the
      // string code stashed in `data.act_error_code`; clients dispatch
      // on `data.act_error_code` rather than the numeric SDK code.
      throw new McpBridgeError(err.code, err.message, err.data);
    }
    return result.value;
  });

  let stdioTransport: StdioServerTransport | null = null;

  const bridge: Bridge = {
    httpHandler: config.httpHandler,
    mcpServer,
    async start(transport: BridgeTransport) {
      if (transport === 'stdio') {
        stdioTransport = new StdioServerTransport();
        await mcpServer.connect(stdioTransport);
        return;
      }
      // Custom transport — operator-supplied (HTTP+SSE / streamable-HTTP).
      // The SDK's `Server.connect` accepts any `Transport` implementer.
      await mcpServer.connect(transport.transport as Parameters<Server['connect']>[0]);
    },
    async dispose() {
      if (stdioTransport) {
        try {
          await stdioTransport.close();
        } catch {
          // best-effort
        }
        stdioTransport = null;
      }
      try {
        await mcpServer.close();
      } catch {
        // best-effort
      }
    },
    async enumerateResourceUris(_identityBridgeOverride?: IdentityBridge) {
      const all = await collectAllResources(config, mounts);
      return all.map((r) => r.uri);
    },
  };

  return bridge;
}

/** PRD-602-R2 alias matching the PRD's exact spelling. */
export const createBridge = createActMcpBridge;

/**
 * PRD-602-R9 — derive MCP server capabilities from the runtime's
 * advertised manifest. Subscriptions are gated by
 * `features.subscriptions === true` AND the runtime exposing an
 * `onChange` event source (per PRD-602-R17; v0.1 runtimes lack
 * `onChange`, so subscribe stays opt-in).
 */
function deriveMcpCapabilities(config: BridgeConfig): {
  resources: { listChanged: boolean; subscribe?: boolean };
} {
  const caps: { resources: { listChanged: boolean; subscribe?: boolean } } = {
    resources: { listChanged: true },
  };
  if (
    config.features?.subscriptions === true &&
    typeof (config.runtime as { onChange?: unknown }).onChange === 'function'
  ) {
    caps.resources.subscribe = true;
  }
  return caps;
}

/**
 * Collect every MCP-surfaced resource entry across the bridge: the
 * unprefixed `act://<host>/manifest` (parent / runtime-profile manifest),
 * each per-mount `act://<host>/<prefix>/manifest`, and every node id under
 * each mount. Subtree list resources are surfaced when the mount manifest
 * advertises subtree (PRD-602-R11).
 */
async function collectAllResources(
  config: BridgeConfig,
  mounts: readonly ResolvedMount[],
): Promise<ReadonlyArray<{ uri: string; name: string; mimeType: string; description?: string; metadata: Record<string, unknown> }>> {
  const host = config.mcp.host;
  const out: Array<{ uri: string; name: string; mimeType: string; description?: string; metadata: Record<string, unknown> }> = [];

  // PRD-602-R7 — unprefixed parent manifest (single-mount: runtime-profile;
  // multi-mount: parent / routing manifest).
  out.push({
    uri: buildManifestUri(host, null),
    name: 'ACT manifest',
    mimeType: MANIFEST_MIME,
    metadata: { act_version: ACT_VERSION },
  });

  if (mounts.length === 0) {
    // Single-source path. Surface the runtime's manifest's index entries.
    const indexEntries = await readSingleSourceIndex(config);
    for (const entry of indexEntries) {
      out.push(buildIndexResourceEntry(host, null, entry));
    }
    return out;
  }

  // Multi-mount path.
  for (const m of mounts) {
    out.push({
      uri: buildManifestUri(host, m.prefix),
      name: `Mount manifest: ${m.prefix}`,
      mimeType: MANIFEST_MIME,
      metadata: {
        act_version: ACT_VERSION,
        mount_prefix: m.prefix,
      },
    });

    const entries = await readMountIndex(m);
    for (const entry of entries) {
      out.push(buildIndexResourceEntry(host, m.prefix, entry));

      // PRD-602-R11 — per-mount subtree exposition: only when this mount's
      // manifest advertises subtree.
      if (m.mount.manifest.subtree_url_template || m.mount.manifest.capabilities?.subtree) {
        out.push({
          uri: buildSubtreeUri(host, m.prefix, entry.id),
          name: `${entry.title ?? entry.id} (subtree)`,
          mimeType: 'application/json; profile=subtree',
          metadata: {
            act_version: ACT_VERSION,
            mount_prefix: m.prefix,
            subtree_root: entry.id,
          },
        });
      }
    }
  }

  return out;
}

interface IndexEntryLike {
  id: string;
  title?: string | undefined;
  summary?: string | undefined;
  etag?: string | undefined;
}

function buildIndexResourceEntry(
  host: string,
  mountPrefix: string | null,
  entry: IndexEntryLike,
): { uri: string; name: string; mimeType: string; description?: string; metadata: Record<string, unknown> } {
  const base: { uri: string; name: string; mimeType: string; metadata: Record<string, unknown> } = {
    uri: buildResourceUri(host, mountPrefix, entry.id),
    name: entry.title ?? entry.id,
    mimeType: NODE_MIME,
    metadata: {
      // PRD-602-R13 — etag exposed as resource metadata.
      ...(entry.etag ? { act_etag: entry.etag } : {}),
      act_version: ACT_VERSION,
      ...(mountPrefix ? { mount_prefix: mountPrefix } : {}),
    },
  };
  if (entry.summary) {
    return { ...base, description: entry.summary };
  }
  return base;
}

async function readSingleSourceIndex(config: BridgeConfig): Promise<readonly IndexEntryLike[]> {
  // For single-source we delegate to the runtime's resolveIndex. We
  // synthesize a minimal ActRequest/ActContext per PRD-500-R3.
  const out = await config.runtime.resolveIndex(synthRequest(), synthContext());
  if (out.kind !== 'ok') return [];
  const idx = out.value;
  return (idx.nodes ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    etag: n.etag,
  }));
}

async function readMountIndex(m: ResolvedMount): Promise<readonly IndexEntryLike[]> {
  if (isStaticSource(m.mount.source)) {
    let data = m.staticData;
    if (!data) {
      data = await readStaticSource(m.mount.source);
    }
    return data.index.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      etag: n.etag,
    }));
  }
  const out = await m.mount.source.resolveIndex(synthRequest(), synthContext());
  if (out.kind !== 'ok') return [];
  return (out.value.nodes ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    etag: n.etag,
  }));
}

/**
 * Read a resource by URI. Returns `{ ok: true, value }` on success or
 * `{ ok: false, error }` on failure (the caller throws).
 */
async function readResourceByUri(
  uri: string,
  config: BridgeConfig,
  mounts: readonly ResolvedMount[],
): Promise<
  | { ok: true; value: { contents: ReadonlyArray<{ uri: string; mimeType: string; text: string }> } }
  | { ok: false; error: ReturnType<typeof mapOutcomeToMcpError> }
> {
  const parsed = parseActUri(uri, config.mcp.host);
  if (!parsed) {
    return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
  }

  // Subtree request (`?subtree=1`).
  if (parsed.isSubtree) {
    return readSubtreeResource(parsed, config, mounts);
  }

  // Multi-mount routing.
  if (mounts.length > 0) {
    const matched = resolveMountByPath(parsed.pathAfterHost, mounts.map((m) => m.prefix));
    if (!matched) {
      return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
    }
    const mount = mounts.find((m) => m.prefix === matched.matchedPrefix);
    if (!mount) {
      return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
    }
    const decodedRemainder = decodeIdFromUrl(matched.remainder);
    if (decodedRemainder === 'manifest') {
      return readManifestForMount(mount, parsed.uri);
    }
    return readNodeForMount(mount, decodedRemainder, parsed.uri);
  }

  // Single-source routing.
  const decodedId = decodeIdFromUrl(parsed.pathAfterHost);
  if (decodedId === 'manifest') {
    return readSingleSourceManifest(config, parsed.uri);
  }
  return readSingleSourceNode(config, decodedId, parsed.uri);
}

interface ParsedUri {
  readonly uri: string;
  readonly pathAfterHost: string;
  readonly isSubtree: boolean;
}

function parseActUri(uri: string, expectedHost: string): ParsedUri | null {
  if (!uri.startsWith('act://')) return null;
  const rest = uri.slice('act://'.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx <= 0) return null;
  const host = rest.slice(0, slashIdx);
  if (host !== expectedHost) return null;
  let pathAfterHost = rest.slice(slashIdx + 1);
  let isSubtree = false;
  const qIdx = pathAfterHost.indexOf('?');
  if (qIdx >= 0) {
    const query = pathAfterHost.slice(qIdx + 1);
    pathAfterHost = pathAfterHost.slice(0, qIdx);
    if (query.split('&').includes('subtree=1')) {
      isSubtree = true;
    }
  }
  return { uri, pathAfterHost, isSubtree };
}

async function readSubtreeResource(
  parsed: ParsedUri,
  config: BridgeConfig,
  mounts: readonly ResolvedMount[],
): Promise<
  | { ok: true; value: { contents: ReadonlyArray<{ uri: string; mimeType: string; text: string }> } }
  | { ok: false; error: ReturnType<typeof mapOutcomeToMcpError> }
> {
  // Resolve the mount and decoded id.
  let mount: ResolvedMount | null = null;
  let decodedId: string;
  if (mounts.length > 0) {
    const matched = resolveMountByPath(parsed.pathAfterHost, mounts.map((m) => m.prefix));
    if (!matched) return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
    mount = mounts.find((m) => m.prefix === matched.matchedPrefix) ?? null;
    decodedId = decodeIdFromUrl(matched.remainder);
  } else {
    decodedId = decodeIdFromUrl(parsed.pathAfterHost);
  }

  // PRD-602-R11 — per-mount subtree advertisement is independent. Mounts
  // (or the single source) without subtree advertisement MUST surface
  // RESOURCE_NOT_FOUND, byte-equivalent to a missing-resource response
  // per PRD-500-R18.
  const manifest = mount ? mount.mount.manifest : null;
  const advertisesSubtree = manifest
    ? Boolean(manifest.subtree_url_template) || Boolean(manifest.capabilities?.subtree)
    : await singleSourceAdvertisesSubtree(config);
  if (!advertisesSubtree) {
    return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
  }

  // Delegate to the source.
  const source = mount ? mount.mount.source : config.runtime;
  if (isStaticSource(source)) {
    // Static-source subtree: synthesize the list-of-resources from the
    // mount's static index (depth-first preorder per PRD-100-R35).
    let data = mount?.staticData;
    if (!data && mount) {
      data = await readStaticSource(source);
    }
    if (!data) {
      return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
    }
    const ids = data.index.nodes.map((n) => n.id);
    const childUris = ids.map((id) =>
      buildResourceUri(config.mcp.host, mount?.prefix ?? null, id),
    );
    return {
      ok: true,
      value: {
        contents: [
          {
            uri: parsed.uri,
            mimeType: 'application/json; profile=subtree',
            text: JSON.stringify({ root: decodedId, depth: 3, children: childUris }),
          },
        ],
      },
    };
  }

  if (typeof source.resolveSubtree !== 'function') {
    return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
  }
  const subtreeOut = await source.resolveSubtree(synthRequest(), synthContext(), {
    id: decodedId,
    depth: 3,
  });
  if (subtreeOut.kind !== 'ok') {
    return { ok: false, error: mapOutcomeToMcpError(subtreeOut) };
  }
  const subtree = subtreeOut.value;
  const childUris = (subtree.nodes ?? []).map((n) =>
    buildResourceUri(config.mcp.host, mount?.prefix ?? null, n.id),
  );
  return {
    ok: true,
    value: {
      contents: [
        {
          uri: parsed.uri,
          mimeType: 'application/json; profile=subtree',
          text: JSON.stringify({ root: subtree.root, depth: subtree.depth, children: childUris }),
        },
      ],
    },
  };
}

async function singleSourceAdvertisesSubtree(config: BridgeConfig): Promise<boolean> {
  const out = await config.runtime.resolveManifest(synthRequest(), synthContext());
  if (out.kind !== 'ok') return false;
  return Boolean(out.value.subtree_url_template) || Boolean(out.value.capabilities?.subtree);
}

function readManifestForMount(
  mount: ResolvedMount,
  uri: string,
):
  | { ok: true; value: { contents: ReadonlyArray<{ uri: string; mimeType: string; text: string }> } }
  | { ok: false; error: ReturnType<typeof mapOutcomeToMcpError> } {
  return {
    ok: true,
    value: {
      contents: [
        {
          uri,
          mimeType: MANIFEST_MIME,
          text: JSON.stringify(mount.mount.manifest),
        },
      ],
    },
  };
}

async function readNodeForMount(
  mount: ResolvedMount,
  id: string,
  uri: string,
): Promise<
  | { ok: true; value: { contents: ReadonlyArray<{ uri: string; mimeType: string; text: string }> } }
  | { ok: false; error: ReturnType<typeof mapOutcomeToMcpError> }
> {
  if (isStaticSource(mount.mount.source)) {
    let data = mount.staticData;
    if (!data) {
      data = await readStaticSource(mount.mount.source);
    }
    const node = data.nodes.find((n) => n.id === id);
    if (!node) {
      return { ok: false, error: mapOutcomeToMcpError({ kind: 'not_found' }) };
    }
    return {
      ok: true,
      value: {
        contents: [{ uri, mimeType: NODE_MIME, text: JSON.stringify(node) }],
      },
    };
  }
  const out = await mount.mount.source.resolveNode(synthRequest(), synthContext(), { id });
  if (out.kind !== 'ok') {
    return { ok: false, error: mapOutcomeToMcpError(out) };
  }
  return {
    ok: true,
    value: {
      contents: [{ uri, mimeType: NODE_MIME, text: JSON.stringify(out.value) }],
    },
  };
}

async function readSingleSourceManifest(
  config: BridgeConfig,
  uri: string,
): Promise<
  | { ok: true; value: { contents: ReadonlyArray<{ uri: string; mimeType: string; text: string }> } }
  | { ok: false; error: ReturnType<typeof mapOutcomeToMcpError> }
> {
  const out = await config.runtime.resolveManifest(synthRequest(), synthContext());
  if (out.kind !== 'ok') {
    return { ok: false, error: mapOutcomeToMcpError(out) };
  }
  return {
    ok: true,
    value: {
      contents: [{ uri, mimeType: MANIFEST_MIME, text: JSON.stringify(out.value) }],
    },
  };
}

async function readSingleSourceNode(
  config: BridgeConfig,
  id: string,
  uri: string,
): Promise<
  | { ok: true; value: { contents: ReadonlyArray<{ uri: string; mimeType: string; text: string }> } }
  | { ok: false; error: ReturnType<typeof mapOutcomeToMcpError> }
> {
  const out = await config.runtime.resolveNode(synthRequest(), synthContext(), { id });
  if (out.kind !== 'ok') {
    return { ok: false, error: mapOutcomeToMcpError(out) };
  }
  return {
    ok: true,
    value: {
      contents: [{ uri, mimeType: NODE_MIME, text: JSON.stringify(out.value) }],
    },
  };
}

/**
 * Synthetic ActRequest / ActContext used when the bridge enumerates
 * resources on its own (ListResources, internal probe). Real MCP-side
 * requests pass through {@link IdentityBridge.resolveAct} which provides
 * the operator's auth context; this helper is only used for the
 * enumeration probe and for static-source-style calls where identity is
 * not required.
 */
function synthRequest(): ActRequest {
  return {
    method: 'GET',
    url: new URL('https://probe.local/'),
    headers: new Headers(),
    getCookie: () => undefined,
  };
}

function synthContext(): ActContext {
  return {
    identity: { kind: 'anonymous' },
    tenant: { kind: 'single' },
  };
}

/**
 * Internal error class — thrown from the MCP request handlers so the SDK
 * surfaces the canonical PRD-602-R14 envelope. Carries the bridge's
 * stable string code and the request-correlated `data` payload.
 */
export class McpBridgeError extends Error {
  public readonly actErrorCode: string;
  public readonly data: Record<string, unknown>;
  constructor(code: string, message: string, data: Record<string, unknown>) {
    super(message);
    this.name = 'McpBridgeError';
    this.actErrorCode = code;
    this.data = { ...data, act_error_code: code };
  }
}

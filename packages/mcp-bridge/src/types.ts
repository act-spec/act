/**
 * PRD-602 normative TypeScript surface for `@act-spec/mcp-bridge`.
 *
 * The bridge wraps a PRD-500 `ActRuntime` (single-source default) or a
 * `BridgeConfig.mounts` array of {@link BridgeMount} entries (multi-mount
 * construction per amendment A4 / PRD-602-R24) and exposes ACT nodes as
 * MCP 1.0 resources under the canonical `act://` URI scheme (PRD-602-R6).
 *
 * Per PRD-602-R5 the bridge does NOT embed an MCP transport — operators
 * wire stdio (preferred for v0.1) or HTTP+SSE at start-up via
 * {@link Bridge.start}.
 *
 * Per PRD-602-R8 each ACT node maps to one MCP resource; blocks are
 * served inline as part of the node payload.
 */
import type { ActRuntime, IdentityResolver, Logger, Manifest } from '@act-spec/runtime-core';

/**
 * PRD-602-R10 — operator-supplied adapter mapping an MCP request's auth
 * context into an ACT request-like shape so the leaf SDK's
 * {@link IdentityResolver} (PRD-500-R6) can run unchanged.
 *
 * The `mcpContext` argument is intentionally typed as a thin record: MCP
 * SDK versions vary in the exact shape of their request extras, and the
 * bridge MUST NOT couple to a single SDK minor's surface (PRD-602-R19
 * forward-compat shim). Operators read whatever they need from
 * `mcpContext.auth` / `mcpContext.session` / `mcpContext.headers`.
 */
export interface IdentityBridge {
  resolveAct(mcpContext: McpRequestContext): Promise<{
    headers: Headers;
    getCookie: (name: string) => string | undefined;
  }>;
}

/**
 * Loose MCP request-context shape passed to {@link IdentityBridge.resolveAct}.
 * The shape is intentionally open per PRD-602-R19: hosts read what they
 * need, the bridge does not pin a contract to a particular MCP SDK
 * version's `RequestHandlerExtra`.
 */
export interface McpRequestContext {
  /** MCP session ID, when the transport surfaces one (HTTP+SSE / stdio differ). */
  readonly sessionId?: string;
  /** Auth context lifted by the operator's MCP transport configuration. */
  readonly auth?: Record<string, unknown>;
  /** Free-form extras carried by the MCP SDK's RequestHandlerExtra. */
  readonly extras?: Record<string, unknown>;
}

/**
 * PRD-602-R24 — single-mount default; multi-mount when {@link BridgeConfig.mounts}
 * is supplied. The single-mount path is byte-identical to pre-amendment-A4
 * PRD-602; `mounts` is purely additive.
 *
 * `mcp.host` is the authority component of `act://<host>/...` URIs
 * (PRD-602-R6); typically the deployment's primary hostname (e.g.
 * `docs.example.com`). Reserved-character `host` values are rejected at
 * `createBridge` per PRD-602 Security §"URI scheme injection".
 */
export interface BridgeConfig {
  readonly runtime: ActRuntime;
  readonly httpHandler: (req: Request) => Promise<Response | null>;
  readonly mcp: {
    readonly name: string;
    readonly version: string;
    readonly host: string;
  };
  readonly identityBridge?: IdentityBridge;
  readonly tenantCacheTtlMs?: number;
  readonly logger?: Logger;
  readonly features?: {
    readonly subscriptions?: boolean;
  };
  /**
   * PRD-602-R24 — OPTIONAL multi-mount construction surface (amendment A4).
   * When supplied, each mount carries its own `source` and is validated
   * independently per PRD-602-R3. When omitted, the bridge wraps the
   * single `runtime` + `httpHandler` (single-source default).
   */
  readonly mounts?: readonly BridgeMount[];
  /**
   * PRD-602-R25 — pinned `act_version`. The bridge refuses to start when
   * the leaf SDK's manifest declares a different `act_version`. Default
   * `"0.1"`.
   */
  readonly actVersion?: string;
}

/**
 * PRD-602-R24 — one mount in the multi-mount construction shape.
 *
 * - `prefix` MUST start with `/` and MUST NOT overlap with another mount's
 *   prefix in the same array (PRD-106-R20 mounts coherence; reused via
 *   `findMountOverlaps` from `@act-spec/validator`). Surfaces in act://
 *   URIs as `act://<host>/<prefix-segments>/<id>` per PRD-602-R6.
 * - `source` is either an `ActRuntime` (PRD-500-R3) for runtime-served
 *   mounts or a {@link StaticSource} for static-walked mounts. The bridge
 *   validates the source against the mount manifest's declared level at
 *   construction time per PRD-602-R3.
 * - `identityBridge` is required iff this mount's `source` is a runtime
 *   with an IdentityResolver registered (PRD-500-R6, PRD-500-R7); MAY be
 *   omitted for `StaticSource` mounts that are anonymous-readable per
 *   PRD-602-R10.
 */
export interface BridgeMount {
  readonly prefix: string;
  readonly source: ActRuntime | StaticSource;
  readonly identityBridge?: IdentityBridge;
  /**
   * The mount's manifest. The bridge surfaces this manifest at
   * `act://<host>/<prefix>/manifest` per PRD-602-R6 / R7 and validates the
   * mount's `source` against `manifest.conformance.level` at construction
   * per PRD-602-R3.
   */
  readonly manifest: Manifest;
  /**
   * For runtime-source mounts: the per-mount `IdentityResolver` per
   * PRD-500-R6. For static-source mounts: anonymous reads (no resolver
   * needed).
   */
  readonly identityResolver?: IdentityResolver;
}

/**
 * PRD-602-R24 — minimal `StaticSource` shape consumed by the same walker
 * `@act-spec/validator`'s `walkStatic` uses (PRD-706-R13 drift prevention).
 *
 * The bridge reads `manifestUrl` (or `rootDir` when supplied) to enumerate
 * the mount's resources; the same data feeds the validator's static walk
 * so the MCP-side enumeration cannot drift from the validator's view.
 */
export interface StaticSource {
  readonly kind: 'static';
  readonly manifestUrl: string;
  readonly rootDir?: string;
  /**
   * Optional pre-loaded envelopes. When present the bridge uses them
   * directly (used by tests and by deployments that pre-walk in the build
   * step). When omitted the bridge fetches `manifestUrl` and the
   * `index.json` it advertises.
   */
  readonly envelopes?: {
    readonly manifest?: Manifest;
    readonly index?: unknown;
    readonly nodes?: ReadonlyArray<unknown>;
  };
}

/**
 * PRD-602-R5 — MCP-server transport choice. v0.1 ships stdio; HTTP+SSE
 * is licensed by PRD-602-R22 but the operator wires that transport
 * themselves (the bridge MUST NOT embed a transport).
 *
 * The `'stdio'` literal triggers the SDK's `StdioServerTransport`. The
 * object form is for HTTP+SSE / streamable-HTTP transports the operator
 * constructs from `@modelcontextprotocol/sdk/server/streamableHttp.js` (or
 * the SSE variant) and passes in directly.
 */
export type BridgeTransport =
  | 'stdio'
  | { readonly kind: 'custom'; readonly transport: unknown };

/**
 * PRD-602-R2 — bridge instance returned by {@link createActMcpBridge}.
 */
export interface Bridge {
  /**
   * PRD-602-R4 — ACT-side handler. Delegates to the chosen leaf SDK
   * (PRD-505 generic fetch / PRD-501 Next.js / PRD-502 Express). The
   * bridge does not re-implement HTTP dispatch.
   */
  readonly httpHandler: (req: Request) => Promise<Response | null>;
  /** PRD-602-R5 — the constructed MCP server instance. */
  readonly mcpServer: unknown;
  /**
   * PRD-602-R5 — convenience wiring of an MCP transport. Operators MAY
   * skip this and connect the server directly via
   * `bridge.mcpServer.connect(transport)`.
   */
  start(transport: BridgeTransport): Promise<void>;
  /** PRD-602-R2 — clean shutdown of both protocols. */
  dispose(): Promise<void>;
  /**
   * Internal — exposed so the conformance probe can enumerate per-mount
   * URIs and verify the MCP-surfaced set equals the static-emitted +
   * runtime-served union (PRD-706 acceptance criterion (e)). The
   * harness uses `enumerateResourceUris(identity?)` to ask the bridge for
   * the union without going through the MCP transport.
   */
  enumerateResourceUris(identity?: IdentityBridge): Promise<readonly string[]>;
}

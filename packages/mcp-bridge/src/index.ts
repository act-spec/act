/**
 * @act-spec/mcp-bridge — PRD-602 ACT-MCP bridge.
 *
 * Public surface per PRD-602-R2 / R5 / R6 / R7 / R10 / R11 / R24:
 *
 *   - `createActMcpBridge(config)` (PRD-602-R2 / R24, alias `createBridge`)
 *     — returns a `Bridge` wrapping a single `ActRuntime` (default) or a
 *     multi-mount `BridgeConfig.mounts` array (amendment A4). The bridge
 *     constructs an MCP 1.0 server with `ListResources` + `ReadResource`
 *     handlers wired against the source(s); the operator wires a transport
 *     (stdio for v0.1; HTTP+SSE custom) at `bridge.start(transport)`.
 *
 *   - `BridgeConfigurationError` — thrown synchronously at
 *     `createActMcpBridge` when the construction-time checks fail
 *     (PRD-602-R3 partial-validity prohibition; PRD-602-R10 missing
 *     IdentityBridge; PRD-602-R24 prefix-coherence; PRD-602-R25
 *     act_version pin; security-section host check).
 *
 *   - URI helpers (`buildResourceUri`, `buildManifestUri`,
 *     `buildSubtreeUri`, `encodePrefixSegments`, `isValidMcpHost`,
 *     `resolveMountByPath`) — exported for the conformance harness and
 *     advanced operators who want to enumerate URIs without instantiating
 *     a bridge.
 *
 *   - `mapOutcomeToMcpError` — PRD-602-R14 / PRD-500-R18 outcome → MCP
 *     error mapping helper.
 *
 *   - `readStaticSource` — PRD-602-R24 / PRD-706-R13 drift-prevention
 *     static walker entry point; reuses the same envelope set
 *     `@act-spec/validator`'s `walkStatic` consumes.
 *
 *   - `runMcpEnumerationProbe` — PRD-706 acceptance criterion (e)
 *     conformance harness: enumerates `act://...` resources from the
 *     bridge and verifies the union equals static-emitted +
 *     runtime-served node IDs.
 *
 * Re-exports the runtime-core types every consumer needs (PRD-602
 * §"Wire format / interface definition" cites them).
 */

export const MCP_BRIDGE_PACKAGE_NAME = '@act-spec/mcp-bridge' as const;

// PRD-602-R2 / R24 — public factory + alias.
export { createActMcpBridge, createBridge, McpBridgeError } from './bridge.js';

// PRD-602 normative TypeScript surface.
export type {
  Bridge,
  BridgeConfig,
  BridgeMount,
  BridgeTransport,
  IdentityBridge,
  McpRequestContext,
  StaticSource,
} from './types.js';

// PRD-602-R3 / R24 / R25 / Security — construction-time errors.
export { BridgeConfigurationError } from './validate-config.js';

// PRD-602-R6 / R7 / R11 — URI helpers.
export {
  buildManifestUri,
  buildResourceUri,
  buildSubtreeUri,
  encodePrefixSegments,
  isValidMcpHost,
  resolveMountByPath,
  MANIFEST_RESOURCE_ID,
} from './uri.js';

// PRD-602-R14 / R19 — failure mapping helpers.
export {
  NOT_FOUND_MESSAGE,
  checkUnknownRequiredField,
  mapOutcomeToMcpError,
  type BridgeMcpError,
  type BridgeMcpErrorCode,
  type MapOutcomeOptions,
} from './failure-map.js';

// PRD-602-R24 / PRD-706-R13 — static-source reader.
export { readStaticSource, type StaticReadResult } from './static-source.js';

// PRD-706 acceptance criterion (e) — MCP enumeration probe harness.
export { runMcpEnumerationProbe, type EnumerationProbeReport } from './probe.js';

// Re-export runtime-core types for one-stop import (non-normative
// convenience; PRD-500 owns the contract).
export type {
  ActContext,
  ActRequest,
  ActResponse,
  ActRuntime,
  EtagComputer,
  Identity,
  IdentityResolver,
  Index,
  IndexEntry,
  Logger,
  Manifest,
  Node,
  Outcome,
  Subtree,
  Tenant,
  TenantResolver,
} from '@act-spec/runtime-core';

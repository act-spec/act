/**
 * PRD-602-R3 + PRD-602-R24 + PRD-602-R25 — construction-time validation.
 *
 * The bridge MUST validate at construction time that every advertised
 * capability is satisfied by the source it is bound to (PRD-602-R3),
 * that no two mounts have overlapping prefixes (PRD-106-R20 / PRD-602-R24),
 * that hosts are syntactically safe (PRD-602 Security §"URI scheme
 * injection"), and that every mount manifest's `act_version` matches the
 * bridge's pinned version (PRD-602-R25).
 *
 * The check fires once per mount; partial-validity construction is
 * forbidden (the bridge throws, the operator fixes, the bridge
 * re-constructs).
 */
import { findMountOverlaps } from '@act-spec/validator';

import type { ActRuntime } from '@act-spec/runtime-core';
import type { BridgeConfig, BridgeMount, StaticSource } from './types.js';
import { isValidMcpHost } from './uri.js';

export class BridgeConfigurationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_HOST'
      | 'OVERLAPPING_PREFIXES'
      | 'PREFIX_FORMAT'
      | 'LEVEL_NOT_SATISFIED'
      | 'MISSING_IDENTITY_BRIDGE'
      | 'ACT_VERSION_MISMATCH'
      | 'EMPTY_MOUNTS',
    message: string,
  ) {
    super(message);
    this.name = 'BridgeConfigurationError';
  }
}

const PINNED_ACT_VERSION = '0.1';

/**
 * Run every construction-time check. Throws {@link BridgeConfigurationError}
 * on the first failure (PRD-602-R3 — partial-validity construction is
 * forbidden).
 */
export function validateBridgeConfig(config: BridgeConfig): void {
  validateHost(config.mcp.host);
  validateActVersionPin(config);

  if (config.mounts !== undefined) {
    validateMounts(config.mounts);
  } else {
    validateSingleSource(config);
  }
}

function validateHost(host: string): void {
  if (!isValidMcpHost(host)) {
    throw new BridgeConfigurationError(
      'INVALID_HOST',
      `BridgeConfig.mcp.host contains reserved characters or is empty: ${JSON.stringify(host)}. ` +
        `Per PRD-602 Security §"URI scheme injection", host MUST be a valid RFC 3986 reg-name (optionally with port).`,
    );
  }
}

function validateActVersionPin(config: BridgeConfig): void {
  const expected = config.actVersion ?? PINNED_ACT_VERSION;
  // Single-source: read the runtime's manifest indirectly — we do not have
  // the manifest at construction (the leaf SDK injects it on resolve), so
  // we trust `config.actVersion` here. Multi-mount: each mount carries a
  // manifest and we validate it.
  if (config.mounts) {
    for (const m of config.mounts) {
      const declared = m.manifest.act_version;
      if (declared !== expected) {
        throw new BridgeConfigurationError(
          'ACT_VERSION_MISMATCH',
          `Mount ${JSON.stringify(m.prefix)} manifest declares act_version=${JSON.stringify(declared)}; bridge expects ${JSON.stringify(expected)}. ` +
            `Per PRD-602-R25, a bridge whose leaf SDK is configured for an act_version other than the bridge's pinned version MUST refuse to start.`,
        );
      }
    }
  }
}

function validateSingleSource(_config: BridgeConfig): void {
  // PRD-602-R3 paragraph 1 — single-source level check is performed by the
  // leaf SDK's `createActRuntime` (PRD-500-R10). We do not independently
  // re-run capability negotiation here (the manifest is not on
  // `ActRuntime`; the leaf SDK injects it at resolve time per PRD-505 /
  // PRD-501 / PRD-502 conventions).
  //
  // PRD-602-R10 enforces the IdentityBridge requirement at request time
  // (when an MCP request reaches a per-tenant endpoint without an
  // identity bridge to lift the auth context). The construction-time
  // check applies per-mount (multi-mount path); single-source bridges
  // delegate to the leaf SDK's IdentityResolver and surface
  // `auth_required` outcomes through the standard error mapping
  // (PRD-602-R14).
}

function validateMounts(mounts: readonly BridgeMount[]): void {
  if (mounts.length === 0) {
    throw new BridgeConfigurationError(
      'EMPTY_MOUNTS',
      'BridgeConfig.mounts MUST contain at least one mount when supplied. Omit `mounts` for single-source construction.',
    );
  }
  for (const m of mounts) {
    if (typeof m.prefix !== 'string' || !m.prefix.startsWith('/')) {
      throw new BridgeConfigurationError(
        'PREFIX_FORMAT',
        `BridgeMount.prefix MUST start with "/"; got ${JSON.stringify(m.prefix)}. ` +
          `Per PRD-106-R20 mounts coherence rule.`,
      );
    }
  }

  const overlaps = findMountOverlaps(mounts.map((m) => ({ prefix: m.prefix })));
  const firstOverlap = overlaps[0];
  if (firstOverlap) {
    throw new BridgeConfigurationError(
      'OVERLAPPING_PREFIXES',
      `BridgeConfig.mounts has overlapping prefixes (PRD-106-R20 / PRD-602-R24): ${firstOverlap.missing}`,
    );
  }

  for (const mount of mounts) {
    validateMountSource(mount);
  }
}

function validateMountSource(mount: BridgeMount): void {
  const declared = mount.manifest.conformance?.level;
  const isStatic = isStaticSource(mount.source);

  if (isStatic) {
    // Static mounts: the manifest itself is the admit-list. No identity
    // bridge required (anonymous reads per PRD-602-R10).
    if (declared === 'standard' || declared === 'strict') {
      // PRD-107-R6 / R8 / R10: the manifest must advertise the URL
      // templates for the level it claims.
      const m = mount.manifest;
      if (declared === 'standard' && !m.subtree_url_template) {
        throw new BridgeConfigurationError(
          'LEVEL_NOT_SATISFIED',
          `Static mount ${JSON.stringify(mount.prefix)} declares level=standard but lacks subtree_url_template. PRD-107-R8.`,
        );
      }
      if (declared === 'strict' && (!m.index_ndjson_url || !m.search_url_template)) {
        throw new BridgeConfigurationError(
          'LEVEL_NOT_SATISFIED',
          `Static mount ${JSON.stringify(mount.prefix)} declares level=strict but lacks index_ndjson_url or search_url_template. PRD-107-R10.`,
        );
      }
    }
    return;
  }

  // Runtime source: validate resolver surface against declared level.
  const runtime: ActRuntime = mount.source;
  if (declared === 'standard' && typeof runtime.resolveSubtree !== 'function') {
    throw new BridgeConfigurationError(
      'LEVEL_NOT_SATISFIED',
      `Runtime mount ${JSON.stringify(mount.prefix)} manifest declares level=standard but resolveSubtree is not registered (PRD-500-R32). PRD-602-R3.`,
    );
  }
  if (declared === 'strict') {
    if (typeof runtime.resolveSubtree !== 'function') {
      throw new BridgeConfigurationError(
        'LEVEL_NOT_SATISFIED',
        `Runtime mount ${JSON.stringify(mount.prefix)} manifest declares level=strict but resolveSubtree is not registered (PRD-500-R32). PRD-602-R3.`,
      );
    }
    if (typeof runtime.resolveIndexNdjson !== 'function' || typeof runtime.resolveSearch !== 'function') {
      throw new BridgeConfigurationError(
        'LEVEL_NOT_SATISFIED',
        `Runtime mount ${JSON.stringify(mount.prefix)} manifest declares level=strict but resolveIndexNdjson/resolveSearch are not registered (PRD-500-R33/R34). PRD-602-R3.`,
      );
    }
  }

  // Identity bridge requirement: runtime mounts whose resolver requires
  // identity (per-tenant scoping per PRD-500-R7) MUST have an identity
  // bridge per PRD-602-R10.
  if (mount.identityResolver && !mount.identityBridge) {
    throw new BridgeConfigurationError(
      'MISSING_IDENTITY_BRIDGE',
      `Runtime mount ${JSON.stringify(mount.prefix)} has an identityResolver but no identityBridge. ` +
        `Per PRD-602-R10, runtime sources whose resolver requires identity MUST supply IdentityBridge or fail at construction per PRD-602-R3.`,
    );
  }
}

export function isStaticSource(source: ActRuntime | StaticSource): source is StaticSource {
  return (source as StaticSource).kind === 'static';
}


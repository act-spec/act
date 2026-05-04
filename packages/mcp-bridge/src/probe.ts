/**
 * PRD-706 acceptance criterion (e) — MCP enumeration probe.
 *
 * Verifies that the union of the bridge's `act://...` resource
 * enumeration equals the static-emitted + runtime-served node IDs across
 * every mount. The probe is the conformance test that closes the
 * "MCP-surfaced graph cannot drift from the validator-walked graph"
 * guarantee (PRD-706-R13).
 *
 * The harness lives in `@act-spec/mcp-bridge` (this package) so PRD-706
 * can import it once it's authored. Track D ships PRD-602 first;
 * PRD-706's own conformance import this harness verbatim.
 *
 * Inputs:
 *   - `bridge` — the constructed `Bridge` from `createActMcpBridge`.
 *   - `expectedNodeUris` — the union of node URIs the operator expects
 *     to surface (computed by the test harness from the static walker
 *     output + the runtime resolver's index).
 *
 * Output:
 *   - `EnumerationProbeReport.passed` — true iff the bridge's enumeration
 *     equals `expectedNodeUris` exactly (manifest URIs and subtree URIs
 *     are surfaced separately for diagnostic clarity).
 *   - `EnumerationProbeReport.findings` — every check performed with
 *     PRD requirement citations.
 */
import type { Bridge } from './types.js';

export interface EnumerationProbeInput {
  readonly bridge: Bridge;
  /** Expected node URIs only (manifest / subtree URIs are checked separately). */
  readonly expectedNodeUris: readonly string[];
  /** Expected manifest URIs (per-mount manifests + the unprefixed parent). */
  readonly expectedManifestUris?: readonly string[];
  /** Expected subtree URIs (when subtree is advertised on any mount). */
  readonly expectedSubtreeUris?: readonly string[];
}

export interface EnumerationProbeFinding {
  readonly check:
    | 'enumeration_includes_all_node_uris'
    | 'enumeration_excludes_unexpected_node_uris'
    | 'enumeration_includes_all_manifest_uris'
    | 'enumeration_includes_all_subtree_uris';
  readonly requirement: string;
  readonly ok: boolean;
  readonly missing?: readonly string[];
  readonly unexpected?: readonly string[];
}

export interface EnumerationProbeReport {
  readonly passed: boolean;
  readonly findings: readonly EnumerationProbeFinding[];
}

/**
 * Run the enumeration probe against a constructed bridge.
 */
export async function runMcpEnumerationProbe(
  input: EnumerationProbeInput,
): Promise<EnumerationProbeReport> {
  const allUris = await input.bridge.enumerateResourceUris();
  const findings: EnumerationProbeFinding[] = [];

  // Partition the bridge's enumeration into nodes / manifests / subtrees.
  const enumeratedManifestUris = allUris.filter((u) => /\/manifest$/.test(u));
  const enumeratedSubtreeUris = allUris.filter((u) => u.includes('?subtree=1'));
  const enumeratedNodeUris = allUris.filter(
    (u) => !enumeratedManifestUris.includes(u) && !enumeratedSubtreeUris.includes(u),
  );

  // Check 1 — every expected node URI is present.
  const expectedNodeSet = new Set(input.expectedNodeUris);
  const missingNodes = [...expectedNodeSet].filter((u) => !enumeratedNodeUris.includes(u));
  findings.push({
    check: 'enumeration_includes_all_node_uris',
    requirement: 'PRD-706-R13 (drift prevention) / PRD-602-R6, R7',
    ok: missingNodes.length === 0,
    ...(missingNodes.length > 0 ? { missing: missingNodes } : {}),
  });

  // Check 2 — no unexpected node URIs.
  const unexpectedNodes = enumeratedNodeUris.filter((u) => !expectedNodeSet.has(u));
  findings.push({
    check: 'enumeration_excludes_unexpected_node_uris',
    requirement: 'PRD-706-R13 (drift prevention)',
    ok: unexpectedNodes.length === 0,
    ...(unexpectedNodes.length > 0 ? { unexpected: unexpectedNodes } : {}),
  });

  // Check 3 — every expected manifest URI is present (when supplied).
  if (input.expectedManifestUris) {
    const expectedManifestSet = new Set(input.expectedManifestUris);
    const missingManifests = [...expectedManifestSet].filter(
      (u) => !enumeratedManifestUris.includes(u),
    );
    findings.push({
      check: 'enumeration_includes_all_manifest_uris',
      requirement: 'PRD-602-R7 / PRD-602-R6',
      ok: missingManifests.length === 0,
      ...(missingManifests.length > 0 ? { missing: missingManifests } : {}),
    });
  }

  // Check 4 — every expected subtree URI is present (when supplied).
  if (input.expectedSubtreeUris) {
    const expectedSubtreeSet = new Set(input.expectedSubtreeUris);
    const missingSubtrees = [...expectedSubtreeSet].filter(
      (u) => !enumeratedSubtreeUris.includes(u),
    );
    findings.push({
      check: 'enumeration_includes_all_subtree_uris',
      requirement: 'PRD-602-R11',
      ok: missingSubtrees.length === 0,
      ...(missingSubtrees.length > 0 ? { missing: missingSubtrees } : {}),
    });
  }

  return {
    passed: findings.every((f) => f.ok),
    findings,
  };
}

/**
 * Two-principal probe harness — `runTwoPrincipalProbe`.
 *
 * MANDATORY for every leaf runtime SDK per PRD-500-R31 and PRD-705
 * acceptance criterion (e); guards against the "Runtime/static auth
 * confusion" anti-pattern. The harness probes:
 *
 *  - **Cross-tenant non-disclosure** (PRD-109-R3, PRD-109-R11, PRD-109-R13).
 *    Principal A cannot resolve principal B's visible node IDs. The 404
 *    response is byte-equivalent to a request for a node that genuinely
 *    does not exist.
 *  - **Existence-non-leak** (PRD-500-R18 / PRD-109-R3). The cross-tenant
 *    404 has identical body, identical headers, and identical
 *    `Content-Length` to the absent-node 404. The discovery `Link` header
 *    is identical (it does not leak tenant identity in error cases).
 *
 * Returns a `ProbeReport` enumerating findings; the caller assertions on
 * `report.passed === true` and (for diagnostics) inspects `report.findings`
 * which lists every check performed with PRD requirement citations.
 *
 * Downstream consumers: PRD-501 (`@act-spec/runtime-next`),
 * PRD-502 (`@act-spec/runtime-express`), PRD-505 (`@act-spec/runtime-fetch`),
 * and the PRD-705 SaaS workspace example. Each leaf MUST run the probe in
 * its CI; failure is a leaf SDK conformance violation.
 */
import type { ActRequest, ActResponse, ActRuntimeInstance, Identity, Tenant } from '../types.js';

/** A single probed principal. */
export interface ProbePrincipal {
  /** The identity the harness will inject into the leaf adapter for this run. */
  readonly identity: Identity;
  /** The tenant the harness will inject. */
  readonly tenant: Tenant;
  /**
   * Node IDs the principal should be able to resolve under their own identity.
   * The harness uses these to construct the cross-tenant attack — principal A
   * tries to fetch principal B's IDs and vice versa.
   */
  readonly visibleNodeIds: ReadonlyArray<string>;
}

/** Input to `runTwoPrincipalProbe`. */
export interface TwoPrincipalProbeInput {
  /** The runtime instance under test. */
  readonly runtime: ActRuntimeInstance;
  /** Principal A. MUST have at least one visible node ID. */
  readonly principalA: ProbePrincipal;
  /** Principal B. MUST have at least one visible node ID, disjoint from A's. */
  readonly principalB: ProbePrincipal;
  /** A node ID that does not exist for **anyone**. Used for the absent-node baseline. */
  readonly absentNodeId: string;
  /**
   * Per-call identity injection: the harness invokes this to override the
   * runtime instance's `identityResolver` / `tenantResolver` for a given
   * principal. This is the leaf adapter's responsibility — leaf SDKs
   * either compose their `IdentityResolver` from a request header the
   * harness sets, or they expose a per-call override hook. The probe
   * accepts a `dispatchAs` callback so each leaf wires it differently.
   */
  readonly dispatchAs: (
    principal: ProbePrincipal,
    req: ActRequest,
  ) => Promise<ActResponse>;
}

/** A single check performed by the harness. */
export interface ProbeFinding {
  /** Short human-readable check name. */
  readonly check: string;
  /** PRD requirement IDs this check enforces. */
  readonly requirements: ReadonlyArray<string>;
  /** Whether the check passed. */
  readonly passed: boolean;
  /** Diagnostic detail (only populated on failure). */
  readonly detail?: string;
}

/** Aggregate report. */
export interface ProbeReport {
  readonly passed: boolean;
  readonly findings: ReadonlyArray<ProbeFinding>;
}

/**
 * Construct a minimal `ActRequest` for a node-fetch under the probe.
 * The harness only exercises `resolveNode`-style requests because the
 * cross-tenant attack model focuses on per-resource access; index
 * enumeration is filtered by the resolver and produces a per-tenant view
 * that is non-comparable across principals.
 */
function buildNodeRequest(rt: ActRuntimeInstance, id: string): ActRequest {
  // Reconstruct the node URL from the manifest's `node_url_template`. We
  // percent-encode the ID per PRD-500-R13 inline to avoid a circular import
  // back into the production code's encoder (the harness ships in the same
  // package; a direct import would be fine but this keeps the harness
  // hermetic for unit-tests of the harness itself).
  const template = rt.manifest.node_url_template;
  const encoded = id
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/g, ':').replace(/%40/g, '@'))
    .join('/');
  const path = `${rt.basePath}${template.replace('{id}', encoded)}`;
  const url = new URL(`http://probe.local${path}`);
  return {
    method: 'GET',
    url,
    headers: new Headers(),
    getCookie: () => undefined,
  };
}

/** Read an `ActResponse`'s body fully into a string for comparison. */
async function readBody(resp: ActResponse): Promise<string> {
  if (resp.body === null) return '';
  if (typeof resp.body === 'string') return resp.body;
  const parts: string[] = [];
  for await (const part of resp.body) parts.push(part);
  return parts.join('');
}

/** Compare two responses byte-for-byte (status + headers + body). */
function compareResponses(
  a: { status: number; headers: Headers; body: string },
  b: { status: number; headers: Headers; body: string },
): { equal: true } | { equal: false; reason: string } {
  if (a.status !== b.status) {
    return { equal: false, reason: `status differs: ${a.status} vs ${b.status}` };
  }
  if (a.body !== b.body) {
    return {
      equal: false,
      reason: `body differs: <${a.body.slice(0, 80)}...> vs <${b.body.slice(0, 80)}...>`,
    };
  }
  // Compare every header set on either response. Cross-tenant non-disclosure
  // requires byte-equivalence; differential `Cache-Control` or a different
  // `Vary` value would be a finding per PRD-500-R18.
  const aKeys = new Set<string>();
  const bKeys = new Set<string>();
  a.headers.forEach((_v, k) => aKeys.add(k.toLowerCase()));
  b.headers.forEach((_v, k) => bKeys.add(k.toLowerCase()));
  const allKeys = new Set([...aKeys, ...bKeys]);
  for (const k of allKeys) {
    const av = a.headers.get(k);
    const bv = b.headers.get(k);
    if (av !== bv) {
      return { equal: false, reason: `header ${k} differs: <${av ?? '<absent>'}> vs <${bv ?? '<absent>'}>` };
    }
  }
  return { equal: true };
}

/** Read response + capture for comparison. */
async function snapshot(resp: ActResponse): Promise<{ status: number; headers: Headers; body: string }> {
  const body = await readBody(resp);
  return { status: resp.status, headers: resp.headers, body };
}

/**
 * Run the two-principal probe. Returns a structured `ProbeReport`. The
 * caller is responsible for asserting `report.passed === true`.
 */
export async function runTwoPrincipalProbe(input: TwoPrincipalProbeInput): Promise<ProbeReport> {
  const findings: ProbeFinding[] = [];

  // Pre-flight: shape checks so misuse is reported up-front.
  if (input.principalA.visibleNodeIds.length === 0 || input.principalB.visibleNodeIds.length === 0) {
    findings.push({
      check: 'principal-has-visible-nodes',
      requirements: ['PRD-705-Re'],
      passed: false,
      detail: 'Both principals MUST have at least one visible node ID for the probe to be meaningful.',
    });
    return { passed: false, findings };
  }

  // 1. Each principal can resolve their OWN visible nodes (sanity baseline).
  for (const [label, p] of [
    ['A', input.principalA] as const,
    ['B', input.principalB] as const,
  ]) {
    const id = p.visibleNodeIds[0]!;
    const req = buildNodeRequest(input.runtime, id);
    const resp = await input.dispatchAs(p, req);
    findings.push({
      check: `principal-${label}-can-see-own-node`,
      requirements: ['PRD-500-R3', 'PRD-705-Re'],
      passed: resp.status === 200,
      ...(resp.status !== 200 ? { detail: `principal ${label} got ${resp.status} for own node ${id}` } : {}),
    });
  }

  // 2. Cross-tenant: A asks for B's visible node → MUST be 404.
  const aTriesB = await snapshot(
    await input.dispatchAs(input.principalA, buildNodeRequest(input.runtime, input.principalB.visibleNodeIds[0]!)),
  );
  findings.push({
    check: 'cross-tenant-A-asks-B-returns-404',
    requirements: ['PRD-109-R3', 'PRD-109-R11', 'PRD-500-R18'],
    passed: aTriesB.status === 404,
    ...(aTriesB.status !== 404 ? { detail: `expected 404, got ${aTriesB.status}` } : {}),
  });

  // 3. Cross-tenant: B asks for A's visible node → MUST be 404.
  const bTriesA = await snapshot(
    await input.dispatchAs(input.principalB, buildNodeRequest(input.runtime, input.principalA.visibleNodeIds[0]!)),
  );
  findings.push({
    check: 'cross-tenant-B-asks-A-returns-404',
    requirements: ['PRD-109-R3', 'PRD-109-R11', 'PRD-500-R18'],
    passed: bTriesA.status === 404,
    ...(bTriesA.status !== 404 ? { detail: `expected 404, got ${bTriesA.status}` } : {}),
  });

  // 4. Baseline: A asks for an absent ID → 404.
  const aAbsent = await snapshot(
    await input.dispatchAs(input.principalA, buildNodeRequest(input.runtime, input.absentNodeId)),
  );
  findings.push({
    check: 'absent-node-returns-404',
    requirements: ['PRD-500-R18'],
    passed: aAbsent.status === 404,
    ...(aAbsent.status !== 404 ? { detail: `expected 404, got ${aAbsent.status}` } : {}),
  });

  // 5. **Existence non-leak**: cross-tenant 404 byte-equivalent to absent 404.
  // PRD-109-R3 + PRD-500-R18 — the body, headers, and status MUST match.
  const cmpA = compareResponses(aTriesB, aAbsent);
  findings.push({
    check: 'cross-tenant-404-equals-absent-404-bodies',
    requirements: ['PRD-109-R3', 'PRD-109-R13', 'PRD-500-R18'],
    passed: cmpA.equal,
    ...(cmpA.equal ? {} : { detail: `A's cross-tenant vs absent diverges: ${cmpA.reason}` }),
  });
  const cmpB = compareResponses(bTriesA, aAbsent);
  findings.push({
    check: 'reverse-cross-tenant-404-equals-absent-404-bodies',
    requirements: ['PRD-109-R3', 'PRD-109-R13', 'PRD-500-R18'],
    passed: cmpB.equal,
    ...(cmpB.equal ? {} : { detail: `B's cross-tenant vs absent diverges: ${cmpB.reason}` }),
  });

  // 6. Discovery Link header MUST be present and identical for the
  // cross-tenant 404 and the absent 404 (no tenant identity leaks).
  const linkAbs = aAbsent.headers.get('Link');
  const linkAB = aTriesB.headers.get('Link');
  findings.push({
    check: 'discovery-link-header-present-and-identical-on-404',
    requirements: ['PRD-500-R29', 'PRD-106-R23', 'PRD-109-R3'],
    passed: !!linkAbs && linkAbs === linkAB,
    ...(linkAbs && linkAbs === linkAB ? {} : { detail: `link headers: absent=${linkAbs ?? '<absent>'}, cross=${linkAB ?? '<absent>'}` }),
  });

  const passed = findings.every((f) => f.passed);
  return { passed, findings };
}

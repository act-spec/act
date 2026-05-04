/**
 * Two-principal probe wired against an in-process synthetic Next.js
 * resolver. MANDATORY for any runtime SDK leaf per PRD-500-R31 and
 * PRD-705 acceptance criterion (e); guards against the "Runtime/static
 * auth confusion" anti-pattern.
 *
 * Strategy:
 *   - Build a tenant-scoped runtime where principal A owns `acme/*`
 *     and principal B owns `beta/*`.
 *   - Construct a `defineActMount` whose IdentityResolver and
 *     TenantResolver read a probe-injected `X-Probe-Principal` header.
 *     The probe's `dispatchAs` callback sets the header before invoking
 *     the mount's `node` handler.
 *   - The harness's `runTwoPrincipalProbe` then:
 *       1. Verifies each principal can see their own node.
 *       2. Cross-tenant requests return 404.
 *       3. Cross-tenant 404 is byte-equivalent to absent-node 404.
 *       4. Discovery `Link` header is identical across both 404 paths.
 *
 * If any check fails, the test fails with a structured diagnostic.
 */
import { runTwoPrincipalProbe, type ProbePrincipal } from '@act-spec/runtime-core/test-utils';
import { describe, expect, it } from 'vitest';

import { defineActMount } from './index.js';
import { coreManifest, tenantedRuntime } from './_fixtures.js';
import type { ActRequest, ActResponse, Identity, Tenant } from '@act-spec/runtime-core';

interface PrincipalSpec {
  identity: Identity;
  tenant: Tenant;
}

/**
 * Build a mount whose identity & tenant resolvers read the probe's
 * `X-Probe-Principal` header. The header value indexes a principal map
 * (A vs B). This is the standard pattern for in-process tests of an
 * authenticating runtime SDK.
 */
function buildProbeMount(principalA: PrincipalSpec, principalB: PrincipalSpec) {
  const principals = new Map<string, PrincipalSpec>([
    ['A', principalA],
    ['B', principalB],
  ]);
  const seed = {
    [principalA.tenant.kind === 'scoped' ? principalA.tenant.key : 'default']: ['doc/a'],
    [principalB.tenant.kind === 'scoped' ? principalB.tenant.key : 'default']: ['doc/b'],
  };
  return defineActMount({
    manifest: coreManifest(),
    runtime: tenantedRuntime(seed),
    identityResolver: async (req: ActRequest) => {
      const tag = req.headers.get('x-probe-principal') ?? '';
      const p = principals.get(tag);
      return p ? p.identity : { kind: 'auth_required' };
    },
    tenantResolver: async (req: ActRequest) => {
      const tag = req.headers.get('x-probe-principal') ?? '';
      const p = principals.get(tag);
      return p ? p.tenant : { kind: 'single' };
    },
  });
}

describe('Two-principal probe — @act-spec/runtime-next', () => {
  it('passes the runTwoPrincipalProbe harness against the synthetic resolver', async () => {
    const principalA: ProbePrincipal = {
      identity: { kind: 'principal', key: 'user-A' },
      tenant: { kind: 'scoped', key: 'acme' },
      visibleNodeIds: ['doc/a'],
    };
    const principalB: ProbePrincipal = {
      identity: { kind: 'principal', key: 'user-B' },
      tenant: { kind: 'scoped', key: 'beta' },
      visibleNodeIds: ['doc/b'],
    };
    const mount = buildProbeMount(
      { identity: principalA.identity, tenant: principalA.tenant },
      { identity: principalB.identity, tenant: principalB.tenant },
    );
    const tagFor = (p: ProbePrincipal): string =>
      p.identity.kind === 'principal' && p.identity.key === 'user-A' ? 'A' : 'B';

    const dispatchAs = async (
      principal: ProbePrincipal,
      req: ActRequest,
    ): Promise<ActResponse> => {
      // Build a Next.js Request from the harness's ActRequest, then
      // dispatch through the mount's node handler. The header carries
      // the principal tag so the mount's identityResolver can pick the
      // right principal.
      const headers = new Headers(req.headers);
      headers.set('x-probe-principal', tagFor(principal));
      const nextReq = new Request(req.url.toString(), {
        method: req.method,
        headers,
      });
      // Compute catch-all id from the URL pathname matching
      // `manifest.node_url_template`. The template is `/act/n/{id}` so
      // the suffix after `/act/n/` is the percent-encoded id; split on
      // `/` to feed Next.js's catch-all params.
      const path = req.url.pathname;
      const prefix = '/act/n/';
      const idEncoded = path.startsWith(prefix) ? path.slice(prefix.length) : '';
      const idSegments = idEncoded.split('/').map((s) => decodeURIComponent(s));
      const resp = await mount.node(nextReq, { params: { id: idSegments } });
      // Convert Response back to ActResponse for the harness's
      // body/header comparison.
      const body = await resp.text();
      return {
        status: resp.status,
        headers: resp.headers,
        body,
      };
    };

    const report = await runTwoPrincipalProbe({
      runtime: mount._instance,
      principalA,
      principalB,
      absentNodeId: 'doc/never-existed',
      dispatchAs,
    });

    if (!report.passed) {
      const failures = report.findings.filter((f) => !f.passed);
      throw new Error(
        `Two-principal probe failed:\n${failures
          .map((f) => `  - ${f.check} (${f.requirements.join(',')}): ${f.detail ?? '(no detail)'}`)
          .join('\n')}`,
      );
    }
    expect(report.passed).toBe(true);
    // Sanity — all expected check names present.
    const checkNames = report.findings.map((f) => f.check);
    expect(checkNames).toContain('cross-tenant-A-asks-B-returns-404');
    expect(checkNames).toContain('cross-tenant-404-equals-absent-404-bodies');
    expect(checkNames).toContain('discovery-link-header-present-and-identical-on-404');
  });
});

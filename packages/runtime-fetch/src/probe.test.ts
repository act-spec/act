/**
 * Two-principal probe wired against an in-process WHATWG-fetch handler.
 *
 * MANDATORY for any runtime SDK leaf per PRD-500-R31 and PRD-705
 * acceptance criterion (e); guards against the "Runtime/static auth
 * confusion" anti-pattern.
 *
 * Strategy mirrors `@act-spec/runtime-next` / `@act-spec/runtime-express`:
 *   - Build a tenant-scoped runtime where principal A owns `acme/*` and
 *     principal B owns `beta/*`.
 *   - Construct a `createActFetchHandler` whose IdentityResolver and
 *     TenantResolver read a probe-injected `X-Probe-Principal` header.
 *     The probe's `dispatchAs` callback sets the header before invoking
 *     the handler with a WHATWG `Request`.
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

import { createActFetchHandler } from './handler.js';
import { coreManifest, tenantedRuntime } from './_fixtures.js';
import type { ActRequest, ActResponse, Identity, Tenant } from '@act-spec/runtime-core';

interface PrincipalSpec {
  identity: Identity;
  tenant: Tenant;
}

/**
 * Build a handler whose identity & tenant resolvers read the probe's
 * `X-Probe-Principal` header. The header value indexes a principal map
 * (A vs B). The handler is the standard pattern for in-process tests of
 * an authenticating fetch handler.
 */
function buildProbeHandler(principalA: PrincipalSpec, principalB: PrincipalSpec) {
  const principals = new Map<string, PrincipalSpec>([
    ['A', principalA],
    ['B', principalB],
  ]);
  const seed = {
    [principalA.tenant.kind === 'scoped' ? principalA.tenant.key : 'default']: ['doc/a'],
    [principalB.tenant.kind === 'scoped' ? principalB.tenant.key : 'default']: ['doc/b'],
  };
  return createActFetchHandler({
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

describe('Two-principal probe — @act-spec/runtime-fetch', () => {
  it('passes the runTwoPrincipalProbe harness against the synthetic fetch handler', async () => {
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
    const handler = buildProbeHandler(
      { identity: principalA.identity, tenant: principalA.tenant },
      { identity: principalB.identity, tenant: principalB.tenant },
    );
    const tagFor = (p: ProbePrincipal): string =>
      p.identity.kind === 'principal' && p.identity.key === 'user-A' ? 'A' : 'B';

    const dispatchAs = async (
      principal: ProbePrincipal,
      req: ActRequest,
    ): Promise<ActResponse> => {
      // The harness produces an ActRequest; convert it to a WHATWG
      // Request and inject the probe principal header. The handler is
      // the system-under-test.
      const headers = new Headers(req.headers);
      headers.set('x-probe-principal', tagFor(principal));
      const fetchReq = new Request(req.url.toString(), {
        method: req.method,
        headers,
      });
      const resp = await handler(fetchReq);
      // Passthrough is a configuration error for this test — the probe
      // exercises ACT endpoints. If resp is null, that means the URL
      // didn't match an ACT endpoint and the test setup is wrong.
      if (!resp) {
        throw new Error(
          `probe expected an ACT-endpoint response; got passthrough (null) for ${req.url.toString()}`,
        );
      }
      const body = await resp.text();
      return {
        status: resp.status,
        headers: resp.headers,
        body,
      };
    };

    const report = await runTwoPrincipalProbe({
      runtime: handler._instance,
      principalA,
      principalB,
      absentNodeId: 'doc/never-existed',
      dispatchAs,
    });

    if (!report.passed) {
      const failures = report.findings.filter((f) => !f.passed);
      throw new Error(
        `Two-principal probe failed:\n${failures
          .map(
            (f) =>
              `  - ${f.check} (${f.requirements.join(',')}): ${f.detail ?? '(no detail)'}`,
          )
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

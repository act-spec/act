/**
 * Two-principal probe wired against an in-process synthetic Express
 * resolver. MANDATORY for any runtime SDK leaf per PRD-500-R31 and
 * PRD-705 acceptance criterion (e); guards against the "Runtime/static
 * auth confusion" anti-pattern.
 *
 * Strategy mirrors `@act-spec/runtime-next`'s probe.test.ts:
 *   - Build a tenant-scoped runtime where principal A owns `acme/*`
 *     and principal B owns `beta/*`.
 *   - Construct an `actRouter` whose IdentityResolver and
 *     TenantResolver read a probe-injected `X-Probe-Principal` header.
 *     The probe's `dispatchAs` callback sets the header before invoking
 *     the router's middleware against an in-process Express-style
 *     `req` / `res` stub.
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

import { actRouter } from './index.js';
import { coreManifest, recordingResponse, tenantedRuntime } from './_fixtures.js';
import type {
  ActRequest,
  ActResponse,
  Identity,
  Tenant,
} from '@act-spec/runtime-core';
import type { ExpressRequestLike } from './types.js';

interface PrincipalSpec {
  identity: Identity;
  tenant: Tenant;
}

/**
 * Build a router whose identity & tenant resolvers read the probe's
 * `X-Probe-Principal` header. The header value indexes a principal map
 * (A vs B).
 */
function buildProbeRouter(principalA: PrincipalSpec, principalB: PrincipalSpec) {
  const principals = new Map<string, PrincipalSpec>([
    ['A', principalA],
    ['B', principalB],
  ]);
  const seed = {
    [principalA.tenant.kind === 'scoped' ? principalA.tenant.key : 'default']: ['doc/a'],
    [principalB.tenant.kind === 'scoped' ? principalB.tenant.key : 'default']: ['doc/b'],
  };
  return actRouter({
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

describe('Two-principal probe — @act-spec/runtime-express', () => {
  it('passes the runTwoPrincipalProbe harness against the synthetic Express resolver', async () => {
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
    const router = buildProbeRouter(
      { identity: principalA.identity, tenant: principalA.tenant },
      { identity: principalB.identity, tenant: principalB.tenant },
    );
    const tagFor = (p: ProbePrincipal): string =>
      p.identity.kind === 'principal' && p.identity.key === 'user-A' ? 'A' : 'B';

    const dispatchAs = async (
      principal: ProbePrincipal,
      req: ActRequest,
    ): Promise<ActResponse> => {
      // Build an Express-style req from the harness's ActRequest. The
      // header carries the principal tag so the router's identityResolver
      // picks the right principal.
      const headersRecord: Record<string, string | string[] | undefined> = {};
      req.headers.forEach((v, k) => {
        headersRecord[k] = v;
      });
      headersRecord['x-probe-principal'] = tagFor(principal);
      headersRecord['host'] = req.url.host;
      const expressReq: ExpressRequestLike = {
        method: req.method,
        url: req.url.pathname + req.url.search,
        originalUrl: req.url.pathname + req.url.search,
        protocol: req.url.protocol.replace(/:$/, ''),
        headers: headersRecord,
      };
      const res = recordingResponse();
      await router(expressReq, res, () => undefined);
      // Convert recording response → ActResponse for the harness comparison.
      const actHeaders = new Headers();
      for (const [name, values] of res.collectedHeaders) {
        for (const v of values) actHeaders.append(name, v);
      }
      return {
        status: res.statusCode,
        headers: actHeaders,
        body: res.body,
      };
    };

    const report = await runTwoPrincipalProbe({
      runtime: router._instance,
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

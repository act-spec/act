/**
 * Two-principal probe harness self-tests.
 *
 * The harness itself is a leaf-SDK conformance gate; it MUST be self-tested
 * with at least one synthetic CONFORMANT resolver (probe passes) and one
 * synthetic NON-CONFORMANT resolver (probe fails for the right reason).
 */
import { describe, expect, it } from 'vitest';

import { createActRuntime } from '../runtime.js';
import type {
  ActRequest,
  ActResponse,
  ActRuntime,
  ActRuntimeInstance,
  Identity,
  Manifest,
  Tenant,
} from '../types.js';
import { runTwoPrincipalProbe, type ProbePrincipal } from './index.js';

// ---------- shared builders ------------------------------------------------

type NodeValue = Extract<Awaited<ReturnType<ActRuntime['resolveNode']>>, { kind: 'ok' }>['value'];
type IndexValue = Extract<Awaited<ReturnType<ActRuntime['resolveIndex']>>, { kind: 'ok' }>['value'];

function manifest(): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'probe.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    index_url: '/i.json',
    node_url_template: '/n/{id}.json',
    auth: { schemes: ['bearer'] },
  } as Manifest;
}

interface TenantStore {
  /** Map of tenant key → set of node IDs visible inside that tenant. */
  readonly visibility: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Build a runtime that scopes nodes by `ctx.tenant.key`. The principal's
 * identity is used only as an authentication gate (never anonymous nor
 * auth_required when the harness drives it). This is the CONFORMANT
 * baseline: per-tenant isolation, byte-equivalent 404s, no Link leak.
 */
function buildConformantRuntime(store: TenantStore): ActRuntimeInstance {
  const rt: ActRuntime = {
    resolveManifest: async () => ({ kind: 'ok', value: manifest() }),
    resolveIndex: async (_req, ctx) => {
      const visible = ctx.tenant.kind === 'scoped' ? store.visibility.get(ctx.tenant.key) ?? new Set() : new Set();
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          nodes: [...visible].map((id) => ({ id, type: 'doc' })),
        } as unknown as IndexValue,
      };
    },
    resolveNode: async (_req, ctx, params) => {
      if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
      const visible = store.visibility.get(ctx.tenant.key);
      if (!visible || !visible.has(params.id)) return { kind: 'not_found' };
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          id: params.id,
          type: 'doc',
          title: `node ${params.id}`,
        } as unknown as NodeValue,
      };
    },
  };

  // Identity / tenant injection is supplied by the dispatchAs callback below;
  // the runtime's own resolvers are stubs that always look at ctx.
  return createActRuntime({
    manifest: manifest(),
    runtime: rt,
    identityResolver: async () => ({ kind: 'principal', key: 'unused-default' }),
    tenantResolver: async () => ({ kind: 'scoped', key: 'unused-default' }),
  });
}

/**
 * Build a runtime that LEAKS — responds 200 to any node ID regardless of
 * tenant. Used to exercise the harness's failure detection.
 */
function buildLeakyRuntime(): ActRuntimeInstance {
  const rt: ActRuntime = {
    resolveManifest: async () => ({ kind: 'ok', value: manifest() }),
    resolveIndex: async () => ({
      kind: 'ok',
      value: { act_version: '0.1', nodes: [] } as unknown as IndexValue,
    }),
    resolveNode: async (_req, _ctx, params) => ({
      kind: 'ok',
      value: {
        act_version: '0.1',
        id: params.id,
        type: 'doc',
        title: 'leaked!',
      } as unknown as NodeValue,
    }),
  };
  return createActRuntime({
    manifest: manifest(),
    runtime: rt,
    identityResolver: async () => ({ kind: 'principal', key: 'unused' }),
    tenantResolver: async () => ({ kind: 'scoped', key: 'unused' }),
  });
}

/**
 * Build a runtime that returns DIFFERENT 404 bodies for cross-tenant vs
 * absent — a header-leak failure (PRD-500-R18 / PRD-109-R3).
 */
function buildDifferentialRuntime(store: TenantStore, allKnownIds: Set<string>): ActRuntimeInstance {
  const rt: ActRuntime = {
    resolveManifest: async () => ({ kind: 'ok', value: manifest() }),
    resolveIndex: async () => ({
      kind: 'ok',
      value: { act_version: '0.1', nodes: [] } as unknown as IndexValue,
    }),
    // The custom resolver returns `not_found` for both, but a wrapper around
    // dispatch will inject a differential header for the cross-tenant path;
    // we simulate by returning a different `details` reason.
    resolveNode: async (_req, ctx, params) => {
      if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
      const visible = store.visibility.get(ctx.tenant.key);
      if (visible && visible.has(params.id)) {
        return {
          kind: 'ok',
          value: {
            act_version: '0.1',
            id: params.id,
            type: 'doc',
          } as unknown as NodeValue,
        };
      }
      // Differential — use `validation` for cross-tenant (a present-but-forbidden
      // ID we know exists somewhere) and `not_found` for absent. This violates
      // PRD-500-R18.
      if (allKnownIds.has(params.id)) {
        return { kind: 'validation', details: { reason: 'cross_tenant' } };
      }
      return { kind: 'not_found' };
    },
  };
  return createActRuntime({
    manifest: manifest(),
    runtime: rt,
    identityResolver: async () => ({ kind: 'principal', key: 'unused' }),
    tenantResolver: async () => ({ kind: 'scoped', key: 'unused' }),
  });
}

/** dispatchAs implementation that injects the principal's identity + tenant. */
function dispatchAsBuilder(
  buildRuntime: (identity: Identity, tenant: Tenant) => ActRuntimeInstance,
): (p: ProbePrincipal, req: ActRequest) => Promise<ActResponse> {
  return async (p, req) => {
    const inst = buildRuntime(p.identity, p.tenant);
    return inst.dispatch(req);
  };
}

// ---------- tests ----------------------------------------------------------

describe('runTwoPrincipalProbe — conformant resolver', () => {
  it('passes when the runtime correctly scopes by tenant', async () => {
    const store: TenantStore = {
      visibility: new Map([
        ['acme', new Set(['a-doc'])],
        ['globex', new Set(['b-doc'])],
      ]),
    };

    const principalA: ProbePrincipal = {
      identity: { kind: 'principal', key: 'alice' },
      tenant: { kind: 'scoped', key: 'acme' },
      visibleNodeIds: ['a-doc'],
    };
    const principalB: ProbePrincipal = {
      identity: { kind: 'principal', key: 'bob' },
      tenant: { kind: 'scoped', key: 'globex' },
      visibleNodeIds: ['b-doc'],
    };

    // We need a single ActRuntimeInstance that acts on the per-call principal.
    // The harness's `dispatchAs` callback wraps that — for tests we rebuild
    // the instance per-call with the requested identity/tenant.
    const buildForRequest = (identity: Identity, tenant: Tenant): ActRuntimeInstance => {
      // Build a runtime whose tenantResolver always returns the requested
      // tenant; the dispatchAs callback ensures the harness's request flows
      // through with that scoping.
      const rt: ActRuntime = {
        resolveManifest: async () => ({ kind: 'ok', value: manifest() }),
        resolveIndex: async () => ({
          kind: 'ok',
          value: { act_version: '0.1', nodes: [] } as unknown as IndexValue,
        }),
        resolveNode: async (_req, ctx, params) => {
          if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
          const v = store.visibility.get(ctx.tenant.key);
          if (!v || !v.has(params.id)) return { kind: 'not_found' };
          return {
            kind: 'ok',
            value: {
              act_version: '0.1',
              id: params.id,
              type: 'doc',
            } as unknown as NodeValue,
          };
        },
      };
      return createActRuntime({
        manifest: manifest(),
        runtime: rt,
        identityResolver: async () => identity,
        tenantResolver: async () => tenant,
      });
    };

    // Probe needs an `instance` for URL math; any of the per-call instances
    // is fine because `manifest`, `basePath`, `wellKnownPath` are constant.
    const refInstance = buildConformantRuntime(store);
    const report = await runTwoPrincipalProbe({
      runtime: refInstance,
      principalA,
      principalB,
      absentNodeId: 'definitely-not-real',
      dispatchAs: dispatchAsBuilder(buildForRequest),
    });

    if (!report.passed) {
      // Surface diagnostics on failure for easy debugging.
      console.error(report.findings.filter((f) => !f.passed));
    }
    expect(report.passed).toBe(true);
    // Specific findings present:
    const checkNames = report.findings.map((f) => f.check);
    expect(checkNames).toContain('cross-tenant-A-asks-B-returns-404');
    expect(checkNames).toContain('cross-tenant-404-equals-absent-404-bodies');
    expect(checkNames).toContain('discovery-link-header-present-and-identical-on-404');
  });
});

describe('runTwoPrincipalProbe — non-conformant resolver detection', () => {
  it('FAILS when the runtime leaks cross-tenant nodes (returns 200 instead of 404)', async () => {
    const principalA: ProbePrincipal = {
      identity: { kind: 'principal', key: 'alice' },
      tenant: { kind: 'scoped', key: 'acme' },
      visibleNodeIds: ['a-doc'],
    };
    const principalB: ProbePrincipal = {
      identity: { kind: 'principal', key: 'bob' },
      tenant: { kind: 'scoped', key: 'globex' },
      visibleNodeIds: ['b-doc'],
    };
    const refInstance = buildLeakyRuntime();
    const report = await runTwoPrincipalProbe({
      runtime: refInstance,
      principalA,
      principalB,
      absentNodeId: 'absent',
      dispatchAs: async (_p, req) => refInstance.dispatch(req),
    });
    expect(report.passed).toBe(false);
    const failed = report.findings.filter((f) => !f.passed).map((f) => f.check);
    expect(failed).toContain('cross-tenant-A-asks-B-returns-404');
  });

  it('FAILS when 404 bodies differ between cross-tenant and absent (PRD-500-R18 leak)', async () => {
    const store: TenantStore = {
      visibility: new Map([
        ['acme', new Set(['a-doc'])],
        ['globex', new Set(['b-doc'])],
      ]),
    };
    const allIds = new Set(['a-doc', 'b-doc']);
    const principalA: ProbePrincipal = {
      identity: { kind: 'principal', key: 'alice' },
      tenant: { kind: 'scoped', key: 'acme' },
      visibleNodeIds: ['a-doc'],
    };
    const principalB: ProbePrincipal = {
      identity: { kind: 'principal', key: 'bob' },
      tenant: { kind: 'scoped', key: 'globex' },
      visibleNodeIds: ['b-doc'],
    };
    const buildForRequest = (identity: Identity, tenant: Tenant): ActRuntimeInstance => {
      // Override the rt's identity/tenant to match the per-call principal.
      const m = manifest();
      return createActRuntime({
        manifest: m,
        runtime: {
          resolveManifest: async () => ({ kind: 'ok', value: m }),
          resolveIndex: async () => ({
            kind: 'ok',
            value: { act_version: '0.1', nodes: [] } as unknown as IndexValue,
          }),
          resolveNode: async (req, ctx, params) => {
            // Use the differential runtime's resolveNode by re-dispatching
            // through it; simpler — just inline the same logic.
            if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
            const visible = store.visibility.get(ctx.tenant.key);
            if (visible && visible.has(params.id)) {
              return {
                kind: 'ok',
                value: {
                  act_version: '0.1',
                  id: params.id,
                  type: 'doc',
                } as unknown as NodeValue,
              };
            }
            if (allIds.has(params.id)) {
              return { kind: 'validation', details: { reason: 'cross_tenant' } };
            }
            return { kind: 'not_found' };
          },
        },
        identityResolver: async () => identity,
        tenantResolver: async () => tenant,
      });
    };

    const refInstance = buildDifferentialRuntime(store, allIds);
    const report = await runTwoPrincipalProbe({
      runtime: refInstance,
      principalA,
      principalB,
      absentNodeId: 'genuinely-absent',
      dispatchAs: dispatchAsBuilder(buildForRequest),
    });
    expect(report.passed).toBe(false);
    const failed = report.findings.filter((f) => !f.passed).map((f) => f.check);
    // The differential runtime returns 400 for cross-tenant (validation) and
    // 404 for absent → the cross-tenant-returns-404 check fails.
    expect(failed).toContain('cross-tenant-A-asks-B-returns-404');
  });

  it('FAILS up-front when a principal has no visible node IDs', async () => {
    const refInstance = buildConformantRuntime({ visibility: new Map() });
    const report = await runTwoPrincipalProbe({
      runtime: refInstance,
      principalA: {
        identity: { kind: 'principal', key: 'a' },
        tenant: { kind: 'scoped', key: 't' },
        visibleNodeIds: [],
      },
      principalB: {
        identity: { kind: 'principal', key: 'b' },
        tenant: { kind: 'scoped', key: 'u' },
        visibleNodeIds: ['x'],
      },
      absentNodeId: 'absent',
      dispatchAs: async (_p, req) => refInstance.dispatch(req),
    });
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.check).toBe('principal-has-visible-nodes');
  });
});

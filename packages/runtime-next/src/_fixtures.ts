/**
 * Shared test fixtures: minimal manifests and resolver factories used
 * across the unit test suite. Deliberately not exported from the
 * package's public surface (`index.ts`); strictly internal.
 */
/* eslint-disable @typescript-eslint/require-await */
import type { ActRuntime, Identity, IdentityResolver, Manifest, TenantResolver } from '@act-spec/runtime-core';

export function coreManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'next-test.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    auth: { schemes: ['bearer'] },
    index_url: '/act/index.json',
    node_url_template: '/act/n/{id}',
    ...overrides,
  };
}

export function standardManifest(overrides: Partial<Manifest> = {}): Manifest {
  return coreManifest({
    conformance: { level: 'standard' },
    subtree_url_template: '/act/sub/{id}',
    ...overrides,
  });
}

export function strictManifest(overrides: Partial<Manifest> = {}): Manifest {
  return coreManifest({
    conformance: { level: 'strict' },
    subtree_url_template: '/act/sub/{id}',
    index_ndjson_url: '/act/index.ndjson',
    search_url_template: '/act/search?q={query}',
    ...overrides,
  });
}

/**
 * Tenant-scoped runtime: each `tenantKey` owns a set of node IDs. A node
 * is visible only to its owning tenant; cross-tenant access returns
 * `not_found` (PRD-109-R3 / PRD-500-R18 byte-equivalence).
 */
export function tenantedRuntime(seed: Record<string, string[]>): ActRuntime {
  return {
    async resolveManifest(_req, _ctx) {
      // Returned shape is filled in by the test harness's manifest
      // option; the SDK wraps to inject delivery / basePath.
      return {
        kind: 'ok',
        value: coreManifest(),
      };
    },
    async resolveIndex(_req, ctx) {
      if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
      const tenantKey = ctx.tenant.kind === 'scoped' ? ctx.tenant.key : 'default';
      const ids = seed[tenantKey] ?? [];
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          nodes: ids.map((id) => ({
            id,
            type: 'article',
            title: `Title ${id}`,
            summary: `Summary ${id}`,
            tokens: { summary: 4 },
            etag: '',
            updated_at: '2026-05-02T00:00:00Z',
          })),
        },
      };
    },
    async resolveNode(_req, ctx, params) {
      if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
      const tenantKey = ctx.tenant.kind === 'scoped' ? ctx.tenant.key : 'default';
      const ids = seed[tenantKey] ?? [];
      if (!ids.includes(params.id)) return { kind: 'not_found' };
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          id: params.id,
          type: 'article',
          title: `Title ${params.id}`,
          summary: `Summary ${params.id}`,
          content: [{ type: 'prose', text: `Body for ${params.id}` }],
          tokens: { summary: 4, body: 12 },
          etag: '',
        },
      };
    },
  };
}

/**
 * Static identity resolver — returns the configured `Identity` regardless
 * of the request shape. Used by the two-principal probe to drive a
 * specific principal through the dispatch pipeline.
 */
export function staticIdentity(identity: Identity): IdentityResolver {
  return async () => identity;
}

export function staticTenant(key: string): TenantResolver {
  return async () => ({ kind: 'scoped', key });
}

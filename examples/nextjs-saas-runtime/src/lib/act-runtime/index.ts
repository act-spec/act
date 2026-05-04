/**
 * PRD-705 `ActRuntime` — manifest, index, node, subtree resolvers.
 *
 * Every tenant-scoped query filters by `tenantId` per PRD-705-R8. The
 * public landing branch is the single explicit pre-tenant-filter branch in
 * `resolveNode` per PRD-705-R12. `resolveSubtree` is registered to satisfy
 * the Standard tier per PRD-705-R14 and bounds depth to `[0, 8]` per
 * PRD-100-R33.
 */
import { defaultEtagComputer } from '@act-spec/runtime-core';
import type {
  ActContext,
  ActRuntime,
  Index,
  IndexEntry,
  Manifest,
  Node,
  Subtree,
} from '@act-spec/runtime-core';

import {
  getPublicLandingNode,
  getTenantNode,
  listTenantNodes,
  PUBLIC_LANDING_ID,
} from '../act-host/content';

/** PRD-705-R2 — manifest payload returned by `resolveManifest`. */
export const MANIFEST: Manifest = {
  act_version: '0.1',
  site: { name: 'Acme Workspace' },
  delivery: 'runtime', // PRD-705-R5 — explicit, not relying on SDK injection.
  conformance: { level: 'standard' }, // PRD-705-R2 / PRD-107-R1
  auth: { schemes: ['cookie', 'bearer'] }, // PRD-705-R2
  index_url: '/act/index.json',
  node_url_template: '/act/n/{id}',
  subtree_url_template: '/act/sub/{id}',
  capabilities: { etag: true, subtree: true },
};

/** PRD-100 default subtree depth when caller omits `?depth=N` (PRD-705-R14). */
const DEFAULT_SUBTREE_DEPTH = 3;

/** Strip a node envelope's `etag` field for canonicalization (PRD-103-R6 step 1). */
function stripEtag(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === 'etag') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Per-entry ETag derivation. PRD-103-R6 mandates the runtime ETag is a
 * function of `(identity, payload, tenant)`. We re-use `defaultEtagComputer`
 * so the index entry's etag matches the per-node response ETag the dispatch
 * pipeline emits at `/act/n/{id}` (PRD-705-R10).
 *
 * Note: PRD-103-R6 also licenses the runtime profile to omit `identity` from
 * the input when the resource is identity-independent. PRD-705-R10 explicitly
 * says ETag input is `(content, tenant.key)` — NOT `(content, principal.id)` —
 * so that two principals in the same tenant viewing the same document receive
 * byte-identical ETags. We pass `identity: null` to honor that.
 */
function nodeToIndexEntry(n: Node, ctx: ActContext): IndexEntry {
  const tenantKey = ctx.tenant.kind === 'scoped' ? ctx.tenant.key : null;
  const etag = defaultEtagComputer({
    identity: null,
    payload: stripEtag(n),
    tenant: tenantKey,
  });
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    summary: n.summary,
    tokens: { summary: n.tokens.summary },
    etag,
    updated_at: '2026-05-02T00:00:00Z',
  };
}

export const runtime: ActRuntime = {
  async resolveManifest(_req, ctx) {
    // PRD-501-R9 — the SDK wraps this to inject `delivery` / capabilities,
    // but PRD-705-R5 mandates an explicit declaration here so reviewers
    // see the contract in code.
    //
    // PRD-705-R18 step 1 — the example serves the manifest auth-scoped to
    // keep the surface uniformly authenticated, except the public-landing
    // node fetched via `/act/n/public/landing` (PRD-705-R12). Anonymous
    // callers receive 401 with the manifest-derived WWW-Authenticate set
    // per PRD-705-R9.
    if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
    return { kind: 'ok', value: { ...MANIFEST } };
  },

  async resolveIndex(_req, ctx) {
    // PRD-705-R8 — the index endpoint requires an authenticated principal
    // AND a scoped tenant. Anonymous or single-tenancy callers see a 401
    // (auth_required).
    if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
    if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
    const nodes = listTenantNodes(ctx.tenant.key);
    const value: Index = {
      act_version: '0.1',
      nodes: nodes.map((n) => nodeToIndexEntry(n, ctx)),
    };
    return { kind: 'ok', value };
  },

  async resolveNode(_req, ctx, params) {
    // PRD-705-R12 — public landing branch BEFORE the tenant filter. Hard-
    // coded; never invokes a tenant-filtered query.
    if (params.id === PUBLIC_LANDING_ID) {
      return { kind: 'ok', value: getPublicLandingNode() };
    }
    // Everything else requires an authenticated principal AND a scoped
    // tenant (PRD-705-R8 / PRD-109-R11 / R13).
    if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
    if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
    const node = getTenantNode(params.id, ctx.tenant.key);
    if (!node) return { kind: 'not_found' }; // PRD-705-R17 — collapses absent + forbidden
    return { kind: 'ok', value: node };
  },

  async resolveSubtree(_req, ctx, params) {
    // PRD-705-R14 — bound depth to [0, 8]; default 3 when omitted (the
    // SDK passes `depth` through from `?depth=N` after parse).
    const depth = Number.isFinite(params.depth) ? params.depth : DEFAULT_SUBTREE_DEPTH;
    if (depth < 0 || depth > 8) {
      return { kind: 'validation', details: { reason: 'depth_out_of_range' } };
    }
    // The example's content tree is shallow: every per-tenant document is
    // a sibling. The subtree from a tenant document is just the document
    // itself (no children). The public landing branch is also a leaf.
    const buildSubtree = (root: Node): Subtree => ({
      act_version: '0.1',
      root: root.id,
      etag: root.etag,
      depth: 0,
      nodes: [root],
    });
    if (params.id === PUBLIC_LANDING_ID) {
      return { kind: 'ok', value: buildSubtree(getPublicLandingNode()) };
    }
    if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
    if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
    const node = getTenantNode(params.id, ctx.tenant.key);
    if (!node) return { kind: 'not_found' };
    return { kind: 'ok', value: buildSubtree(node) };
  },
};

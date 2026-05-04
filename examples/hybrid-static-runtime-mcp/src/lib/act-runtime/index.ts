/**
 * PRD-706-R6 (inherits PRD-705) `ActRuntime` for the app mount.
 *
 * Compared to PRD-705's runtime:
 *   - `basePath: "/app"` (PRD-501-R8 / PRD-706-R6).
 *   - Advertised URLs are prefixed with `/app` (the SDK does this on the
 *     manifest path; we also pre-bake it here so the per-mount manifest
 *     surfaced via the MCP bridge carries the same shape).
 *
 * Identity / tenant scoping, ETag derivation, public-landing branch, and
 * cross-tenant 404 collapse all match PRD-705 verbatim.
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
} from '../act-host/content.js';

/**
 * PRD-706-R6 — leaf manifest for the app mount. URL templates are stored
 * un-prefixed; the runtime-next SDK's `wrapManifestRuntime` injects the
 * `basePath` prefix on the served wire manifest (PRD-501-R9 step 2). The
 * dispatch pipeline strips `basePath` from incoming paths BEFORE matching
 * against these un-prefixed templates.
 */
export const APP_MANIFEST: Manifest = {
  act_version: '0.1',
  site: { name: 'Acme App' },
  delivery: 'runtime',
  conformance: { level: 'standard' },
  // PRD-705-R2 / PRD-706-R6 — auth.schemes carries cookie + bearer.
  auth: { schemes: ['cookie', 'bearer'] },
  index_url: '/act/index.json',
  node_url_template: '/act/n/{id}',
  subtree_url_template: '/act/sub/{id}',
  capabilities: { etag: true, subtree: true },
} as Manifest;

const DEFAULT_SUBTREE_DEPTH = 3;

function stripEtag(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === 'etag') continue;
    out[k] = v;
  }
  return out;
}

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
    if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
    return { kind: 'ok', value: { ...APP_MANIFEST } };
  },

  async resolveIndex(_req, ctx) {
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
    if (params.id === PUBLIC_LANDING_ID) {
      return { kind: 'ok', value: getPublicLandingNode() };
    }
    if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
    if (ctx.tenant.kind !== 'scoped') return { kind: 'not_found' };
    const node = getTenantNode(params.id, ctx.tenant.key);
    if (!node) return { kind: 'not_found' };
    return { kind: 'ok', value: node };
  },

  async resolveSubtree(_req, ctx, params) {
    const depth = Number.isFinite(params.depth) ? params.depth : DEFAULT_SUBTREE_DEPTH;
    if (depth < 0 || depth > 8) {
      return { kind: 'validation', details: { reason: 'depth_out_of_range' } };
    }
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

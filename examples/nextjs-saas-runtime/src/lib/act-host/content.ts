/**
 * Content materialization via `@act-spec/adapter-programmatic` (PRD-208).
 *
 * The PRD-705 example serves runtime-only content; PRD-705-R12 / OQ2 record
 * that the public landing branch is inline in `resolveNode` and that the
 * programmatic-adapter is cited as the future seam (v0.2) for build-time
 * pre-materialization. We exercise the adapter dependency at module-load
 * time to PRE-VALIDATE the canonical node envelopes the resolver returns,
 * so any drift between the example's hand-coded node shape and the
 * PRD-100-R21 envelope schema is surfaced before the first request lands.
 *
 * The adapter runs once at startup and produces a typed `Map<id, Node>`
 * keyed by the persistent document id. The resolver then hands these out
 * via the PRD-705-R12-mandated branching (public-landing branch first;
 * tenant filter for everything else).
 *
 * This is the "use programmatic-adapter to construct workspace nodes at
 * startup and bind them to runtime-next" hand-off the runtime engineer
 * SOP-5 calls for, while honoring PRD-705-R12's normative inline branch.
 */
/* eslint-disable @typescript-eslint/require-await */
import {
  defineSimpleAdapter,
  PROGRAMMATIC_ADAPTER_DEFAULT_NAME,
} from '@act-spec/adapter-programmatic';
import {
  runAdapter,
  type AdapterContext,
  type AdapterLogger,
  type EmittedNode,
} from '@act-spec/adapter-framework';
import type { Node } from '@act-spec/runtime-core';

import { db, type Document } from '../db';

/** PRD-705-R12 — single anonymous-readable node id. */
export const PUBLIC_LANDING_ID = 'public/landing';

/** Token estimator (length / 4 ≈ tokens; coarse but deterministic). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

interface ContentItem {
  readonly kind: 'public' | 'doc';
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  /** `tenantId` is undefined for the public landing node (PRD-705-R12). */
  readonly tenantId?: string;
}

function items(): ContentItem[] {
  const out: ContentItem[] = [
    {
      kind: 'public',
      id: PUBLIC_LANDING_ID,
      title: 'About this workspace',
      summary:
        'Welcome to a reference SaaS workspace built on the ACT runtime profile. Sign in to your tenant to see private documents.',
      body: 'This page is the only public node. Every other document in this workspace is private to a tenant. Authenticate with the cookie or bearer scheme to fetch your tenant’s documents via /act/index.json and /act/n/doc/{id}.',
    },
  ];
  // Materialize per-tenant docs the same way so the PRD-100 envelope is
  // exercised for every node the resolver hands out.
  for (const d of db_documents()) {
    out.push({
      kind: 'doc',
      id: d.id,
      title: d.title,
      summary: d.summary,
      body: d.body,
      tenantId: d.tenantId,
    });
  }
  return out;
}

/** Helper to enumerate every doc in the in-memory DB. */
function db_documents(): readonly Document[] {
  // Internal helper: union per-tenant lists. The DB module deliberately
  // does not expose an "all docs" accessor (the per-tenant filter is the
  // primary access pattern). This helper is materialization-only.
  const acme = db.documents.listByTenant('tenant-acme');
  const beta = db.documents.listByTenant('tenant-beta');
  return [...acme, ...beta];
}

/**
 * The programmatic adapter spec. Each input item becomes one PRD-100-R21
 * node envelope; the adapter framework's pre-emit validator (PRD-208-R3)
 * runs each envelope through the JSON-Schema, so a mismatch surfaces at
 * startup, NOT at first request.
 */
const adapter = defineSimpleAdapter<ContentItem>({
  name: PROGRAMMATIC_ADAPTER_DEFAULT_NAME,
  items: items(),
  // PRD-208-R7 — opt out of namespacing because the example's IDs are
  // already canonical (`public/landing`, `doc/{uuid}`) per PRD-705-R4.
  namespaceIds: false,
  capabilities: { level: 'standard' },
  transform(item): EmittedNode {
    return {
      act_version: '0.1',
      id: item.id,
      type: 'article',
      title: item.title,
      summary: item.summary,
      content: [{ type: 'prose', text: item.body }],
      tokens: { summary: estimateTokens(item.summary), body: estimateTokens(item.body) },
      // ETag is filled in by the SDK's `defaultEtagComputer` per
      // PRD-705-R10; the adapter's emit just reserves the field.
      etag: '',
    };
  },
});

const logger: AdapterLogger = {
  // eslint-disable-next-line no-console, @typescript-eslint/no-empty-function
  debug: () => {},
  // eslint-disable-next-line no-console
  info: (m: string): void => console.error(`[content-adapter] ${m}`),
  // eslint-disable-next-line no-console
  warn: (m: string): void => console.error(`[content-adapter] WARN ${m}`),
  // eslint-disable-next-line no-console
  error: (m: string): void => console.error(`[content-adapter] ERROR ${m}`),
};

/**
 * Run the programmatic adapter at module-load time. Returns a Map keyed by
 * canonical id. The adapter's pre-emit validator (PRD-208-R3) ensures every
 * node envelope satisfies PRD-100-R21 / PRD-102 before the resolver can
 * hand it out.
 */
async function materialize(): Promise<Map<string, Node>> {
  const ctx: AdapterContext = {
    config: {},
    targetLevel: 'standard',
    actVersion: '0.1',
    logger,
    signal: new AbortController().signal,
    state: {},
  };
  const result = await runAdapter(adapter, {}, ctx);
  const map = new Map<string, Node>();
  for (const n of result.nodes) {
    if ('_actPartial' in n && n._actPartial === true) continue; // SimpleAdapter never emits partials
    map.set(n.id, n as Node);
  }
  return map;
}

// Top-level await is allowed in ES2022 + node ESM; module load completes
// only after the adapter has materialized AND validated every node. Any
// PRD-100/PRD-102 schema mismatch surfaces here at boot.
const NODE_CACHE: Map<string, Node> = await materialize();

/** Look up the public landing node (PRD-705-R12). */
export function getPublicLandingNode(): Node {
  const n = NODE_CACHE.get(PUBLIC_LANDING_ID);
  if (!n) throw new Error('public landing node missing from materialized cache');
  return n;
}

/**
 * Look up a tenant-scoped document. Returns `undefined` for both "absent"
 * and "wrong-tenant" cases so the resolver collapses both into a single
 * `{ kind: 'not_found' }` per PRD-705-R17 / PRD-109-R3.
 */
export function getTenantNode(id: string, tenantId: string): Node | undefined {
  const n = NODE_CACHE.get(id);
  if (!n) return undefined;
  // Cross-check against the DB so the node-cache view of "tenancy" agrees
  // with the database of record. This is the per-tenant scoping invariant
  // PRD-705-R8 and PRD-705-R20 enforce; the adapter is authoritative on
  // envelope shape, the DB is authoritative on tenancy.
  const doc = db.documents.findByIdScoped(id, tenantId);
  if (!doc) return undefined;
  return n;
}

/** Enumerate the visible nodes for a given tenant (PRD-705-R8 index path). */
export function listTenantNodes(tenantId: string): readonly Node[] {
  const docs = db.documents.listByTenant(tenantId);
  return docs
    .map((d) => NODE_CACHE.get(d.id))
    .filter((n): n is Node => n !== undefined);
}

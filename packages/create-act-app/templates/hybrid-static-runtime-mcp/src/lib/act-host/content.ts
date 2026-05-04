/**
 * Content materialization for the runtime app mount.
 *
 * Mirrors PRD-705's pattern: the `@act-spec/adapter-programmatic` (PRD-208)
 * runs at module-load time to materialize the canonical PRD-100 envelope
 * for each per-tenant document AND the optional public landing node. The
 * pre-emit validator catches schema drift before the first request lands.
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

import { db, type Document } from '../db.js';

/** PRD-705-R12 — public landing id (optional retention per PRD-706-R6). */
export const PUBLIC_LANDING_ID = 'public/landing';

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

interface ContentItem {
  readonly kind: 'public' | 'doc';
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly tenantId?: string;
}

function items(): ContentItem[] {
  const out: ContentItem[] = [
    {
      kind: 'public',
      id: PUBLIC_LANDING_ID,
      title: 'Workspace landing — sign in to see your tenant',
      summary:
        'The app mount of the PRD-706 hybrid example. Public node mirrors the marketing landing; everything else requires authentication.',
      body: 'This page is the only public node on the runtime /app mount. Authenticate to fetch your tenant’s documents.',
    },
  ];
  for (const d of allDocuments()) {
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

function allDocuments(): readonly Document[] {
  return [
    ...db.documents.listByTenant('tenant-acme'),
    ...db.documents.listByTenant('tenant-beta'),
  ];
}

const adapter = defineSimpleAdapter<ContentItem>({
  name: PROGRAMMATIC_ADAPTER_DEFAULT_NAME,
  items: items(),
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
      etag: '',
    };
  },
});

const logger: AdapterLogger = {
  debug: () => undefined,
  // eslint-disable-next-line no-console
  info: (m: string): void => console.error(`[content-adapter] ${m}`),
  // eslint-disable-next-line no-console
  warn: (m: string): void => console.error(`[content-adapter] WARN ${m}`),
  // eslint-disable-next-line no-console
  error: (m: string): void => console.error(`[content-adapter] ERROR ${m}`),
};

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
    if ('_actPartial' in n && n._actPartial === true) continue;
    map.set(n.id, n as Node);
  }
  return map;
}

const NODE_CACHE: Map<string, Node> = await materialize();

export function getPublicLandingNode(): Node {
  const n = NODE_CACHE.get(PUBLIC_LANDING_ID);
  if (!n) throw new Error('public landing node missing from materialized cache');
  return n;
}

export function getTenantNode(id: string, tenantId: string): Node | undefined {
  const n = NODE_CACHE.get(id);
  if (!n) return undefined;
  const doc = db.documents.findByIdScoped(id, tenantId);
  if (!doc) return undefined;
  return n;
}

export function listTenantNodes(tenantId: string): readonly Node[] {
  const docs = db.documents.listByTenant(tenantId);
  return docs
    .map((d) => NODE_CACHE.get(d.id))
    .filter((n): n is Node => n !== undefined);
}

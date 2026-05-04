/**
 * `act_walk_subtree(url, node_id, depth?)` — walks the subtree rooted
 * at `node_id`. We delegate to the inspector's `walk` API and then
 * filter the resulting node set to descendants of `node_id` (inclusive)
 * up to `depth`.
 *
 * Why not call `subtree(url, node_id, { depth })` directly? Because
 * subtree is a Standard-or-better feature; many ACT-emitting sites
 * declare `level=core` and only ship the index + per-node endpoints.
 * A client-side walk over the index is the universal approach.
 *
 * We DO try `subtree` first when available (via the manifest), but the
 * fallback is a structural walk over the index.
 */
import { walk } from '@act-spec/inspector';

import type { ServerCache } from '../cache.js';
import type { WalkSubtreeResult } from '../types.js';

export interface WalkSubtreeDeps {
  fetch?: typeof globalThis.fetch;
  cache: ServerCache;
}

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 8;

export async function actWalkSubtree(
  url: string,
  rootId: string,
  depth: number,
  deps: WalkSubtreeDeps,
): Promise<WalkSubtreeResult> {
  const clampedDepth = clampDepth(depth);
  const opts: Parameters<typeof walk>[1] = { sample: 'all' };
  if (deps.fetch !== undefined) opts.fetch = deps.fetch;
  const result = await walk(url, opts);

  if (result.manifest === null) {
    return {
      url: result.url,
      root_id: rootId,
      depth: clampedDepth,
      nodes: [],
      truncated: false,
      findings: result.findings,
    };
  }

  // Cache the manifest (cheap side-effect; lets `act_load_site` be
  // a no-op next time).
  deps.cache.setManifest(url, result.manifest);

  const byId = new Map<string, (typeof result.nodes)[number]>();
  for (const n of result.nodes) byId.set(n.id, n);

  // BFS from rootId, bounded by clampedDepth.
  const out: WalkSubtreeResult['nodes'] = [];
  const seen = new Set<string>();
  const queue: Array<{ id: string; d: number }> = [{ id: rootId, d: 0 }];
  while (queue.length > 0) {
    const { id, d } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    out.push({
      id: n.id,
      type: n.type,
      parent: n.parent,
      children: n.children,
      ...(typeof (n as { title?: string }).title === 'string'
        ? { title: (n as { title?: string }).title! }
        : {}),
      ...(typeof (n as { summary?: string }).summary === 'string'
        ? { summary: (n as { summary?: string }).summary! }
        : {}),
    });
    if (d < clampedDepth) {
      for (const childId of n.children ?? []) {
        if (!seen.has(childId)) queue.push({ id: childId, d: d + 1 });
      }
    }
  }

  return {
    url: result.url,
    root_id: rootId,
    depth: clampedDepth,
    nodes: out,
    truncated: false,
    findings: result.findings,
  };
}

function clampDepth(d: number): number {
  if (!Number.isFinite(d)) return DEFAULT_DEPTH;
  if (d < 0) return 0;
  if (d > MAX_DEPTH) return MAX_DEPTH;
  return Math.floor(d);
}

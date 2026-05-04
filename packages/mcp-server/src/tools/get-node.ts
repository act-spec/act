/**
 * `act_get_node(url, node_id)` — single-node fetch, delegating to the
 * inspector's `node` API.
 */
import { node as inspectorNode } from '@act-spec/inspector';

import type { ServerCache } from '../cache.js';
import type { GetNodeResult } from '../types.js';

export interface GetNodeDeps {
  fetch?: typeof globalThis.fetch;
  cache: ServerCache;
}

export async function actGetNode(
  url: string,
  nodeId: string,
  deps: GetNodeDeps,
): Promise<GetNodeResult> {
  const cached = deps.cache.getNode(url, nodeId);
  if (cached !== undefined) {
    return { url, node: cached, findings: [] };
  }
  const opts: Parameters<typeof inspectorNode>[2] = {};
  if (deps.fetch !== undefined) opts.fetch = deps.fetch;
  const result = await inspectorNode(url, nodeId, opts);
  if (result.node !== null && result.node !== undefined) {
    deps.cache.setNode(url, nodeId, result.node);
  }
  return {
    url: result.url,
    node: result.node,
    findings: result.findings,
  };
}

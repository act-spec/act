/**
 * `budget` — token-budget what-if (PRD-601-R12).
 *
 * Two strategies:
 *
 *  - `breadth-first` (default): start at `root_id` (or `--start-id`),
 *    include the start node, then walk children layer-by-layer adding
 *    full bodies until the next addition would exceed `max-tokens`.
 *
 *  - `deepest-first`: walk leaves first, then ascend, including each
 *    parent only when all of its descendants up to the cutoff have
 *    been included.
 *
 * Token costs are the producer-declared `tokens.summary + tokens.body`
 * per PRD-601-R12; an optional `tokenizer` callback overrides on the
 * programmatic API only (per Q3 resolution).
 */
import { walk } from './walk.js';
import type { BudgetOptions, BudgetResult, WalkResult } from './types.js';

export async function budget(
  url: string,
  maxTokens: number,
  opts: BudgetOptions = {},
): Promise<BudgetResult> {
  const w = await walk(url, opts);
  const manifest = w.manifest as Record<string, unknown> | null;
  const rootId = (manifest && typeof manifest['root_id'] === 'string' ? (manifest['root_id']) : 'root');
  const startId = opts.startId ?? rootId;
  const strategy = opts.strategy ?? 'breadth-first';
  const order = strategy === 'breadth-first' ? walkBreadthFirst(w, startId) : walkDeepestFirst(w, startId);

  const inclusion: BudgetResult['inclusion_order'] = [];
  let cumulative = 0;
  for (const node of order) {
    const cost = costOf(node, opts);
    if (cumulative + cost > maxTokens) continue;
    cumulative += cost;
    inclusion.push({ id: node.id, tokens: cost, cumulative_tokens: cumulative });
  }

  return {
    url: w.url,
    strategy,
    max_tokens: maxTokens,
    start_id: startId,
    inclusion_order: inclusion,
    summary: {
      nodes_included: inclusion.length,
      nodes_excluded: order.length - inclusion.length,
      tokens_used: cumulative,
      tokens_remaining: maxTokens - cumulative,
    },
    findings: w.findings,
  };
}

function costOf(node: WalkResult['nodes'][number], opts: BudgetOptions): number {
  if (opts.tokenizer) return opts.tokenizer(node.id);
  return (node.tokens.summary ?? 0) + (node.tokens.body ?? 0);
}

function walkBreadthFirst(w: WalkResult, startId: string): WalkResult['nodes'] {
  const byId = new Map(w.nodes.map((n) => [n.id, n] as const));
  const start = byId.get(startId);
  if (!start) return [];
  const out: WalkResult['nodes'] = [];
  const seen = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    out.push(n);
    for (const c of n.children ?? []) {
      if (!seen.has(c)) queue.push(c);
    }
  }
  return out;
}

function walkDeepestFirst(w: WalkResult, startId: string): WalkResult['nodes'] {
  const byId = new Map(w.nodes.map((n) => [n.id, n] as const));
  const start = byId.get(startId);
  if (!start) return [];
  const out: WalkResult['nodes'] = [];
  const seen = new Set<string>();
  // Post-order DFS — emit descendants before ancestors.
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = byId.get(id);
    if (!n) return;
    for (const c of n.children ?? []) visit(c);
    out.push(n);
  };
  visit(startId);
  return out;
}

/**
 * Cycle detection for the `children` graph (PRD-100-R25 / PRD-102-R25).
 *
 * `children` is a forest by spec — cycles are a hard error per PRD-600-R13.
 * `related` cycles are tolerated (PRD-100-R26) and not detected here.
 */

interface NodeLike {
  id?: unknown;
  children?: unknown;
}

/**
 * Detect whether the node references itself (directly or via siblings in
 * its own `children[]` set). Single-node form: PRD-600 emits a gap if the
 * node lists its own ID in `children[]`.
 *
 * Returns `true` if a self-cycle exists in this single envelope.
 */
export function hasSelfCycle(node: NodeLike): boolean {
  if (typeof node.id !== 'string') return false;
  if (!Array.isArray(node.children)) return false;
  for (const child of node.children) {
    if (typeof child === 'string' && child === node.id) return true;
  }
  return false;
}

/**
 * Detect cycles in a multi-node graph (e.g., a subtree's `nodes[]` set or
 * an index's `nodes[]` set). Returns the IDs participating in the first
 * cycle found, or `null` if the graph is acyclic.
 *
 * The graph is built from each node's `id` → `children[]` edges. Nodes
 * referenced as children but not present in `nodes[]` are tolerated (the
 * graph is open; only the in-set portion is checked).
 */
export function findChildrenCycle(nodes: readonly NodeLike[]): readonly string[] | null {
  const adj = new Map<string, readonly string[]>();
  for (const n of nodes) {
    if (typeof n.id !== 'string') continue;
    const kids: string[] = [];
    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        if (typeof c === 'string') kids.push(c);
      }
    }
    adj.set(n.id, kids);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function dfs(u: string): readonly string[] | null {
    color.set(u, GRAY);
    stack.push(u);
    // Every `u` reached here was registered in `adj` by the caller.
    const kids = adj.get(u) as readonly string[];
    for (const v of kids) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        // Cycle: every gray node is on the stack, so indexOf is always ≥ 0.
        const idx = stack.indexOf(v);
        return [...stack.slice(idx), v];
      }
      if (c === WHITE && adj.has(v)) {
        const sub = dfs(v);
        if (sub) return sub;
      }
    }
    color.set(u, BLACK);
    stack.pop();
    return null;
  }

  for (const u of adj.keys()) {
    if ((color.get(u) ?? WHITE) === WHITE) {
      const r = dfs(u);
      if (r) return r;
    }
  }
  return null;
}

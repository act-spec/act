/**
 * `diff` — classify two trees by node `id` (PRD-601-R10 / R13).
 *
 * Algorithm is O(N + M):
 *   1. walk(urlA), walk(urlB) in parallel.
 *   2. build per-tree maps (id → node entry).
 *   3. one-pass classification per id ∈ mapA ∪ mapB.
 *   4. when `--include-content` is set AND classification is
 *      `etag_changed`, fetch both nodes' bodies and emit a JCS-pointer
 *      changeset.
 *
 * Per PRD-601-R10 the diff is by id, NOT structural similarity. Per
 * PRD-601-R10 the inspector tolerates differing `root_id` values.
 */
import { walk } from './walk.js';
import { node as fetchNode } from './fetch.js';
import type { DiffOptions, DiffResult, Finding, WalkResult } from './types.js';

export async function diff(urlA: string, urlB: string, opts: DiffOptions = {}): Promise<DiffResult> {
  const [a, b] = await Promise.all([walk(urlA, opts), walk(urlB, opts)]);

  const mapA = new Map(a.nodes.map((n) => [n.id, n] as const));
  const mapB = new Map(b.nodes.map((n) => [n.id, n] as const));

  const added: DiffResult['added'] = [];
  const removed: DiffResult['removed'] = [];
  const etag_unchanged: DiffResult['etag_unchanged'] = [];
  const etag_changed: DiffResult['etag_changed'] = [];
  const structural_change: DiffResult['structural_change'] = [];

  const allIds = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const sortedIds = [...allIds].sort();

  for (const id of sortedIds) {
    const ea = mapA.get(id);
    const eb = mapB.get(id);
    if (!ea && eb) {
      added.push({ id });
    } else if (ea && !eb) {
      removed.push({ id });
    } else if (ea && eb) {
      if (ea.etag === eb.etag && ea.etag !== '') {
        const struct = detectStructuralChange(ea, eb);
        if (struct !== null) {
          structural_change.push({ id, ...struct });
        } else {
          etag_unchanged.push({ id });
        }
      } else if (ea.etag === eb.etag && ea.etag === '') {
        // Empty etag both sides — fall back to structural comparison.
        const struct = detectStructuralChange(ea, eb);
        if (struct !== null) {
          structural_change.push({ id, ...struct });
        } else {
          etag_unchanged.push({ id });
        }
      } else {
        const tokenDelta = {
          summary: (eb.tokens.summary ?? 0) - (ea.tokens.summary ?? 0),
          body: (eb.tokens.body ?? 0) - (ea.tokens.body ?? 0),
        };
        const entry: DiffResult['etag_changed'][number] = { id, token_delta: tokenDelta };
        if (opts.includeContent === true) {
          const changes = await diffContent(id, urlA, urlB, opts);
          if (changes.length > 0) entry.changes = changes;
        }
        etag_changed.push(entry);
      }
    }
  }

  return {
    url_a: urlA,
    url_b: urlB,
    added,
    removed,
    etag_unchanged,
    etag_changed,
    structural_change,
    findings: combinedFindings(a, b),
    walk_summary: {
      requests_made: a.walk_summary.requests_made + b.walk_summary.requests_made,
      elapsed_ms: Math.max(a.walk_summary.elapsed_ms, b.walk_summary.elapsed_ms),
    },
  };
}

function combinedFindings(a: WalkResult, b: WalkResult): Finding[] {
  return [
    ...a.findings.map((f) => ({ ...f, message: `[A] ${f.message}` })),
    ...b.findings.map((f) => ({ ...f, message: `[B] ${f.message}` })),
  ];
}

interface MaybeStructuralChange {
  parent_change?: { before: string | null | undefined; after: string | null | undefined };
  children_change?: { added: string[]; removed: string[] };
}

function detectStructuralChange(
  a: WalkResult['nodes'][number],
  b: WalkResult['nodes'][number],
): MaybeStructuralChange | null {
  const out: MaybeStructuralChange = {};
  if ((a.parent ?? null) !== (b.parent ?? null)) {
    out.parent_change = { before: a.parent ?? null, after: b.parent ?? null };
  }
  const aSorted = [...(a.children ?? [])].sort();
  const bSorted = [...(b.children ?? [])].sort();
  if (aSorted.join(',') !== bSorted.join(',')) {
    const aSet = new Set(aSorted);
    const bSet = new Set(bSorted);
    out.children_change = {
      added: bSorted.filter((c) => !aSet.has(c)),
      removed: aSorted.filter((c) => !bSet.has(c)),
    };
  }
  return Object.keys(out).length === 0 ? null : out;
}

async function diffContent(
  id: string,
  urlA: string,
  urlB: string,
  opts: DiffOptions,
): Promise<Array<{ pointer: string; before: unknown; after: unknown }>> {
  const [na, nb] = await Promise.all([fetchNode(urlA, id, opts), fetchNode(urlB, id, opts)]);
  if (!na.node || !nb.node) return [];
  const ignore = new Set(opts.ignoreFields ?? []);
  const flatA = flatten(na.node, '');
  const flatB = flatten(nb.node, '');
  const out: Array<{ pointer: string; before: unknown; after: unknown }> = [];
  const allKeys = new Set([...flatA.keys(), ...flatB.keys()]);
  for (const k of [...allKeys].sort()) {
    if (ignore.has(k) || ignore.has(stripPointer(k))) continue;
    const va = flatA.get(k);
    const vb = flatB.get(k);
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      out.push({ pointer: k, before: va, after: vb });
    }
  }
  return out;
}

function flatten(value: unknown, prefix: string, out = new Map<string, unknown>()): Map<string, unknown> {
  if (value === null || typeof value !== 'object') {
    out.set(prefix === '' ? '/' : prefix, value);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.set(prefix === '' ? '/' : prefix, []);
    }
    for (let i = 0; i < value.length; i += 1) {
      flatten(value[i], `${prefix}/${i}`, out);
    }
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) out.set(prefix === '' ? '/' : prefix, {});
  for (const [k, v] of entries) {
    flatten(v, `${prefix}/${escapePointer(k)}`, out);
  }
  return out;
}

function escapePointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function stripPointer(p: string): string {
  // Convert /tokens/summary → tokens.summary so `--ignore-fields tokens.summary` works.
  return p.replace(/^\//, '').replace(/\//g, '.');
}

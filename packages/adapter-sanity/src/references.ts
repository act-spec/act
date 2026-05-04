/**
 * PRD-203-R10 / R11 / R12 — reference resolution with depth bound + cycle
 * detection. Sanity `_ref` link → ACT `related[]` entry per PRD-102-R18.
 *
 * Depth ≥0 and ≤5 (R11). 0 = no resolution; 1 = immediate refs only.
 * Cycles tolerated (R12 / PRD-102-R20) — counted and stamped on
 * `metadata.reference_cycles` by the caller.
 */
import type { SanityAdapterConfig, SanityDocument, SanityRef } from './types.js';

export interface ReferenceLookup {
  /** Look up a referenced document by `_id`. Undefined when not in corpus. */
  getDocument(id: string): SanityDocument | undefined;
}

export interface ReferenceResolutionResult {
  related: Array<{ id: string; relation: string }>;
  cycles: number;
}

/**
 * Resolve every reference field configured on `fieldMapping.related`.
 * Returns related ACT IDs (resolved via `idResolver`) plus a cycle count.
 */
export function resolveReferences(
  doc: SanityDocument,
  config: SanityAdapterConfig,
  lookup: ReferenceLookup,
  idResolver: (target: SanityDocument) => string,
): ReferenceResolutionResult {
  const out: Array<{ id: string; relation: string }> = [];
  const fields = config.fieldMapping?.related ?? {};
  const depth = clampDepth(config.referenceDepth ?? 1);
  if (depth === 0) return { related: out, cycles: 0 };

  const seen = new Set<string>([doc._id]);
  let cycles = 0;

  for (const [fieldName, relation] of Object.entries(fields)) {
    const refs = collectRefs(doc[fieldName]);
    for (const ref of refs) {
      const targetId = ref._ref;
      if (seen.has(targetId)) {
        cycles += 1;
        continue;
      }
      seen.add(targetId);
      const target = lookup.getDocument(targetId);
      if (!target) continue;
      const actId = idResolver(target);
      out.push({ id: actId, relation });
      if (depth > 1) {
        // Recurse one level deeper — propagate `seen`, decrement depth.
        const inner = resolveReferencesInner(target, config, lookup, idResolver, seen, depth - 1);
        for (const e of inner.related) out.push(e);
        cycles += inner.cycles;
      }
    }
  }
  return { related: out, cycles };
}

function resolveReferencesInner(
  doc: SanityDocument,
  config: SanityAdapterConfig,
  lookup: ReferenceLookup,
  idResolver: (target: SanityDocument) => string,
  seen: Set<string>,
  depth: number,
): ReferenceResolutionResult {
  const out: Array<{ id: string; relation: string }> = [];
  let cycles = 0;
  const fields = config.fieldMapping?.related ?? {};
  for (const [fieldName, relation] of Object.entries(fields)) {
    const refs = collectRefs(doc[fieldName]);
    for (const ref of refs) {
      if (seen.has(ref._ref)) {
        cycles += 1;
        continue;
      }
      seen.add(ref._ref);
      const target = lookup.getDocument(ref._ref);
      if (!target) continue;
      out.push({ id: idResolver(target), relation });
      if (depth > 1) {
        const inner = resolveReferencesInner(target, config, lookup, idResolver, seen, depth - 1);
        for (const e of inner.related) out.push(e);
        cycles += inner.cycles;
      }
    }
  }
  return { related: out, cycles };
}

/** Clamp / validate depth — PRD-203-R11. */
export function clampDepth(d: number): number {
  if (!Number.isInteger(d)) return 1;
  if (d < 0) return 0;
  if (d > 5) return 5;
  return d;
}

/** Collect references from a value (single ref, array of refs, or absent). */
function collectRefs(v: unknown): SanityRef[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap((x) => collectRefs(x));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['_ref'] === 'string') {
      return [o as unknown as SanityRef];
    }
  }
  return [];
}

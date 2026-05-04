/**
 * PRD-206-R14 / R15 / R16 — reference resolution with depth bound + cycle
 * tolerance.
 *
 * Builder.io's `data.references` is an array of
 * `{ '@type': '@builder.io/core:Reference', model, id }` (or in some
 * envelope variants simply `{ model, id }`) referencing other Builder
 * content entries. The adapter resolves these into ACT `related[]`
 * entries per PRD-102-R18. Default `relation` is `"see-also"`; operators
 * MAY map per-field via `fieldMapping.related`.
 *
 * Depth defaults to 1 (PRD-206-R15). Cycles are tolerated and stamped
 * `metadata.reference_cycles: <count>` per PRD-206-R16 / PRD-102-R20.
 */
import type { BuilderContent, BuilderContentData, BuilderReference } from './types.js';

export interface ReferenceLookup {
  /** Look up a referenced Builder content by model + id. Undefined when absent. */
  getContentByModelAndId(model: string, id: string): BuilderContent | undefined;
}

export interface RelationResolveResult {
  related: Array<{ id: string; relation: string }>;
  cycles: number;
}

export interface ResolveOpts {
  /** Default `"see-also"`. */
  defaultRelation: string;
  /** PRD-206-R15 — recursion depth (already clamped). */
  depth: number;
  /** Per-field relation override (`fieldMapping.related`). */
  fieldRelations: Record<string, string>;
}

/**
 * Resolve every Builder reference and any operator-configured relation
 * fields. Returns related ACT IDs (resolved via `idResolver`) plus a cycle
 * count.
 */
export function resolveReferences(
  content: BuilderContent,
  lookup: ReferenceLookup,
  opts: ResolveOpts,
  idResolver: (target: BuilderContent) => string,
): RelationResolveResult {
  const related: Array<{ id: string; relation: string }> = [];
  if (opts.depth === 0) return { related, cycles: 0 };

  const seen = new Set<string>([contentKey(content)]);
  let cycles = 0;

  // (1) Native `data.references` — relation defaults to opts.defaultRelation.
  const nativeRefs = collectReferences(content.data?.references);
  for (const ref of nativeRefs) {
    const looked = lookup.getContentByModelAndId(ref.model, ref.id);
    if (!looked) continue;
    const key = contentKey(looked);
    if (seen.has(key)) {
      cycles += 1;
      continue;
    }
    seen.add(key);
    related.push({ id: idResolver(looked), relation: opts.defaultRelation });
    if (opts.depth > 1) {
      const inner = resolveInner(looked, lookup, opts, idResolver, seen, opts.depth - 1);
      for (const e of inner.related) related.push(e);
      cycles += inner.cycles;
    }
  }

  // (2) Operator-configured per-field relations: `fieldMapping.related`.
  for (const [fieldName, relation] of Object.entries(opts.fieldRelations)) {
    const value = (content.data as Record<string, unknown> | undefined)?.[fieldName];
    const fieldRefs = collectReferences(value);
    for (const ref of fieldRefs) {
      const looked = lookup.getContentByModelAndId(ref.model, ref.id);
      if (!looked) continue;
      const key = contentKey(looked);
      if (seen.has(key)) {
        cycles += 1;
        continue;
      }
      seen.add(key);
      related.push({ id: idResolver(looked), relation });
      if (opts.depth > 1) {
        const inner = resolveInner(looked, lookup, opts, idResolver, seen, opts.depth - 1);
        for (const e of inner.related) related.push(e);
        cycles += inner.cycles;
      }
    }
  }

  return { related, cycles };
}

function resolveInner(
  content: BuilderContent,
  lookup: ReferenceLookup,
  opts: ResolveOpts,
  idResolver: (target: BuilderContent) => string,
  seen: Set<string>,
  depth: number,
): RelationResolveResult {
  const related: Array<{ id: string; relation: string }> = [];
  let cycles = 0;
  const refs = collectReferences(content.data?.references);
  for (const ref of refs) {
    const looked = lookup.getContentByModelAndId(ref.model, ref.id);
    if (!looked) continue;
    const key = contentKey(looked);
    if (seen.has(key)) {
      cycles += 1;
      continue;
    }
    seen.add(key);
    related.push({ id: idResolver(looked), relation: opts.defaultRelation });
    if (depth > 1) {
      const inner = resolveInner(looked, lookup, opts, idResolver, seen, depth - 1);
      for (const e of inner.related) related.push(e);
      cycles += inner.cycles;
    }
  }
  return related.length > 0 || cycles > 0
    ? { related, cycles }
    : { related: [], cycles: 0 };
}

/**
 * Collect a flat list of `{ model, id }` references from a value that may be
 * a Builder reference, a Builder content, an array of either, or `null`.
 */
function collectReferences(v: unknown): Array<{ model: string; id: string }> {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap((x) => collectReferences(x));
  if (typeof v !== 'object') return [];
  const o = v as Partial<BuilderReference & BuilderContent> & Record<string, unknown>;
  // Reference shape (canonical Builder): `{ '@type': '@builder.io/core:Reference', model, id }`.
  if (typeof o['model'] === 'string' && typeof o['id'] === 'string') {
    return [{ model: o['model'], id: o['id'] }];
  }
  // Inline Builder content shape: `{ id, modelName, ... }` (already-resolved).
  if (typeof o['id'] === 'string' && typeof o['modelName'] === 'string') {
    return [{ model: o['modelName'], id: o['id'] }];
  }
  return [];
}

/** Stable per-content key for cycle detection. */
function contentKey(c: BuilderContent): string {
  return `${c.modelName ?? '<unknown>'}:${c.id}`;
}

/** PRD-206-R15. Clamp reference depth to 0–3 (default 1). */
export function clampReferenceDepth(d: number | undefined): number {
  if (d === undefined) return 1;
  if (!Number.isInteger(d)) return 1;
  if (d < 0) return 0;
  if (d > 3) return 3;
  return d;
}

/** Re-export the helper so callers needn't import the contentdata type. */
export type { BuilderContentData };

/**
 * PRD-205-R12 / R13 / R14 — relation resolution with depth bound + cycle
 * tolerance.
 *
 * Strapi relation fields point to one or more entities (per content-type).
 * The adapter resolves declared relations into ACT `related[]` entries per
 * PRD-102-R18. Default `relation` is whatever the operator configured in
 * `fieldMapping.related`; depth defaults to 1 (PRD-205-R13). Cycles are
 * tolerated and stamped `metadata.reference_cycles: <count>` per PRD-205-R14.
 *
 * The shape of a "relation field" varies by Strapi version:
 *  - v4 wrap-and-attributes: `{ data: [{ id, attributes }] }` or `{ data: { id, attributes } }`.
 *  - v5 flat: `[{ id, documentId, ... }]` or `{ id, documentId, ... }`.
 */
import type { StrapiAdapterConfig, StrapiEntity } from './types.js';

export interface EntityLookup {
  /** Look up a referenced entity by content-type + Strapi id. Undefined when not in corpus. */
  getEntityByContentTypeAndId(
    contentType: string,
    id: number | string,
  ): StrapiEntity | undefined;
}

export interface RelationResolveResult {
  related: Array<{ id: string; relation: string }>;
  cycles: number;
}

/**
 * Resolve every relation field configured under `fieldMapping.related`.
 * Returns related ACT IDs (resolved via `idResolver`) plus a cycle count.
 */
export function resolveRelations(
  entity: StrapiEntity,
  config: StrapiAdapterConfig,
  lookup: EntityLookup,
  idResolver: (target: StrapiEntity) => string,
): RelationResolveResult {
  const related: Array<{ id: string; relation: string }> = [];
  const fields = config.fieldMapping?.related ?? {};
  const depth = clampPopulateDepth(config.populateDepth ?? 1);
  if (depth === 0 || Object.keys(fields).length === 0) {
    return { related, cycles: 0 };
  }
  const seen = new Set<string>([entityKey(entity)]);
  let cycles = 0;
  for (const [fieldName, relation] of Object.entries(fields)) {
    const value = (entity as unknown as Record<string, unknown>)[fieldName];
    const targets = collectRelationTargets(value);
    for (const target of targets) {
      const lookedUp = lookup.getEntityByContentTypeAndId(target.contentType, target.id);
      if (!lookedUp) continue;
      const key = entityKey(lookedUp);
      if (seen.has(key)) {
        cycles += 1;
        continue;
      }
      seen.add(key);
      related.push({ id: idResolver(lookedUp), relation });
      if (depth > 1) {
        const inner = resolveRelationsInner(
          lookedUp,
          config,
          lookup,
          idResolver,
          seen,
          depth - 1,
        );
        for (const e of inner.related) related.push(e);
        cycles += inner.cycles;
      }
    }
  }
  return { related, cycles };
}

function resolveRelationsInner(
  entity: StrapiEntity,
  config: StrapiAdapterConfig,
  lookup: EntityLookup,
  idResolver: (target: StrapiEntity) => string,
  seen: Set<string>,
  depth: number,
): RelationResolveResult {
  const related: Array<{ id: string; relation: string }> = [];
  let cycles = 0;
  const fields = config.fieldMapping?.related ?? {};
  for (const [fieldName, relation] of Object.entries(fields)) {
    const value = (entity as unknown as Record<string, unknown>)[fieldName];
    const targets = collectRelationTargets(value);
    for (const target of targets) {
      const lookedUp = lookup.getEntityByContentTypeAndId(target.contentType, target.id);
      if (!lookedUp) continue;
      const key = entityKey(lookedUp);
      if (seen.has(key)) {
        cycles += 1;
        continue;
      }
      seen.add(key);
      related.push({ id: idResolver(lookedUp), relation });
      if (depth > 1) {
        const inner = resolveRelationsInner(
          lookedUp,
          config,
          lookup,
          idResolver,
          seen,
          depth - 1,
        );
        for (const e of inner.related) related.push(e);
        cycles += inner.cycles;
      }
    }
  }
  return { related, cycles };
}

/** PRD-205-R13. Clamp populate depth to 0–4. */
export function clampPopulateDepth(d: number): number {
  if (!Number.isInteger(d)) return 1;
  if (d < 0) return 0;
  if (d > 4) return 4;
  return d;
}

interface RelationTarget {
  contentType: string;
  id: number | string;
}

/**
 * Collect relation targets from a Strapi relation field value, accepting
 * both v4 (`{ data: [...] }`) and v5 (flat array / object) shapes.
 *
 * For v5 the field value is either a single entity or an array of entities
 * each with `id` and (optionally) `documentId`. The `__contentType`
 * synthesized field is set by the corpus normalizer; if it's absent we fall
 * back to the entity's `__contentType` heuristic and skip when neither is
 * present (the entity is unresolvable without its content type).
 */
function collectRelationTargets(v: unknown): RelationTarget[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap((x) => collectRelationTargets(x));
  if (typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  // v4 envelope shape: `{ data: <one|array> }`.
  if ('data' in o) {
    return collectRelationTargets(o['data']);
  }
  const ct = typeof o['__contentType'] === 'string' ? o['__contentType'] : undefined;
  if (ct === undefined) return [];
  const id = o['id'];
  if (typeof id === 'number' || typeof id === 'string') {
    return [{ contentType: ct, id }];
  }
  return [];
}

/** Stable per-entity key for cycle detection. */
function entityKey(e: StrapiEntity): string {
  return typeof e.documentId === 'string'
    ? `${e.__contentType}:${e.documentId}`
    : `${e.__contentType}:${String(e.id)}`;
}

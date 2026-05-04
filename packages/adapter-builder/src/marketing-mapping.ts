/**
 * PRD-206-R13 — `componentMapping` projection helpers.
 *
 * `componentMapping` configures how custom Builder components map to
 * `marketing:*` blocks. Each entry has shape:
 *
 * ```
 * { type: "marketing:hero",
 *   fields: { headline: "options.headline",
 *             cta: { label: "options.ctaLabel", href: "options.ctaHref" } } }
 * ```
 *
 * Field paths support dot-notation and the array-projection suffix
 * `path[].{a, b, c}` (e.g. `tiers[].{name, price, features}`). The mapping
 * is evaluated against the Builder block's `component` field.
 */
import type { BuilderBlock } from './types.js';

export interface MappingEntry {
  type: string;
  fields: Record<string, unknown>;
}

export interface ProjectionResult {
  block: Record<string, unknown>;
  /** True when one of the projected fields resolved to `undefined`. */
  partial: boolean;
}

/**
 * Emit a `marketing:*` block by projecting fields per `mapping.fields`
 * against the Builder block. The projection source is the entire block
 * object (so paths like `options.headline` resolve to `block.component.options.headline`
 * via the `component.options.*` short-form OR direct `options.*` against the
 * inlined component object). For ergonomics, we expose `options.*` as a
 * top-level alias of `component.options.*`.
 */
export function emitMappedBlock(
  src: BuilderBlock,
  mapping: MappingEntry,
): ProjectionResult {
  const root = makeProjectionRoot(src);
  const out: Record<string, unknown> = { type: mapping.type };
  let partial = false;
  for (const [actField, projection] of Object.entries(mapping.fields)) {
    const value = project(root, projection);
    if (value === undefined) partial = true;
    out[actField] = value;
  }
  return { block: out, partial };
}

/**
 * Build a projection root object that exposes both `component.options.*` and
 * the more ergonomic top-level `options.*` so configured paths can be short.
 */
function makeProjectionRoot(src: BuilderBlock): Record<string, unknown> {
  const opts = src.component?.options ?? {};
  return {
    ...src,
    options: opts,
    component: src.component ?? {},
  };
}

/** Recursive projection per PRD-206-R13 / PRD-205-R11 syntax. */
function project(src: Record<string, unknown>, projection: unknown): unknown {
  if (typeof projection === 'string') return resolvePath(src, projection);
  if (Array.isArray(projection)) return projection.map((p) => project(src, p));
  if (projection !== null && typeof projection === 'object') {
    const obj = projection as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = project(src, v);
    return out;
  }
  return projection;
}

/**
 * Resolve a dot path with optional `[].{a, b, c}` array-projection suffix.
 *  - `tiers` → src.tiers
 *  - `tiers[].{name, price, features}` → src.tiers.map(t => ({ name: t.name, ... }))
 *  - `cta.label` → src.cta.label
 */
function resolvePath(src: Record<string, unknown>, path: string): unknown {
  const arrayProj = /^([\w.]+)\[\]\.\{([\w,\s]+)\}$/.exec(path.trim());
  if (arrayProj) {
    const basePath = arrayProj[1] ?? '';
    const fields = (arrayProj[2] ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    const arr = resolvePath(src, basePath);
    if (!Array.isArray(arr)) return undefined;
    return arr.map((item: unknown) => {
      if (item === null || typeof item !== 'object') return item;
      const obj = item as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const f of fields) out[f] = obj[f];
      return out;
    });
  }
  const parts = path.split('.').filter((p) => p.length > 0);
  let cur: unknown = src;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Slug-case a Builder identifier for use in variant `id` suffixes. */
export function slugCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

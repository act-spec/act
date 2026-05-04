/**
 * PRD-205-R10 / R11 — dynamic-zone & component → marketing:* walker.
 *
 * Strapi dynamic zones are arrays of component instances each tagged with a
 * `__component` discriminator (e.g. `"shared.hero"`). When the configured
 * `componentMapping` carries an entry for that component, the walker emits
 * the corresponding `marketing:*` block (PRD-102-R6/R7-R11). Otherwise the
 * walker emits a partial-extraction `prose` block citing the unmapped
 * component name.
 *
 * Recursion depth: components MAY contain nested dynamic zones (Strapi
 * "repeatable components" + nested `__component` entries). Depth caps at the
 * configured `dynamicZoneMax` (1–3, default 3 per PRD-205-R10). Beyond that
 * cap the walker emits a partial `prose` block with the bound message.
 */
import type { StrapiAdapterConfig, StrapiDynamicZoneEntry } from './types.js';
import type { ContentBlock } from './markdown.js';

export interface DynamicZoneConvertContext {
  targetLevel: 'core' | 'standard' | 'strict';
  componentMapping?: StrapiAdapterConfig['componentMapping'];
  /** PRD-205-R10 — recursion bound for component nesting. Default 3. */
  dynamicZoneMax: number;
  /** Receives recoverable warnings; framework treats these as build warnings. */
  warn: (msg: string) => void;
}

export interface DynamicZoneWalkResult {
  blocks: ContentBlock[];
  /** True when at least one block was emitted with extraction_status="partial". */
  partial: boolean;
}

/** PRD-205-R10 / R11 — top-level walker for a dynamic zone array. */
export function walkDynamicZone(
  zone: unknown,
  ctx: DynamicZoneConvertContext,
): DynamicZoneWalkResult {
  if (!Array.isArray(zone)) {
    return { blocks: [], partial: false };
  }
  return walkEntries(zone, ctx, 1);
}

function walkEntries(
  entries: unknown[],
  ctx: DynamicZoneConvertContext,
  depth: number,
): DynamicZoneWalkResult {
  // PRD-205-R10 — bound check at the entry into a new nesting level.
  if (depth > ctx.dynamicZoneMax) {
    const componentNames = entries
      .map((e) =>
        e !== null && typeof e === 'object' && typeof (e as Record<string, unknown>)['__component'] === 'string'
          ? (e as Record<string, unknown>)['__component']
          : '<unknown>',
      )
      .join(', ');
    ctx.warn(`dynamic-zone depth bound exceeded at depth ${String(depth)}: ${componentNames}`);
    return {
      blocks: [
        {
          type: 'prose',
          format: 'markdown',
          text: `(dynamic-zone depth bound exceeded at depth ${String(depth)})`,
          metadata: {
            extraction_status: 'partial',
            extraction_error: `dynamic-zone depth exceeded ${String(ctx.dynamicZoneMax)}`,
          },
        },
      ],
      partial: true,
    };
  }

  const out: ContentBlock[] = [];
  let partial = false;

  for (const raw of entries) {
    if (raw === null || raw === undefined || typeof raw !== 'object') continue;
    const entry = raw as StrapiDynamicZoneEntry;
    const componentName = typeof entry.__component === 'string' ? entry.__component : undefined;
    if (componentName === undefined) {
      partial = true;
      ctx.warn('dynamic-zone entry missing __component discriminator');
      out.push({
        type: 'prose',
        format: 'markdown',
        text: '(dynamic-zone entry missing __component)',
        metadata: {
          extraction_status: 'partial',
          extraction_error: 'dynamic-zone entry missing __component',
        },
      });
      continue;
    }

    const mapping = ctx.componentMapping?.[componentName];
    if (mapping) {
      const projection = emitMappedBlock(entry, mapping);
      if (projection.partial) partial = true;
      out.push(projection.block);
      continue;
    }

    // No mapping — partial fallback (PRD-205-R11 + R23).
    partial = true;
    ctx.warn(`dynamic-zone: no component mapping for "${componentName}"`);
    out.push({
      type: 'prose',
      format: 'markdown',
      text: `(unmapped component: ${componentName})`,
      metadata: {
        extraction_status: 'partial',
        extraction_error: `unmapped component: ${componentName}`,
      },
    });
  }

  return { blocks: out, partial };
}

interface ProjectionResult {
  block: ContentBlock;
  partial: boolean;
}

/**
 * PRD-205-R11 — emit a `marketing:*` block per `componentMapping` projection.
 *
 * Field paths are simple dot/bracket projections evaluated against the source
 * component payload. A field projection that yields `undefined` triggers a
 * partial-extraction warning so misconfigured mappings surface (per PRD-205
 * negative fixture `component-mapping-malformed`).
 */
function emitMappedBlock(
  src: StrapiDynamicZoneEntry,
  cm: { type: string; fields: Record<string, unknown> },
): ProjectionResult {
  const out: Record<string, unknown> = { type: cm.type };
  let partial = false;
  for (const [actField, projection] of Object.entries(cm.fields)) {
    const value = project(src, projection);
    if (value === undefined) {
      partial = true;
    }
    out[actField] = value;
  }
  return { block: out as ContentBlock, partial };
}

/**
 * Tiny projection helper:
 *  - a string is a path (dot-separated, with `[].{a,b}` meaning "iterate this
 *    array and pick fields a, b");
 *  - an object literal is a structural mapping (each value projected from the
 *    source).
 */
function project(src: Record<string, unknown> | StrapiDynamicZoneEntry, projection: unknown): unknown {
  if (typeof projection === 'string') {
    return resolvePath(src, projection);
  }
  if (Array.isArray(projection)) {
    return projection.map((p) => project(src, p));
  }
  if (projection !== null && typeof projection === 'object') {
    const obj = projection as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = project(src, v);
    }
    return out;
  }
  return projection;
}

/**
 * Resolve a dot path with optional `[].{a, b, c}` array-projection suffix.
 *  - `tiers` → src.tiers
 *  - `tiers[].{name, price, features}` → src.tiers.map(t => ({ name: t.name, price: t.price, features: t.features }))
 *  - `cta.label` → src.cta.label
 */
function resolvePath(src: Record<string, unknown>, path: string): unknown {
  const arrayProj = /^([\w.]+)\[\]\.\{([\w,\s]+)\}$/.exec(path.trim());
  if (arrayProj) {
    const basePath = arrayProj[1] ?? '';
    const fields = (arrayProj[2] ?? '').split(',').map((f) => f.trim()).filter((f) => f.length > 0);
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

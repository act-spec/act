/**
 * PRD-300-R14 / R15 / R16 / R17 / R18 / R19 — variant emission protocol.
 *
 * The framework provides:
 *  - `resolveVariantKeys` — translates the contract's `variants` policy
 *    into a closed array (R14, R15, R16) and enforces the 64-cap (R17).
 *  - `composeVariantId` — produces `{base_id}@{variant_key}` per PRD-102-R29.
 *  - `applyVariantMetadata` — stamps `metadata.variant` (R18) and the
 *    `variant_of` related entry (R19).
 *  - `replayVariants` — orchestrates the canonical + per-variant draft
 *    emission per R15 + R16 + R30.
 */
import type {
  ExtractionContext,
  NodeDraft,
  NodeMetadata,
  PageContract,
} from './types.js';
import { BuildError } from './errors.js';

/** PRD-300-R17 — closed cap; bindings/generators MUST NOT widen. */
export const VARIANT_CAP_PER_PAGE = 64;

/** PRD-102-R31 — closed v0.1 source enum surfaced for type-narrowing. */
export type VariantSource = 'experiment' | 'personalization' | 'locale';

/**
 * PRD-300-R14 / R15 / R16 — translate the contract's `variants` field
 * into a closed list of variant keys to render.
 *
 * - `undefined` or `"default"` → `[]` (canonical only; R14, R16).
 * - `"all"` → `discoverAll()`; bindings supply this from their config
 *   (e.g., the React binding hands in the registered locale list when
 *   the page declared `variants: "all"` for locale-source variants).
 * - `string[]` → returned as-is after dedupe + cap check.
 *
 * Throws `BuildError("PRD-300-R17")` when the resolved list exceeds the
 * 64-cap (R17). The caller is responsible for the `discoverAll` callback
 * (the framework cannot enumerate variants without binding context).
 */
export function resolveVariantKeys(
  policy: PageContract['variants'],
  discoverAll: () => readonly string[],
): readonly string[] {
  if (policy === undefined || policy === 'default') return [];
  const raw = policy === 'all' ? discoverAll() : policy;
  // Dedupe but preserve declared order (replay determinism per R15).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    if (typeof k !== 'string' || k.length === 0) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  if (out.length > VARIANT_CAP_PER_PAGE) {
    throw new BuildError(
      'PRD-300-R17',
      `variant matrix ${String(out.length)} exceeds cap ${String(VARIANT_CAP_PER_PAGE)}`,
    );
  }
  return out;
}

/** PRD-102-R29 — `{base_id}@{variant_key}` composer. */
export function composeVariantId(baseId: string, key: string): string {
  return `${baseId}@${key}`;
}

/**
 * PRD-300-R18 / R19 — stamp `metadata.variant` (R18) and append the
 * `variant_of` related entry (R19) on a draft. Returns a NEW draft;
 * never mutates the input.
 */
export function applyVariantMetadata(
  draft: NodeDraft,
  baseId: string,
  key: string,
  source: VariantSource,
): NodeDraft {
  const meta: NodeMetadata = { ...(draft.metadata ?? {}) };
  meta.variant = { base_id: baseId, key, source };
  const related = [...(draft.related ?? [])];
  // PRD-300-R19 — typically only `variant_of` from the variant to the base.
  related.push({ id: baseId, relation: 'variant_of' });
  return {
    ...draft,
    id: composeVariantId(baseId, key),
    metadata: meta,
    related,
  };
}

export interface ReplayVariantsInput {
  page: PageContract;
  baseCtx: ExtractionContext;
  /** Caller-supplied render of the page for a specific variant context. */
  renderForVariant: (ctx: ExtractionContext) => NodeDraft;
  /** PRD-300-R18 — the variant source the page contract / generator declared. */
  source: VariantSource;
  /** Provider for `variants: "all"`; receives the page's contract. */
  discoverAll?: () => readonly string[];
}

/**
 * PRD-300-R15 / R16 / R30 — orchestrate canonical + per-variant emission.
 * The canonical draft is always emitted (R15 cites PRD-102-R30); each
 * variant key produces an additional draft with `metadata.variant` and
 * the `variant_of` relation.
 *
 * Bindings supply `renderForVariant` so the framework stays inert to the
 * underlying framework's render implementation per PRD-300-R8.
 */
export function replayVariants(input: ReplayVariantsInput): NodeDraft[] {
  const { page, baseCtx, renderForVariant, source } = input;
  const out: NodeDraft[] = [];
  // Canonical render — variant undefined per PRD-300-R15.
  const canonical = renderForVariant({ ...baseCtx, variant: undefined });
  out.push(canonical);
  const keys = resolveVariantKeys(
    page.variants,
    input.discoverAll ?? ((): readonly string[] => []),
  );
  for (const key of keys) {
    const draft = renderForVariant({ ...baseCtx, variant: key });
    out.push(applyVariantMetadata(draft, page.id, key, source));
  }
  return out;
}

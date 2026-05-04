/**
 * PRD-300-R7 / R20 / R22 — invoking `extract` and validating its output
 * before emission. The framework guarantees that:
 *  1. Throws become placeholders (R22).
 *  2. Promise returns become placeholders (R7 — sync-only in v0.1).
 *  3. Schema-violating blocks become placeholders (R20).
 *  4. Author-supplied `metadata.extracted_via` overrides are rejected
 *     and become placeholders (R21 — the field is binding-owned).
 *  5. Successful blocks get `metadata.extracted_via = "component-contract"`
 *     stamped automatically (R21) and `metadata.extraction_method`
 *     stamped per the binding's selected mode (R29).
 */
import type {
  ActContract,
  ContractOutput,
  ExtractionContext,
  ExtractionMethod,
} from './types.js';
import { buildPlaceholder } from './placeholder.js';

/** PRD-100-R29 — closed core block types. */
const CORE_BLOCK_TYPES = new Set(['markdown', 'prose', 'code', 'data', 'callout']);

/** PRD-102-R6 — `marketing:*` suffix grammar. */
const MARKETING_SUFFIX_RE = /^marketing:[a-z][a-z0-9-]*$/;

/**
 * PRD-300-R20 — minimum shape every emitted block satisfies before the
 * `metadata.extracted_via` stamp. Returns the failure message or null.
 *
 * Per-type schema enforcement (e.g., `code` REQUIRES `language`) is the
 * binding/generator's responsibility via PRD-600 once envelopes assemble;
 * the framework only enforces the discriminator + namespace gates here.
 */
export function validateBlockShape(block: unknown): string | null {
  if (block === null || typeof block !== 'object') {
    return 'block must be a non-null object';
  }
  const t = (block as { type?: unknown }).type;
  if (typeof t !== 'string' || t.length === 0) {
    return 'block.type must be a non-empty string (PRD-100-R28)';
  }
  if (t.startsWith('core:')) {
    return `block.type "${t}" uses closed core:* namespace (PRD-100-R29)`;
  }
  if (t.startsWith('marketing:')) {
    if (!MARKETING_SUFFIX_RE.test(t)) {
      return `block.type "${t}" violates marketing:* suffix grammar (PRD-102-R6)`;
    }
    return null;
  }
  if (CORE_BLOCK_TYPES.has(t)) return null;
  // Unknown / custom-namespace types are tolerated per PRD-100-R31; the
  // generator's per-type validator handles deeper checks.
  return null;
}

/**
 * PRD-300-R21 — reject blocks where authors set `metadata.extracted_via`
 * to a value other than `"component-contract"`. The field is binding-owned.
 */
export function rejectAuthorOverride(block: ContractOutput): string | null {
  if (!block.metadata || typeof block.metadata !== 'object') return null;
  const v = block.metadata['extracted_via'];
  if (v === undefined) return null;
  if (v === 'component-contract') return null;
  const safe =
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : JSON.stringify(v);
  return `metadata.extracted_via is binding-owned; author supplied "${safe}" (PRD-300-R21)`;
}

/**
 * PRD-300-R21 / R29 — stamp `extracted_via` (always) and `extraction_method`
 * (when the binding declared one) on the block's metadata. Returns a NEW
 * object; never mutates the input.
 */
export function stampMetadata(
  block: ContractOutput,
  method: ExtractionMethod | undefined,
): ContractOutput {
  const meta = (block.metadata && typeof block.metadata === 'object'
    ? { ...block.metadata }
    : {}) as Record<string, unknown>;
  meta['extracted_via'] = 'component-contract';
  if (method !== undefined) meta['extraction_method'] = method;
  return { ...block, metadata: meta };
}

interface SafeExtractOptions {
  method?: ExtractionMethod;
  component?: string;
  location?: string;
}

/**
 * PRD-300-R7 / R20 / R21 / R22 — single chokepoint that bindings call.
 * Returns one or more `ContractOutput` blocks; on any failure path,
 * returns a single `marketing:placeholder` per PRD-300-R22.
 */
export function safeExtract<P>(
  contract: ActContract<P>,
  props: P,
  ctx: ExtractionContext,
  opts: SafeExtractOptions = {},
): ContractOutput[] {
  let result: ContractOutput | ContractOutput[];
  try {
    result = contract.extract(props, ctx);
  } catch (e) {
    ctx.warn('extract threw; emitting placeholder (PRD-300-R22)');
    return [
      buildPlaceholder({
        error: e instanceof Error ? e : String(e),
        ...(opts.component !== undefined ? { component: opts.component } : {}),
        ...(opts.location !== undefined ? { location: opts.location } : {}),
      }),
    ];
  }
  if (looksLikePromise(result)) {
    ctx.warn('extract returned a Promise; emitting placeholder (PRD-300-R7)');
    return [
      buildPlaceholder({
        error: 'extract returned a Promise; v0.1 requires synchronous extract',
        ...(opts.component !== undefined ? { component: opts.component } : {}),
        ...(opts.location !== undefined ? { location: opts.location } : {}),
      }),
    ];
  }
  const blocks = Array.isArray(result) ? result : [result];
  const stamped: ContractOutput[] = [];
  for (const raw of blocks) {
    const shapeError = validateBlockShape(raw);
    if (shapeError !== null) {
      ctx.warn(`${shapeError}; emitting placeholder (PRD-300-R20)`);
      stamped.push(
        buildPlaceholder({
          error: shapeError,
          ...(opts.component !== undefined ? { component: opts.component } : {}),
          ...(opts.location !== undefined ? { location: opts.location } : {}),
        }),
      );
      continue;
    }
    const overrideError = rejectAuthorOverride(raw);
    if (overrideError !== null) {
      ctx.warn(`${overrideError}; emitting placeholder`);
      stamped.push(
        buildPlaceholder({
          error: overrideError,
          ...(opts.component !== undefined ? { component: opts.component } : {}),
          ...(opts.location !== undefined ? { location: opts.location } : {}),
        }),
      );
      continue;
    }
    stamped.push(stampMetadata(raw, opts.method));
  }
  return stamped;
}

function looksLikePromise(v: unknown): boolean {
  return (
    v !== null
    && typeof v === 'object'
    && typeof (v as { then?: unknown }).then === 'function'
  );
}

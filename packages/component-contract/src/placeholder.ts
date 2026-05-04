/**
 * PRD-300-R22 / R32 — placeholder block helper + secret-pattern redaction.
 *
 * Bindings emit `marketing:placeholder` per PRD-102-R22 whenever extraction
 * fails (throw, malformed output, Promise return, schema violation). The
 * helper enforces the 200-char `metadata.error` cap and redacts strings
 * matching the v0.1 secret-pattern set per PRD-300-R32.
 */
import type { ContractOutput } from './types.js';

/** PRD-300-R32 — closed v0.1 secret-pattern set. */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /sk_live_[A-Za-z0-9]+/g,
  /AKIA[A-Z0-9]{16}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /xoxb-[A-Za-z0-9-]+/g,
];

/** PRD-300-R22 — `metadata.error` truncation cap. */
export const ERROR_MESSAGE_CAP = 200;

/** PRD-300-R32 — apply every pattern; replace each match with `[REDACTED]`. */
export function redactSecrets(message: string): string {
  let out = message;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

export interface BuildPlaceholderInput {
  /** PRD-300-R22 — string or Error; both produce a redacted, capped message. */
  error: Error | string;
  /** PRD-300-R22 — component name as known to the binding. */
  component?: string;
  /**
   * PRD-300-R22 / R32 — source location. The binding SHOULD pass
   * `file.basename:line` form; the helper does NOT path-strip — the
   * binding owns the file-path scope per the security delta in §"Security
   * considerations".
   */
  location?: string;
}

/**
 * PRD-300-R22 — build the placeholder block for an extraction failure.
 * The helper:
 *  1. Stringifies the error (Error.message or string verbatim).
 *  2. Redacts secret patterns per PRD-300-R32.
 *  3. Truncates to ≤200 chars per PRD-300-R22.
 *  4. Sets `metadata.extracted_via = "component-contract"` (PRD-300-R21).
 *  5. Sets `metadata.extraction_status = "failed"` (PRD-102-R22).
 *  6. Conditionally attaches `component`, `location`, `error` only when
 *     non-empty so the resulting JSON is minimal.
 */
export function buildPlaceholder(input: BuildPlaceholderInput): ContractOutput {
  const raw = typeof input.error === 'string' ? input.error : (input.error.message ?? '');
  const redacted = redactSecrets(raw);
  const truncated = redacted.slice(0, ERROR_MESSAGE_CAP);
  const metadata: Record<string, unknown> = {
    extracted_via: 'component-contract',
    extraction_status: 'failed',
  };
  if (truncated.length > 0) metadata['error'] = truncated;
  if (input.component !== undefined && input.component.length > 0) {
    metadata['component'] = input.component;
  }
  if (input.location !== undefined && input.location.length > 0) {
    metadata['location'] = input.location;
  }
  return {
    type: 'marketing:placeholder',
    metadata,
  };
}

/**
 * PRD-300-R23 — build a partial-extraction placeholder marker. Used when
 * the binding accepts a block whose REQUIRED fields are present but some
 * OPTIONAL fields are absent; the binding stamps `extraction_status =
 * "partial"` on the otherwise-shipped block via `stampPartial`.
 */
export function stampPartial(block: ContractOutput): ContractOutput {
  const meta = (block.metadata && typeof block.metadata === 'object'
    ? { ...block.metadata }
    : {}) as Record<string, unknown>;
  meta['extracted_via'] = 'component-contract';
  meta['extraction_status'] = 'partial';
  return { ...block, metadata: meta };
}

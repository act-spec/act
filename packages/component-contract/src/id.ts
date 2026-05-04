/**
 * PRD-300-R5 / R10 — id grammar enforcement at the contract surface.
 *
 * Delegates to PRD-100-R10 (`^[a-z0-9]([a-z0-9._\-]|/)*[a-z0-9]$`) and
 * PRD-100-R11 (≤ 256 UTF-8 bytes). The single-character form `^[a-z0-9]$`
 * is permitted per PRD-100-R10's grammar reading.
 */

/** PRD-100-R10. Anchored. */
export const ID_GRAMMAR_RE = /^[a-z0-9](?:[a-z0-9._\-/]*[a-z0-9])?$/;

/** PRD-100-R11. */
export const ID_BYTE_CAP = 256;

const TEXT_ENCODER = new TextEncoder();

/** PRD-100-R10 — pure regex check. */
export function isValidIdGrammar(id: string): boolean {
  return ID_GRAMMAR_RE.test(id);
}

/** PRD-100-R11 — UTF-8 byte length cap. */
export function isWithinIdByteCap(id: string): boolean {
  return TEXT_ENCODER.encode(id).length <= ID_BYTE_CAP;
}

/**
 * PRD-300-R5 — combined check used by the binding before emitting a node.
 * Returns the failure reason as a string or null when the id is valid.
 */
export function validateContractId(id: string): string | null {
  if (typeof id !== 'string' || id.length === 0) {
    return 'id must be a non-empty string';
  }
  if (!isValidIdGrammar(id)) {
    return `id "${id}" violates PRD-100-R10 grammar`;
  }
  if (!isWithinIdByteCap(id)) {
    return `id "${id}" exceeds PRD-100-R11 byte cap (${String(ID_BYTE_CAP)})`;
  }
  return null;
}

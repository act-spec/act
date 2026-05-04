/**
 * PRD-207-R13 — locale-string normalization to PRD-104-R2's BCP-47 subset.
 *
 *  - Underscore separators (e.g., `en_US`) become hyphens (`en-US`).
 *  - Primary subtag is lowercased (`EN-US` → `en-US`).
 *  - Script subtag (4 letters) is title-cased (`zh-hant` → `zh-Hant`).
 *  - Region subtag (2 letters) is uppercased (`pt-br` → `pt-BR`).
 *
 * A normalization that changes the input emits a warning via the supplied
 * sink. A locale string that fails to parse to the subset regex even
 * after normalization is unrecoverable (caller throws).
 */
import { I18nAdapterError } from './errors.js';

export const BCP47_SUBSET_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

export function normalizeLocale(
  input: string,
  warn: (msg: string) => void,
): string {
  let n = input.replace(/_/g, '-');
  const parts = n.split('-');
  const first = parts[0];
  if (typeof first === 'string') parts[0] = first.toLowerCase();
  // Detect a script segment (4 letters) — title-case it.
  for (let i = 1; i < parts.length; i += 1) {
    const seg = parts[i];
    if (typeof seg !== 'string') continue;
    if (seg.length === 4 && /^[A-Za-z]{4}$/.test(seg)) {
      parts[i] = seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    } else if (seg.length === 2 && /^[A-Za-z]{2}$/.test(seg)) {
      parts[i] = seg.toUpperCase();
    }
  }
  n = parts.join('-');
  if (n !== input) {
    warn(`PRD-207-R13: locale '${input}' normalized to '${n}'`);
  }
  if (!BCP47_SUBSET_RE.test(n)) {
    throw new I18nAdapterError({
      code: 'config_invalid',
      message: `PRD-207-R13/R14: locale '${input}' fails BCP-47 subset (PRD-104-R2) after normalization (got '${n}')`,
    });
  }
  return n;
}

/**
 * PRD-500-R20 / R21 ETag computer.
 *
 * The default implements PRD-103-R6's runtime triple:
 *   1. Construct `{ identity, payload, tenant }`.
 *   2. JCS-canonicalize per RFC 8785 (delegated to `@act-spec/validator`'s
 *      `jcs` per ADR-004 Seam 3 — a single canonicalization implementation
 *      across the monorepo).
 *   3. SHA-256.
 *   4. base64url no-padding.
 *   5. Truncate to 22 chars.
 *   6. Prepend `s256:`.
 *
 * Override hooks (PRD-500-R21) MUST be deterministic and MUST NOT mix
 * request-local data; the SDK validates the returned value's shape on every
 * invocation against PRD-103-R2's loose value-shape regex.
 */
import { ETAG_LOOSE_RE, deriveEtagFromCanonicalBytes, jcs } from '@act-spec/validator';

import type { EtagComputer } from './types.js';

/**
 * PRD-500-R20 — the default ETag computer. Re-uses
 * `@act-spec/validator`'s JCS + SHA-256 implementation so the producer-side
 * (this package) and consumer-side (validator) derivations are guaranteed
 * byte-identical (ADR-004 Seam 3).
 *
 * For deterministic mappings:
 *  - `identity = null` ⇒ JSON `null` in the canonical form.
 *  - `tenant = null` ⇒ JSON `null` in the canonical form.
 */
export const defaultEtagComputer: EtagComputer = ({ identity, payload, tenant }) => {
  const triple = { identity, payload, tenant };
  return deriveEtagFromCanonicalBytes(jcs(triple));
};

/**
 * PRD-500-R21 — validate a custom computer's returned value-shape.
 * `^[a-z0-9]+:[A-Za-z0-9_-]+$` per PRD-103-R2.
 */
export function isValidEtagShape(value: string): boolean {
  return ETAG_LOOSE_RE.test(value);
}

/**
 * PRD-103-R8 — strip the surrounding HTTP double-quotes from an
 * `If-None-Match` header value before comparing to the envelope's `etag`
 * field. RFC 9110 §8.8.3 — strong validators are double-quoted in the
 * header form; the envelope field carries the bare value.
 */
export function unquoteIfNoneMatch(headerValue: string): string {
  const trimmed = headerValue.trim();
  // Strip an optional `W/` weak indicator and surrounding quotes.
  const noWeak = trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
  if (noWeak.length >= 2 && noWeak.startsWith('"') && noWeak.endsWith('"')) {
    return noWeak.slice(1, -1);
  }
  return noWeak;
}

/**
 * PRD-204-R16 — webhook signature verification (HMAC-SHA256).
 *
 * Helper exposed for generator-side webhook receivers (PRD-400). The receiver
 * is the generator's concern; this module contributes only the verification
 * primitive, defended against timing side-channels via `timingSafeEqual` per
 * PRD-109.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * PRD-204-R16 — verify a Storyblok webhook signature.
 *
 * Returns `true` iff the HMAC-SHA256 of `body` keyed by `secret` matches
 * `signature` (hex-encoded) in constant time. Returns `false` on any malformed
 * input (empty signature/secret, length mismatch). MUST NOT throw on invalid
 * input per PRD-204-R16.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string | undefined | null,
  secret: string | undefined | null,
): boolean {
  if (typeof body !== 'string') return false;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  let expected: string;
  try {
    expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

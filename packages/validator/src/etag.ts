/**
 * ETag derivation per PRD-103-R4 (static) / PRD-103-R6 (runtime).
 *
 * Recipe per PRD-103:
 *   1. Strip the envelope's own `etag` field.
 *   2. JCS-canonicalize (RFC 8785) the remaining payload.
 *   3. SHA-256 the canonical bytes.
 *   4. base64url-encode without padding.
 *   5. Truncate to 22 chars.
 *   6. Prefix `s256:`.
 *
 * This module is also the home of the strict admit-list regex (PRD-103-R3)
 * and helpers for PRD-600-R6 / R7.
 */
// Use a namespace import so the browser bundler (Vite/Rollup) can resolve
// `node:crypto` to a no-op stub without choking on a named-import
// destructuring against the stub. The browser SPA never reaches the
// `createHash` call site (etag re-derivation is a Node-only flow); when
// run in Node the namespace lookup resolves correctly.
import * as nodeCrypto from 'node:crypto';

/** PRD-103-R3 strict admit-list. */
export const ETAG_S256_RE = /^s256:[A-Za-z0-9_-]{22}$/;
/** PRD-103-R2 loose value-shape. */
export const ETAG_LOOSE_RE = /^[a-z0-9]+:[A-Za-z0-9_-]+$/;

/**
 * Strip an envelope's `etag` field, returning a *new* object. Does not
 * mutate the input.
 */
export function stripEtag<T extends { etag?: unknown }>(envelope: T): Omit<T, 'etag'> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(envelope)) {
    if (k === 'etag') continue;
    out[k] = v;
  }
  return out as Omit<T, 'etag'>;
}

/**
 * RFC 8785 / JCS canonicalization. Recursively serializes JSON values such
 * that any two semantically-equal values yield identical UTF-8 bytes.
 *
 *  - Objects: keys sorted by UTF-16 code unit (per JCS §3.2.3 / ECMA-262).
 *  - Arrays: order preserved.
 *  - Strings: UTF-8, with the ECMA-262 / JSON minimum-escape set.
 *  - Numbers: ECMA-262 `Number.prototype.toString()` semantics; finite numbers
 *    only (NaN/Infinity throw per RFC 8785).
 */
export function jcs(value: unknown): string {
  const out: string[] = [];
  serialize(value, out);
  return out.join('');
}

function serialize(value: unknown, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('jcs: non-finite number');
    }
    out.push(canonicalizeNumber(value));
    return;
  }
  if (typeof value === 'string') {
    out.push(serializeString(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      serialize(value[i], out);
    }
    out.push(']');
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // UTF-16 code-unit ordering — default JS string compare. `Object.keys`
    // returns unique strings so we never need a 0-return branch.
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : 1));
    out.push('{');
    let first = true;
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      if (!first) out.push(',');
      first = false;
      out.push(serializeString(k));
      out.push(':');
      serialize(v, out);
    }
    out.push('}');
    return;
  }
  throw new Error(`jcs: unsupported value type ${typeof value}`);
}

/** RFC 8785 §3.2.2.2 — ECMA-262 Number canonicalization. JS already does it. */
function canonicalizeNumber(n: number): string {
  if (Object.is(n, -0)) return '0';
  return String(n);
}

/**
 * RFC 8785 §3.2.2.3 — string serialization with the JSON minimum escape set.
 */
function serializeString(s: string): string {
  const out: string[] = ['"'];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    switch (ch) {
      case 0x22:
        out.push('\\"');
        break;
      case 0x5c:
        out.push('\\\\');
        break;
      case 0x08:
        out.push('\\b');
        break;
      case 0x09:
        out.push('\\t');
        break;
      case 0x0a:
        out.push('\\n');
        break;
      case 0x0c:
        out.push('\\f');
        break;
      case 0x0d:
        out.push('\\r');
        break;
      default:
        if (ch < 0x20) {
          out.push('\\u' + ch.toString(16).padStart(4, '0'));
        } else {
          out.push(s[i]!);
        }
    }
  }
  out.push('"');
  return out.join('');
}

/**
 * Base64url encode (no padding) the given bytes. Buffer's `base64url`
 * encoding is correct on Node 16+; we drop trailing padding defensively.
 */
function base64url(bytes: Buffer): string {
  return bytes.toString('base64url').replace(/=+$/, '');
}

/**
 * Derive `s256:<22 base64url chars>` from a payload per PRD-103-R4 / R6.
 *
 * The caller is responsible for stripping `etag` from the input first when
 * the input is a full envelope (or supply the canonical bytes directly via
 * {@link deriveEtagFromCanonicalBytes}).
 */
export function deriveEtag(payload: unknown): string {
  return deriveEtagFromCanonicalBytes(jcs(payload));
}

/**
 * Lower-level form: take already-canonicalized bytes and produce the
 * `s256:` etag. Useful when a fixture pins a `canonical_jcs_bytes_utf8`
 * value (PRD-103-R7 worked example).
 */
export function deriveEtagFromCanonicalBytes(bytes: string): string {
  const digest = nodeCrypto.createHash('sha256').update(bytes, 'utf8').digest();
  return `s256:${base64url(digest).slice(0, 22)}`;
}

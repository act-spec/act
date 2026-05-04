/**
 * Tests for the JCS canonicalizer + s256 etag derivation
 * (PRD-600-R6 / R7 / R8 — value-shape, derivation, determinism).
 */
import { describe, expect, it } from 'vitest';
import {
  ETAG_LOOSE_RE,
  ETAG_S256_RE,
  deriveEtag,
  deriveEtagFromCanonicalBytes,
  jcs,
  stripEtag,
} from './etag.js';

describe('jcs — RFC 8785 canonicalization', () => {
  it('sorts object keys by UTF-16 code unit', () => {
    expect(jcs({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(jcs([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes null / true / false', () => {
    expect(jcs(null)).toBe('null');
    expect(jcs(true)).toBe('true');
    expect(jcs(false)).toBe('false');
  });

  it('escapes the JSON minimum set (quote, backslash, control bytes)', () => {
    expect(jcs('a\nb')).toBe('"a\\nb"');
    expect(jcs('"')).toBe('"\\""');
    expect(jcs('\\')).toBe('"\\\\"');
    expect(jcs('\b\t\n\f\r')).toBe('"\\b\\t\\n\\f\\r"');
    expect(jcs('')).toBe('"\\u0001"');
  });

  it('drops `undefined` object members (mirrors JSON.stringify)', () => {
    expect(jcs({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('canonicalizes -0 to 0 (RFC 8785 §3.2.2.2)', () => {
    expect(jcs(-0)).toBe('0');
    expect(jcs(0)).toBe('0');
  });

  it('throws on non-finite number', () => {
    expect(() => jcs(Infinity)).toThrow(/non-finite/);
  });

  it('throws on unsupported value type', () => {
    expect(() => jcs(BigInt(1))).toThrow(/unsupported/);
  });

  it('serializes nested objects deterministically', () => {
    const a = jcs({ x: { b: 1, a: 2 }, y: [1, 2] });
    const b = jcs({ y: [1, 2], x: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });

  it('serializes empty object and empty array', () => {
    expect(jcs({})).toBe('{}');
    expect(jcs([])).toBe('[]');
  });
});

describe('deriveEtag (PRD-600-R7 / PRD-103-R4)', () => {
  it('produces an s256: value with exactly 22 base64url chars', () => {
    const etag = deriveEtag({ a: 1 });
    expect(ETAG_S256_RE.test(etag)).toBe(true);
  });

  it('matches the worked example bytes from fixtures/103/positive/static-derivation-worked-example.json', () => {
    // Bytes copied from the fixture; the value must match.
    const bytes =
      '{"act_version":"0.1","content":[{"text":"Hello.","type":"prose"}],"id":"intro","summary":"A simple introduction.","title":"Introduction","tokens":{"body":2,"summary":4},"type":"document"}';
    const expected = 's256:8Z0luYEDvPcDQKLimP55qC';
    expect(deriveEtagFromCanonicalBytes(bytes)).toBe(expected);
  });

  it('strips the etag field via stripEtag before derivation', () => {
    const out = stripEtag({ a: 1, etag: 's256:zzzzzzzzzzzzzzzzzzzzzz' });
    expect('etag' in out).toBe(false);
    expect((out as { a: number }).a).toBe(1);
  });
});

describe('value-shape regexes', () => {
  it('ETAG_S256_RE matches v0.1 admit-list', () => {
    expect(ETAG_S256_RE.test('s256:8Z0luYEDvPcDQKLimP55qC')).toBe(true);
    expect(ETAG_S256_RE.test('s256:short')).toBe(false);
    expect(ETAG_S256_RE.test('S256:8Z0luYEDvPcDQKLimP55qC')).toBe(false);
  });

  it('ETAG_LOOSE_RE matches the general PRD-103-R2 shape', () => {
    expect(ETAG_LOOSE_RE.test('blake3:abc')).toBe(true);
    expect(ETAG_LOOSE_RE.test('s256:abc 123')).toBe(false);
  });
});

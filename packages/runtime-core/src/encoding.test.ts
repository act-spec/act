/**
 * PRD-500-R13 — encoding helper tests.
 */
import { describe, expect, it } from 'vitest';

import { decodeIdFromUrl, encodeIdForUrl } from './encoding.js';

describe('PRD-500-R13: encodeIdForUrl', () => {
  it('preserves slash as the segment separator', () => {
    expect(encodeIdForUrl('docs/intro')).toBe('docs/intro');
  });

  it('percent-encodes spaces and reserved chars per pchar', () => {
    expect(encodeIdForUrl('docs/hello world')).toBe('docs/hello%20world');
    expect(encodeIdForUrl('a%b')).toBe('a%25b');
  });

  it('preserves `:` and `@` per RFC 3986 §3.3 pchar', () => {
    expect(encodeIdForUrl('a/b@variant')).toBe('a/b@variant');
    expect(encodeIdForUrl('ns:tag')).toBe('ns:tag');
  });

  it('preserves sub-delims `! * \' ( )`', () => {
    expect(encodeIdForUrl(`a!b*c'd(e)`)).toBe(`a!b*c'd(e)`);
  });

  it('encodes `?` and `#` and `[` and `]`', () => {
    expect(encodeIdForUrl('a?b')).toBe('a%3Fb');
    expect(encodeIdForUrl('a#b')).toBe('a%23b');
  });
});

describe('PRD-106-R15: decodeIdFromUrl', () => {
  it('round-trips basic IDs', () => {
    const id = 'docs/hello world/foo';
    expect(decodeIdFromUrl(encodeIdForUrl(id))).toBe(id);
  });

  it('decodes a percent-encoded segment but preserves the separator', () => {
    expect(decodeIdFromUrl('a/b%20c')).toBe('a/b c');
  });
});

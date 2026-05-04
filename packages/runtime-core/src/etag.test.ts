/**
 * PRD-500-R20 / R21 — ETag computer tests.
 */
import { describe, expect, it } from 'vitest';

import { defaultEtagComputer, isValidEtagShape, unquoteIfNoneMatch } from './etag.js';

describe('PRD-500-R20: defaultEtagComputer', () => {
  it('returns an `s256:` etag for a complete triple', () => {
    const etag = defaultEtagComputer({
      identity: 'user-42',
      payload: { id: 'intro', kind: 'doc' },
      tenant: 'acme',
    });
    expect(etag).toMatch(/^s256:[A-Za-z0-9_-]{22}$/);
  });

  it('is deterministic across replicas (PRD-103-R7)', () => {
    const triple = { identity: 'user-42', payload: { id: 'intro' }, tenant: 'acme' };
    const a = defaultEtagComputer(triple);
    const b = defaultEtagComputer(triple);
    expect(a).toBe(b);
  });

  it('differs when identity differs (PRD-103-R6 triple)', () => {
    const a = defaultEtagComputer({ identity: 'alice', payload: { x: 1 }, tenant: null });
    const b = defaultEtagComputer({ identity: 'bob', payload: { x: 1 }, tenant: null });
    expect(a).not.toBe(b);
  });

  it('differs when tenant differs (PRD-103-R6 triple)', () => {
    const a = defaultEtagComputer({ identity: 'alice', payload: { x: 1 }, tenant: 'acme' });
    const b = defaultEtagComputer({ identity: 'alice', payload: { x: 1 }, tenant: 'globex' });
    expect(a).not.toBe(b);
  });

  it('differs when payload differs', () => {
    const a = defaultEtagComputer({ identity: null, payload: { x: 1 }, tenant: null });
    const b = defaultEtagComputer({ identity: null, payload: { x: 2 }, tenant: null });
    expect(a).not.toBe(b);
  });

  it('treats null identity as JSON null', () => {
    // Two anonymous calls produce identical etags.
    const a = defaultEtagComputer({ identity: null, payload: { id: 'x' }, tenant: null });
    const b = defaultEtagComputer({ identity: null, payload: { id: 'x' }, tenant: null });
    expect(a).toBe(b);
  });
});

describe('PRD-500-R21: isValidEtagShape', () => {
  it('accepts s256:<22 chars>', () => {
    expect(isValidEtagShape('s256:abcdefghijABCDEF012345')).toBe(true);
  });

  it('accepts other algorithm prefixes per the loose admit-list', () => {
    expect(isValidEtagShape('blake3:foo-bar_baz')).toBe(true);
  });

  it('rejects values without a colon', () => {
    expect(isValidEtagShape('justsomestring')).toBe(false);
  });

  it('rejects empty alg or value', () => {
    expect(isValidEtagShape(':abc')).toBe(false);
    expect(isValidEtagShape('s256:')).toBe(false);
  });
});

describe('PRD-103-R8: unquoteIfNoneMatch', () => {
  it('strips surrounding quotes', () => {
    expect(unquoteIfNoneMatch('"s256:abc"')).toBe('s256:abc');
  });

  it('strips a W/ weak indicator', () => {
    expect(unquoteIfNoneMatch('W/"s256:abc"')).toBe('s256:abc');
  });

  it('returns input unchanged when no quotes', () => {
    expect(unquoteIfNoneMatch('s256:bare')).toBe('s256:bare');
  });

  it('trims whitespace', () => {
    expect(unquoteIfNoneMatch('  "s256:abc"  ')).toBe('s256:abc');
  });
});

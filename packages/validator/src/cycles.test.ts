/**
 * Tests for cycle detection (PRD-600-R13 / PRD-100-R25).
 */
import { describe, expect, it } from 'vitest';
import { findChildrenCycle, hasSelfCycle } from './cycles.js';

describe('hasSelfCycle (single-envelope, PRD-600-R13)', () => {
  it('returns true when a node lists itself in children', () => {
    expect(hasSelfCycle({ id: 'aa', children: ['aa'] })).toBe(true);
  });
  it('returns false when children are unrelated IDs', () => {
    expect(hasSelfCycle({ id: 'aa', children: ['b', 'c'] })).toBe(false);
  });
  it('returns false when children is missing or non-array', () => {
    expect(hasSelfCycle({ id: 'aa' })).toBe(false);
    expect(hasSelfCycle({ id: 'aa', children: 'b' })).toBe(false);
  });
  it('returns false when id is not a string', () => {
    expect(hasSelfCycle({ children: ['aa'] })).toBe(false);
  });
  it('returns false when children entry is not a string', () => {
    expect(hasSelfCycle({ id: 'aa', children: [42] })).toBe(false);
  });
});

describe('findChildrenCycle (multi-node, PRD-600-R13)', () => {
  it('returns null on an acyclic forest', () => {
    expect(
      findChildrenCycle([
        { id: 'aa', children: ['bb'] },
        { id: 'bb', children: [] },
      ]),
    ).toBe(null);
  });

  it('detects a 2-cycle a -> b -> a', () => {
    const cycle = findChildrenCycle([
      { id: 'aa', children: ['bb'] },
      { id: 'bb', children: ['aa'] },
    ]);
    expect(cycle).toBeTruthy();
    expect(cycle).toContain('aa');
    expect(cycle).toContain('bb');
  });

  it('detects self-cycle a -> a', () => {
    const cycle = findChildrenCycle([{ id: 'aa', children: ['aa'] }]);
    expect(cycle).toEqual(['aa', 'aa']);
  });

  it('tolerates dangling children (referenced ID not in nodes set)', () => {
    expect(findChildrenCycle([{ id: 'aa', children: ['ghost'] }])).toBe(null);
  });

  it('skips nodes lacking a string id', () => {
    expect(findChildrenCycle([{ children: ['aa'] }, { id: 'aa', children: [] }])).toBe(null);
  });

  it('skips non-string entries in children', () => {
    expect(findChildrenCycle([{ id: 'aa', children: [42, 'b'] }, { id: 'bb', children: [] }])).toBe(null);
  });

  it('handles non-array children gracefully', () => {
    expect(findChildrenCycle([{ id: 'aa' }])).toBe(null);
  });
});

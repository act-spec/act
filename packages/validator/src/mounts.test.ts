/**
 * Tests for mounts coherence (PRD-600-R3 / PRD-106-R20).
 */
import { describe, expect, it } from 'vitest';
import { findMountOverlaps } from './mounts.js';

describe('findMountOverlaps (PRD-106-R20)', () => {
  it('flags two mounts with parent-prefix relationship', () => {
    const findings = findMountOverlaps([
      { prefix: '/a', delivery: 'static', manifest_url: '/a/.well-known/act.json' },
      { prefix: '/a/b', delivery: 'static', manifest_url: '/a/b/.well-known/act.json' },
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.requirement).toBe('PRD-106-R20');
  });

  it('does not flag distinct sibling mounts', () => {
    const findings = findMountOverlaps([
      { prefix: '/a', delivery: 'static', manifest_url: '/a/.well-known/act.json' },
      { prefix: '/b', delivery: 'static', manifest_url: '/b/.well-known/act.json' },
    ]);
    expect(findings).toEqual([]);
  });

  it('does not flag /foo vs /foobar (no shared path-segment boundary)', () => {
    const findings = findMountOverlaps([
      { prefix: '/foo', delivery: 'static', manifest_url: '/foo/.well-known/act.json' },
      { prefix: '/foobar', delivery: 'static', manifest_url: '/foobar/.well-known/act.json' },
    ]);
    expect(findings).toEqual([]);
  });

  it('flags identical prefixes', () => {
    const findings = findMountOverlaps([
      { prefix: '/x', delivery: 'static', manifest_url: '/x/a' },
      { prefix: '/x', delivery: 'runtime', manifest_url: '/x/b' },
    ]);
    expect(findings.length).toBe(1);
  });

  it('treats a trailing slash as equivalent to no trailing slash', () => {
    const findings = findMountOverlaps([
      { prefix: '/a/', delivery: 'static', manifest_url: '/a/.well-known/act.json' },
      { prefix: '/a/sub', delivery: 'static', manifest_url: '/a/sub/.well-known/act.json' },
    ]);
    expect(findings.length).toBe(1);
  });

  it('flags root prefix overlapping any child', () => {
    const findings = findMountOverlaps([
      { prefix: '/', delivery: 'static', manifest_url: '/.well-known/act.json' },
      { prefix: '/a', delivery: 'static', manifest_url: '/a/.well-known/act.json' },
    ]);
    expect(findings.length).toBe(1);
  });

  it('flags overlap regardless of array order (covers the longer-vs-shorter branch)', () => {
    const findings = findMountOverlaps([
      { prefix: '/a/b', delivery: 'static', manifest_url: '/a/b/.well-known/act.json' },
      { prefix: '/a', delivery: 'static', manifest_url: '/a/.well-known/act.json' },
    ]);
    expect(findings.length).toBe(1);
  });

  it('skips entries missing a string prefix', () => {
    const findings = findMountOverlaps([
      { delivery: 'static', manifest_url: '/x' },
      { prefix: '/a' },
    ]);
    expect(findings).toEqual([]);
  });
});

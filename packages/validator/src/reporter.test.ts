/**
 * Tests for reporter assembly (PRD-600-R16 → R22, R24, R31).
 */
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  inferAchievedLevel,
  searchBodyDeferredWarning,
} from './reporter.js';
import type { Gap } from '@act-spec/core';

describe('PRD-600-R16: report carries the seven required fields', () => {
  it('emits act_version, url, declared, achieved, gaps, warnings, passed_at', () => {
    const r = buildReport({
      url: 'https://e.test/.well-known/act.json',
      declared: { level: 'core', delivery: 'static' },
      achieved: { level: 'core', delivery: 'static' },
      gaps: [],
      warnings: [],
      passedAt: '2026-05-01T00:00:00Z',
    });
    expect(r.act_version).toBe('0.1');
    expect(r.url).toBe('https://e.test/.well-known/act.json');
    expect(r.declared).toEqual({ level: 'core', delivery: 'static' });
    expect(r.achieved).toEqual({ level: 'core', delivery: 'static' });
    expect(r.gaps).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.passed_at).toBe('2026-05-01T00:00:00Z');
  });

  it('PRD-600-R31: report passes the PRD-107 reporter-shape contract — additionalProperties tolerated', () => {
    const r = buildReport({
      url: 'x',
      declared: { level: null, delivery: null },
      achieved: { level: null, delivery: null },
      gaps: [],
      warnings: [],
      walkSummary: {
        requests_made: 1,
        nodes_sampled: 0,
        sample_strategy: 'first-n',
        elapsed_ms: 5,
      },
    });
    expect(r.validator_version).toBe('0.1.0');
    expect(r.walk_summary?.requests_made).toBe(1);
  });

  it('PRD-600-R21: passed_at is RFC 3339 (defaults to now)', () => {
    const r = buildReport({
      url: 'x',
      declared: { level: null, delivery: null },
      achieved: { level: null, delivery: null },
      gaps: [],
      warnings: [],
    });
    expect(r.passed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('PRD-600-R18: inferAchievedLevel by probing', () => {
  it('returns plus when no gaps', () => {
    expect(inferAchievedLevel([])).toBe('strict');
  });
  it('returns null when any core gap exists', () => {
    expect(
      inferAchievedLevel([{ level: 'core', requirement: 'PRD-100-R4', missing: 'x' }] as Gap[]),
    ).toBe(null);
  });
  it('returns core when only standard gaps exist', () => {
    expect(
      inferAchievedLevel([
        { level: 'standard', requirement: 'PRD-107-R8', missing: 'x' },
      ] as Gap[]),
    ).toBe('core');
  });
  it('returns standard when only plus gaps exist', () => {
    expect(
      inferAchievedLevel([
        { level: 'strict', requirement: 'PRD-107-R10', missing: 'x' },
      ] as Gap[]),
    ).toBe('standard');
  });
  it('returns null when both core+plus gaps exist (core-blocking dominates)', () => {
    expect(
      inferAchievedLevel([
        { level: 'strict', requirement: 'PRD-107-R10', missing: 'x' },
        { level: 'core', requirement: 'PRD-100-R4', missing: 'y' },
      ] as Gap[]),
    ).toBe(null);
  });
});

describe('PRD-600-R24: search-body-deferred warning is emitted on every Plus target', () => {
  it('returns the canonical warning when manifest advertises search_url_template', () => {
    const out = searchBodyDeferredWarning({ search_url_template: '/q?x={query}' });
    expect(out).toHaveLength(1);
    expect(out[0]?.code).toBe('search-body-deferred');
    expect(out[0]?.message).toContain('search response body envelope is deferred to v0.2');
  });
  it('returns no warning when manifest omits search_url_template', () => {
    expect(searchBodyDeferredWarning({})).toEqual([]);
  });
  it('tolerates non-object input', () => {
    expect(searchBodyDeferredWarning(null)).toEqual([]);
    expect(searchBodyDeferredWarning(undefined)).toEqual([]);
    expect(searchBodyDeferredWarning('manifest-as-string')).toEqual([]);
  });
});

describe('PRD-600-R20: warnings carry level/code/message', () => {
  it('warnings list shape is preserved end-to-end', () => {
    const r = buildReport({
      url: 'x',
      declared: { level: null, delivery: null },
      achieved: { level: null, delivery: null },
      gaps: [],
      warnings: [{ level: 'core', code: 'unknown-field', message: 'x' }],
    });
    expect(r.warnings[0]?.code).toBe('unknown-field');
  });
});

describe('PRD-600-R22: declared.level is preserved separately from achieved.level', () => {
  it('a Plus-declared producer that achieves Core still surfaces Plus in declared', () => {
    const r = buildReport({
      url: 'x',
      declared: { level: 'strict', delivery: 'runtime' },
      achieved: { level: 'core', delivery: 'runtime' },
      gaps: [{ level: 'standard', requirement: 'PRD-107-R8', missing: 'x' }],
      warnings: [],
    });
    expect(r.declared.level).toBe('strict');
    expect(r.achieved.level).toBe('core');
  });
});

/**
 * Placeholder test for @act-spec/core. Real PRD-600 reporter behavior
 * lives in @act-spec/validator. This test only confirms the type module
 * loads under the package's vitest harness so CI's `pnpm -r test` is green.
 */
import { describe, it, expect } from 'vitest';
import type { ConformanceReport, Gap, AchievedLevel } from './conformance-reporter.js';
import { ACT_VERSION } from './index.js';

describe('@act-spec/core conformance-reporter types', () => {
  it('admits a minimal PRD-107-R16 shape', () => {
    const report: ConformanceReport = {
      act_version: '0.1',
      url: 'https://example.test/.well-known/act.json',
      declared: { level: 'core', delivery: 'static' },
      achieved: { level: 'core', delivery: 'static' },
      gaps: [],
      warnings: [],
      passed_at: '2026-05-01T00:00:00Z',
    };
    expect(report.act_version).toBe('0.1');
  });

  it('admits gap entries citing a PRD-{NNN}-R{n} source', () => {
    const gap: Gap = { level: 'core', requirement: 'PRD-100-R4', missing: 'manifest missing field' };
    const levels: AchievedLevel[] = ['core', 'standard', 'strict'];
    expect(gap.requirement).toMatch(/^PRD-\d{3}-R\d+[a-z]?$/);
    expect(levels).toContain(gap.level);
  });

  it('exposes the bundled ACT_VERSION constant via the package barrel', () => {
    expect(ACT_VERSION).toBe('0.1');
  });
});

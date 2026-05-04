import { describe, expect, it } from 'vitest';

import { parseDuration } from './duration.js';

describe('PRD-409-R10 parseDuration', () => {
  it('PRD-409-R10: accepts seconds suffix (s)', () => {
    expect(parseDuration('30s')).toBe(30_000);
  });

  it('PRD-409-R10: accepts minutes suffix (m)', () => {
    expect(parseDuration('5m')).toBe(5 * 60_000);
  });

  it('PRD-409-R10: accepts hours suffix (h)', () => {
    expect(parseDuration('2h')).toBe(2 * 3_600_000);
  });

  it('PRD-409-R10: accepts millisecond suffix (ms)', () => {
    expect(parseDuration('500ms')).toBe(500);
  });

  it('PRD-409-R10: bare integer is interpreted as milliseconds', () => {
    expect(parseDuration('1500')).toBe(1500);
  });

  it('PRD-409-R10: rejects malformed input with a cited error', () => {
    expect(() => parseDuration('garbage')).toThrow(/PRD-409-R10/);
    expect(() => parseDuration('5x')).toThrow(/PRD-409-R10/);
  });
});

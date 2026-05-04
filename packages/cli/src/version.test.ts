import { describe, expect, it } from 'vitest';

import { ACT_VERSION, CLI_VERSION } from './version.js';

describe('PRD-409 version constants', () => {
  it('PRD-409-R12 / R14: ACT_VERSION is "0.1" for v0.1', () => {
    expect(ACT_VERSION).toBe('0.1');
  });

  it('PRD-409-R2: CLI_VERSION is a non-empty string', () => {
    expect(typeof CLI_VERSION).toBe('string');
    expect(CLI_VERSION.length).toBeGreaterThan(0);
  });
});

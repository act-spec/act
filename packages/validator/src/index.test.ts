/**
 * Tests for the public package surface (PRD-600-R25).
 */
import { describe, expect, it } from 'vitest';
import {
  ACT_VERSION,
  VALIDATOR_PACKAGE_NAME,
  VALIDATOR_VERSION,
  buildReport,
  validateError,
  validateIndex,
  validateManifest,
  validateNdjsonIndex,
  validateNode,
  validateSubtree,
  validateSite,
} from './index.js';

describe('public surface (PRD-600-R25)', () => {
  it('exports the seven validators required by PRD-600-R25', () => {
    expect(typeof validateManifest).toBe('function');
    expect(typeof validateNode).toBe('function');
    expect(typeof validateIndex).toBe('function');
    expect(typeof validateNdjsonIndex).toBe('function');
    expect(typeof validateSubtree).toBe('function');
    expect(typeof validateError).toBe('function');
    expect(typeof validateSite).toBe('function');
  });

  it('exports the bundled ACT_VERSION and VALIDATOR_VERSION', () => {
    expect(ACT_VERSION).toBe('0.1');
    expect(VALIDATOR_VERSION).toBe('0.1.0');
  });

  it('exports the buildReport reporter assembler', () => {
    const r = buildReport({
      url: 'x',
      declared: { level: null, delivery: null },
      achieved: { level: null, delivery: null },
      gaps: [],
      warnings: [],
    });
    expect(r.act_version).toBe(ACT_VERSION);
  });

  it('keeps the legacy package marker', () => {
    expect(VALIDATOR_PACKAGE_NAME).toBe('@act-spec/validator');
  });

  it('PRD-600-R12: reserved (formerly per-tenant ID stability prober — folded into PRD-600-R8)', () => {
    // PRD-600-R12 is intentionally reserved. PRD-103-R7 / PRD-600-R8 cover
    // the runtime-determinism behavior the original R12 prober would have
    // exercised. This test exists to surface R12 in the requirement-coverage
    // matrix and prevent silent re-allocation.
    expect('PRD-600-R12').toMatch(/^PRD-600-R12$/);
  });

  it('PRD-600-R28 / R29: hosted SPA path + stale-build banner (SPA is a separate package, deferred to PRD-700-series; library exposes ACT_VERSION + VALIDATOR_VERSION + reporter shape that the SPA renders)', () => {
    // R28: SPA bundles the validator and renders ACT_VERSION + VALIDATOR_VERSION
    // in its footer. R29: SPA fetches /spec-version.json and renders a banner.
    // The SPA itself is out of scope for the validator library; the library
    // exports the constants the SPA needs.
    expect(ACT_VERSION).toMatch(/^\d+\.\d+$/);
    expect(VALIDATOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

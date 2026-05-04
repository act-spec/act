/**
 * PRD-301 Open Question 1 (resolved 2026-05-01) — runtime contract
 * validator. Catches CMS-driven prop drift at extract time.
 */
import { describe, expect, it } from 'vitest';
import {
  assertContractShape,
  validateContractShape,
} from './validate-contract.js';

describe('PRD-301 Q1 runtime contract validator', () => {
  it('Q1: accepts a well-shaped contract', () => {
    expect(
      validateContractShape({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:hero' }),
      }),
    ).toBeNull();
  });

  it('Q1: rejects null / undefined / scalars', () => {
    expect(validateContractShape(null)).toMatch(/non-null object/);
    expect(validateContractShape(undefined)).toMatch(/non-null object/);
    expect(validateContractShape('hero')).toMatch(/non-null object/);
    expect(validateContractShape(7)).toMatch(/non-null object/);
  });

  it('Q1: rejects missing or empty type (PRD-300-R2)', () => {
    expect(
      validateContractShape({ contract_version: '0.1', extract: () => ({}) }),
    ).toMatch(/contract\.type/);
    expect(
      validateContractShape({ type: '', contract_version: '0.1', extract: () => ({}) }),
    ).toMatch(/contract\.type/);
  });

  it('Q1: rejects malformed contract_version (PRD-300-R26)', () => {
    expect(
      validateContractShape({ type: 'marketing:hero', contract_version: 'one', extract: () => ({}) }),
    ).toMatch(/contract_version/);
    expect(
      validateContractShape({ type: 'marketing:hero', contract_version: '1', extract: () => ({}) }),
    ).toMatch(/contract_version/);
  });

  it('Q1: rejects non-function extract (PRD-300-R7)', () => {
    expect(
      validateContractShape({ type: 'marketing:hero', contract_version: '0.1', extract: 'nope' }),
    ).toMatch(/extract/);
  });

  it('Q1 / PRD-301-R16: assertContractShape throws on invalid shape', () => {
    expect(() => {
      assertContractShape(null);
    }).toThrow();
    expect(() => {
      assertContractShape({
        type: 'marketing:hero',
        contract_version: '0.1',
        extract: () => ({ type: 'marketing:hero' }),
      });
    }).not.toThrow();
  });
});

/**
 * PRD-303 (mirrors PRD-301 Q1) — runtime contract validator.
 */
import { describe, expect, it } from 'vitest';
import { assertContractShape, validateContractShape } from './validate-contract.js';

describe('validateContractShape', () => {
  it('returns null on a valid contract', () => {
    const ok = {
      type: 'marketing:hero',
      contract_version: '0.1',
      extract: () => ({ type: 'marketing:hero' }),
    };
    expect(validateContractShape(ok)).toBeNull();
  });

  it('PRD-300-R2: rejects null', () => {
    expect(validateContractShape(null)).toContain('non-null object');
  });

  it('PRD-300-R2: rejects non-object', () => {
    expect(validateContractShape('string')).toContain('non-null object');
    expect(validateContractShape(42)).toContain('non-null object');
  });

  it('PRD-300-R2: rejects empty type', () => {
    expect(
      validateContractShape({ type: '', contract_version: '0.1', extract: () => ({ type: 'x' }) }),
    ).toContain('contract.type');
  });

  it('PRD-300-R2: rejects missing type', () => {
    expect(
      validateContractShape({ contract_version: '0.1', extract: () => ({ type: 'x' }) }),
    ).toContain('contract.type');
  });

  it('PRD-300-R26: rejects malformed contract_version', () => {
    expect(
      validateContractShape({ type: 'x', contract_version: 'v1', extract: () => ({ type: 'x' }) }),
    ).toContain('contract_version');
    expect(
      validateContractShape({ type: 'x', contract_version: '0.1.0', extract: () => ({ type: 'x' }) }),
    ).toContain('contract_version');
  });

  it('PRD-300-R7: rejects non-function extract', () => {
    expect(
      validateContractShape({ type: 'x', contract_version: '0.1', extract: 'nope' }),
    ).toContain('extract');
  });
});

describe('assertContractShape', () => {
  it('returns silently on a valid contract', () => {
    expect(() =>
      assertContractShape({
        type: 'x',
        contract_version: '0.1',
        extract: () => ({ type: 'x' }),
      }),
    ).not.toThrow();
  });

  it('throws on an invalid contract', () => {
    expect(() => assertContractShape(null)).toThrow();
    expect(() =>
      assertContractShape({ type: 'x', contract_version: 'v1', extract: () => ({ type: 'x' }) }),
    ).toThrow();
  });
});

/**
 * Public-surface smoke tests — every PRD-601-R15 export is reachable
 * and the package marker is intact.
 */
import { describe, expect, it } from 'vitest';
import * as pkg from './index.js';

describe('@act-spec/inspector public surface (PRD-601-R15)', () => {
  it('exports the package marker', () => {
    expect(pkg.INSPECTOR_PACKAGE_NAME).toBe('@act-spec/inspector');
  });

  it('exports ACT_VERSION + INSPECTOR_VERSION (PRD-601-R16)', () => {
    expect(pkg.ACT_VERSION).toBe('0.1');
    expect(typeof pkg.INSPECTOR_VERSION).toBe('string');
  });

  it.each([
    ['inspect'],
    ['walk'],
    ['diff'],
    ['node'],
    ['subtree'],
    ['budget'],
  ])('exports %s as a function (PRD-601-R15)', (name) => {
    expect(typeof (pkg as unknown as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports runCli + parseCliArgs for CLI testing', () => {
    expect(typeof pkg.runCli).toBe('function');
    expect(typeof pkg.parseCliArgs).toBe('function');
  });
});

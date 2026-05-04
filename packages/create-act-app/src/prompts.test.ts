import { describe, expect, it } from 'vitest';

import { isValidProjectName } from './prompts.js';

describe('isValidProjectName', () => {
  it('accepts plain names', () => {
    expect(isValidProjectName('my-app')).toBe(true);
    expect(isValidProjectName('a')).toBe(true);
    expect(isValidProjectName('a.b_c-1')).toBe(true);
  });

  it('accepts scoped names', () => {
    expect(isValidProjectName('@scope/name')).toBe(true);
  });

  it('rejects empty', () => {
    expect(isValidProjectName('')).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(isValidProjectName('my app')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidProjectName('MyApp')).toBe(false);
  });

  it('rejects leading dot or dash', () => {
    expect(isValidProjectName('.foo')).toBe(false);
    expect(isValidProjectName('-foo')).toBe(false);
  });

  it('rejects names over 214 chars', () => {
    expect(isValidProjectName('a'.repeat(215))).toBe(false);
  });
});

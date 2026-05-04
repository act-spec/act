/**
 * PRD-302-R2 — Vue 3+ peer-dep floor.
 */
import { describe, expect, it } from 'vitest';
import { assertVue3Plus, parseVueMajor } from './version-gate.js';
import { VueBindingError } from './errors.js';

describe('PRD-302-R2 Vue 3+ peer floor', () => {
  it('PRD-302-R2: parseVueMajor extracts the major from "3.4.21"', () => {
    expect(parseVueMajor('3.4.21')).toBe(3);
  });

  it('PRD-302-R2: parseVueMajor returns NaN on garbage', () => {
    expect(parseVueMajor(null)).toBeNaN();
    expect(parseVueMajor(undefined)).toBeNaN();
    expect(parseVueMajor('')).toBeNaN();
    expect(parseVueMajor(42)).toBeNaN();
  });

  it('PRD-302-R2: assertVue3Plus passes on Vue 3.x', () => {
    expect(() => assertVue3Plus('3.0.0')).not.toThrow();
    expect(() => assertVue3Plus('3.4.21')).not.toThrow();
  });

  it('PRD-302-R2: assertVue3Plus throws BuildError on Vue 2.x (Vue 2 explicitly out of scope)', () => {
    let caught: VueBindingError | undefined;
    try {
      assertVue3Plus('2.7.16');
    } catch (e) {
      caught = e as VueBindingError;
    }
    expect(caught).toBeInstanceOf(VueBindingError);
    expect(caught?.vueCode).toBe('PRD-302-R2');
    expect(caught?.message).toContain('Vue 2');
    expect(caught?.message).toContain('Vue 3+ required');
  });

  it('PRD-302-R2: assertVue3Plus throws on unparseable version', () => {
    expect(() => assertVue3Plus(null)).toThrowError(/cannot parse Vue version/);
    expect(() => assertVue3Plus('garbage')).toThrowError(/cannot parse Vue version/);
  });

  it('PRD-302-R2: assertVue3Plus passes on Vue 4+ (forward-compatible per PRD-108-R7)', () => {
    expect(() => assertVue3Plus('4.0.0')).not.toThrow();
  });
});

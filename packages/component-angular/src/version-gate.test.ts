/**
 * PRD-303-R2 — Angular 17+ peer-dep floor.
 */
import { describe, expect, it } from 'vitest';
import { assertAngular17Plus, parseAngularMajor } from './version-gate.js';
import { AngularBindingError } from './errors.js';

describe('PRD-303-R2 parseAngularMajor', () => {
  it('PRD-303-R2: parses string `"17.3.0"` to 17', () => {
    expect(parseAngularMajor('17.3.0')).toBe(17);
  });

  it('PRD-303-R2: parses VERSION-object form `{ major: "17", full: "17.3.0" }` to 17', () => {
    expect(parseAngularMajor({ major: '17', full: '17.3.0' })).toBe(17);
  });

  it('PRD-303-R2: returns NaN on null', () => {
    expect(parseAngularMajor(null)).toBeNaN();
  });

  it('PRD-303-R2: returns NaN on undefined', () => {
    expect(parseAngularMajor(undefined)).toBeNaN();
  });

  it('PRD-303-R2: returns NaN on empty string', () => {
    expect(parseAngularMajor('')).toBeNaN();
  });

  it('PRD-303-R2: returns NaN on garbage object (no major field)', () => {
    expect(parseAngularMajor({ random: 1 })).toBeNaN();
  });

  it('PRD-303-R2: returns NaN on garbage string', () => {
    expect(parseAngularMajor('not-a-version')).toBeNaN();
  });

  it('PRD-303-R2: returns NaN on object with non-string major', () => {
    expect(parseAngularMajor({ major: 17 })).toBeNaN();
  });
});

describe('PRD-303-R2 assertAngular17Plus', () => {
  it('PRD-303-R2: accepts Angular 17.x', () => {
    expect(() => assertAngular17Plus('17.0.0')).not.toThrow();
    expect(() => assertAngular17Plus('17.3.5')).not.toThrow();
  });

  it('PRD-303-R2: accepts Angular 18+ (peer range goes up to <21)', () => {
    expect(() => assertAngular17Plus('18.0.0')).not.toThrow();
    expect(() => assertAngular17Plus('20.5.0')).not.toThrow();
  });

  it('PRD-303-R2: accepts the VERSION-object form', () => {
    expect(() => assertAngular17Plus({ major: '17', full: '17.3.0' })).not.toThrow();
  });

  it('PRD-303-R2: throws AngularBindingError on Angular 16', () => {
    expect(() => assertAngular17Plus('16.2.0')).toThrow(AngularBindingError);
  });

  it('PRD-303-R2: throws AngularBindingError on Angular 15', () => {
    expect(() => assertAngular17Plus('15.0.0')).toThrow(AngularBindingError);
  });

  it('PRD-303-R2: throws AngularBindingError on AngularJS (1.x)', () => {
    expect(() => assertAngular17Plus('1.8.3')).toThrow(AngularBindingError);
  });

  it('PRD-303-R2: throws AngularBindingError on garbage version string', () => {
    expect(() => assertAngular17Plus('not-a-version')).toThrow(AngularBindingError);
  });

  it('PRD-303-R2: throws AngularBindingError on null', () => {
    expect(() => assertAngular17Plus(null)).toThrow(AngularBindingError);
  });

  it('PRD-303-R2: error message includes the supplied version', () => {
    try {
      assertAngular17Plus('16.0.0');
    } catch (e) {
      expect((e as Error).message).toContain('16.0.0');
      expect((e as Error).message).toContain('PRD-303-R2');
    }
  });

  it('PRD-303-R2: error message includes the full string when VERSION-object passed', () => {
    try {
      assertAngular17Plus({ major: '16', full: '16.2.1' });
    } catch (e) {
      expect((e as Error).message).toContain('16.2.1');
    }
  });
});

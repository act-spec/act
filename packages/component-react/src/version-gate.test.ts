/**
 * PRD-301-R2 — React 18+ peer-dep floor enforcement.
 */
import { describe, expect, it } from 'vitest';
import { BuildError } from '@act-spec/component-contract';
import { assertReact18Plus, parseReactMajor } from './version-gate.js';

describe('PRD-301-R2 React version gate', () => {
  it('PRD-301-R2: parses MAJOR from a standard semver string', () => {
    expect(parseReactMajor('18.3.1')).toBe(18);
    expect(parseReactMajor('19.0.0-rc.1')).toBe(19);
    expect(parseReactMajor('17.0.2')).toBe(17);
  });

  it('PRD-301-R2: returns NaN for invalid input', () => {
    expect(parseReactMajor('')).toBeNaN();
    expect(parseReactMajor(undefined)).toBeNaN();
    expect(parseReactMajor(null)).toBeNaN();
    expect(parseReactMajor(18)).toBeNaN();
  });

  it('PRD-301-R2: accepts React 18+', () => {
    expect(() => assertReact18Plus('18.0.0')).not.toThrow();
    expect(() => assertReact18Plus('18.3.1')).not.toThrow();
    expect(() => assertReact18Plus('19.0.0')).not.toThrow();
  });

  it('PRD-301-R2: rejects React < 18 with BuildError', () => {
    expect(() => assertReact18Plus('17.0.2')).toThrow(BuildError);
    expect(() => assertReact18Plus('17.0.2')).toThrow(/React 17/);
  });

  it('PRD-301-R2: rejects unparseable version strings', () => {
    expect(() => assertReact18Plus('not-a-version')).toThrow(BuildError);
    expect(() => assertReact18Plus('')).toThrow(BuildError);
  });
});

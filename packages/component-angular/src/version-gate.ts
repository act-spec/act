/**
 * PRD-303-R2 — Angular 17+ peer-dep floor.
 *
 * The binding probes `@angular/core` `VERSION.major` at instantiation;
 * if Angular < 17 is detected, an `AngularBindingError("PRD-303-R2")` is
 * thrown. Angular 16 and earlier are explicitly out of scope for v0.1
 * (PRD-303-R2 + Open Question 3, resolved 2026-05-01). AngularJS
 * (Angular 1.x) is also out of scope and detected via the same code path
 * (its versions parse as MAJOR `1`, well below the floor).
 */
import { AngularBindingError } from './errors.js';

/**
 * Parses an Angular version string into its MAJOR component.
 * Accepts both string forms (`"17.3.0"`) and the `VERSION` object
 * `@angular/core` exports (`{ full: "17.3.0", major: "17", ... }`).
 * Returns NaN on garbage input.
 */
export function parseAngularMajor(version: unknown): number {
  if (version === null || version === undefined) return Number.NaN;
  // The `@angular/core` `VERSION` object has a `.major` string field.
  if (typeof version === 'object' && 'major' in (version as Record<string, unknown>)) {
    const v = (version as { major: unknown }).major;
    if (typeof v === 'string' && v.length > 0) {
      const parsed = Number.parseInt(v, 10);
      return Number.isNaN(parsed) ? Number.NaN : parsed;
    }
  }
  if (typeof version !== 'string' || version.length === 0) return Number.NaN;
  const head = version.split('.', 1)[0];
  if (head === undefined) return Number.NaN;
  return Number.parseInt(head, 10);
}

/**
 * PRD-303-R2 — throw `BuildError("PRD-303-R2")` when the supplied Angular
 * MAJOR is < 17. The binding's `extractRoute` calls this once with the
 * value of `@angular/core`'s `VERSION` per the PRD's runtime-probe wording.
 */
export function assertAngular17Plus(version: unknown): void {
  const major = parseAngularMajor(version);
  if (Number.isNaN(major)) {
    throw new AngularBindingError(
      'PRD-303-R2',
      `cannot parse Angular version "${String(stringifyVersion(version))}"; Angular 17+ required`,
    );
  }
  if (major < 17) {
    throw new AngularBindingError(
      'PRD-303-R2',
      `Angular ${String(stringifyVersion(version))} detected; Angular 17+ required (PRD-303 v0.1)`,
    );
  }
}

function stringifyVersion(version: unknown): string {
  if (typeof version === 'string') return version;
  if (version !== null && typeof version === 'object'
      && 'full' in (version as Record<string, unknown>)) {
    const v = (version as { full: unknown }).full;
    if (typeof v === 'string') return v;
  }
  return String(version);
}

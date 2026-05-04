/**
 * PRD-301-R2 — React 18+ peer-dep floor.
 *
 * The binding probes `React.version` at instantiation; if React < 18 is
 * detected, a `BuildError("PRD-301-R2")` is thrown. React 17 and earlier
 * are explicitly out of scope for v0.1 (see PRD-301 Open Question 2,
 * resolved 2026-05-01).
 */
import { ReactBindingError } from './errors.js';

/** Parses `"18.3.1"` → 18 (the MAJOR). Returns NaN on garbage input. */
export function parseReactMajor(version: unknown): number {
  if (typeof version !== 'string' || version.length === 0) return Number.NaN;
  const head = version.split('.', 1)[0];
  if (head === undefined) return Number.NaN;
  return Number.parseInt(head, 10);
}

/**
 * PRD-301-R2 — throw `BuildError("PRD-301-R2")` when the supplied React
 * MAJOR is < 18. The binding's `extractRoute` calls this once with the
 * value of `React.version` per the PRD's runtime-probe wording.
 */
export function assertReact18Plus(version: unknown): void {
  const major = parseReactMajor(version);
  if (Number.isNaN(major)) {
    throw new ReactBindingError(
      'PRD-301-R2',
      `cannot parse React version "${String(version)}"; React 18+ required`,
    );
  }
  if (major < 18) {
    throw new ReactBindingError(
      'PRD-301-R2',
      `React ${String(version)} detected; React 18+ required (PRD-301 v0.1)`,
    );
  }
}

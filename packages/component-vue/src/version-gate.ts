/**
 * PRD-302-R2 — Vue 3.x peer-dep floor.
 *
 * The binding probes `Vue.version` (or `app.version`) at instantiation; if
 * Vue < 3.0 is detected, a `BuildError("PRD-302-R2")` is thrown. Vue 2 is
 * explicitly out of scope for v0.1 (Open Question 1, resolved 2026-05-01).
 */
import { VueBindingError } from './errors.js';

/** Parses `"3.4.21"` → 3 (the MAJOR). Returns NaN on garbage input. */
export function parseVueMajor(version: unknown): number {
  if (typeof version !== 'string' || version.length === 0) return Number.NaN;
  const head = version.split('.', 1)[0];
  if (head === undefined) return Number.NaN;
  return Number.parseInt(head, 10);
}

/**
 * PRD-302-R2 — throw `BuildError("PRD-302-R2")` when the supplied Vue
 * MAJOR is < 3. The binding's `extractRoute` calls this once with the
 * value of `Vue.version` per the PRD's runtime-probe wording.
 */
export function assertVue3Plus(version: unknown): void {
  const major = parseVueMajor(version);
  if (Number.isNaN(major)) {
    throw new VueBindingError(
      'PRD-302-R2',
      `cannot parse Vue version "${String(version)}"; Vue 3+ required`,
    );
  }
  if (major < 3) {
    throw new VueBindingError(
      'PRD-302-R2',
      `Vue ${String(version)} detected; Vue 3+ required (PRD-302 v0.1 — Vue 2 explicitly out of scope)`,
    );
  }
}

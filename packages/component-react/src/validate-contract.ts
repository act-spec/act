/**
 * PRD-301 Open Question 1 (resolved 2026-05-01) — runtime contract
 * validator. Catches CMS-driven prop drift at extract time and routes
 * to PRD-301-R16's placeholder path.
 *
 * The TS `satisfies ActContract<P>` helper covers compile-time author
 * ergonomics; this runtime validator covers cases the type system can't
 * see (e.g., CMS-fetched payloads handed to a component as `unknown`).
 */
import type { ActContract } from '@act-spec/component-contract';

/**
 * Returns the failure reason as a string or null when the contract
 * shape is valid. Pure (no throws); the binding's `safeExtract` chain
 * converts a non-null reason to a placeholder per PRD-301-R16.
 */
export function validateContractShape(value: unknown): string | null {
  if (value === null || typeof value !== 'object') {
    return 'contract MUST be a non-null object';
  }
  const c = value as Partial<ActContract<unknown>>;
  if (typeof c.type !== 'string' || c.type.length === 0) {
    return 'contract.type MUST be a non-empty string (PRD-300-R2)';
  }
  if (typeof c.contract_version !== 'string' || !/^[0-9]+\.[0-9]+$/.test(c.contract_version)) {
    return 'contract.contract_version MUST match `^[0-9]+\\.[0-9]+$` (PRD-300-R26)';
  }
  if (typeof c.extract !== 'function') {
    return 'contract.extract MUST be a function (PRD-300-R7)';
  }
  return null;
}

/**
 * Asserting form for callers that want a thrown error rather than a
 * reason string. Tests use this; production code prefers the
 * non-throwing form so failures route to placeholder per PRD-301-R16.
 */
export function assertContractShape(value: unknown): asserts value is ActContract<unknown> {
  const reason = validateContractShape(value);
  if (reason !== null) throw new Error(reason);
}

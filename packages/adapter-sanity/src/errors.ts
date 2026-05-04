/**
 * PRD-203 — closed enum of unrecoverable error codes thrown by the adapter.
 * Cross-referenced from the recoverable surface (PRD-203-R21) which yields
 * partial nodes rather than throwing.
 */
export type SanityAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'project_not_found'
  | 'reference_depth_exceeded'
  | 'rate_limit_exhausted'
  | 'level_mismatch';

/**
 * PRD-203 — typed error class. `code` is the closed enum above; the adapter
 * never logs the raw apiToken in `message` (PRD-203-R23 / R24).
 */
export class SanityAdapterError extends Error {
  public readonly code: SanityAdapterErrorCode;
  constructor(opts: { code: SanityAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'SanityAdapterError';
    this.code = opts.code;
  }
}

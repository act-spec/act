/**
 * PRD-205 — closed enum of unrecoverable error codes thrown by the adapter.
 * Cross-referenced from the recoverable surface (PRD-205-R23) which yields
 * partial nodes rather than throwing.
 */
export type StrapiAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'content_type_not_found'
  | 'populate_depth_exceeded'
  | 'dynamic_zone_max_invalid'
  | 'rate_limit_exhausted'
  | 'level_mismatch'
  | 'locale_plugin_missing';

/**
 * PRD-205 — typed error class. `code` is the closed enum above; the adapter
 * never logs the raw apiToken in `message` (PRD-205-R24 / R25).
 */
export class StrapiAdapterError extends Error {
  public readonly code: StrapiAdapterErrorCode;
  constructor(opts: { code: StrapiAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'StrapiAdapterError';
    this.code = opts.code;
  }
}

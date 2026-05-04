/**
 * PRD-206 — closed enum of unrecoverable error codes thrown by the adapter.
 * Recoverable surfaces (rate-limit retries exhausted, unmapped components,
 * Symbol recursion exceeded) yield partial nodes per PRD-206-R24 / R9 / R12
 * rather than throwing.
 */
export type BuilderAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'private_key_detected'
  | 'model_not_found'
  | 'reference_depth_exceeded'
  | 'symbol_recursion_max_invalid'
  | 'mode_invalid'
  | 'level_mismatch';

/**
 * PRD-206 — typed error class. `code` is the closed enum above; the adapter
 * never logs the raw apiKey value in `message` (PRD-206-R26 / R27).
 */
export class BuilderAdapterError extends Error {
  public readonly code: BuilderAdapterErrorCode;
  constructor(opts: { code: BuilderAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'BuilderAdapterError';
    this.code = opts.code;
  }
}

/**
 * PRD-204 — closed enum of unrecoverable error codes thrown by the adapter.
 * Cross-referenced from the recoverable surface (PRD-204-R22) which yields
 * partial nodes rather than throwing.
 */
export type StoryblokAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'space_not_found'
  | 'link_resolution_depth_exceeded'
  | 'component_recursion_max_invalid'
  | 'rate_limit_exhausted'
  | 'level_mismatch';

/**
 * PRD-204 — typed error class. `code` is the closed enum above; the adapter
 * never logs the raw accessToken in `message` (PRD-204-R23 / R24).
 */
export class StoryblokAdapterError extends Error {
  public readonly code: StoryblokAdapterErrorCode;
  constructor(opts: { code: StoryblokAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'StoryblokAdapterError';
    this.code = opts.code;
  }
}

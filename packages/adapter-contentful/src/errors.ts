/**
 * PRD-202-R19 — closed enum of unrecoverable error codes thrown by the
 * adapter. Cross-referenced from the recoverable surface (PRD-202-R18) which
 * yields partial nodes rather than throwing.
 */
export type ContentfulAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'space_not_found'
  | 'content_type_not_found'
  | 'reserved_metadata_key'
  | 'rate_limit_exhausted'
  | 'upstream_unavailable'
  | 'locale_not_in_space'
  | 'level_mismatch';

/**
 * PRD-202-R19 — typed error class. `code` is the closed enum above; the
 * adapter never logs the raw access token in `message`.
 */
export class ContentfulAdapterError extends Error {
  public readonly code: ContentfulAdapterErrorCode;
  constructor(opts: { code: ContentfulAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'ContentfulAdapterError';
    this.code = opts.code;
  }
}

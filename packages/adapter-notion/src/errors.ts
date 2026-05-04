/**
 * Closed enum of unrecoverable error codes thrown by the Notion adapter.
 * Recoverable problems (a single page failing to fetch, an unknown block
 * type, an absent locale property) yield partial nodes or warnings instead.
 */
export type NotionAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'database_not_found'
  | 'rate_limit_exhausted'
  | 'upstream_unavailable'
  | 'level_mismatch';

/**
 * Typed error class. `code` is the closed enum above; the adapter never
 * logs the raw access token in `message`.
 */
export class NotionAdapterError extends Error {
  public readonly code: NotionAdapterErrorCode;
  constructor(opts: { code: NotionAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'NotionAdapterError';
    this.code = opts.code;
  }
}

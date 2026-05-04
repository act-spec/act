/** Closed set of error codes thrown by the WordPress adapter. */
export type WordPressAdapterErrorCode =
  | 'config_invalid'
  | 'auth_failed'
  | 'auth_missing'
  | 'http_error'
  | 'transport_error'
  | 'env_missing'
  | 'used_before_init';

/**
 * Typed error thrown by the WordPress adapter for unrecoverable failures.
 * The `code` field is one of the documented values; `message` includes
 * adapter context (URL, status, env-var name) when relevant.
 */
export class WordPressAdapterError extends Error {
  public readonly code: WordPressAdapterErrorCode;
  constructor(opts: { code: WordPressAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'WordPressAdapterError';
    this.code = opts.code;
  }
}

/**
 * PRD-207 — closed enum of unrecoverable error codes thrown by the i18n
 * adapter. Recoverable surfaces (missing locale file, locale-string
 * normalization, cross-locale ID computation failure, orphan partial)
 * yield warnings per PRD-207-R9 / R10 / R13 rather than throwing.
 */
export type I18nAdapterErrorCode =
  | 'config_invalid'
  | 'catalog_parse'
  | 'level_mismatch';

/**
 * PRD-207 — typed error class. `code` is the closed enum above; the
 * adapter never reads or logs translation strings into messages
 * (PRD-207 security: catalog content as untrusted).
 */
export class I18nAdapterError extends Error {
  public readonly code: I18nAdapterErrorCode;
  constructor(opts: { code: I18nAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'I18nAdapterError';
    this.code = opts.code;
  }
}

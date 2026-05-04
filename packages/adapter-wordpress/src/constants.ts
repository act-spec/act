/** Adapter identity exposed via the framework `Adapter.name`. */
export const ADAPTER_NAME = 'act-wordpress' as const;

/** Default concurrency for parallel transforms. */
export const DEFAULT_CONCURRENCY = 4 as const;

/** Default REST page size. WordPress's hard cap is 100. */
export const DEFAULT_PER_PAGE = 100 as const;

/** Default node-id namespace prefix. */
export const DEFAULT_NAMESPACE = 'wp' as const;

/** Reserved metadata keys the adapter refuses to overwrite. */
export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'source',
  'extraction_status',
  'extraction_error',
  'locale',
  'translations',
]);

/**
 * `@act-spec/adapter-wordpress` — WordPress REST adapter for ACT.
 *
 * Public API. Imports the adapter framework contract from
 * `@act-spec/adapter-framework`. The default export pattern mirrors the
 * other first-party adapters: a factory (`createWordPressAdapter`) returns
 * an `Adapter` whose lifecycle satisfies the framework contract.
 */
export const WORDPRESS_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-wordpress' as const;

export {
  WORDPRESS_ADAPTER_NAME,
  WORDPRESS_DEFAULT_CONCURRENCY,
  WORDPRESS_DEFAULT_NAMESPACE,
  WORDPRESS_DEFAULT_PER_PAGE,
  RESERVED_METADATA_KEYS,
  corpusProvider,
  createWordPressAdapter,
  httpProvider,
  resolveAuth,
  _resetConfigValidatorCacheForTest,
} from './wordpress.js';

export type {
  CreateWordPressAdapterOpts,
  HttpProviderOptions,
  WordPressSourceProvider,
} from './wordpress.js';

export { WordPressAdapterError } from './errors.js';
export type { WordPressAdapterErrorCode } from './errors.js';

export {
  buildAuthHeader,
  buildCollectionUrl,
  fetchCollection,
  fetchCollectionPage,
} from './client.js';
export type { ClientOptions, CollectionPage, FetchLike, WordPressCollection } from './client.js';

export { detectI18nMode, extractLocale, extractTranslations } from './i18n.js';
export type { I18nMode } from './i18n.js';

export { htmlToParagraphs, tokenize } from './html.js';

export { mapWordPressItem } from './mapper.js';

export type {
  FromEnv,
  I18nOptions,
  IncludeFilter,
  RenderedText,
  ResolvedAuth,
  Secret,
  WordPressAdapterConfig,
  WordPressAuth,
  WordPressEntityKind,
  WordPressItem,
  WordPressMedia,
  WordPressPage,
  WordPressPost,
  WordPressSourceCorpus,
  WordPressTerm,
  WordPressUser,
} from './types.js';

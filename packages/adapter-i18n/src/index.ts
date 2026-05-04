/**
 * @act-spec/adapter-i18n — PRD-207 leaf.
 *
 * Public API. Imports the PRD-200 framework contract from
 * `@act-spec/adapter-framework` (per ADR-005). Every public symbol cites
 * a PRD-207 requirement and is exercised by at least one test in
 * `i18n.test.ts`.
 */
export const I18N_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-i18n' as const;

export {
  I18N_ADAPTER_NAME,
  I18N_DEFAULT_CONCURRENCY,
  createI18nAdapter,
  _resetConfigValidatorCacheForTest,
  _BCP47_SUBSET_RE_FOR_TEST,
  _inferNodesFromCatalogsForTest,
  _isSupportedLibrary,
} from './i18n.js';
export type { CreateI18nAdapterOpts } from './i18n.js';

export { I18nAdapterError } from './errors.js';
export type { I18nAdapterErrorCode } from './errors.js';

export type {
  DetectionResult,
  FlatCatalog,
  I18nAdapterConfig,
  I18nItem,
  I18nLibrary,
  TranslationStatus,
} from './types.js';

export {
  flattenObject,
  loadLocaleCatalog,
} from './catalog.js';

export { detectLibraryLayout } from './detect.js';

export {
  BCP47_SUBSET_RE,
  normalizeLocale,
} from './locale.js';

export {
  determineNodeStatus,
  type NodeStatus,
} from './fallback.js';

export {
  computeBindingId,
  inferNamespace,
  resolveCrossLocaleId,
  type ResolveOpts,
} from './cross-locale.js';

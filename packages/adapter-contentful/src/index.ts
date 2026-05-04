/**
 * @act-spec/adapter-contentful — PRD-202 leaf.
 *
 * Public API. Imports the PRD-200 framework contract from
 * `@act-spec/adapter-framework` (per ADR-005). Every public symbol cites a
 * PRD-202 requirement and is exercised by at least one test in
 * `contentful.test.ts`.
 */
export const CONTENTFUL_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-contentful' as const;

export {
  CONTENTFUL_ADAPTER_NAME,
  CONTENTFUL_DEFAULT_CONCURRENCY,
  RESERVED_METADATA_KEYS,
  corpusProvider,
  createContentfulAdapter,
  _resetConfigValidatorCacheForTest,
} from './contentful.js';

export type {
  ContentfulSourceProvider,
  CreateContentfulAdapterOpts,
} from './contentful.js';

export { ContentfulAdapterError } from './errors.js';
export type { ContentfulAdapterErrorCode } from './errors.js';

export type {
  ContentTypeMapping,
  ContentfulAdapterConfig,
  ContentfulAsset,
  ContentfulEntry,
  ContentfulEntrySys,
  ContentfulItem,
  ContentfulSourceCorpus,
  ContentfulSysRef,
  RichTextDocument,
} from './types.js';

export { richTextToBlocks } from './richtext.js';
export type { ContentBlock, RichTextConvertContext } from './richtext.js';

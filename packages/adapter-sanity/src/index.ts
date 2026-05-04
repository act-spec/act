/**
 * @act-spec/adapter-sanity — PRD-203 leaf.
 *
 * Public API. Imports the PRD-200 framework contract from
 * `@act-spec/adapter-framework` (per ADR-005). Every public symbol cites a
 * PRD-203 requirement and is exercised by at least one test in
 * `sanity.test.ts`.
 */
export const SANITY_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-sanity' as const;

export {
  SANITY_ADAPTER_NAME,
  SANITY_DEFAULT_CONCURRENCY,
  RESERVED_METADATA_KEYS,
  corpusProvider,
  createSanityAdapter,
  _resetConfigValidatorCacheForTest,
} from './sanity.js';

export type {
  CreateSanityAdapterOpts,
  SanitySourceProvider,
} from './sanity.js';

export { SanityAdapterError } from './errors.js';
export type { SanityAdapterErrorCode } from './errors.js';

export type {
  PortableTextBlock,
  PortableTextCustomBlock,
  PortableTextNode,
  PortableTextSpan,
  SanityAdapterConfig,
  SanityDocument,
  SanityItem,
  SanityRef,
  SanitySlug,
  SanitySourceCorpus,
} from './types.js';

export { walkPortableText, type ContentBlock } from './portable-text.js';
export { resolveReferences, clampDepth } from './references.js';

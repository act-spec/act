/**
 * @act-spec/adapter-builder — PRD-206 leaf.
 *
 * Public API. Imports the PRD-200 framework contract from
 * `@act-spec/adapter-framework` (per ADR-005). Every public symbol cites a
 * PRD-206 requirement and is exercised by at least one test in
 * `builder.test.ts`.
 */
export const BUILDER_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-builder' as const;

export {
  BUILDER_ADAPTER_NAME,
  BUILDER_DEFAULT_CONCURRENCY,
  BUILDER_DEFAULT_REFERENCE_DEPTH,
  BUILDER_DEFAULT_SYMBOL_RECURSION_MAX,
  BUILDER_DEFAULT_UNMAPPED_THRESHOLD,
  RESERVED_METADATA_KEYS,
  computeLevel,
  corpusProvider,
  createBuilderAdapter,
  deriveActId,
  emitPassThrough,
  normalizeContent,
  resolveActType,
  resolveSummary,
  _resetConfigValidatorCacheForTest,
} from './builder.js';

export type {
  BuilderSourceProvider,
  CreateBuilderAdapterOpts,
} from './builder.js';

export { BuilderAdapterError } from './errors.js';
export type { BuilderAdapterErrorCode } from './errors.js';

export type {
  BuilderAdapterConfig,
  BuilderBlock,
  BuilderContent,
  BuilderContentData,
  BuilderItem,
  BuilderReference,
  BuilderSourceCorpus,
  BuilderVariation,
} from './types.js';

export { walkBuilderTree } from './extract.js';
export type { WalkContext, WalkResult } from './extract.js';

export {
  clampReferenceDepth,
  resolveReferences,
} from './references.js';
export type { ReferenceLookup, RelationResolveResult, ResolveOpts } from './references.js';

export { emitMappedBlock, slugCase } from './marketing-mapping.js';
export type { MappingEntry, ProjectionResult } from './marketing-mapping.js';

export { htmlToMarkdown } from './html-to-markdown.js';
export type { HtmlConvertResult } from './html-to-markdown.js';

export { verifyWebhookSignature } from './webhook.js';

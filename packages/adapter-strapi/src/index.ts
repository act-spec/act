/**
 * @act-spec/adapter-strapi — PRD-205 leaf.
 *
 * Public API. Imports the PRD-200 framework contract from
 * `@act-spec/adapter-framework` (per ADR-005). Every public symbol cites a
 * PRD-205 requirement and is exercised by at least one test in
 * `strapi.test.ts`.
 */
export const STRAPI_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-strapi' as const;

export {
  STRAPI_ADAPTER_NAME,
  STRAPI_DEFAULT_CONCURRENCY,
  STRAPI_DEFAULT_DYNAMIC_ZONE_MAX,
  STRAPI_DEFAULT_POPULATE_DEPTH,
  RESERVED_METADATA_KEYS,
  corpusProvider,
  createStrapiAdapter,
  normalizeEntity,
  clampPopulateDepth,
  _resetConfigValidatorCacheForTest,
} from './strapi.js';

export type {
  CreateStrapiAdapterOpts,
  StrapiSourceProvider,
} from './strapi.js';

export { StrapiAdapterError } from './errors.js';
export type { StrapiAdapterErrorCode } from './errors.js';

export type {
  StrapiAdapterConfig,
  StrapiDynamicZoneEntry,
  StrapiEntity,
  StrapiGraphQLResponse,
  StrapiItem,
  StrapiListResponse,
  StrapiSourceCorpus,
  StrapiV4DataItem,
} from './types.js';

export { emitMarkdownBody, walkMarkdownSplit, type ContentBlock } from './markdown.js';
export { walkDynamicZone } from './dynamic-zone.js';
export { resolveRelations } from './relations.js';
export { verifyWebhookSignature } from './webhook.js';

/**
 * @act-spec/adapter-storyblok — PRD-204 leaf.
 *
 * Public API. Imports the PRD-200 framework contract from
 * `@act-spec/adapter-framework` (per ADR-005). Every public symbol cites a
 * PRD-204 requirement and is exercised by at least one test in
 * `storyblok.test.ts`.
 */
export const STORYBLOK_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-storyblok' as const;

export {
  STORYBLOK_ADAPTER_NAME,
  STORYBLOK_DEFAULT_CONCURRENCY,
  STORYBLOK_DEFAULT_COMPONENT_RECURSION_MAX,
  RESERVED_METADATA_KEYS,
  corpusProvider,
  createStoryblokAdapter,
  _resetConfigValidatorCacheForTest,
} from './storyblok.js';

export type {
  CreateStoryblokAdapterOpts,
  StoryblokSourceProvider,
} from './storyblok.js';

export { StoryblokAdapterError } from './errors.js';
export type { StoryblokAdapterErrorCode } from './errors.js';

export type {
  RichtextDoc,
  RichtextBlockNode,
  RichtextMark,
  RichtextNode,
  RichtextTextNode,
  StoryblokAdapterConfig,
  StoryblokBlokPayload,
  StoryblokContent,
  StoryblokItem,
  StoryblokLink,
  StoryblokSourceCorpus,
  StoryblokStory,
} from './types.js';

export { walkRichtext, type ContentBlock } from './richtext.js';
export { resolveStoryLinks, clampDepth } from './references.js';
export { verifyWebhookSignature } from './webhook.js';

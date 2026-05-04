/**
 * @act-spec/adapter-notion — Notion adapter for ACT (Agent Content Tree).
 *
 * Public surface:
 *   - `notionAdapter(opts?)` — factory returning an `Adapter<NotionItem>`.
 *   - `httpProvider`, `corpusProvider` — provider implementations behind
 *     the `NotionSourceProvider` interface.
 *   - `blocksToContent`, `extractLocale`, `transformDatabase`, `transformPage`
 *     — pure helpers exposed for advanced callers and consumers that want
 *     to wire the conversion stages independently.
 */
export const NOTION_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-notion' as const;

export {
  notionAdapter,
} from './notion.js';
export type { CreateNotionAdapterOpts } from './notion.js';

export {
  NOTION_ADAPTER_NAME,
  NOTION_DEFAULT_CONCURRENCY,
  deriveDatabaseId,
  derivePageId,
  normalize,
  transformDatabase,
  transformPage,
} from './mapper.js';

export {
  NOTION_API_BASE_URL,
  NOTION_API_VERSION,
  corpusProvider,
  httpProvider,
} from './client.js';
export type {
  FetchLike,
  HttpProviderOpts,
  NotionSourceCorpus,
  NotionSourceProvider,
} from './client.js';

export { extractLocale } from './locale.js';
export type { LocaleExtractOpts } from './locale.js';

export { blocksToContent, richTextPlain } from './blocks.js';
export type { ContentBlock, WalkResult } from './blocks.js';

export { NotionAdapterError } from './errors.js';
export type { NotionAdapterErrorCode } from './errors.js';

export type {
  NotionAccessToken,
  NotionAdapterConfig,
  NotionBlock,
  NotionDatabase,
  NotionItem,
  NotionPage,
  NotionPropertyValue,
  NotionRichText,
} from './types.js';

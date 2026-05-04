/**
 * @act-spec/adapter-markdown — PRD-201 markdown leaf.
 *
 * Public API. The PRD-200 adapter framework now lives in the dedicated
 * `@act-spec/adapter-framework` package (per ADR-005, extracted from this
 * package's pre-G2 `./framework.ts`). For backward compatibility — and to
 * satisfy ADR-005's stable-surface requirement — every framework symbol is
 * re-exported here unchanged. New consumers should import directly from
 * `@act-spec/adapter-framework`; the re-exports remain so existing
 * imports of `@act-spec/adapter-markdown` for framework symbols continue
 * to work.
 *
 * The PRD-201 leaf lives in `./markdown.ts`.
 */
export const MARKDOWN_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-markdown' as const;

// PRD-200 framework — re-exported from @act-spec/adapter-framework (ADR-005).
export type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  AdapterLogger,
  AdapterRunResult,
  AdapterSourceStamp,
  EmittedNode,
  IdResolution,
  MergeOptions,
  MergePolicy,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';
export {
  FRAMEWORK_CONFORMANCE_VERSION,
  bubbleManifestCapabilities,
  checkAdapterPinning,
  mergeContributions,
  mergeRuns,
  namespaceIds,
  resolveId,
  runAdapter,
  stampSource,
} from '@act-spec/adapter-framework';

// PRD-201 markdown leaf.
export type { MarkdownAdapterConfig, MarkdownItem, BlockEmission, ParsedFrontmatter } from './markdown.js';
export {
  ID_GRAMMAR,
  bodyToBlocks,
  createMarkdownAdapter,
  deriveDefaultId,
  deriveEtag,
  extractSummary,
  listFiles,
  parseFrontmatter,
  parseTomlSubset,
  stripEtag,
  transformOne,
  truncateSummary,
  validateId,
} from './markdown.js';

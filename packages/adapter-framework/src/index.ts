/**
 * @act-spec/adapter-framework — PRD-200 adapter framework.
 *
 * Extracted from `@act-spec/adapter-markdown` per ADR-005 (trigger:
 * ADR-004 §"Recommendations for Phase 6.2 fan-out" item 1). Every
 * first-party adapter (PRD-201 markdown, PRD-208 programmatic, PRD-202
 * Contentful, PRD-203 Sanity, …) imports types and helpers from here.
 *
 * Public surface: types + lifecycle + multi-source merge + manifest
 * capability bubbling + adapter pinning. The PRD-201 leaf
 * (`@act-spec/adapter-markdown`) re-exports this module for backward
 * compatibility with consumers that imported framework symbols from the
 * markdown adapter pre-extraction.
 */
export const ADAPTER_FRAMEWORK_PACKAGE_NAME = '@act-spec/adapter-framework' as const;

// PRD-200 framework — types + lifecycle + multi-source merge.
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
} from './framework.js';
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
} from './framework.js';

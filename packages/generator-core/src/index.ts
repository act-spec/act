/**
 * @act-spec/generator-core — PRD-400 generator framework.
 *
 * Extracted from `@act-spec/plugin-astro` per ADR-006 (trigger: ADR-004 §"Seam 2"
 * + Phase 6.2 Track B beginning with PRD-404 Docusaurus). Every first-party
 * generator (PRD-401 Astro, PRD-404 Docusaurus, PRD-405 Next.js, PRD-406
 * Remix, PRD-407 Nuxt, PRD-408 Eleventy, PRD-409 CLI) imports the pipeline,
 * envelope builders, and capability/pinning helpers from here.
 *
 * Public surface: pipeline orchestration, manifest/index/subtree builders,
 * etag derivation, target-level + adapter-pinning enforcement, file
 * emission + atomic write, capability backing verification, build report
 * shape. The PRD-401 leaf (`@act-spec/plugin-astro`) re-exports this module for
 * backward compatibility with consumers that imported framework symbols
 * from the astro generator pre-extraction.
 */
export const GENERATOR_CORE_PACKAGE_NAME = '@act-spec/generator-core' as const;

// PRD-400 framework — types.
export type {
  BuildContext,
  BuildReport,
  GeneratorConfig,
  GeneratorPlugin,
  PipelineOutcome,
  PipelineRun,
} from './pipeline.js';

// PRD-400 framework — values.
export {
  PIPELINE_FRAMEWORK_VERSION,
  VERSIONED_TREES_SUPPORTED,
  atomicWrite,
  buildIndex,
  buildManifest,
  buildSubtree,
  cleanupTmp,
  computeEtag,
  emitFiles,
  enforceAdapterPinning,
  enforceTargetLevel,
  inferAchievedLevel,
  runPipeline,
  verifyCapabilityBacking,
} from './pipeline.js';

// v0.2 §3.4 / §3.5 — `/llms.txt` + `/llms-full.txt` back-compat emitters.
export { emitLlmsTxt } from './emitters/llms-txt.js';
export type { EmitLlmsTxtOptions } from './emitters/llms-txt.js';
export {
  DEFAULT_LLMS_FULL_MAX_BYTES,
  emitLlmsFullTxt,
  nodeFetcherFromArray,
  renderBlockToMarkdown,
} from './emitters/llms-full-txt.js';
export type {
  EmitLlmsFullTxtOptions,
  NodeFetcher,
} from './emitters/llms-full-txt.js';

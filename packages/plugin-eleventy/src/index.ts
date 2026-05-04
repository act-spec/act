/**
 * @act-spec/plugin-eleventy — PRD-408 Eleventy plugin leaf.
 *
 * Public API. Per ADR-006, the PRD-400 generator framework lives in
 * `@act-spec/generator-core`; this leaf imports framework symbols from
 * there. PRD-201's markdown adapter is consumed unchanged from
 * `@act-spec/adapter-markdown` (no adapter logic is duplicated here per
 * the "generator overreach" anti-pattern).
 *
 * Default export: a function with the Eleventy plugin signature
 * `(eleventyConfig, options) => void`. Hosts wire it via:
 *
 * ```js
 * // .eleventy.js / eleventy.config.mjs
 * import actPlugin from "@act-spec/plugin-eleventy";
 * export default function (eleventyConfig) {
 *   eleventyConfig.addPlugin(actPlugin, {
 *     baseUrl: "https://example.com",
 *     manifest: { site: { name: "Example" } },
 *     urlTemplates: { indexUrl: "/act/index.json", nodeUrlTemplate: "/act/n/{id}.json" },
 *   });
 *   return { dir: { input: ".", output: "_site" } };
 * }
 * ```
 */

// PRD-408 leaf surface — types.
export type {
  EleventyActOptions,
  EleventyAfterPayload,
  EleventyConfigLike,
  EleventyEventCallback,
  EleventyPluginState,
  EleventyResultEntry,
} from './types.js';

// PRD-408 leaf surface — values.
export {
  ELEVENTY_PACKAGE_NAME,
  ELEVENTY_PACKAGE_VERSION,
  actEleventyPlugin,
  detectAchievedBand,
  enforceEleventyVersion,
  isEleventyVersionSupported,
  makePermalinkFilter,
  permalinkFilteredWarnings,
  publishedSourcePaths,
  readEleventyIgnore,
  resolveBuildReportPath,
  resolveConfig,
  resolveOutputDir,
  runActBuild,
  validateOptions,
  writeBuildReport,
} from './plugin.js';

export { default } from './plugin.js';

// Re-exports from @act-spec/generator-core for ergonomics — leaf
// consumers (the PRD-408 conformance gate, future PRD-707 Eleventy blog
// example) can import the pipeline framework alongside the leaf without
// a separate dependency line.
export type {
  BuildContext,
  BuildReport,
  GeneratorConfig,
  GeneratorPlugin,
  PipelineOutcome,
  PipelineRun,
} from '@act-spec/generator-core';

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
} from '@act-spec/generator-core';

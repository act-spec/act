/**
 * @act-spec/plugin-nuxt — PRD-407 Nuxt module leaf.
 *
 * Public API. Per ADR-006, the PRD-400 generator framework lives in
 * `@act-spec/generator-core`; this leaf imports framework symbols from
 * there and re-exports the leaf-specific surface.
 *
 * Operators consume the integration from `nuxt.config.ts`:
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ["@act-spec/plugin-nuxt"],
 *   act: {
 *     conformanceTarget: "core",
 *     manifest: { siteName: "Acme" },
 *     urlTemplates: {
 *       indexUrl: "/act/index.json",
 *       nodeUrlTemplate: "/act/nodes/{id}.json",
 *     },
 *   },
 * });
 * ```
 */

// PRD-407-R1 — leaf exports.
export type {
  ActNuxtModule,
  ActNuxtOptions,
  NuxtI18nLike,
  NuxtLike,
  NuxtLikeLogger,
  NuxtLikeOptions,
  NuxtModuleState,
  NuxtRouteLike,
  ResolvedI18n,
} from './integration.js';

export {
  NUXT_DEFAULT_BINDING,
  NUXT_PACKAGE_NAME,
  NUXT_PACKAGE_VERSION,
  applyRouteFilter,
  defineActModule,
  detectAchievedBand,
  detectContent,
  detectI18n,
  isGenerateMode,
  isNuxtVersionSupported,
  resolveBuildReportPath,
  resolveConfig,
  resolveOutputDir,
  runActBuild,
  validateOptions,
  writeBuildReport,
} from './integration.js';

export { default } from './integration.js';

// Re-exports from @act-spec/generator-core for ergonomics — leaf consumers
// (the PRD-407 conformance gate, future Vue-flavored 700-series example)
// can import the pipeline framework alongside the leaf without a separate
// dependency line.
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

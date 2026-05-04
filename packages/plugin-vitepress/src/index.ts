/**
 * @act-spec/plugin-vitepress — public API.
 *
 * VitePress plugin that wraps the ACT generator pipeline
 * (`@act-spec/generator-core`) against VitePress 1.x / 2.x via the
 * `transformPageData` (per-page) and `buildEnd` (final emit) hooks. The
 * markdown adapter (`@act-spec/adapter-markdown`) is consumed unchanged.
 *
 * Usage:
 *
 *   import { defineConfig } from 'vitepress';
 *   import { actPlugin } from '@act-spec/plugin-vitepress';
 *
 *   const act = actPlugin({
 *     baseUrl: 'https://example.com',
 *     manifest: { site: { name: 'Example Docs' } },
 *     urlTemplates: {
 *       indexUrl: '/act/index.json',
 *       nodeUrlTemplate: '/act/n/{id}.json',
 *     },
 *   });
 *
 *   export default defineConfig({
 *     title: 'Example Docs',
 *     transformPageData: act.transformPageData,
 *     buildEnd: act.buildEnd,
 *   });
 */

// Plugin surface — types.
export type {
  ActVitePressPlugin,
  ActVitePressPluginState,
  VitePressActOptions,
  VitePressBuildEndHook,
  VitePressLocaleEntry,
  VitePressPageData,
  VitePressSiteConfig,
  VitePressTransformPageDataHook,
} from './types.js';
export type { AccumulatedPages } from './plugin.js';

// Plugin surface — values.
export {
  VITEPRESS_PACKAGE_NAME,
  VITEPRESS_PACKAGE_VERSION,
  actPlugin,
  detectAchievedBand,
  extractLocales,
  resolveConfig,
  resolveOutputDir,
  resolveSourceDir,
  runActBuild,
  validateOptions,
} from './plugin.js';

export { default } from './plugin.js';

// Re-exports from `@act-spec/generator-core` for ergonomics — leaf
// consumers (test harnesses, conformance gates, downstream tooling) can
// import the pipeline framework alongside the leaf without a separate
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

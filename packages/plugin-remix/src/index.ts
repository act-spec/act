/**
 * @act-spec/plugin-remix — PRD-406 Remix-Vite static-export generator leaf.
 *
 * Public API. Per ADR-006, the PRD-400 generator framework lives in
 * `@act-spec/generator-core`; this leaf imports framework symbols from
 * there and re-exports the leaf-specific surface.
 *
 * Operators consume the integration from `vite.config.ts` alongside
 * Remix's `vitePlugin`:
 *
 * ```ts
 * import { vitePlugin as remix } from '@remix-run/dev';
 * import { act } from '@act-spec/plugin-remix';
 * import { defineConfig } from 'vite';
 *
 * export default defineConfig({
 *   plugins: [
 *     remix({ ... }),
 *     act({ conformanceTarget: 'standard' }),
 *   ],
 * });
 * ```
 */

// PRD-406-R1 — leaf exports.
export type {
  ActRemixOptions,
  ActVitePlugin,
  RemixLikeLogger,
  RemixLikeOptions,
  RemixVitePluginLike,
  RouteActExport,
  ViteLikeResolvedConfig,
  VitePluginLike,
} from './integration.js';

export {
  REMIX_STATIC_PACKAGE_NAME,
  REMIX_STATIC_PACKAGE_VERSION,
  REMIX_STATIC_PLUGIN_NAME,
  act,
  detectAchievedBand,
  detectsPrerenderConfig,
  findRemixPlugin,
  isClientBuild,
  isRemixVersionSupported,
  isViteVersionSupported,
  readRemixPluginOptions,
  readRouteActExport,
  resolveBuildReportPath,
  resolveConfig,
  runActBuild,
  writeBuildReport,
} from './integration.js';

export { default } from './integration.js';

// Re-exports from @act-spec/generator-core for ergonomics — leaf consumers
// (conformance gates, downstream test harnesses) can import the pipeline
// framework alongside the leaf without a separate dependency line.
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

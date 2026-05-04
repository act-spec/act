/**
 * @act-spec/plugin-nextjs — PRD-405 Next.js static-export generator leaf.
 *
 * Public API. Per ADR-006, the PRD-400 generator framework lives in
 * `@act-spec/generator-core`; this leaf imports framework symbols from
 * there and re-exports the leaf-specific surface.
 *
 * Operators consume the integration from `next.config.js`:
 *
 * ```js
 * const { withAct } = require('@act-spec/plugin-nextjs');
 * module.exports = withAct({ output: 'export' }, { conformanceTarget: 'core' });
 * ```
 */

// PRD-405-R1 — leaf exports.
export type {
  ActNextOptions,
  ActWebpackPluginOptions,
  NextLikeConfig,
  NextLikeLogger,
  PageActExport,
  ResolvedI18n,
  WebpackInvocationCtx,
  WebpackLikeConfig,
  WithActResult,
} from './integration.js';

export {
  ActWebpackPostBuildPlugin,
  NEXTJS_STATIC_PACKAGE_NAME,
  NEXTJS_STATIC_PACKAGE_VERSION,
  detectAchievedBand,
  detectsReactRoutes,
  isNextVersionSupported,
  isOutputExport,
  readPageActExport,
  resolveBuildReportPath,
  resolveConfig,
  resolveI18n,
  runActBuild,
  waitForExportMarker,
  withAct,
  writeBuildReport,
} from './integration.js';

export { default } from './integration.js';

// Re-exports from @act-spec/generator-core for ergonomics — leaf consumers
// (PRD-702 corporate marketing example, conformance gates) can import the
// pipeline framework alongside the leaf without a separate dependency line.
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

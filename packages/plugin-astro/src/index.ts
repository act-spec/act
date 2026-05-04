/**
 * @act-spec/plugin-astro — PRD-401 Astro generator leaf.
 *
 * Public API. The PRD-400 generator framework now lives in the dedicated
 * `@act-spec/generator-core` package (per ADR-006, extracted from this
 * package's pre-Track-B `./pipeline.ts`). For backward compatibility — and
 * to satisfy ADR-006's stable-surface requirement — every framework symbol
 * is re-exported here unchanged. New consumers (PRD-404 Docusaurus,
 * PRD-405 Next.js, PRD-406 Remix, PRD-407 Nuxt, PRD-408 Eleventy, PRD-409
 * CLI) should import directly from `@act-spec/generator-core`; the
 * re-exports remain so existing imports of `@act-spec/plugin-astro` for framework
 * symbols continue to work.
 *
 * The PRD-401 leaf lives in `./integration.ts`.
 */
export const ASTRO_PACKAGE_NAME = '@act-spec/plugin-astro' as const;

// PRD-400 framework — re-exported from @act-spec/generator-core (ADR-006).
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

// PRD-401 leaf exports.
export type { ActAstroOptions, ActIntegration, RouteActExport } from './integration.js';
export {
  actIntegration,
  debounce,
  detectAchievedBand,
  detectsReactIslands,
  isAstroVersionSupported,
  isOutputEligibleForStatic,
  readRouteActExport,
  resolveConfig,
  runActBuild,
} from './integration.js';
export { default } from './integration.js';

/**
 * @act-spec/cli — PRD-409 standalone CLI for ACT v0.1.
 *
 * Public surface:
 *   - `runBuild(config, opts)`     — programmatic build (PRD-409-R16).
 *   - `watchBuild(config, opts)`   — programmatic watch (PRD-409-R6).
 *   - `initProject(template, dir)` — programmatic scaffolder (PRD-409-R8).
 *   - `defineConfig(config)`       — identity helper for `act.config.ts`.
 *   - `runCli(argv, sink)`         — argv-driven dispatch; the `bin` shim
 *      delegates here.
 *   - `loadConfig(cwd)`            — config-file resolution (PRD-409-R5).
 *
 * The package re-exports framework symbols from `@act-spec/generator-core`
 * (`GeneratorConfig`, `BuildReport`) so operators can import everything they
 * need from a single package — matching the inspector's and validator's
 * one-stop-shop posture.
 */
export const CLI_PACKAGE_NAME = '@act-spec/cli' as const;

export { ACT_VERSION, CLI_VERSION } from './version.js';

// PRD-409-R5 / R17 — config helpers.
export {
  CONFIG_SEARCH_ORDER,
  HOST_FRAMEWORK_FIELD_TO_PRD,
  applyProfileOverride,
  defineConfig,
  detectHostFrameworkFields,
  findConfigPath,
  loadConfig,
  probeTsLoader,
  type LoadedConfig,
  type ProfileShorthand,
} from './config.js';

// PRD-409-R11 — output-dir conflict detection.
export { detectOutputConflicts, formatConflict, type OutputConflict } from './conflicts.js';

// PRD-409-R10 — duration parser (exposed for tests + advanced library use).
export { parseDuration } from './duration.js';

// PRD-409-R8 — `actree init` programmatic API.
export { initProject, type InitOptions } from './init.js';
export { getTemplateFiles, isInitTemplate, type InitTemplate, type TemplateFile } from './templates.js';

// §5.2.6 / §6.40 — `actree flatten` programmatic API.
export {
  flattenSite,
  formatLlmsFull,
  runFlatten,
  type FlattenOptions,
  type FlattenSiteOptions,
} from './flatten.js';

// PRD-409-R9 — logger.
export {
  createLogger,
  selectLoggerMode,
  type CliLogger,
  type LoggerMode,
  type LoggerSink,
} from './logger.js';

// PRD-409-R4 / R12 / R16 — programmatic build.
export {
  BuildTimeoutError,
  isReportInsideOutputDir,
  runBuild,
  type RunBuildOptions,
} from './run-build.js';

// PRD-409-R6 — programmatic watch.
export {
  collectWatchPaths,
  watchBuild,
  type WatchHandle,
  type WatchOptions,
} from './watch.js';

// PRD-409-R1 / R2 — argv-driven CLI dispatch.
export { runCli, type CliOptions } from './cli.js';

// PRD-400-R31 / R27 — re-export the framework's primary types so consumers
// don't need a second package import for `GeneratorConfig` / `BuildReport`.
export type { BuildReport, GeneratorConfig } from '@act-spec/generator-core';

/**
 * PRD-408 Eleventy plugin — entry point. Implements the Eleventy plugin
 * lifecycle (`addPlugin` / `eleventy.after`) and delegates pipeline
 * execution to `@act-spec/generator-core`.
 *
 * Library choices (ADR-006):
 *   - The PRD-400 framework is consumed from `@act-spec/generator-core`,
 *     not re-implemented locally. PRD-201's markdown adapter is consumed
 *     from `@act-spec/adapter-markdown`. No adapter logic is duplicated
 *     here — the plugin is pure glue between Eleventy's lifecycle and
 *     generator-core's pipeline (avoiding the "generator overreach"
 *     anti-pattern).
 *   - `@11ty/eleventy` is an OPTIONAL peer dependency; the plugin is
 *     structurally typed against the slice declared in `./types.ts` so
 *     the package builds and tests without Eleventy installed (matches
 *     the `@act-spec/plugin-docusaurus` and `@act-spec/plugin-nuxt` posture).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

import {
  cleanupTmp,
  emitFiles,
  inferAchievedLevel,
  runPipeline,
  verifyCapabilityBacking,
  type BuildReport,
  type GeneratorConfig,
} from '@act-spec/generator-core';

import type {
  EleventyActOptions,
  EleventyAfterPayload,
  EleventyConfigLike,
  EleventyEventCallback,
  EleventyPluginState,
  EleventyResultEntry,
} from './types.js';

const PACKAGE_NAME = '@act-spec/plugin-eleventy' as const;
const PACKAGE_VERSION = '0.0.0' as const;
const ELEVENTY_PEER_FLOOR = 2 as const;
const BUILD_REPORT_BASENAME = '.act-build-report.json' as const;

interface ResolvedRuntime {
  /** Translated GeneratorConfig (includes filtered adapters). */
  config: GeneratorConfig;
  /** Where to write the build report sidecar. */
  buildReportPath: string;
  /** Project root (Eleventy's input dir resolved to absolute). */
  projectRoot: string;
  /** Aggregated warnings raised during option translation (e.g., level downgrade). */
  preflightWarnings: string[];
}

/* v8 ignore start */
function defaultLogger(): {
  debug: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
} {
  return {
    debug: (m: string) => console.warn(`act-eleventy debug: ${m}`),
    info: (m: string) => console.warn(`act-eleventy: ${m}`),
    warn: (m: string) => console.warn(`act-eleventy warn: ${m}`),
    error: (m: string) => console.error(`act-eleventy error: ${m}`),
  };
}
/* v8 ignore stop */

/**
 * PRD-408-R2 — Eleventy 2.0+ floor probe. Returns true when the host
 * Eleventy instance exposes the `versionCheck` API; false otherwise.
 *
 * Eleventy 2.0+ exposes `eleventyConfig.versionCheck`. The probe is the
 * documented detection path per the PRD's R2 implementation note.
 * Exported so tests + the conformance gate can drive the check directly.
 */
export function isEleventyVersionSupported(eleventyConfig: EleventyConfigLike): boolean {
  if (typeof eleventyConfig.versionCheck !== 'function') {
    return false;
  }
  try {
    eleventyConfig.versionCheck(`>=${ELEVENTY_PEER_FLOOR}.0.0`);
    return true;
  } catch {
    return false;
  }
}

/**
 * PRD-408-R2 — enforce Eleventy 2.0+ at plugin-load time. Throws a
 * configuration error citing R2 when the host's Eleventy is < 2.0
 * (detected by the absence of `versionCheck` or by a thrown range check).
 */
export function enforceEleventyVersion(eleventyConfig: EleventyConfigLike): void {
  if (typeof eleventyConfig.versionCheck !== 'function') {
    throw new Error(
      `PRD-408-R2: @act-spec/plugin-eleventy requires Eleventy ${ELEVENTY_PEER_FLOOR}.0+. ` +
        `Detected an older Eleventy (no \`versionCheck\` API).`,
    );
  }
  try {
    eleventyConfig.versionCheck(`>=${ELEVENTY_PEER_FLOOR}.0.0`);
  } catch (err) {
    throw new Error(
      `PRD-408-R2: @act-spec/plugin-eleventy requires Eleventy ${ELEVENTY_PEER_FLOOR}.0+. ` +
        `Detected: ${(err as Error).message}`,
    );
  }
}

/**
 * PRD-408-R4 / R10 / R12 / R13 — validate plugin options at plugin-load
 * time (before any build hook fires). Throws a configuration error citing
 * the failing requirement.
 */
export function validateOptions(options: unknown): EleventyActOptions {
  if (options === undefined || options === null || typeof options !== 'object') {
    throw new Error(`PRD-408-R4: plugin options must be an object; got ${typeof options}`);
  }
  const opts = options as Record<string, unknown>;

  // PRD-408-R10 — `bindings` is a configuration error (Eleventy is
  // template-driven; component instrumentation is out of scope).
  if ('bindings' in opts) {
    throw new Error(
      'PRD-408-R10: @act-spec/plugin-eleventy does not support component bindings. ' +
        'Eleventy is template-driven; component instrumentation is out of scope. ' +
        'For component-driven workflows, see @act-spec/plugin-astro (PRD-401), ' +
        '@act-spec/plugin-nextjs (PRD-405), or @act-spec/plugin-nuxt (PRD-407).',
    );
  }
  if (typeof opts['baseUrl'] !== 'string' || opts['baseUrl'].length === 0) {
    throw new Error(`PRD-408-R4 / R12: 'baseUrl' is required and must be a non-empty string`);
  }
  const manifest = opts['manifest'];
  if (manifest === undefined || manifest === null || typeof manifest !== 'object') {
    throw new Error(`PRD-408-R4 / R12: 'manifest' is required and must be an object`);
  }
  const site = (manifest as Record<string, unknown>)['site'];
  if (site === undefined || site === null || typeof site !== 'object') {
    throw new Error(`PRD-408-R4 / R12: 'manifest.site' is required and must be an object`);
  }
  if (typeof (site as Record<string, unknown>)['name'] !== 'string') {
    throw new Error(`PRD-408-R4 / R12: 'manifest.site.name' is required and must be a string`);
  }
  const urlTemplates = opts['urlTemplates'];
  if (urlTemplates === undefined || urlTemplates === null || typeof urlTemplates !== 'object') {
    throw new Error(`PRD-408-R4 / R12: 'urlTemplates' is required and must be an object`);
  }
  // Conformance target is one of three strings when present.
  const conformanceTarget = opts['conformanceTarget'];
  if (
    conformanceTarget !== undefined &&
    conformanceTarget !== 'core' &&
    conformanceTarget !== 'standard' &&
    conformanceTarget !== 'strict'
  ) {
    throw new Error(
      `PRD-408-R4 / R12: invalid 'conformanceTarget' value ${JSON.stringify(conformanceTarget)}`,
    );
  }
  // parseMode is one of two strings when present (PRD-408-R12 / A10).
  const parseMode = opts['parseMode'];
  if (parseMode !== undefined && parseMode !== 'coarse' && parseMode !== 'fine') {
    throw new Error(
      `PRD-408-R4 / R12: invalid 'parseMode' value ${JSON.stringify(parseMode)} (expected "coarse" | "fine")`,
    );
  }
  return opts as unknown as EleventyActOptions;
}

/**
 * PRD-408-R13 — resolve the ACT output directory.
 *
 * Defaults to Eleventy's resolved `dir.output` (typically `_site/`).
 * Override via `act.outputDir`. An `outputDir` resolving outside the
 * project root is rejected per PRD-408-R13 / PRD-109.
 */
export function resolveOutputDir(
  eleventyConfig: EleventyConfigLike,
  payload: EleventyAfterPayload | undefined,
  projectRoot: string,
  override: string | undefined,
): string {
  const eleventyOut =
    payload?.dir.output ?? eleventyConfig.dir?.output ?? path.join(projectRoot, '_site');
  const candidate = override ?? eleventyOut;
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(projectRoot, candidate);
  if (!isInsideRoot(absolute, projectRoot)) {
    throw new Error(
      `PRD-408-R13: outputDir '${absolute}' resolves outside project root '${projectRoot}'. ` +
        `Override act.outputDir to a path inside the project.`,
    );
  }
  return absolute;
}

function isInsideRoot(target: string, root: string): boolean {
  if (target === root) return true;
  const sep = path.sep;
  return target.startsWith(`${root}${sep}`);
}

/**
 * PRD-408-R6 — cross-reference adapter enumerate output against
 * Eleventy's `results` array, keyed on the source file's path. Returns
 * a Set of project-relative POSIX-style paths Eleventy actually
 * published.
 *
 * Eleventy's `inputPath` is documented as project-relative (e.g.,
 * `./posts/hello.md`) but real Eleventy 2.x sometimes hands back
 * absolute paths depending on the host's `dir.input` configuration. The
 * helper accepts either: when a `projectRoot` is supplied, absolute
 * paths are relativised against it; the leading `./` is always stripped.
 */
export function publishedSourcePaths(
  results: readonly EleventyResultEntry[],
  projectRoot?: string,
): Set<string> {
  const out = new Set<string>();
  for (const r of results) {
    out.add(normaliseRelative(r.inputPath, projectRoot));
  }
  return out;
}

function normaliseRelative(p: string, projectRoot?: string): string {
  let s = p;
  if (projectRoot !== undefined && path.isAbsolute(s)) {
    s = path.relative(projectRoot, s);
  }
  s = s.replace(/^\.\//, '');
  // Always emit POSIX-style separators (the markdown adapter's glob
  // matcher walks paths as POSIX strings).
  return s.split(path.sep).join('/');
}

/**
 * PRD-408-R6 — given a set of published source paths (project-relative)
 * AND a project root, return a predicate that decides whether a given
 * adapter-emitted absolute source path should be retained.
 *
 * Filenames not present in the published set are excluded (they typically
 * had `permalink: false` or `eleventyExcludeFromCollections: true`).
 */
export function makePermalinkFilter(
  publishedRelative: ReadonlySet<string>,
  projectRoot: string,
): (absSourcePath: string) => boolean {
  const publishedAbs = new Set<string>();
  for (const rel of publishedRelative) {
    publishedAbs.add(path.resolve(projectRoot, rel));
  }
  return (abs: string): boolean => publishedAbs.has(path.resolve(abs));
}

/**
 * PRD-408-R3 — read `.eleventyignore` and surface its non-empty,
 * non-comment lines as glob exclusions. Missing file → empty list.
 *
 * Eleventy's ignore-file format is one path / glob per line; lines
 * starting with `#` are comments. The plugin threads the parsed list
 * into PRD-201's `exclude` config so the markdown adapter walks
 * everything Eleventy walks (minus ignored files).
 */
export async function readEleventyIgnore(projectRoot: string): Promise<string[]> {
  const ignorePath = path.join(projectRoot, '.eleventyignore');
  let raw: string;
  try {
    raw = await fs.readFile(ignorePath, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * PRD-408-R12 / R17 — translate `EleventyActOptions` into a fully-formed
 * `GeneratorConfig`.
 *
 * `parseMode` (per A10) is forwarded to every auto-wired markdown adapter
 * via `MarkdownAdapterConfig.mode`. `parseMode: "fine"` against
 * `conformanceTarget: "core"` is a hard error at this stage — the
 * plugin surfaces the underlying PRD-201-R23 level-mismatch verbatim
 * (matching the @act-spec/plugin-docusaurus / A2 pattern).
 *
 * Public so the conformance gate can build a config without going
 * through Eleventy's lifecycle.
 */
export function resolveConfig(args: {
  options: EleventyActOptions;
  projectRoot: string;
  outputDir: string;
  /**
   * Project-relative source paths Eleventy actually published. When
   * present, threaded into the auto-wired markdown adapter as `exclude`
   * patterns for any adapter source NOT in the set (PRD-408-R6).
   * Optional because `resolveConfig` is also called outside an
   * `eleventy.after` context (e.g., conformance gate, tests).
   */
  publishedRelative?: ReadonlySet<string> | undefined;
  /** PRD-408-R3 — additional adapter excludes from `.eleventyignore`. */
  ignorePatterns?: readonly string[];
}): { config: GeneratorConfig; preflightWarnings: string[] } {
  const { options, projectRoot, outputDir } = args;
  const target = options.conformanceTarget ?? 'core';
  const preflightWarnings: string[] = [];

  // PRD-408-R12 / A10 — parseMode pre-flight check before any adapter is
  // constructed. Mirrors @act-spec/plugin-docusaurus's A2 pattern: the error text
  // cites PRD-408-R12 and PRD-201-R23 verbatim.
  if (options.parseMode === 'fine' && target === 'core') {
    throw new Error(
      'PRD-408-R12 / PRD-201-R23: parseMode "fine" requires conformanceTarget >= "standard"; got "core"',
    );
  }

  // PRD-408-R3 — auto-wire PRD-201 against Eleventy's input dir.
  const sourceDir = projectRoot;
  const explicitAdapters = options.adapters;
  const ignorePatterns = args.ignorePatterns ?? [];

  // PRD-408-R6 — when we know the published-relative set, surface it as
  // additional adapter excludes for any source the auto-wired adapter
  // would otherwise enumerate. Implemented as glob excludes on every
  // adapter-walked path NOT in the published set, per the PRD's
  // "filter before merge" rule.
  const autoAdapter: GeneratorConfig['adapters'][number] = {
    adapter: createMarkdownAdapter(),
    config: {
      sourceDir,
      ...(ignorePatterns.length > 0 ? { exclude: [...ignorePatterns] } : {}),
      ...(options.parseMode !== undefined ? { mode: options.parseMode } : {}),
    },
    actVersion: '0.1',
  };

  const adapters = explicitAdapters ?? [autoAdapter];

  // PRD-408-R17 — Plus band requires a precomputed search artifact when
  // the host has not provided one. Without `searchArtifactPath`, the
  // plugin downgrades to Standard and surfaces a warning.
  let effectiveTarget = target;
  if (target === 'strict' && options.searchArtifactPath === undefined) {
    effectiveTarget = 'standard';
    preflightWarnings.push(
      'PRD-408-R17: conformanceTarget "strict" requested but no searchArtifactPath supplied; downgraded to "standard".',
    );
  }

  const cfg: GeneratorConfig = {
    conformanceTarget: effectiveTarget,
    outputDir,
    adapters,
    site: {
      name: options.manifest.site.name,
      ...(options.manifest.site.description !== undefined
        ? { description: options.manifest.site.description }
        : {}),
      ...(options.manifest.site.canonical_url !== undefined
        ? { canonical_url: options.manifest.site.canonical_url }
        : { canonical_url: options.baseUrl }),
    },
    urlTemplates: options.urlTemplates,
    failOnExtractionError: options.failOnExtractionError ?? false,
    incremental: options.incremental ?? false,
    generator: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
  };
  return { config: cfg, preflightWarnings };
}

/**
 * PRD-408-R6 — given a build report, surface a synthetic
 * `excluded_by_permalink` warning for each source enumerated by the
 * adapter but absent from Eleventy's `results`. The plugin filters those
 * sources from the adapter via the `exclude` glob, but for observability
 * the warning shape is documented in the PRD's example fixtures.
 *
 * This helper computes the warning text from the difference of two sets.
 */
export function permalinkFilteredWarnings(
  enumerated: readonly string[],
  published: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const src of enumerated) {
    if (!published.has(normaliseRelative(src))) {
      out.push(`PRD-408-R6: excluded_by_permalink: source '${src}' is absent from Eleventy results`);
    }
  }
  return out;
}

/**
 * PRD-408-R5 / R14 / R15 — programmatic build entry. Mirrors
 * `@act-spec/plugin-docusaurus`'s `runActBuild`: takes a fully-resolved
 * `GeneratorConfig` and runs the generator-core pipeline + emission +
 * capability backing + build-report sidecar. Used by the plugin's
 * `eleventy.after` hook AND by the conformance gate.
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  buildReportPath?: string;
  /** Pre-flight warnings (e.g., level downgrade) to merge into the report. */
  preflightWarnings?: readonly string[];
  hooks?: EleventyActOptions['hooks'];
  logger?: ReturnType<typeof defaultLogger>;
}): Promise<BuildReport> {
  const logger = opts.logger ?? defaultLogger();
  const startedAt = Date.now();
  const buildCtx = {
    outputDir: opts.config.outputDir,
    config: opts.config,
    logger,
  };
  try {
    if (opts.hooks?.preBuild) await opts.hooks.preBuild(buildCtx);
    const outcome = await runPipeline({ config: opts.config, logger });
    const report = await emitFiles({
      outcome,
      outputDir: opts.config.outputDir,
      config: opts.config,
      startedAt,
    });
    // PRD-408-R14 — capability backing inherited via verifyCapabilityBacking.
    verifyCapabilityBacking(outcome.capabilities, report.files);
    // PRD-408-R17 — surface pre-flight warnings (level-downgrade etc.) on
    // the report so observability tools can render them alongside the
    // pipeline-emitted warnings.
    if (opts.preflightWarnings && opts.preflightWarnings.length > 0) {
      report.warnings = [...opts.preflightWarnings, ...report.warnings];
    }
    // PRD-408-R15 — sidecar at the configured path.
    if (opts.buildReportPath !== undefined) {
      await writeBuildReport(opts.buildReportPath, report);
    }
    if (opts.hooks?.postBuild) await opts.hooks.postBuild(buildCtx, report);
    return report;
  } catch (err) {
    if (opts.hooks?.onError) await opts.hooks.onError(buildCtx, err);
    // PRD-408-R14 — clean up tmp files inside ACT-owned paths.
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/**
 * PRD-408-R15 — write the build report sidecar at the resolved path.
 * Default location is `<outputDir>/.act-build-report.json` per
 * resolveBuildReportPath; the plugin attempts to add the path to
 * Eleventy's ignore list so it doesn't ship to the CDN.
 */
export async function writeBuildReport(reportPath: string, report: BuildReport): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

/**
 * PRD-408-R15 — resolve the build report path. Default is
 * `<outputDir>/.act-build-report.json`. The plugin tries to add the
 * relative path to Eleventy's ignore list (best-effort); if the host's
 * Eleventy version lacks `ignores.add`, the warning is documented per
 * the PRD's R15 text.
 */
export function resolveBuildReportPath(outputDir: string): string {
  return path.join(outputDir, BUILD_REPORT_BASENAME);
}

/**
 * PRD-408-R17 — derive the achieved conformance band from observed
 * emissions. Wraps PRD-400-R17 `inferAchievedLevel`. Re-exported so
 * tests + the conformance gate don't have to reach into
 * `@act-spec/generator-core` directly.
 */
export function detectAchievedBand(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  return inferAchievedLevel(observed);
}

/**
 * PRD-408-R1 / R4 / R5 / R10 / R19 — public plugin factory.
 *
 * Returns a function with the Eleventy-plugin signature
 * `(eleventyConfig, options) => void`. Hosts call:
 *
 *   import actPlugin from "@act-spec/plugin-eleventy";
 *   eleventyConfig.addPlugin(actPlugin, { baseUrl, manifest, urlTemplates, … });
 *
 * The factory:
 *   1. Validates options (PRD-408-R4 / R10 / R12).
 *   2. Probes Eleventy 2.0+ floor (PRD-408-R2).
 *   3. Pre-flight resolves the GeneratorConfig (PRD-408-R12, A10 parseMode check).
 *   4. Subscribes to `eleventy.after` (PRD-408-R5) with a build-scoped
 *      re-entry guard (PRD-408-R5 / R19).
 *   5. Best-effort adds the build-report path to Eleventy's ignore list
 *      (PRD-408-R15).
 *
 * Returns the plugin state object via the `__act` marker for tests +
 * downstream tooling.
 */
export function actEleventyPlugin(
  eleventyConfig: EleventyConfigLike,
  options: EleventyActOptions,
): EleventyPluginState {
  // PRD-408-R4 / R10 / R12 — validate before any side effect.
  const validated = validateOptions(options);
  // PRD-408-R2 — Eleventy 2.0+ floor.
  enforceEleventyVersion(eleventyConfig);

  const projectRoot = path.resolve(eleventyConfig.dir?.input ?? '.');

  // PRD-408-R12 / A10 — pre-flight resolveConfig at registration time so
  // `parseMode` mismatches surface BEFORE Eleventy enters its build loop
  // (mirrors @act-spec/plugin-docusaurus's pre-flight pattern).
  const provisionalOutputDir = resolveOutputDir(
    eleventyConfig,
    undefined,
    projectRoot,
    validated.outputDir,
  );
  resolveConfig({
    options: validated,
    projectRoot,
    outputDir: provisionalOutputDir,
  });

  const state: EleventyPluginState = {
    inFlight: undefined,
    invocations: 0,
    lastBuildReportPath: undefined,
    lastWarnings: [],
  };

  const callback: EleventyEventCallback = async (payload: EleventyAfterPayload) => {
    state.invocations += 1;
    // PRD-408-R5 / R19 — re-entry guard.
    if (state.inFlight !== undefined) {
      await state.inFlight;
    }
    state.inFlight = (async () => {
      const runtime = await prepareRuntime(eleventyConfig, validated, projectRoot, payload);
      state.lastBuildReportPath = runtime.buildReportPath;
      const report = await runActBuild({
        config: runtime.config,
        buildReportPath: runtime.buildReportPath,
        preflightWarnings: runtime.preflightWarnings,
        ...(validated.hooks !== undefined ? { hooks: validated.hooks } : {}),
      });
      state.lastWarnings = report.warnings;
      return report;
    })();
    try {
      await state.inFlight;
    } finally {
      state.inFlight = undefined;
    }
  };
  eleventyConfig.on('eleventy.after', callback);

  // PRD-408-R15 — best-effort ignore-list integration. The relative path
  // is what Eleventy understands; older 2.0.x versions lack the API and
  // we silently no-op (the PRD's R15 text permits this).
  try {
    const reportRel = path.join(
      path.relative(projectRoot, provisionalOutputDir) || '.',
      BUILD_REPORT_BASENAME,
    );
    eleventyConfig.ignores?.add?.(reportRel);
  } catch {
    /* best-effort; older Eleventy 2.0.x lacks `ignores.add` */
  }

  return state;
}

/**
 * PRD-408-R6 / R12 / R13 — assemble the per-build runtime: re-resolve
 * the output dir against the live `payload.dir.output` (Eleventy's
 * resolved value at build time MAY differ from the value at plugin-load
 * if the host mutated config in between), thread the published-source
 * set into the adapter's `exclude` glob, and read `.eleventyignore`.
 *
 * Returns a fully-formed runtime ready for `runActBuild`.
 */
async function prepareRuntime(
  eleventyConfig: EleventyConfigLike,
  options: EleventyActOptions,
  projectRoot: string,
  payload: EleventyAfterPayload,
): Promise<ResolvedRuntime> {
  const outputDir = resolveOutputDir(eleventyConfig, payload, projectRoot, options.outputDir);
  const ignorePatterns = await readEleventyIgnore(projectRoot);
  const publishedRelative = publishedSourcePaths(payload.results, projectRoot);

  // PRD-408-R6 — for the auto-wired adapter (no `act.adapters` override),
  // thread an explicit include-list of the published source files into
  // the markdown adapter via the `include` glob. Each published file is
  // a relative path inside the project root; we transform to a glob
  // pattern matching exactly that file. This implements the "filter
  // before merge" rule by simply not enumerating non-published files in
  // the first place.
  const explicitAdapters = options.adapters;
  let perBuildAdapters = explicitAdapters;
  if (perBuildAdapters === undefined) {
    // Build the include list from the published-relative set. Each entry
    // is a glob pattern matching the file exactly (escaping minimatch
    // metacharacters by wrapping in [] for special chars is not needed
    // — published-source paths are real filenames the adapter walks
    // unmodified).
    const includeGlobs: string[] = [];
    for (const rel of publishedRelative) {
      // Only include `.md` / `.mdx` files (the markdown adapter's glob);
      // Eleventy `results` includes other output types we ignore.
      if (rel.endsWith('.md') || rel.endsWith('.mdx')) {
        includeGlobs.push(rel);
      }
    }
    perBuildAdapters = [
      {
        adapter: createMarkdownAdapter(),
        config: {
          sourceDir: projectRoot,
          ...(includeGlobs.length > 0 ? { include: includeGlobs } : {}),
          ...(ignorePatterns.length > 0 ? { exclude: [...ignorePatterns] } : {}),
          ...(options.parseMode !== undefined ? { mode: options.parseMode } : {}),
        },
        actVersion: '0.1',
      },
    ];
  }

  // Reuse resolveConfig for the level-downgrade + parseMode pre-flight
  // path, then swap the per-build adapter list in.
  const { config: baseConfig, preflightWarnings } = resolveConfig({
    options,
    projectRoot,
    outputDir,
    publishedRelative,
    ignorePatterns,
  });
  const config: GeneratorConfig = {
    ...baseConfig,
    adapters: perBuildAdapters,
  };

  // PRD-408-R6 — empty results triggers the `empty_build` warning per R16.
  if (payload.results.length === 0) {
    preflightWarnings.push(
      'PRD-408-R16: empty_build: eleventy.after fired with zero results; ACT manifest may be empty.',
    );
  }

  const buildReportPath = resolveBuildReportPath(outputDir);

  return {
    config,
    buildReportPath,
    projectRoot,
    preflightWarnings,
  };
}

/**
 * PRD-408-R1 — package surface markers.
 */
export const ELEVENTY_PACKAGE_NAME = PACKAGE_NAME;
export const ELEVENTY_PACKAGE_VERSION = PACKAGE_VERSION;

/** Default export per Eleventy plugin idiom. */
export default actEleventyPlugin;

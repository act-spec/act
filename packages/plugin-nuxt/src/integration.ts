/**
 * PRD-407 Nuxt module — wraps the PRD-400 pipeline against Nuxt 3+
 * static-export builds (`nuxt generate`).
 *
 * Library choices (per ADR-006 + PRD-407):
 *  - Framework imports come from `@act-spec/generator-core` (NOT from
 *    `@act-spec/plugin-astro` or `@act-spec/plugin-nextjs`); ADR-006 mandates
 *    the dedicated framework package for every leaf generator.
 *  - `nuxt`, `@nuxt/kit`, and `vue` are `peerDependencies` and are NOT
 *    imported at runtime here; the module's surface is structurally
 *    typed so it works in test contexts without Nuxt installed (matches
 *    the `@act-spec/plugin-astro` and `@act-spec/plugin-nextjs` posture).
 *  - The module factory `defineActModule` returns a duck-typed Nuxt-3
 *    module spec ({ meta, defaults, setup }) that Nuxt's `defineNuxtModule`
 *    accepts directly. The host wires it at `nuxt.config.ts`'s
 *    `modules: ["@act-spec/plugin-nuxt"]` array; the canonical pipeline runs
 *    at `build:done` per PRD-407-R5.
 *  - Adapters: PRD-201 (markdown) is auto-wired against the host's Nuxt
 *    Content directory by default per PRD-407-R7. The Vue binding
 *    (PRD-302 `vueBinding`) is the default extraction binding per R9.
 *  - `runActBuild` exposes the same programmatic entry point as the
 *    Next.js leaf so tests + the conformance gate can drive the pipeline
 *    without spinning a real `nuxt generate`.
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import { vueBinding } from '@act-spec/component-vue';

import {
  cleanupTmp,
  emitFiles,
  inferAchievedLevel,
  runPipeline,
  verifyCapabilityBacking,
  type BuildReport,
  type GeneratorConfig,
  type GeneratorPlugin,
} from '@act-spec/generator-core';

const PACKAGE_NAME = '@act-spec/plugin-nuxt' as const;
const PACKAGE_VERSION = '0.0.0' as const;

/** PRD-407-R13 — `ActNuxtOptions`. Strict subset of PRD-400-R31 GeneratorConfig. */
export interface ActNuxtOptions {
  /** PRD-407-R13 / R18. Default: 'core'. */
  conformanceTarget?: 'core' | 'standard' | 'strict';
  /** PRD-407-R14 / R13. Override Nitro's resolved publicDir (rare; tests use it). */
  outputDir?: string;
  /** PRD-407-R16 / R13. Default: '<projectRoot>/.act-build-report.json'. */
  buildReportPath?: string;
  /** PRD-407-R7 / R13. Markdown content roots. Default: `<projectRoot>/content`. */
  content?: { roots?: string[] };
  /** PRD-407-R7 / R13. When set, overrides auto-wiring of PRD-201. */
  adapters?: GeneratorConfig['adapters'];
  /** PRD-407-R9 / R13. When set, overrides auto-wiring of PRD-302 vueBinding. */
  bindings?: unknown[];
  /** PRD-407-R9 / R13. Default: 'ssr-walk'. */
  extractionMode?: 'ssr-walk' | 'static-ast';
  /** PRD-407-R10 / R13. Default: 'auto'. `false` opts out of auto-wiring even when @nuxtjs/i18n is configured. */
  i18n?: 'auto' | false | { pattern?: '1' | '2' };
  /** PRD-407-R8 / R13. Optional callback to exclude routes from extraction. */
  routeFilter?: (route: NuxtRouteLike) => boolean;
  /** PRD-407-R17 / R13. Default: false. */
  failOnExtractionError?: boolean;
  /** PRD-407-R13. */
  incremental?: boolean;
  /** PRD-407-R13. Site identity surfaced in the manifest. */
  manifest?: { siteName?: string };
  /** PRD-407-R13. URL templates passthrough. */
  urlTemplates?: GeneratorConfig['urlTemplates'];
  /** PRD-407-R4 / R13. Host hooks; run AFTER the module's own. */
  hooks?: GeneratorPlugin['hooks'];
}

/** Minimal logger surface used by the pipeline. */
export interface NuxtLikeLogger {
  debug?: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

/**
 * PRD-407-R3 — structural type for the Nuxt instance the module touches.
 * Not a runtime import of `nuxt`; matches the duck-typed surface real Nuxt
 * 3.x exposes on `nuxt.options` + `nuxt.hook` + `nuxt._version` + the
 * generate flag.
 */
export interface NuxtLike {
  _version?: string;
  options: NuxtLikeOptions;
  hook?: (event: string, callback: NuxtHookCallback) => void;
}

/**
 * Nuxt hook callback shape. Accepts arbitrary positional arguments and
 * may return a Promise (Nuxt awaits async hooks). Typed permissively so
 * the module's structural typing matches Nuxt-3's runtime hook surface
 * without pulling `nuxt` in as a runtime import.
 */
export type NuxtHookCallback = (...args: unknown[]) => unknown;

export interface NuxtLikeOptions {
  rootDir?: string;
  _generate?: boolean;
  nitro?: { output?: { publicDir?: string } };
  i18n?: NuxtI18nLike;
  modules?: unknown[];
  buildModules?: unknown[];
  // Other Nuxt config fields are passed through unchanged; the module
  // MUST NOT mutate them (PRD-407-R13).
  [key: string]: unknown;
}

/**
 * Subset of `@nuxtjs/i18n`'s `Options` that PRD-407-R10 reads. The
 * `strategy` field is typed as `string` so future Nuxt-i18n strategies
 * surface a clean PRD-407-R10 configuration error rather than a TS
 * compile error; the module's `detectI18n` switch maps the four
 * documented strategies and throws on every other value.
 */
export interface NuxtI18nLike {
  strategy?: string;
  locales?: Array<string | { code: string }>;
  defaultLocale?: string;
}

/** Nuxt page-route shape captured via `pages:extend` (PRD-407-R8). */
export interface NuxtRouteLike {
  /** Route id; matches Nuxt's resolved `path` field. */
  id: string;
  /** Filesystem path to the page SFC. */
  file: string;
  /** Parent route id (when present). */
  parent?: string;
}

/* ------------------------------------------------------------------------- */
/* Version + lifecycle probes                                                */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R2 — Nuxt 3+ floor probe. Accepts the runtime `nuxt._version`
 * string. Returns true when major >= 3 (and a documented forward-compatible
 * Nuxt 4.x slot is reserved). Returns false for Nuxt 2.x and unrecognised
 * version strings.
 */
export function isNuxtVersionSupported(version: string | undefined): boolean {
  if (typeof version !== 'string' || version.length === 0) return false;
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null) return false;
  const major = Number(m[1]);
  if (major === 3) return true;
  if (major === 4) return true;
  return false;
}

/**
 * PRD-407-R6 — `nuxt generate` detection. Returns true when the host build
 * is producing a static-export tree (`nuxt._generate === true` on Nuxt
 * 3.x). Returns false for `nuxt build` (server output).
 *
 * The check is on the `_generate` flag rather than the absence of
 * `.output/public/` because the directory may legitimately not exist yet
 * at the moment the hook fires (Nitro writes asynchronously). The flag is
 * the authoritative signal per PRD-407-R6.
 */
export function isGenerateMode(nuxt: NuxtLike): boolean {
  return nuxt.options._generate === true;
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R10 — Nuxt i18n strategy mapping                                  */
/* ------------------------------------------------------------------------- */

export interface ResolvedI18n {
  defaultLocale: string;
  locales: string[];
  pattern: '1' | '2';
}

/**
 * PRD-407-R10 — auto-detect `@nuxtjs/i18n` configuration and map its
 * `strategy` to a PRD-104 layout pattern. Returns `null` when i18n is
 * absent / disabled / single-locale; throws on an unmappable strategy.
 *
 * Mapping table (PRD-407-R10):
 *   prefix                  → Pattern 2 (per-locale manifests)
 *   prefix_except_default   → Pattern 2
 *   prefix_and_default      → Pattern 2
 *   no_prefix               → Pattern 1 (locale-prefixed IDs)
 *   <other>                 → throw configuration error
 */
export function detectI18n(
  nuxt: NuxtLike,
  override?: ActNuxtOptions['i18n'],
): ResolvedI18n | null {
  if (override === false) return null;
  const i18n = nuxt.options.i18n;
  if (i18n === undefined || i18n === null) return null;
  const localesRaw = i18n.locales ?? [];
  if (localesRaw.length === 0) return null;
  const locales = localesRaw.map((l) => (typeof l === 'string' ? l : l.code));
  if (locales.length <= 1) return null;
  // locales.length > 1 verified above, so locales[0] is always defined.
  const firstLocale = locales[0] ?? '';
  const defaultLocale = i18n.defaultLocale ?? firstLocale;

  // Override pattern explicitly when caller passes { pattern }.
  if (typeof override === 'object' && override !== null && override.pattern !== undefined) {
    return { defaultLocale, locales, pattern: override.pattern };
  }

  const strategy = i18n.strategy ?? 'prefix';
  let pattern: '1' | '2';
  switch (strategy) {
    case 'prefix':
    case 'prefix_except_default':
    case 'prefix_and_default':
      pattern = '2';
      break;
    case 'no_prefix':
      pattern = '1';
      break;
    default:
      throw new Error(
        `PRD-407-R10: @nuxtjs/i18n strategy '${strategy}' is not mappable to a PRD-104 layout pattern. ` +
          `Supported: prefix, prefix_except_default, prefix_and_default, no_prefix.`,
      );
  }
  return { defaultLocale, locales, pattern };
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R7 — Nuxt Content auto-wiring                                     */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R7 — detect `@nuxt/content` in the host's modules + buildModules
 * arrays. Returns the resolved content directory when detected; returns
 * `null` otherwise (the host then configures adapters explicitly).
 */
export function detectContent(nuxt: NuxtLike): { contentDir: string } | null {
  const inModuleList = (entry: unknown): boolean => {
    if (typeof entry === 'string') return entry === '@nuxt/content';
    if (Array.isArray(entry) && typeof entry[0] === 'string') {
      return entry[0] === '@nuxt/content';
    }
    return false;
  };
  const found =
    (nuxt.options.modules ?? []).some(inModuleList) ||
    (nuxt.options.buildModules ?? []).some(inModuleList);
  if (!found) return null;
  const root = nuxt.options.rootDir ?? process.cwd();
  // Nuxt Content's default content dir is `content/` under the project root.
  return { contentDir: path.join(root, 'content') };
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R14 — output dir resolution                                       */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R14 — resolve Nitro's static-export public directory, with an
 * explicit `act.outputDir` override. The default is `<rootDir>/.output/public`
 * for default Nuxt 3.x configurations; non-default Nitro `output.publicDir`
 * overrides are honored. An `outputDir` resolving outside the project root
 * is rejected per PRD-407-R14 / PRD-109.
 */
export function resolveOutputDir(nuxt: NuxtLike, override?: string): string {
  const root = path.resolve(nuxt.options.rootDir ?? process.cwd());
  const configured =
    override ?? nuxt.options.nitro?.output?.publicDir ?? path.join(root, '.output', 'public');
  const absolute = path.resolve(configured);
  if (!isInsideRoot(absolute, root)) {
    throw new Error(
      `PRD-407-R14: outputDir '${absolute}' resolves outside project root '${root}'. ` +
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

/* ------------------------------------------------------------------------- */
/* PRD-407-R3 — module options validation                                    */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R3 — validate `act` options at module-setup time, before any
 * build hook fires. Throws with PRD-407-R3 citation on shape violations.
 * Returns the input unchanged on success (callers can use the return value
 * for chaining).
 */
export function validateOptions(options: ActNuxtOptions | undefined | null): ActNuxtOptions {
  if (options === undefined || options === null || typeof options !== 'object') {
    throw new Error(`PRD-407-R3: 'act' options must be an object; got ${typeof options}`);
  }
  if (
    options.conformanceTarget !== undefined &&
    options.conformanceTarget !== 'core' &&
    options.conformanceTarget !== 'standard' &&
    options.conformanceTarget !== 'strict'
  ) {
    throw new Error(
      `PRD-407-R3: invalid 'act.conformanceTarget' value '${String(options.conformanceTarget)}'`,
    );
  }
  if (
    options.extractionMode !== undefined &&
    options.extractionMode !== 'ssr-walk' &&
    options.extractionMode !== 'static-ast'
  ) {
    throw new Error(
      `PRD-407-R3: invalid 'act.extractionMode' value '${String(options.extractionMode)}'`,
    );
  }
  if (
    options.manifest !== undefined &&
    (typeof options.manifest !== 'object' || options.manifest === null)
  ) {
    throw new Error(`PRD-407-R3: 'act.manifest' must be an object`);
  }
  if (options.routeFilter !== undefined && typeof options.routeFilter !== 'function') {
    throw new Error(`PRD-407-R3: 'act.routeFilter' must be a function`);
  }
  return options;
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R8 — route enumeration                                            */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R8 — apply the host's optional `routeFilter` to a captured route
 * list. Returns the routes the binding-extraction stage should walk.
 * Routes ineligible for component extraction (no contract) are still
 * returned; the binding skips them per PRD-302-R10.
 */
export function applyRouteFilter(
  routes: NuxtRouteLike[],
  routeFilter: ActNuxtOptions['routeFilter'] | undefined,
): NuxtRouteLike[] {
  if (routeFilter === undefined) return [...routes];
  return routes.filter((r) => routeFilter(r));
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R18 — conformance band wrapper                                    */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R18 — wraps PRD-400-R17 inferAchievedLevel with the Nuxt-side
 * defaults. Re-exported for tests + the conformance gate so they don't
 * have to reach into `@act-spec/generator-core` directly.
 */
export function detectAchievedBand(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  return inferAchievedLevel(observed);
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R16 — build report sidecar                                        */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R16 — write the build report sidecar at the configured path.
 * Default is `<projectRoot>/.act-build-report.json`; overrides into the
 * static-export tree produce a warning per `resolveBuildReportPath`.
 */
export async function writeBuildReport(reportPath: string, report: BuildReport): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

/**
 * PRD-407-R16 — resolve the build report path. When the operator points
 * the path inside the static-export tree, returns the path AND a warning
 * string (the report would otherwise ship to the CDN per PRD-400-R27).
 */
export function resolveBuildReportPath(
  options: ActNuxtOptions,
  outputDir: string,
  projectRoot: string,
): { path: string; warning?: string } {
  const configured = options.buildReportPath ?? path.join(projectRoot, '.act-build-report.json');
  const normalizedOut = path.resolve(outputDir);
  const normalizedReport = path.resolve(configured);
  if (
    normalizedReport === normalizedOut ||
    normalizedReport.startsWith(`${normalizedOut}${path.sep}`)
  ) {
    return {
      path: configured,
      warning: `PRD-407-R16: buildReportPath "${configured}" resolves inside output dir; the report will ship to the CDN.`,
    };
  }
  return { path: configured };
}

/* ------------------------------------------------------------------------- */
/* PRD-407-R13 — config translation                                          */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R13 — translate `ActNuxtOptions` into a fully-resolved
 * `GeneratorConfig`. PRD-407-R7 / R9 — adapters and bindings auto-wire
 * unless overridden. Public so the conformance gate can build a config
 * without going through Nuxt's lifecycle.
 */
export function resolveConfig(
  nuxt: NuxtLike,
  options: ActNuxtOptions,
  fallbackOutDir: string,
): GeneratorConfig {
  const level = options.conformanceTarget ?? 'core';
  const projectRoot = path.resolve(nuxt.options.rootDir ?? process.cwd());
  const contentDirRoots = options.content?.roots;
  const contentInfo = detectContent(nuxt);
  // Auto-wire markdown when a content dir is detected OR the operator
  // supplied explicit content roots (the markdown adapter walks one
  // directory; we use the first root when supplied).
  const sourceDir =
    contentDirRoots !== undefined && contentDirRoots.length > 0
      ? path.resolve(projectRoot, contentDirRoots[0] as string)
      : (contentInfo?.contentDir ?? path.join(projectRoot, 'content'));
  const adapters =
    options.adapters ??
    [
      {
        adapter: createMarkdownAdapter(),
        config: { sourceDir },
        actVersion: '0.1',
      },
    ];
  const cfg: GeneratorConfig = {
    conformanceTarget: level,
    outputDir: options.outputDir ?? fallbackOutDir,
    adapters,
    site: { name: options.manifest?.siteName ?? 'ACT Nuxt site' },
    ...(options.urlTemplates !== undefined ? { urlTemplates: options.urlTemplates } : {}),
    ...(options.failOnExtractionError !== undefined
      ? { failOnExtractionError: options.failOnExtractionError }
      : {}),
    ...(options.incremental !== undefined ? { incremental: options.incremental } : {}),
    generator: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
  };
  return cfg;
}

/**
 * PRD-407-R20 — `vueBinding` sentinel exported so generators / fixtures
 * can detect that the Nuxt module's default binding is the PRD-302
 * `@act-spec/component-vue` binding (not a re-implementation).
 */
export const NUXT_DEFAULT_BINDING = vueBinding;

/* ------------------------------------------------------------------------- */
/* PRD-407-R5 — programmatic build entry                                     */
/* ------------------------------------------------------------------------- */

/**
 * PRD-407-R5 — programmatic build entry. The Nuxt `build:done` hook invokes
 * this; tests + the conformance gate also call it directly to bypass
 * Nuxt's lifecycle when running on a fixture.
 *
 * Inherits PRD-400-R29/R30 pinning enforcement (PRD-407-R20), atomic writes
 * (PRD-407-R15), capability backing (PRD-407-R19), and the build-report
 * sidecar (PRD-407-R16).
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  buildReportPath?: string;
  failOnExtractionError?: boolean;
  logger?: NuxtLikeLogger;
  hooks?: GeneratorPlugin['hooks'];
}): Promise<BuildReport> {
  const logger = opts.logger ?? defaultLogger();
  const startedAt = Date.now();
  const buildCtx = {
    outputDir: opts.config.outputDir,
    config: opts.config,
    logger: {
      debug: logger.debug ?? ((m: string) => logger.info(m)),
      info: logger.info,
      warn: logger.warn,
      error: logger.error,
    },
  };
  try {
    if (opts.hooks?.preBuild) await opts.hooks.preBuild(buildCtx);
    const outcome = await runPipeline({ config: opts.config, logger: buildCtx.logger });
    const report = await emitFiles({
      outcome,
      outputDir: opts.config.outputDir,
      config: opts.config,
      startedAt,
    });
    // PRD-407-R19 — capability backing.
    verifyCapabilityBacking(outcome.capabilities, report.files);
    // PRD-407-R16 — sidecar at the configured path (NOT inside outputDir).
    if (opts.buildReportPath !== undefined) {
      await writeBuildReport(opts.buildReportPath, report);
    }
    if (opts.hooks?.postBuild) await opts.hooks.postBuild(buildCtx, report);
    // PRD-407-R17 — fail the build when extraction placeholders are present
    // and `failOnExtractionError` is set.
    if (
      opts.failOnExtractionError === true &&
      report.warnings.some(
        (w) =>
          w.startsWith('placeholder:') ||
          /extraction_status=(failed|partial)/.test(w),
      )
    ) {
      throw new Error(
        'PRD-407-R17: extraction placeholder(s) emitted; failing per failOnExtractionError',
      );
    }
    return report;
  } catch (err) {
    if (opts.hooks?.onError) await opts.hooks.onError(buildCtx, err as Error);
    // PRD-407-R15 — clean up tmp files inside ACT-owned paths.
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/* v8 ignore start */
function defaultLogger(): NuxtLikeLogger {
  return {
    debug: (m: string) => console.warn(`act: ${m}`),
    info: (m: string) => console.warn(`act: ${m}`),
    warn: (m: string) => console.warn(`act warn: ${m}`),
    error: (m: string) => console.error(`act error: ${m}`),
  };
}
/* v8 ignore stop */

/* ------------------------------------------------------------------------- */
/* PRD-407-R1 — Nuxt module factory                                          */
/* ------------------------------------------------------------------------- */

/** Internal state captured during module setup; surfaced for tests + observability. */
export interface NuxtModuleState {
  plugin: GeneratorPlugin;
  options: ActNuxtOptions;
  resolvedI18n: ResolvedI18n | null;
  contentInfo: { contentDir: string } | null;
  buildReportPath: string;
  buildReportWarning: string | undefined;
  outputDir: string;
  routes: NuxtRouteLike[];
  /** Re-entry guard for PRD-407-R5 — set true after the first pipeline run. */
  ran: boolean;
}

/** Result of `defineActModule` — Nuxt-3 module spec + an `__act` marker for tests. */
export interface ActNuxtModule {
  /** Nuxt-3 module meta (name, configKey, compatibility). */
  meta: {
    name: string;
    configKey: string;
    compatibility: { nuxt: string };
  };
  /** Nuxt-3 module defaults. */
  defaults: ActNuxtOptions;
  /** Nuxt-3 module setup callback. Synchronous; async work happens inside the registered hooks. */
  setup: (options: ActNuxtOptions, nuxt: NuxtLike) => void;
  /** Internal state surfaced for tests + the conformance gate. */
  __act: { options: ActNuxtOptions };
}

/**
 * PRD-407-R1 — public factory. Returns a Nuxt-3 module spec object the
 * host wires via `nuxt.config.ts`'s `modules: ["@act-spec/plugin-nuxt"]` array.
 * The module's setup callback registers PRD-407-R4 / R5 / R8 / R11 / R12
 * / R21 hooks against the Nuxt instance.
 *
 * The `nuxt` package is NOT imported at runtime here; the module runs
 * even when `nuxt` is absent (peer-optional posture). At setup time the
 * module:
 *   1. Validates options (PRD-407-R3).
 *   2. Probes Nuxt 3+ floor (PRD-407-R2) — error on Nuxt 2.
 *   3. Detects Nuxt Content + @nuxtjs/i18n (PRD-407-R7, R10).
 *   4. Hooks `pages:extend` (PRD-407-R8) for route enumeration.
 *   5. Hooks `app:created` (PRD-407-R11) for provider installation.
 *   6. Hooks `vite:extendConfig` (PRD-407-R21) for the macro plugin chain.
 *   7. Hooks `build:done` (PRD-407-R5) for the canonical pipeline.
 */
export function defineActModule(rawOptions: ActNuxtOptions = {}): ActNuxtModule {
  // Validate the input shape immediately so a misconfigured `act` block
  // surfaces a PRD-407-R3 error before Nuxt invokes setup.
  const options = validateOptions(rawOptions);

  const setup = (setupOptions: ActNuxtOptions, nuxt: NuxtLike): void => {
    // PRD-407-R3 — re-validate at setup time too (the operator-supplied
    // options arrive here, even if the module was registered with empty
    // defaults).
    const merged = validateOptions({ ...options, ...setupOptions });

    // PRD-407-R2 — Nuxt 3+ floor.
    if (!isNuxtVersionSupported(nuxt._version)) {
      throw new Error(
        `PRD-407-R2: @act-spec/plugin-nuxt requires Nuxt 3+ (and forward-compat 4.x); detected '${String(nuxt._version)}'`,
      );
    }

    // PRD-407-R10 — i18n auto-detection (errors propagate).
    const resolvedI18n = detectI18n(nuxt, merged.i18n);
    // PRD-407-R7 — content auto-wiring.
    const contentInfo = detectContent(nuxt);
    // PRD-407-R14 — output dir resolution (errors propagate).
    const outputDir = resolveOutputDir(nuxt, merged.outputDir);
    const projectRoot = path.resolve(nuxt.options.rootDir ?? process.cwd());
    // PRD-407-R16 — build report path resolution.
    const { path: buildReportPath, warning: buildReportWarning } = resolveBuildReportPath(
      merged,
      outputDir,
      projectRoot,
    );

    const config = resolveConfig(nuxt, merged, outputDir);
    const plugin: GeneratorPlugin = {
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      config,
      ...(merged.hooks !== undefined ? { hooks: merged.hooks } : {}),
    };

    const state: NuxtModuleState = {
      plugin,
      options: merged,
      resolvedI18n,
      contentInfo,
      buildReportPath,
      buildReportWarning,
      outputDir,
      routes: [],
      ran: false,
    };

    // Surface state on the nuxt instance for tests + downstream tooling.
    (nuxt as unknown as { _act?: NuxtModuleState })._act = state;

    // PRD-407-R8 — capture Nuxt's resolved page-route list. The hook fires
    // after Nuxt's pages directory is scanned and before route generation.
    const onPagesExtend: NuxtHookCallback = (pages) => {
      const list = Array.isArray(pages) ? pages : [];
      const captured: NuxtRouteLike[] = [];
      for (const p of list) {
        const pp = p as { path?: unknown; file?: unknown; parent?: unknown };
        if (typeof pp.path !== 'string') continue;
        const route: NuxtRouteLike = {
          id: pp.path,
          file: typeof pp.file === 'string' ? pp.file : '',
        };
        if (typeof pp.parent === 'string') route.parent = pp.parent;
        captured.push(route);
      }
      state.routes = applyRouteFilter(captured, merged.routeFilter);
    };
    nuxt.hook?.('pages:extend', onPagesExtend);

    // PRD-407-R11 — install the Vue provider at app:created. The actual
    // installer is loaded lazily so the module continues to load even if
    // `vue` is absent (peer-optional). Errors during install propagate so
    // PRD-302-R16 placeholder semantics surface end-to-end.
    const onAppCreated: NuxtHookCallback = async (vueApp) => {
      const mod = await import('@act-spec/component-vue');
      mod.installActProvider(vueApp as Parameters<typeof mod.installActProvider>[0]);
    };
    nuxt.hook?.('app:created', onAppCreated);

    // PRD-407-R21 — register the @act-spec/component-vue Vite plugin chain
    // for `defineActContract` macro desugaring. The plugin entry is a
    // lightweight no-op registration here (component-vue ships the actual
    // Vite plugin); the test asserts the hook is wired.
    const onViteExtendConfig: NuxtHookCallback = (viteConfig) => {
      const cfg = viteConfig as { plugins?: unknown[] };
      if (!Array.isArray(cfg.plugins)) cfg.plugins = [];
      // De-dupe by name — never register twice.
      const already = cfg.plugins.some(
        (p) => (p as { name?: string } | null)?.name === '@act-spec/component-vue/macros',
      );
      if (!already) {
        cfg.plugins.push({ name: '@act-spec/component-vue/macros' });
      }
    };
    nuxt.hook?.('vite:extendConfig', onViteExtendConfig);

    // PRD-407-R5 / R6 — the canonical pipeline runs at build:done, exactly
    // once per build, only under `nuxt generate`.
    const onBuildDone: NuxtHookCallback = async () => {
      // PRD-407-R5 — re-entry guard.
      if (state.ran) return;
      state.ran = true;
      // PRD-407-R6 — refuse `nuxt build` (server output).
      if (!isGenerateMode(nuxt)) {
        throw new Error(
          'PRD-407-R6: @act-spec/plugin-nuxt requires `nuxt generate` (static export). Detected `nuxt build`.',
        );
      }
      await runActBuild({
        config: plugin.config,
        buildReportPath,
        failOnExtractionError: merged.failOnExtractionError ?? false,
        ...(plugin.hooks !== undefined ? { hooks: plugin.hooks } : {}),
      });
    };
    nuxt.hook?.('build:done', onBuildDone);
  };

  return {
    meta: {
      name: PACKAGE_NAME,
      configKey: 'act',
      compatibility: { nuxt: '>=3.0.0 <5.0.0' },
    },
    defaults: { conformanceTarget: 'core', incremental: true },
    setup,
    __act: { options },
  };
}

/** Default export per Nuxt module idiom (operators sometimes import default). */
export default defineActModule;

/** Re-exported package marker for tests / observability. */
export const NUXT_PACKAGE_NAME = PACKAGE_NAME;
export const NUXT_PACKAGE_VERSION = PACKAGE_VERSION;

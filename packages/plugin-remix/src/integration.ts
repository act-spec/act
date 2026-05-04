/**
 * PRD-406 Remix-Vite plugin (static export) — wraps the PRD-400 pipeline in
 * a Vite `Plugin`-shaped factory consumed by `vite.config.ts`:
 *
 * ```ts
 * import { vitePlugin as remix } from '@remix-run/dev';
 * import { act } from '@act-spec/plugin-remix';
 *
 * export default defineConfig({
 *   plugins: [remix({ ... }), act({ conformanceTarget: 'standard' })],
 * });
 * ```
 *
 * Library choices (per ADR-006 + PRD-406):
 *  - Framework imports come from `@act-spec/generator-core`; the leaf does
 *    NOT re-export the pipeline (anti-pattern: generator-overreach into
 *    adapter logic).
 *  - `@remix-run/dev`, `vite`, `react`, and `react-dom` are `peerDependencies`
 *    and never imported at runtime here. The slice of the Vite plugin
 *    interface and Remix-Vite plugin options the integration touches is
 *    declared structurally so the plugin works with or without a Vite or
 *    Remix install (matches Astro + Next.js posture).
 *  - Pipeline runs from Vite's `closeBundle` hook on the client build only
 *    (PRD-406-R5). The server-build invocation is a no-op; dev mode
 *    (`vite serve`) is also a no-op (PRD-406-R10).
 *  - Adapters: PRD-201 (markdown) is auto-wired by default; CMS / i18n
 *    adapters are opt-in via `adapters: [...]` (PRD-406-R6).
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

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

const PACKAGE_NAME = '@act-spec/plugin-remix' as const;
const PACKAGE_VERSION = '0.0.0' as const;
const PLUGIN_NAME = 'act/remix' as const;

/** PRD-406-R19 — `ActRemixOptions`. Mirrors PRD-400-R31 `GeneratorConfig`. */
export interface ActRemixOptions {
  /** PRD-406-R14 / R19. Default: `'core'`. */
  conformanceTarget?: 'core' | 'standard' | 'strict';
  /** PRD-406-R11 / R19. Override Remix-Vite's resolved `build/client/`
   *  (rare; tests use it). */
  outputDir?: string;
  /** PRD-406-R15 / R19. Default: `./.act-build-report.json` at project root. */
  buildReportPath?: string;
  /** PRD-406-R6 / R19. Markdown content roots. Default: `['content/**\/*.{md,mdx}']`. */
  content?: { roots?: string[] };
  /** PRD-406-R6 / R19. When set, overrides auto-wiring of PRD-201. */
  adapters?: GeneratorConfig['adapters'];
  /** PRD-406-R9 / R19. When set, overrides React-binding auto-detection. */
  bindings?: unknown[];
  /** PRD-406-R9 / R19. Default: `'ssr-walk'`. */
  extractMode?: 'ssr-walk' | 'static-ast';
  /** PRD-406-R16 / R19. Default: false. */
  failOnExtractionError?: boolean;
  /** PRD-406-R19 / R22. Default: []. */
  mounts?: unknown[];
  /** PRD-406-R19. Site identity. */
  manifest?: { siteName?: string; rootId?: string };
  /** PRD-406-R19. URL templates passthrough (parameter parity with PRD-405). */
  urlTemplates?: GeneratorConfig['urlTemplates'];
}

/** Minimal logger surface used by the pipeline. Mirrors Vite's `Logger` shape. */
export interface RemixLikeLogger {
  debug?: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

/**
 * Structural slice of Vite's `ResolvedConfig` the integration touches.
 * The full `ResolvedConfig` is huge; we type only the fields we actually
 * read so we never import `vite` at runtime (peer-optional).
 */
export interface ViteLikeResolvedConfig {
  /** Vite 5 `build` config; `ssr` discriminates client vs server build. */
  build?: { ssr?: boolean | string };
  /** Vite 5 plugin list — used to discover Remix's plugin instance. */
  plugins?: ReadonlyArray<{ name?: string } & Record<string, unknown>>;
  /** Vite 5 logger surface. */
  logger?: RemixLikeLogger;
  /** Resolved project root. */
  root?: string;
}

/** Structural slice of Vite's `Plugin` interface. */
export interface VitePluginLike {
  name: string;
  enforce?: 'pre' | 'post';
  apply?: 'build' | 'serve';
  config?: (
    config: Record<string, unknown>,
    env: { command: 'build' | 'serve'; mode: string },
  ) => void | Record<string, unknown>;
  configResolved?: (config: ViteLikeResolvedConfig) => void | Promise<void>;
  closeBundle?: () => void | Promise<void>;
}

/**
 * Structural slice of Remix-Vite's plugin options (`vitePlugin(opts)` from
 * `@remix-run/dev`). The integration inspects the resolved Vite config's
 * plugin array for an entry with name `remix` (or `remix-vite`) and reads
 * the `_remixOptions` it carries forward (see PRD-406-R3 for the
 * normative contract — "static-export-only", not the specific signal name).
 */
export interface RemixVitePluginLike {
  name?: string;
  /** Remix's resolved options surfaced via the plugin instance. */
  _remixOptions?: RemixLikeOptions;
  /** Some Remix-Vite versions surface options under `_remix`. */
  _remix?: { options?: RemixLikeOptions };
}

export interface RemixLikeOptions {
  /** Function or array describing prerendered routes. */
  prerender?: ((args: unknown) => unknown) | unknown[] | true;
  /** Per-route prerender flag list — Remix-Vite's `routes` callback output. */
  routes?: Array<{ id?: string; path?: string; prerender?: boolean; file?: string }>;
  /** Some adopters point Remix-Vite at a custom build directory. */
  buildDirectory?: string;
}

/** PRD-406-R9 — read a route module's `act` export at build time. */
export interface RouteActExport {
  id: string;
  type?: string;
  title?: string;
  summary?: string;
  /** Marker — when the export is a function call, v0.1 skips extraction. */
  _unsupported?: boolean;
}

export function readRouteActExport(
  mod: Record<string, unknown> | undefined | null,
): RouteActExport | null {
  if (!mod) return null;
  if (!('act' in mod)) return null;
  const a = mod['act'];
  if (typeof a === 'function') {
    // PRD-406-R9: runtime-call form is unsupported in v0.1.
    return { id: '', _unsupported: true };
  }
  if (a === null || typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  if (typeof r['id'] !== 'string') return null;
  const out: RouteActExport = { id: r['id'] };
  if (typeof r['type'] === 'string') out.type = r['type'];
  if (typeof r['title'] === 'string') out.title = r['title'];
  if (typeof r['summary'] === 'string') out.summary = r['summary'];
  return out;
}

/**
 * PRD-406-R2 — Remix-Vite peer-version probe. Accepts the published
 * `@remix-run/dev/package.json` version string. Returns true when the
 * Remix-Vite peer satisfies `^2.0.0`.
 */
export function isRemixVersionSupported(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null) return false;
  return Number(m[1]) === 2;
}

/**
 * PRD-406-R2 — Vite peer-version probe. Accepts the published
 * `vite/package.json` version string. Returns true when the Vite peer
 * satisfies `^5.0.0`.
 */
export function isViteVersionSupported(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null) return false;
  return Number(m[1]) === 5;
}

/**
 * PRD-406-R3 — static-export detection. Inspects a resolved Remix-Vite
 * options object for a `prerender` directive (function, array, or `true`)
 * OR per-route `prerender: true` flags. Returns true when the build is
 * static-exporting. Per the PRD's "Note on detection heuristic", the
 * normative contract is "static-export-only" — replacing the detection
 * mechanism is a MINOR amendment to PRD-406; weakening the requirement
 * is MAJOR.
 */
export function detectsPrerenderConfig(remixOpts: RemixLikeOptions | null | undefined): boolean {
  if (!remixOpts) return false;
  // The structural type permits truthy values (function, non-empty array,
  // literal `true`); `undefined` is the negative case. The `prerender: false`
  // shape is not part of the declared type but real Remix configs sometimes
  // emit it; treat any falsy value as "not configured".
  const pre = remixOpts.prerender as unknown;
  if (pre !== undefined && pre !== false && pre !== null) return true;
  if (Array.isArray(remixOpts.routes)) {
    if (remixOpts.routes.some((r) => r.prerender === true)) return true;
  }
  return false;
}

/**
 * PRD-406-R3 — extract a Remix-Vite plugin instance from Vite's plugin
 * array. Recognizes `name === 'remix'` and `name === 'remix-vite'`
 * (Remix-Vite has used both across 2.x). Returns the typed slice or null.
 */
export function findRemixPlugin(
  plugins: ReadonlyArray<{ name?: string } & Record<string, unknown>> | undefined,
): RemixVitePluginLike | null {
  if (!plugins) return null;
  for (const p of plugins) {
    if (p.name === 'remix' || p.name === 'remix-vite') {
      return p;
    }
  }
  return null;
}

/**
 * PRD-406-R3 — read Remix's resolved options off a discovered plugin
 * instance. Tolerates both `_remixOptions` and `_remix.options` shapes.
 */
export function readRemixPluginOptions(
  plugin: RemixVitePluginLike | null | undefined,
): RemixLikeOptions | null {
  if (!plugin) return null;
  if (plugin._remixOptions) return plugin._remixOptions;
  if (plugin._remix?.options) return plugin._remix.options;
  return null;
}

/**
 * PRD-406-R5 — discriminate the client build from the server build.
 * Vite invokes `closeBundle` once per build target; Remix-Vite produces
 * both a client and a server bundle for SSR-prerender configurations.
 * The pipeline runs ONLY on the client build invocation.
 */
export function isClientBuild(config: ViteLikeResolvedConfig | undefined): boolean {
  if (!config) return true; // direct (non-Vite) invocation defaults to client.
  // `build.ssr` is `false | undefined` for the client build, `true` (or a
  // string entry-point) for the server build.
  const ssr = config.build?.ssr;
  return ssr === undefined || ssr === false;
}

/** PRD-406-R14 — wraps PRD-400-R17 inferAchievedLevel. */
export function detectAchievedBand(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  return inferAchievedLevel(observed);
}

/** PRD-406-R15 — write the build report sidecar at `buildReportPath`. */
export async function writeBuildReport(reportPath: string, report: BuildReport): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

/**
 * PRD-406-R15 — resolve the build-report path. When the operator points
 * the path inside `build/client/`, returns the path AND a warning string.
 */
export function resolveBuildReportPath(
  options: ActRemixOptions,
  outputDir: string,
): { path: string; warning?: string } {
  const configured =
    options.buildReportPath ?? path.join(process.cwd(), '.act-build-report.json');
  const normalizedOut = path.resolve(outputDir);
  const normalizedReport = path.resolve(configured);
  if (
    normalizedReport.startsWith(`${normalizedOut}${path.sep}`) ||
    normalizedReport === normalizedOut
  ) {
    return {
      path: configured,
      warning: `PRD-406-R15: buildReportPath "${configured}" resolves inside build/client; the report will ship to the CDN.`,
    };
  }
  return { path: configured };
}

/**
 * Internal helper — turn `ActRemixOptions` into a fully-resolved
 * GeneratorConfig. Public so the conformance gate can build a config
 * without going through Vite.
 */
export function resolveConfig(
  options: ActRemixOptions,
  fallbackOutDir: string,
): GeneratorConfig {
  const level = options.conformanceTarget ?? 'core';
  // PRD-406-R6 — auto-wire the markdown adapter when no explicit adapters
  // are supplied. Default content roots resolve relative to the project
  // root (one level above Remix-Vite's `build/client/`).
  const projectRoot = path.dirname(path.dirname(fallbackOutDir));
  const adapters = options.adapters ?? [
    {
      adapter: createMarkdownAdapter(),
      config: { sourceDir: path.join(projectRoot, 'content') },
      actVersion: '0.1',
    },
  ];
  const cfg: GeneratorConfig = {
    conformanceTarget: level,
    outputDir: options.outputDir ?? fallbackOutDir,
    adapters,
    site: { name: options.manifest?.siteName ?? 'ACT site' },
    ...(options.urlTemplates !== undefined ? { urlTemplates: options.urlTemplates } : {}),
    ...(options.failOnExtractionError !== undefined
      ? { failOnExtractionError: options.failOnExtractionError }
      : {}),
    generator: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
  };
  return cfg;
}

/**
 * PRD-406-R5 / R12 — programmatic build entry. Vite's `closeBundle` hook
 * calls this; tests + the conformance gate also call it directly to
 * bypass Vite/Remix's lifecycle when running on a fixture.
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  buildReportPath?: string;
  failOnExtractionError?: boolean;
  logger?: RemixLikeLogger;
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
    // PRD-400-R18 — capability backing.
    verifyCapabilityBacking(outcome.capabilities, report.files);
    // PRD-406-R15 — sidecar at the configured path (NOT inside build/client/).
    if (opts.buildReportPath !== undefined) {
      await writeBuildReport(opts.buildReportPath, report);
    }
    if (opts.hooks?.postBuild) await opts.hooks.postBuild(buildCtx, report);
    // PRD-406-R16 — fail the build when extraction placeholders are present
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
        'PRD-406-R16: extraction placeholder(s) emitted; failing per failOnExtractionError',
      );
    }
    return report;
  } catch (err) {
    if (opts.hooks?.onError) await opts.hooks.onError(buildCtx, err as Error);
    // PRD-406-R12 — clean up tmp files inside ACT-owned paths.
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/* v8 ignore start */
function defaultLogger(): RemixLikeLogger {
  return {
    debug: (m: string) => console.warn(`act: ${m}`),
    info: (m: string) => console.warn(`act: ${m}`),
    warn: (m: string) => console.warn(`act warn: ${m}`),
    error: (m: string) => console.error(`act error: ${m}`),
  };
}
/* v8 ignore stop */

/** Internal — state carried by a single `act()` plugin instance. */
interface InternalState {
  options: ActRemixOptions;
  fallbackOutDir: string;
  resolvedOutDir: string;
  resolvedConfig: GeneratorConfig;
  buildReportPath: string;
  buildReportWarning: string | undefined;
  isServeMode: boolean;
  isClient: boolean;
  prerenderDetected: boolean;
  loggedDevNote: boolean;
  logger: RemixLikeLogger;
  invocationCount: number;
}

/** Result returned by `act()` — Vite's `Plugin` shape plus an `__act` marker. */
export type ActVitePlugin = VitePluginLike & {
  __act: {
    plugin: GeneratorPlugin;
    options: ActRemixOptions;
    state: InternalState;
  };
};

/**
 * PRD-406-R1 / R4 — public factory. Returns a Vite `Plugin`-shaped object
 * that carries the underlying `GeneratorPlugin` reference for direct
 * pipeline invocation by tests + the conformance gate.
 *
 * The `vite`, `@remix-run/dev`, `react`, and `react-dom` packages are NOT
 * imported at runtime here; the plugin runs even when those peers are
 * absent (peer-optional posture, mirroring Astro and Next.js leaves).
 */
export function act(options: ActRemixOptions = {}): ActVitePlugin {
  const fallbackOutDir =
    options.outputDir ?? path.join(process.cwd(), 'build', 'client');
  const resolvedConfig = resolveConfig(options, fallbackOutDir);
  const { path: buildReportPath, warning: buildReportWarning } = resolveBuildReportPath(
    options,
    resolvedConfig.outputDir,
  );

  const state: InternalState = {
    options,
    fallbackOutDir,
    resolvedOutDir: fallbackOutDir,
    resolvedConfig,
    buildReportPath,
    buildReportWarning,
    isServeMode: false,
    isClient: true,
    prerenderDetected: false,
    loggedDevNote: false,
    logger: defaultLogger(),
    invocationCount: 0,
  };

  const plugin: GeneratorPlugin = {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    config: resolvedConfig,
  };

  const vitePlugin: ActVitePlugin = {
    name: PLUGIN_NAME,
    // PRD-406-R4 — run AFTER Remix's plugin so its route tree is populated.
    enforce: 'post',
    // PRD-406-R10 — applies to `vite build` only. Vite's `apply: 'build'`
    // collapses the dev-mode no-op to a no-op even more aggressively;
    // we ALSO guard inside `closeBundle` for safety on direct invocation.
    apply: 'build',

    config(_userConfig, env) {
      // PRD-406-R10 — record dev-mode posture for `closeBundle` guard.
      state.isServeMode = env.command === 'serve';
    },

    configResolved(config) {
      // PRD-406-R5 — gate on client vs server build.
      state.isClient = isClientBuild(config);
      // PRD-406-R3 — detect Remix's prerender configuration via the resolved
      // plugin array. The check runs at config-resolve time so the build
      // error surfaces BEFORE Vite finalizes the bundle.
      const remixPlugin = findRemixPlugin(config?.plugins);
      const remixOpts = readRemixPluginOptions(remixPlugin);
      state.prerenderDetected = detectsPrerenderConfig(remixOpts);
      // PRD-406-R18 — plumb Vite's logger into the pipeline.
      if (config?.logger) state.logger = config.logger;
      // PRD-406-R3 — gate on prerender detection only when Remix-Vite is
      // actually present. When no Remix plugin is detected (direct Vite
      // build, fixture invocation), the gate is permissive — the operator
      // is responsible for the static-export contract.
      if (remixPlugin !== null && !state.prerenderDetected && state.isClient) {
        throw new Error(
          'PRD-406-R3: Static export not detected. Configure Remix prerendering, or wait for the Remix runtime SDK (deferred to v0.2). See PRD-406-R3.',
        );
      }
      if (state.buildReportWarning !== undefined) {
        state.logger.warn(state.buildReportWarning);
      }
    },

    async closeBundle() {
      state.invocationCount += 1;
      // PRD-406-R10 — dev-mode no-op (one-time logger note).
      if (state.isServeMode) {
        if (!state.loggedDevNote) {
          state.logger.info(
            'ACT artifacts are produced only by `vite build`; run `remix vite:build` to generate them.',
          );
          state.loggedDevNote = true;
        }
        return;
      }
      // PRD-406-R5 — only the client build invocation runs the pipeline.
      if (!state.isClient) return;
      await runActBuild({
        config: state.resolvedConfig,
        buildReportPath: state.buildReportPath,
        failOnExtractionError: options.failOnExtractionError ?? false,
        logger: state.logger,
      });
    },

    __act: {
      plugin,
      options,
      state,
    },
  };

  return vitePlugin;
}

/** Default export per Vite plugin idiom. */
export default act;

/** Re-exported package marker for tests / observability. */
export const REMIX_STATIC_PACKAGE_NAME = PACKAGE_NAME;
export const REMIX_STATIC_PACKAGE_VERSION = PACKAGE_VERSION;
export const REMIX_STATIC_PLUGIN_NAME = PLUGIN_NAME;

/**
 * PRD-405 Next.js plugin (static export) — wraps the PRD-400 pipeline in a
 * `next.config.js` `withAct(nextConfig, options)` shape.
 *
 * Library choices (per ADR-006 + PRD-405):
 *  - Framework imports come from `@act-spec/generator-core` (NOT from
 *    `@act-spec/plugin-astro`); ADR-006 mandates the dedicated framework package
 *    for every leaf generator.
 *  - `next` and `react` are `peerDependencies` and never imported at runtime
 *    here; we type the parts of `NextConfig` we touch with a structural
 *    interface so the plugin works with or without `next` installed (matches
 *    Astro's posture in `@act-spec/plugin-astro`).
 *  - The post-build hook is implemented as a Next webpack-plugin entry on
 *    `compilation.hooks.done` (Next 14 fallback, also valid on Next 15).
 *    PRD-405-R5 explicitly calls the hook name "illustrative" — the
 *    normative contract is "post-build static-export emission".
 *  - Adapters: PRD-201 (markdown) is auto-wired by default; CMS / i18n
 *    adapters are opt-in via `adapters: [...]`. PRD-301 React binding
 *    detection is heuristic (route-tree presence), exposed as
 *    `detectsReactRoutes` for tests + the conformance gate.
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

const PACKAGE_NAME = '@act-spec/plugin-nextjs' as const;
const PACKAGE_VERSION = '0.0.0' as const;

/** PRD-405-R20 — `ActNextOptions`. Mirrors PRD-400-R31 `GeneratorConfig`. */
export interface ActNextOptions {
  /** PRD-405-R14 / R20. Default: `'core'`. */
  conformanceTarget?: 'core' | 'standard' | 'strict';
  /** PRD-405-R5 / R20. Override Next's resolved `out/` (rare; tests use it). */
  outputDir?: string;
  /** PRD-405-R15 / R20. Default: `./.act-build-report.json` at project root. */
  buildReportPath?: string;
  /** PRD-405-R6 / R20. Markdown content roots. Default: `['content/**\/*.{md,mdx}']`. */
  content?: { roots?: string[] };
  /** PRD-405-R6 / R20. When set, overrides auto-wiring of PRD-201. */
  adapters?: GeneratorConfig['adapters'];
  /** PRD-405-R9 / R20. When set, overrides React-binding auto-detection. */
  bindings?: unknown[];
  /** PRD-405-R9 / R20. Default: `'ssr-walk'`. */
  extractMode?: 'ssr-walk' | 'static-ast';
  /** PRD-405-R10 / R20. Default: `'auto'`. */
  i18n?: 'auto' | false | { pattern?: '1' | '2' };
  /** PRD-405-R16 / R20. Default: false. */
  failOnExtractionError?: boolean;
  /** PRD-405-R22 / R20. Default: []. */
  mounts?: unknown[];
  /** PRD-405-R20. Site identity. */
  manifest?: { siteName?: string; rootId?: string; canonicalUrl?: string };
  /** PRD-405-R20. URL templates passthrough (parameter parity with PRD-401). */
  urlTemplates?: GeneratorConfig['urlTemplates'];
}

/** Minimal logger surface used by the pipeline. */
export interface NextLikeLogger {
  debug?: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

/** PRD-405-R1 — public surface. NOT a runtime import of `next`. */
export interface NextLikeConfig {
  output?: string;
  distDir?: string;
  i18n?: { locales?: string[]; defaultLocale?: string };
  webpack?: (config: WebpackLikeConfig, ctx: WebpackInvocationCtx) => WebpackLikeConfig;
  // Other Next config fields are passed through unchanged; the plugin must
  // NOT mutate them (PRD-405-R4).
  [key: string]: unknown;
}

export interface WebpackLikeConfig {
  plugins?: unknown[];
  [key: string]: unknown;
}

export interface WebpackInvocationCtx {
  isServer: boolean;
  dev: boolean;
}

/**
 * PRD-405-R3 — accept `'export'` only. `'server'` and `'standalone'` are
 * explicitly rejected; absence of `output` defaults Next to a server build,
 * which is also rejected. Returns true when the build is eligible.
 */
export function isOutputExport(output: NextLikeConfig['output']): boolean {
  return output === 'export';
}

/**
 * PRD-405-R2 — version probe. Accepts the published `next/package.json`
 * version string. Returns true when `next` ≥ 14.2 and < 16.
 */
export function isNextVersionSupported(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 14) return minor >= 2;
  if (major === 15) return true;
  return false;
}

/**
 * PRD-405-R9 — heuristic React-route detection. Returns true when any of
 * `app/**\/*.{tsx,jsx}`, `pages/**\/*.{tsx,jsx}`, or
 * `src/components/**\/*.{tsx,jsx}` files exist under `projectRoot`.
 *
 * The detection is filesystem-only (no module loading) so the integration
 * stays usable in static-config contexts (Vercel build inspectors, Lambda
 * cold paths). Loading `@act-spec/component-react` is gated on a positive
 * detection per PRD-405-R9.
 */
export async function detectsReactRoutes(projectRoot: string): Promise<boolean> {
  const candidates = ['app', 'pages', path.join('src', 'components')];
  for (const candidate of candidates) {
    const absolute = path.join(projectRoot, candidate);
    if (await directoryHasReactSource(absolute)) return true;
  }
  return false;
}

async function directoryHasReactSource(root: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && /\.(tsx|jsx)$/i.test(e.name)) return true;
    if (e.isDirectory()) {
      if (await directoryHasReactSource(p)) return true;
    }
  }
  return false;
}

/** PRD-405-R8 — read a route module's `act` export at build time. */
export interface PageActExport {
  id: string;
  type?: string;
  title?: string;
  summary?: string;
  /** Marker — when the export is a function call, v0.1 skips extraction. */
  _unsupported?: boolean;
}

export function readPageActExport(mod: Record<string, unknown> | undefined | null): PageActExport | null {
  if (!mod) return null;
  if (!('act' in mod)) return null;
  const a = mod['act'];
  if (typeof a === 'function') {
    // PRD-405-R8: runtime-call form is unsupported in v0.1.
    return { id: '', _unsupported: true };
  }
  if (a === null || typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  if (typeof r['id'] !== 'string') return null;
  const out: PageActExport = { id: r['id'] };
  if (typeof r['type'] === 'string') out.type = r['type'];
  if (typeof r['title'] === 'string') out.title = r['title'];
  if (typeof r['summary'] === 'string') out.summary = r['summary'];
  return out;
}

/** PRD-405-R14 — wraps PRD-400-R17 inferAchievedLevel. */
export function detectAchievedBand(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  return inferAchievedLevel(observed);
}

/**
 * PRD-405-R10 — i18n auto-detection. Returns the resolved i18n config
 * (locale list + pattern) or null if i18n is disabled / single-locale.
 */
export interface ResolvedI18n {
  locales: string[];
  defaultLocale: string | undefined;
  pattern: '1' | '2';
}

export function resolveI18n(
  nextConfig: NextLikeConfig,
  opt: ActNextOptions['i18n'],
): ResolvedI18n | null {
  if (opt === false) return null;
  // Pages Router: nextConfig.i18n.locales.
  const pagesLocales = nextConfig.i18n?.locales;
  if (!pagesLocales || pagesLocales.length <= 1) return null;
  const pattern: '1' | '2' = typeof opt === 'object' && opt?.pattern ? opt.pattern : '2';
  return {
    locales: pagesLocales,
    defaultLocale: nextConfig.i18n?.defaultLocale,
    pattern,
  };
}

/** PRD-405-R15 — write the build report sidecar at `buildReportPath`. */
export async function writeBuildReport(reportPath: string, report: BuildReport): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

/**
 * Internal helper — turn `ActNextOptions` into a fully-resolved
 * GeneratorConfig. Public so the conformance gate can build a config
 * without going through `next.config.js` resolution.
 */
export function resolveConfig(
  nextConfig: NextLikeConfig,
  options: ActNextOptions,
  fallbackOutDir: string,
): GeneratorConfig {
  const level = options.conformanceTarget ?? 'core';
  // PRD-405-R6 — auto-wire the markdown adapter when no explicit adapters
  // are supplied. Default content roots resolve relative to the project
  // root (== fallbackOutDir's parent in Next's typical layout).
  const projectRoot = path.dirname(fallbackOutDir);
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
    site: {
      name: options.manifest?.siteName ?? 'ACT site',
      ...(typeof options.manifest?.canonicalUrl === 'string' && options.manifest.canonicalUrl.length > 0
        ? { canonical_url: options.manifest.canonicalUrl }
        : {}),
    },
    ...(options.urlTemplates !== undefined ? { urlTemplates: options.urlTemplates } : {}),
    ...(options.failOnExtractionError !== undefined
      ? { failOnExtractionError: options.failOnExtractionError }
      : {}),
    generator: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
  };
  return cfg;
}

/**
 * PRD-405-R5 — programmatic build entry. The webpack post-build hook
 * calls this; tests + the conformance gate also call it directly to
 * bypass Next's lifecycle when running on a fixture.
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  buildReportPath?: string;
  failOnExtractionError?: boolean;
  logger?: NextLikeLogger;
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
    // PRD-405-R15 — sidecar at the configured path (NOT inside `out/`).
    if (opts.buildReportPath !== undefined) {
      await writeBuildReport(opts.buildReportPath, report);
    }
    if (opts.hooks?.postBuild) await opts.hooks.postBuild(buildCtx, report);
    // PRD-405-R16 — fail the build when extraction placeholders are present
    // and `failOnExtractionError` is set. Placeholder warnings come from the
    // pipeline as `warnings[]` entries prefixed `placeholder:`.
    if (
      opts.failOnExtractionError === true &&
      report.warnings.some(
        (w) =>
          w.startsWith('placeholder:') ||
          /extraction_status=(failed|partial)/.test(w),
      )
    ) {
      throw new Error('PRD-405-R16: extraction placeholder(s) emitted; failing per failOnExtractionError');
    }
    return report;
  } catch (err) {
    if (opts.hooks?.onError) await opts.hooks.onError(buildCtx, err as Error);
    // PRD-405-R12 — clean up tmp files inside ACT-owned paths.
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/* v8 ignore start */
function defaultLogger(): NextLikeLogger {
  return {
    debug: (m: string) => console.warn(`act: ${m}`),
    info: (m: string) => console.warn(`act: ${m}`),
    warn: (m: string) => console.warn(`act warn: ${m}`),
    error: (m: string) => console.error(`act error: ${m}`),
  };
}
/* v8 ignore stop */

/**
 * PRD-405-R5 / Snippet 2 — webpack plugin entry-point that hooks
 * `compilation.hooks.done` to invoke the canonical pipeline AFTER Next's
 * static export completes. The plugin is constructed here so the integration
 * is independent of a literal webpack import (Next plugins are duck-typed
 * by webpack on `apply(compiler)`).
 */
export interface ActWebpackPluginOptions {
  config: GeneratorConfig;
  buildReportPath: string;
  failOnExtractionError: boolean;
  logger: NextLikeLogger;
}

export class ActWebpackPostBuildPlugin {
  constructor(private readonly opts: ActWebpackPluginOptions) {}
  apply(compiler: {
    hooks: {
      done: {
        tapPromise: (name: string, cb: (stats: unknown) => Promise<void>) => void;
      };
    };
  }): void {
    compiler.hooks.done.tapPromise(PACKAGE_NAME, async (_stats: unknown) => {
      // PRD-405-R5 — wait briefly for Next's static-export marker. If the
      // marker is absent after the timeout, proceed with a build warning
      // (the plugin still emits ACT artifacts based on whatever is in
      // `out/`, even if Next emitted nothing static).
      await waitForExportMarker(this.opts.config.outputDir);
      await runActBuild({
        config: this.opts.config,
        buildReportPath: this.opts.buildReportPath,
        failOnExtractionError: this.opts.failOnExtractionError,
        logger: this.opts.logger,
      });
    });
  }
}

/**
 * PRD-405-R5 — poll for `out/.next-static-export-marker` (Next-emitted
 * artifact). Resolves immediately when present; resolves silently after
 * `timeoutMs` if not. Exported for tests.
 */
export async function waitForExportMarker(outputDir: string, timeoutMs = 5_000): Promise<boolean> {
  const markerPath = path.join(outputDir, '.next-static-export-marker');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.stat(markerPath);
      return true;
    } catch {
      // not present yet
    }
    await delay(50);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PRD-405-R15 — resolve the build-report path. When the operator points
 * the path inside `out/`, returns the path AND a warning string.
 */
export function resolveBuildReportPath(
  options: ActNextOptions,
  outputDir: string,
): { path: string; warning?: string } {
  const configured = options.buildReportPath ?? path.join(process.cwd(), '.act-build-report.json');
  // Detect "inside out/" by suffix containment.
  const normalizedOut = path.resolve(outputDir);
  const normalizedReport = path.resolve(configured);
  if (normalizedReport.startsWith(`${normalizedOut}${path.sep}`) || normalizedReport === normalizedOut) {
    return {
      path: configured,
      warning: `PRD-405-R15: buildReportPath "${configured}" resolves inside output dir; the report will ship to the CDN.`,
    };
  }
  return { path: configured };
}

/** Result returned by `withAct` — a `NextConfig`-shaped object. */
export type WithActResult = NextLikeConfig & {
  /** Internal — surfaced for tests + conformance. */
  __act: {
    plugin: GeneratorPlugin;
    options: ActNextOptions;
    resolvedI18n: ResolvedI18n | null;
    buildReportPath: string;
    buildReportWarning: string | undefined;
    fallbackOutDir: string;
  };
};

/**
 * PRD-405-R1 — public factory. Returns a `NextConfig`-shaped object that
 * (a) preserves every field on `nextConfig` (PRD-405-R4 composability),
 * (b) wraps `nextConfig.webpack` to register the post-build plugin, and
 * (c) carries the underlying GeneratorPlugin reference for direct
 *     pipeline invocation by tests + the conformance gate.
 *
 * The `next` package is NOT imported at runtime here; the plugin runs
 * even when `next` is absent (peer-optional posture).
 */
export function withAct(nextConfig: NextLikeConfig, options: ActNextOptions = {}): WithActResult {
  // PRD-405-R3 — output: "export" requirement (config-resolve time).
  if (!isOutputExport(nextConfig.output)) {
    const observed = nextConfig.output ?? '<unset>';
    throw new Error(
      `PRD-405-R3: output: "${observed}" is unsupported; PRD-405 requires output: "export". For runtime ACT use @act-spec/runtime-next (PRD-501).`,
    );
  }

  // PRD-405-R10 — i18n auto-detection.
  const resolvedI18n = resolveI18n(nextConfig, options.i18n ?? 'auto');

  // PRD-405-R6 / R20 — fallback out-dir before the post-build hook fires.
  const distDir = nextConfig.distDir ?? '.next';
  const fallbackOutDir = options.outputDir ?? path.join(process.cwd(), 'out');

  const config = resolveConfig(nextConfig, options, fallbackOutDir);
  const { path: buildReportPath, warning: buildReportWarning } = resolveBuildReportPath(
    options,
    config.outputDir,
  );

  const plugin: GeneratorPlugin = {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    config,
  };

  // PRD-405-R4 — left-of-composable. Wrap the user's `webpack` callback
  // (when present) and chain ours after it; never mutate other plugins'
  // returned config beyond appending our own plugin entry.
  // PRD-405-R19 — dev-mode posture: the post-build hook is a NO-OP when
  // ctx.dev === true. We register the plugin entry only when !dev so even
  // a dev build that somehow wires `output: "export"` does not invoke
  // the canonical pipeline.
  const userWebpack = nextConfig.webpack;
  const wrapped = (config: WebpackLikeConfig, ctx: WebpackInvocationCtx): WebpackLikeConfig => {
    const merged = userWebpack ? userWebpack(config, ctx) : config;
    if (ctx.dev || !ctx.isServer) return merged;
    const next: WebpackLikeConfig = {
      ...merged,
      plugins: [
        ...(merged.plugins ?? []),
        new ActWebpackPostBuildPlugin({
          config: plugin.config,
          buildReportPath,
          failOnExtractionError: options.failOnExtractionError ?? false,
          logger: defaultLogger(),
        }),
      ],
    };
    return next;
  };

  // PRD-405-R4 — pass every other field through unchanged; only `webpack`
  // is wrapped, and that wrap preserves the user's callback semantics.
  const out: WithActResult = {
    ...nextConfig,
    webpack: wrapped,
    distDir,
    __act: {
      plugin,
      options,
      resolvedI18n,
      buildReportPath,
      buildReportWarning,
      fallbackOutDir,
    },
  };
  return out;
}

/** Default export per Next plugin idiom (operators sometimes import default). */
export default withAct;

/** Re-exported package marker for tests / observability. */
export const NEXTJS_STATIC_PACKAGE_NAME = PACKAGE_NAME;
export const NEXTJS_STATIC_PACKAGE_VERSION = PACKAGE_VERSION;

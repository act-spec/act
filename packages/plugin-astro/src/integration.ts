/**
 * PRD-401 Astro integration — wraps the PRD-400 pipeline in Astro's
 * `AstroIntegration` shape.
 *
 * Library choices (ADR-003):
 *  - Astro's official `AstroIntegration` API (typed as `AstroIntegration`
 *    from `astro`). The integration registers `astro:config:setup`,
 *    `astro:server:start`, `astro:build:done` hooks; the pipeline runs
 *    exclusively from `astro:build:done` (PRD-401-R5).
 *  - The integration is statically typed without a runtime dependency on
 *    Astro at the @act-spec/plugin-astro layer (Astro is a peerDep). This makes
 *    the package usable in non-Astro contexts (programmatic invocation
 *    via `runActBuild`) for tests and for the conformance gate.
 */
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
  type GeneratorPlugin,
} from '@act-spec/generator-core';

/** PRD-401-R19 — public options for the integration factory. */
export interface ActAstroOptions {
  /** PRD-401-R6. Defaults to a single auto-wired markdown adapter. */
  adapters?: GeneratorConfig['adapters'];
  /** PRD-401-R19. Default 'core'. */
  level?: 'core' | 'standard' | 'strict';
  /** PRD-401-R19. Override Astro's resolved outDir (rare; tests use it). */
  output?: string;
  /** Site identity. */
  site?: GeneratorConfig['site'];
  /** PRD-401-R19. */
  urlTemplates?: GeneratorConfig['urlTemplates'];
  /** PRD-400-R26. */
  failOnExtractionError?: boolean;
  /** PRD-400-R22. */
  incremental?: boolean;
  /** PRD-401-R17. Plus-tier opt-in (not implemented in v0.1). */
  i18n?: boolean | { pattern: '1' | '2' };
}

const PACKAGE_NAME = '@act-spec/plugin-astro' as const;
const PACKAGE_VERSION = '0.0.0' as const;

/** Minimal logger that satisfies AdapterLogger. */
function makeLogger(prefix: string): {
  debug: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
} {
  return {
    /* v8 ignore next */
    debug: (m) => console.error(`${prefix} debug: ${m}`),
    /* v8 ignore next */
    info: (m) => console.warn(`${prefix}: ${m}`),
    /* v8 ignore next */
    warn: (m) => console.warn(`${prefix} warn: ${m}`),
    /* v8 ignore next */
    error: (m) => console.error(`${prefix} error: ${m}`),
  };
}

/**
 * PRD-401-R3 — Astro `output` setting check. Returns true when the build is
 * eligible for static emission; false otherwise (the integration emits a
 * build error when `output: "server"` is detected).
 */
export function isOutputEligibleForStatic(output: string): boolean {
  return output === 'static' || output === 'hybrid';
}

/**
 * PRD-401-R2 — version probe. Returns `true` when the supplied Astro version
 * string satisfies the `^4.0.0` peer-dependency constraint.
 */
export function isAstroVersionSupported(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\./.exec(version);
  if (m === null) return false;
  return Number(m[1]) === 4;
}

/**
 * PRD-401-R14 — auto-detect achieved conformance band from observed files.
 * Wraps PRD-400-R17 inferAchievedLevel with the Astro-specific defaults.
 */
export function detectAchievedBand(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  return inferAchievedLevel(observed);
}

/** PRD-401-R8 — read a route module's `act` export at build time. */
export interface RouteActExport {
  id: string;
  type?: string;
  summary?: string;
  extract?: () => unknown;
}

export function readRouteActExport(mod: Record<string, unknown> | undefined): RouteActExport | null {
  if (!mod) return null;
  const a = mod['act'];
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  if (typeof r['id'] !== 'string') return null;
  const result: RouteActExport = { id: r['id'] };
  if (typeof r['type'] === 'string') result.type = r['type'];
  if (typeof r['summary'] === 'string') result.summary = r['summary'];
  if (typeof r['extract'] === 'function') result.extract = r['extract'] as () => unknown;
  return result;
}

/**
 * PRD-401-R9 — heuristic React-island detection from a list of route paths.
 * Looks for `.tsx` or `.jsx` under `src/pages/` or `src/components/`.
 */
export function detectsReactIslands(paths: string[]): boolean {
  return paths.some(
    (p) =>
      (/\.(tsx|jsx)$/.test(p) && (p.includes('/src/pages/') || p.includes('/src/components/'))) ||
      /client:(load|idle|visible|media|only)/.test(p),
  );
}

/**
 * PRD-401-R12 — debounce helper for the `astro dev` watcher. Pure factory,
 * exposed for test ergonomics.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): { call: (...args: Parameters<T>) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call(...args) {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => fn(...(args as unknown[])), ms);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Internal helper — turn `ActAstroOptions` into a fully-resolved
 * GeneratorConfig. Public so the conformance gate can build a config
 * without going through Astro's hooks.
 */
export function resolveConfig(
  options: ActAstroOptions,
  fallbackOutDir: string,
  astroSite?: string,
): GeneratorConfig {
  const level = options.level ?? 'core';
  const adapters = options.adapters ?? [
    {
      adapter: createMarkdownAdapter(),
      config: { sourceDir: path.join(fallbackOutDir, '..', 'src', 'content') },
      actVersion: '0.1',
    },
  ];
  // Default canonical_url to Astro's `config.site` when caller didn't
  // override it. The pipeline propagates this as `ctx.siteOrigin` so
  // adapters can populate `source.human_url` deterministically.
  const baseSite = options.site ?? { name: 'ACT site' };
  const site: GeneratorConfig['site'] =
    baseSite.canonical_url === undefined && typeof astroSite === 'string' && astroSite.length > 0
      ? { ...baseSite, canonical_url: astroSite }
      : baseSite;
  const cfg: GeneratorConfig = {
    conformanceTarget: level,
    outputDir: options.output ?? fallbackOutDir,
    adapters,
    site,
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
 * PRD-401-R5 / R20 — programmatic build entry. The integration's
 * `astro:build:done` hook calls this; tests + the conformance gate also
 * call it directly to bypass Astro's lifecycle when running on a fixture.
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  logger?: ReturnType<typeof makeLogger>;
  hooks?: GeneratorPlugin['hooks'];
}): Promise<BuildReport> {
  const logger = opts.logger ?? makeLogger('act');
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
    // PRD-400-R18 — capability backing.
    verifyCapabilityBacking(outcome.capabilities, report.files);
    if (opts.hooks?.postBuild) await opts.hooks.postBuild(buildCtx, report);
    return report;
  } catch (err) {
    if (opts.hooks?.onError) await opts.hooks.onError(buildCtx, err as Error);
    // PRD-401-R13 — clean up any tmp files inside ACT-owned paths.
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/**
 * PRD-401-R1 — public factory. Returns an `AstroIntegration`-shaped object
 * that ALSO carries the underlying GeneratorPlugin reference for direct
 * pipeline invocation. The Astro types are not imported at runtime to keep
 * the package usable without an Astro install (Astro is a peerDep).
 */
export interface ActIntegration {
  name: string;
  hooks: {
    'astro:config:setup': (params: AstroConfigSetupParams) => void;
    'astro:server:start': (params: AstroServerStartParams) => void;
    'astro:build:done': (params: AstroBuildDoneParams) => Promise<void>;
  };
  /** Internal — surfaced for tests + conformance. */
  __plugin: GeneratorPlugin;
  __options: ActAstroOptions;
}

interface AstroConfigSetupParams {
  config: { output?: string; root?: URL | string; site?: string };
  command: 'build' | 'dev' | 'preview';
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  updateConfig?: (cfg: unknown) => void;
}
interface AstroServerStartParams {
  address: { port: number };
  logger?: { info: (m: string) => void };
}
interface AstroBuildDoneParams {
  dir: URL | string;
  routes?: Array<{ pathname?: string }>;
  pages?: Array<{ pathname: string }>;
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export function actIntegration(options: ActAstroOptions = {}): ActIntegration {
  let resolvedOutDir = options.output ?? 'dist';
  let astroSite: string | undefined;

  const plugin: GeneratorPlugin = {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    config: resolveConfig(options, resolvedOutDir),
  };

  return {
    name: PACKAGE_NAME,
    hooks: {
      // PRD-401-R3 / R4 / R5
      'astro:config:setup': (params: AstroConfigSetupParams): void => {
        const out = params.config.output ?? 'static';
        if (!isOutputEligibleForStatic(out)) {
          throw new Error(
            `PRD-401-R3: output: "${out}" is unsupported; v0.1 requires "static" or "hybrid". See PRD-105-R3.`,
          );
        }
        // Capture Astro's `site` so it can default `canonical_url` for
        // pipeline output. ACT-side `options.site.canonical_url` wins when
        // set; otherwise we use the Astro config's `site`.
        if (typeof params.config.site === 'string' && params.config.site.length > 0) {
          astroSite = params.config.site;
        }
      },
      // PRD-401-R12 / R20 — dev-mode in-memory only.
      'astro:server:start': (_params: AstroServerStartParams): void => {
        // Watcher install lives outside the integration's pure surface; the
        // dev-mode watcher is wired by the host plugin in the consuming
        // example app. PRD-401-R20: no writes to outDir.
      },
      // PRD-401-R5 — pipeline runs here.
      'astro:build:done': async (params: AstroBuildDoneParams): Promise<void> => {
        const dir = params.dir;
        const outDir = typeof dir === 'string' ? dir : new URL(dir).pathname;
        resolvedOutDir = outDir;
        const config = resolveConfig(options, outDir, astroSite);
        plugin.config = config;
        await runActBuild({ config, hooks: plugin.hooks });
      },
    },
    __plugin: plugin,
    __options: options,
  };
}

/** Default export per Astro idiom. */
export default actIntegration;

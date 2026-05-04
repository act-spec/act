/**
 * @act-spec/plugin-vitepress — VitePress plugin entry point.
 *
 * Wires VitePress's `transformPageData` (per-page) and `buildEnd`
 * (post-build, fires once) lifecycle hooks into the ACT generator
 * pipeline (`@act-spec/generator-core`). The markdown adapter
 * (`@act-spec/adapter-markdown`) is consumed unchanged — no adapter
 * logic is duplicated here (avoiding the "generator overreach"
 * anti-pattern).
 *
 * `vitepress` is an OPTIONAL peer dependency; the plugin is structurally
 * typed against the slice declared in `./types.ts` so the package builds
 * and tests without VitePress installed (matches the
 * `@act-spec/plugin-eleventy` / `@act-spec/plugin-docusaurus` posture).
 *
 * Hook reference: https://vitepress.dev/reference/site-config#build-hooks.
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
} from '@act-spec/generator-core';

import type {
  ActVitePressPlugin,
  ActVitePressPluginState,
  VitePressActOptions,
  VitePressPageData,
  VitePressSiteConfig,
} from './types.js';

const PACKAGE_NAME = '@act-spec/plugin-vitepress' as const;
const PACKAGE_VERSION = '0.2.0' as const;
/** Default conformance target for the VitePress plugin (per the runbook spec). */
const DEFAULT_CONFORMANCE_TARGET: GeneratorConfig['conformanceTarget'] = 'standard';

/* v8 ignore start */
function defaultLogger(): {
  debug: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
} {
  return {
    debug: (m: string) => console.warn(`act-vitepress debug: ${m}`),
    info: (m: string) => console.warn(`act-vitepress: ${m}`),
    warn: (m: string) => console.warn(`act-vitepress warn: ${m}`),
    error: (m: string) => console.error(`act-vitepress error: ${m}`),
  };
}
/* v8 ignore stop */

/**
 * Validate `VitePressActOptions` at plugin-load time. Throws a
 * configuration error citing the failing field; surfaces issues BEFORE
 * VitePress enters its build loop.
 */
export function validateOptions(options: unknown): VitePressActOptions {
  if (options === undefined || options === null || typeof options !== 'object') {
    throw new Error(`@act-spec/plugin-vitepress: options must be an object; got ${typeof options}`);
  }
  const opts = options as Record<string, unknown>;
  if (typeof opts['baseUrl'] !== 'string' || (opts['baseUrl'] as string).length === 0) {
    throw new Error(
      `@act-spec/plugin-vitepress: 'baseUrl' is required and must be a non-empty string`,
    );
  }
  const manifest = opts['manifest'];
  if (manifest === undefined || manifest === null || typeof manifest !== 'object') {
    throw new Error(`@act-spec/plugin-vitepress: 'manifest' is required and must be an object`);
  }
  const site = (manifest as Record<string, unknown>)['site'];
  if (site === undefined || site === null || typeof site !== 'object') {
    throw new Error(
      `@act-spec/plugin-vitepress: 'manifest.site' is required and must be an object`,
    );
  }
  if (typeof (site as Record<string, unknown>)['name'] !== 'string') {
    throw new Error(
      `@act-spec/plugin-vitepress: 'manifest.site.name' is required and must be a string`,
    );
  }
  const urlTemplates = opts['urlTemplates'];
  if (urlTemplates === undefined || urlTemplates === null || typeof urlTemplates !== 'object') {
    throw new Error(
      `@act-spec/plugin-vitepress: 'urlTemplates' is required and must be an object`,
    );
  }
  const target = opts['conformanceTarget'];
  if (
    target !== undefined &&
    target !== 'core' &&
    target !== 'standard' &&
    target !== 'strict'
  ) {
    throw new Error(
      `@act-spec/plugin-vitepress: invalid 'conformanceTarget' value ${JSON.stringify(target)}`,
    );
  }
  const parseMode = opts['parseMode'];
  if (parseMode !== undefined && parseMode !== 'coarse' && parseMode !== 'fine') {
    throw new Error(
      `@act-spec/plugin-vitepress: invalid 'parseMode' value ${JSON.stringify(parseMode)} (expected "coarse" | "fine")`,
    );
  }
  return opts as unknown as VitePressActOptions;
}

/**
 * Resolve the ACT output directory. Defaults to VitePress's resolved
 * `outDir` (typically `<root>/.vitepress/dist`); override via
 * `options.outputDir`.
 */
export function resolveOutputDir(
  siteConfig: VitePressSiteConfig | undefined,
  override: string | undefined,
): string {
  if (typeof override === 'string' && override.length > 0) {
    return path.isAbsolute(override) ? path.resolve(override) : path.resolve(override);
  }
  const root = siteConfig?.root ?? process.cwd();
  const outDir = siteConfig?.outDir ?? path.join(root, '.vitepress', 'dist');
  return path.isAbsolute(outDir) ? outDir : path.resolve(root, outDir);
}

/**
 * Resolve the markdown source directory. Defaults to VitePress's
 * `srcDir`, falling back to `root`. Used by the auto-wired markdown
 * adapter when no `adapters` override is provided.
 */
export function resolveSourceDir(siteConfig: VitePressSiteConfig | undefined): string {
  const root = siteConfig?.root ?? process.cwd();
  const srcDir = siteConfig?.srcDir ?? root;
  return path.isAbsolute(srcDir) ? srcDir : path.resolve(root, srcDir);
}

/**
 * Extract the locale codes VitePress's `locales` config declares. Each
 * non-`'root'` key in `locales` represents a non-default URL prefix; its
 * `lang` (when present) is the BCP-47 code.
 *
 * Returns the deduplicated, sorted list of `lang` codes (including the
 * site-wide `lang` when set). Empty array when `locales` is undefined.
 */
export function extractLocales(siteConfig: VitePressSiteConfig | undefined): string[] {
  if (!siteConfig) return [];
  const out = new Set<string>();
  if (typeof siteConfig.lang === 'string' && siteConfig.lang.length > 0) {
    out.add(siteConfig.lang);
  }
  const locales = siteConfig.locales;
  if (locales !== undefined) {
    for (const entry of Object.values(locales)) {
      if (typeof entry?.lang === 'string' && entry.lang.length > 0) {
        out.add(entry.lang);
      }
    }
  }
  return [...out].sort();
}

/** Derive the achieved conformance band from observed emissions. */
export function detectAchievedBand(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  return inferAchievedLevel(observed);
}

/**
 * Translate `VitePressActOptions` + a captured VitePress `SiteConfig`
 * into a fully-formed `GeneratorConfig`. Public so a programmatic
 * harness (or a downstream conformance gate) can build a config without
 * going through VitePress's hook lifecycle.
 */
export function resolveConfig(args: {
  options: VitePressActOptions;
  siteConfig: VitePressSiteConfig | undefined;
  outputDir: string;
}): GeneratorConfig {
  const { options, siteConfig, outputDir } = args;
  const target = options.conformanceTarget ?? DEFAULT_CONFORMANCE_TARGET;

  // parseMode "fine" against conformanceTarget "core" is rejected by the
  // markdown adapter (PRD-201-R23). Surface the failure here, before the
  // adapter is constructed, so VitePress's build halts cleanly.
  if (options.parseMode === 'fine' && target === 'core') {
    throw new Error(
      `@act-spec/plugin-vitepress: parseMode "fine" requires conformanceTarget >= "standard"; got "core"`,
    );
  }

  const sourceDir = resolveSourceDir(siteConfig);
  const explicitAdapters = options.adapters;
  // Default the markdown adapter's `mode` to "fine" when the caller is
  // targeting "standard" (the runbook-spec default); the markdown adapter
  // declares "core" under "coarse" mode and "standard" under "fine" mode.
  // PRD-200-R24's level-cap check then accepts the configured target.
  const adapterMode: 'coarse' | 'fine' =
    options.parseMode ?? (target === 'core' ? 'coarse' : 'fine');
  const autoAdapter: GeneratorConfig['adapters'][number] = {
    adapter: createMarkdownAdapter(),
    config: {
      sourceDir,
      mode: adapterMode,
      targetLevel: target,
    },
    actVersion: '0.1',
  };
  const adapters = explicitAdapters ?? [autoAdapter];

  const cfg: GeneratorConfig = {
    conformanceTarget: target,
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
    ...(options.emit !== undefined ? { emit: options.emit } : {}),
  };
  return cfg;
}

/**
 * Programmatic build entry. The plugin's `buildEnd` hook calls this;
 * test harnesses + downstream tooling can call it directly to bypass
 * VitePress's lifecycle when running on a fixture.
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  hooks?: VitePressActOptions['hooks'];
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
    verifyCapabilityBacking(outcome.capabilities, report.files);
    if (opts.hooks?.postBuild) await opts.hooks.postBuild(buildCtx, report);
    return report;
  } catch (err) {
    if (opts.hooks?.onError) await opts.hooks.onError(buildCtx, err);
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/**
 * Public factory. Returns a VitePress-shaped plugin object with
 * `transformPageData` + `buildEnd` hooks. Spread into VitePress's
 * `defineConfig`:
 *
 *   import { defineConfig } from 'vitepress';
 *   import { actPlugin } from '@act-spec/plugin-vitepress';
 *
 *   const act = actPlugin({
 *     baseUrl: 'https://example.com',
 *     manifest: { site: { name: 'Example Docs' } },
 *     urlTemplates: { indexUrl: '/act/index.json', nodeUrlTemplate: '/act/n/{id}.json' },
 *   });
 *
 *   export default defineConfig({
 *     title: 'Example Docs',
 *     transformPageData: act.transformPageData,
 *     buildEnd: act.buildEnd,
 *   });
 *
 * The factory:
 *   1. Validates options.
 *   2. Subscribes `transformPageData` for per-page metadata accumulation
 *      (locale traversal happens here).
 *   3. Subscribes `buildEnd` for the single ACT pipeline emission.
 */
export function actPlugin(options: VitePressActOptions): ActVitePressPlugin {
  const validated = validateOptions(options);

  const state: ActVitePressPluginState = {
    options: validated,
    pages: [],
    observedLocales: [],
    lastSiteConfig: undefined,
    lastOutputDir: undefined,
    invocations: 0,
  };

  const transformPageData: ActVitePressPlugin['transformPageData'] = (pageData, ctx) => {
    state.pages.push(pageData);
    state.lastSiteConfig = ctx.siteConfig;

    // Accumulate observed locales — page-attached `lang` takes precedence
    // over the site-wide / per-locale config since VitePress already
    // resolves the per-page locale before invoking `transformPageData`.
    const set = new Set(state.observedLocales);
    if (typeof pageData.lang === 'string' && pageData.lang.length > 0) {
      set.add(pageData.lang);
    }
    for (const lang of extractLocales(ctx.siteConfig)) set.add(lang);
    state.observedLocales = [...set].sort();
  };

  const buildEnd: ActVitePressPlugin['buildEnd'] = async (siteConfig) => {
    state.invocations += 1;
    state.lastSiteConfig = siteConfig;
    const outputDir = resolveOutputDir(siteConfig, validated.outputDir);
    state.lastOutputDir = outputDir;
    const config = resolveConfig({ options: validated, siteConfig, outputDir });
    await runActBuild({
      config,
      ...(validated.hooks !== undefined ? { hooks: validated.hooks } : {}),
    });
  };

  return {
    transformPageData,
    buildEnd,
    __act: state,
  };
}

export const VITEPRESS_PACKAGE_NAME = PACKAGE_NAME;
export const VITEPRESS_PACKAGE_VERSION = PACKAGE_VERSION;

/** Default export — `defineConfig` consumers can `import act from '@act-spec/plugin-vitepress'`. */
export default actPlugin;

/**
 * Page accumulator surface — exposed for tests + custom orchestration
 * that wants to feed pages through without going through VitePress's
 * hook plumbing. `pages` is the running list captured by
 * `transformPageData`; callers that build pages programmatically can
 * push directly into it before invoking `buildEnd`.
 */
export type AccumulatedPages = readonly VitePressPageData[];

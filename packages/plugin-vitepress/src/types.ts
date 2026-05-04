/**
 * @act-spec/plugin-vitepress — public type surface.
 *
 * The package treats `vitepress` as an OPTIONAL peer dependency
 * (per `package.json` `peerDependenciesMeta`); we re-declare the
 * structural slice of VitePress's config + hook payloads the factory
 * consumes. The structural shape matches VitePress 1.x / 2.x
 * `defineConfig` and the documented `transformPageData` / `buildEnd`
 * hook signatures (https://vitepress.dev/reference/site-config#build-hooks).
 *
 * Consumers who have VitePress installed pass real values through
 * unchanged — TypeScript's structural typing accepts VitePress's own
 * `SiteConfig` / `PageData` because their declared fields are a strict
 * superset of what we read here.
 */
import type { GeneratorConfig } from '@act-spec/generator-core';

/**
 * Structural slice of VitePress's `LocaleConfig` map (the shape behind
 * `defineConfig({ locales: { … } })`). Each entry's `lang` plus its key
 * (the URL prefix, `'root'` for the default locale) is what the plugin
 * threads into the ACT locale tree.
 */
export interface VitePressLocaleEntry {
  lang?: string;
  label?: string;
  link?: string;
}

/**
 * Structural slice of VitePress's `PageData` as exposed to
 * `transformPageData`. VitePress passes additional fields; we only read
 * the ones below.
 */
export interface VitePressPageData {
  /** Source-relative path, e.g. `guide/getting-started.md`. */
  relativePath: string;
  /** Page title (frontmatter or first H1). */
  title?: string;
  /** Frontmatter `description`. */
  description?: string;
  /** Frontmatter object, raw. */
  frontmatter?: Record<string, unknown>;
  /** Lang code attached by VitePress when locales are configured. */
  lang?: string;
  /** Last-updated timestamp (ms epoch) when `lastUpdated` is enabled. */
  lastUpdated?: number;
}

/**
 * Structural slice of VitePress's `SiteConfig` as exposed to the
 * `transformPageData` and `buildEnd` hook contexts. VitePress includes
 * far more fields (markdown plugins, theme, vue, vite, etc.); the
 * plugin only reads the ones below.
 */
export interface VitePressSiteConfig {
  /** Project root (defaults to `process.cwd()`). */
  root?: string;
  /** Source dir relative to root (default: same as root). */
  srcDir?: string;
  /** Build output dir; default `<root>/.vitepress/dist`. */
  outDir?: string;
  /** Per-locale config map. `'root'` is the default. */
  locales?: Record<string, VitePressLocaleEntry>;
  /** Site-wide language. */
  lang?: string;
  /** Canonical site title. */
  title?: string;
  /** Site description. */
  description?: string;
}

/**
 * The `buildEnd` hook payload VitePress hands plugins. Mirrors the
 * documented `(siteConfig: SiteConfig) => Promise<void> | void` signature.
 */
export type VitePressBuildEndHook = (siteConfig: VitePressSiteConfig) => Promise<void> | void;

/**
 * The `transformPageData` hook signature. VitePress invokes it for every
 * page; the plugin uses it to accumulate per-page metadata so `buildEnd`
 * has the full page set without re-walking the file system.
 */
export type VitePressTransformPageDataHook = (
  pageData: VitePressPageData,
  ctx: { siteConfig: VitePressSiteConfig },
) => Promise<void> | void;

/**
 * Public options surface for the plugin factory.
 *
 * Strict subset of `GeneratorConfig`. The plugin translates this shape
 * into a fully-formed `GeneratorConfig` before invoking the pipeline.
 */
export interface VitePressActOptions {
  /** Required — the deployment origin. Used as `manifest.site.canonical_url` when not overridden. */
  baseUrl: string;
  /** Required — site identity for the manifest. */
  manifest: { site: { name: string; description?: string; canonical_url?: string } };
  /** Required — URL templates for index / nodes / subtrees. */
  urlTemplates: NonNullable<GeneratorConfig['urlTemplates']>;
  /** Default `'standard'` (per the runbook spec). */
  conformanceTarget?: 'core' | 'standard' | 'strict';
  /** Override VitePress's resolved `outDir` for ACT artifacts (rare). */
  outputDir?: string;
  /** Default `false`. */
  failOnExtractionError?: boolean;
  /** Default `false`; VitePress already manages its own dev rebuild. */
  incremental?: boolean;
  /** Escape hatch — replaces the auto-wired markdown adapter. */
  adapters?: GeneratorConfig['adapters'];
  /** Body-to-block parse mode forwarded to the auto-wired markdown adapter. */
  parseMode?: 'coarse' | 'fine';
  /**
   * Toggles for the back-compat surface emitted at the site root. Defaults
   * are pulled from `GeneratorConfig.emit` (both llmsTxt + llmsFullTxt
   * default to ON). Setting `emit.llmsTxt: false` opts out.
   */
  emit?: GeneratorConfig['emit'];
  /** Pipeline lifecycle hooks. */
  hooks?: {
    preBuild?: (...args: unknown[]) => unknown;
    postBuild?: (...args: unknown[]) => unknown;
    onError?: (...args: unknown[]) => unknown;
  };
}

/**
 * The plugin object returned by `actPlugin(options)`. Spread into
 * VitePress's `defineConfig({ ...actPlugin(opts) })` so VitePress wires
 * its `transformPageData` and `buildEnd` hooks unchanged.
 *
 * The `__act` field is a non-enumerable observability handle for tests +
 * downstream tooling; VitePress ignores unknown config keys.
 */
export interface ActVitePressPlugin {
  transformPageData: VitePressTransformPageDataHook;
  buildEnd: VitePressBuildEndHook;
  __act: ActVitePressPluginState;
}

/** Internal state surfaced for tests + observability. */
export interface ActVitePressPluginState {
  /** Resolved options, post-validation. */
  options: VitePressActOptions;
  /** Pages accumulated via `transformPageData` for the current build. */
  pages: VitePressPageData[];
  /** Locale codes observed across `pages` (sorted, unique). */
  observedLocales: string[];
  /** Captured site config from the most recent `buildEnd` invocation. */
  lastSiteConfig: VitePressSiteConfig | undefined;
  /** Last computed output dir (used by `buildEnd`). */
  lastOutputDir: string | undefined;
  /** Total `buildEnd` invocations seen. */
  invocations: number;
}

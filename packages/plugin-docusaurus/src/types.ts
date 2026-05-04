/**
 * PRD-404 Docusaurus plugin — public type surface.
 *
 * The package treats `@docusaurus/types` and `@docusaurus/core` as optional
 * peer dependencies (per PRD-404-R2 / package.json `peerDependenciesMeta`),
 * so we re-declare the structural slice of Docusaurus's plugin API the
 * factory consumes. The structural shape matches Docusaurus 3.x's
 * `Plugin<Content>` / `LoadContext` exports; consumers who have Docusaurus
 * installed pass the real values through unchanged.
 */
import type { GeneratorConfig } from '@act-spec/generator-core';

/**
 * Structural slice of Docusaurus's `LoadContext`. Real Docusaurus passes
 * many additional fields; the plugin only reads what is declared here.
 */
export interface DocusaurusLoadContext {
  siteDir: string;
  generatedFilesDir?: string;
  outDir: string;
  baseUrl: string;
  siteConfig: DocusaurusSiteConfig;
  i18n: DocusaurusI18nConfig;
}

export interface DocusaurusSiteConfig {
  title: string;
  url: string;
  baseUrl: string;
  presets?: unknown[];
  plugins?: unknown[];
  /** Optional logger surface; mirrors Docusaurus's `siteConfig`. */
  logger?: PluginLogger;
}

/** PRD-404-R9 — Docusaurus i18n configuration shape. */
export interface DocusaurusI18nConfig {
  defaultLocale: string;
  locales: readonly string[];
  /** Per-locale overrides — unused by the plugin in v0.1. */
  localeConfigs?: Record<string, unknown>;
}

/**
 * PRD-404-R6 / R8 — sidebars.js shape (subset). Mirrors Docusaurus's
 * resolved sidebar declaration after `sidebars.js` is required.
 */
export type SidebarItem = SidebarDocItem | SidebarCategoryItem | SidebarLinkItem | string;

export interface SidebarDocItem {
  type: 'doc';
  id: string;
}

export interface SidebarCategoryItem {
  type: 'category';
  label: string;
  description?: string;
  items: SidebarItem[];
}

export interface SidebarLinkItem {
  type: 'link';
  label: string;
  href: string;
}

export interface ResolvedSidebars {
  /** The default `docs` sidebar. Multi-sidebar sites add additional keys. */
  [sidebarKey: string]: SidebarItem[];
}

/** PRD-404-R4 — `LoadedContent` returned from `loadContent`. */
export interface LoadedContent {
  docsInstances: ResolvedDocsContent[];
  blogContent?: ResolvedBlogContent;
  pagesContent?: ResolvedPagesContent;
  sidebars: ResolvedSidebars;
  versions?: VersionedContent;
  locales: ResolvedLocales;
}

export interface ResolvedDocsContent {
  /** Plugin-instance id — `default` when only one docs instance is wired. */
  id: string;
  /** Absolute path to the docs source directory. */
  path: string;
}

export interface ResolvedBlogContent {
  path: string;
}

export interface ResolvedPagesContent {
  /** Whether `src/pages/**` contains React-component sources. */
  hasReactPages: boolean;
}

export interface VersionedContent {
  /** Versions present in `versions.json`, in display order. */
  included: VersionedDocsEntry[];
}

export interface VersionedDocsEntry {
  id: string;
  path: string;
}

export interface ResolvedLocales {
  defaultLocale: string;
  locales: readonly string[];
  /** Active locale — the locale currently being built. */
  activeLocale: string;
}

/**
 * PRD-404-R16 — public options surface. The shape extends a
 * Docusaurus-compatible subset of `GeneratorConfig` (without `outputDir` and
 * `baseUrl`, which the plugin resolves from `LoadContext`).
 */
export interface ActDocusaurusOptions
  extends Partial<Omit<GeneratorConfig, 'outputDir' | 'site'>> {
  /** Override target conformance level. Default `"core"`. */
  target?: 'core' | 'standard' | 'strict';

  /** Override extraction mode for embedded React. Default `"static-ast"`. */
  extractMode?: 'ssr-walk' | 'static-ast';

  /**
   * Body-to-block parse mode forwarded to PRD-201's auto-wired markdown
   * adapter (PRD-201-R12). `"coarse"` (default) emits one `markdown` block
   * per file; `"fine"` splits into prose / code / data / callout blocks.
   * Setting `"fine"` against `target: "core"` fails at init per
   * PRD-201-R23. Added per amendment A2 (PRD-404-R16,
   * MINOR bump per PRD-108-R4(1)).
   */
  parseMode?: 'coarse' | 'fine';

  /** Disable i18n auto-wiring (default: auto-wire when locales > 1). */
  i18n?: boolean | { pattern: '1' | '2' };

  /** Scope versioned-docs emission. */
  versions?: false | { include: string[] };

  /** Site identity override; defaults read from Docusaurus `siteConfig`. */
  site?: GeneratorConfig['site'];

  /** Docusaurus-specific extensions. */
  docusaurus?: {
    /** Which docs-plugin instance to wire (multi-docs deployments). */
    docsInstance?: string;
    /** Skip blog wiring entirely. */
    skipBlog?: boolean;
    /** Plugin-instance `id` honored by Docusaurus per PRD-404-R3. */
    id?: string;
  };
}

/** PRD-404-R17 — minimum logger surface the plugin plumbs. */
export interface PluginLogger {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/**
 * PRD-404-R1 / R4 — Docusaurus `Plugin<LoadedContent>`-compatible shape.
 * Real `@docusaurus/types` `Plugin<C>` is wider; we declare only the methods
 * the factory wires.
 */
export interface ActDocusaurusPlugin {
  name: string;
  loadContent(): Promise<LoadedContent> | LoadedContent;
  contentLoaded(args: {
    content: LoadedContent;
    actions: { setGlobalData?: (data: unknown) => void };
  }): Promise<void> | void;
  postBuild(args: { outDir: string; content: LoadedContent }): Promise<void> | void;
}

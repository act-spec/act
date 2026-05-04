/**
 * @act-spec/plugin-docusaurus — PRD-404 Docusaurus generator leaf.
 *
 * Public API. The PRD-400 generator framework lives in
 * `@act-spec/generator-core` (per ADR-006). This package consumes the
 * framework via dependency import, NOT by re-implementing it. PRD-201's
 * markdown adapter is consumed unchanged from `@act-spec/adapter-markdown`.
 *
 * Default export: a Docusaurus `Plugin<LoadedContent>`-compatible factory
 * registered via `docusaurus.config.js`:
 *
 * ```js
 * plugins: [["@act-spec/plugin-docusaurus", { /* options *\/ }]]
 * ```
 */
export const DOCUSAURUS_PACKAGE_NAME = '@act-spec/plugin-docusaurus' as const;

// PRD-404 leaf surface.
export type {
  ActDocusaurusOptions,
  ActDocusaurusPlugin,
  DocusaurusI18nConfig,
  DocusaurusLoadContext,
  DocusaurusSiteConfig,
  LoadedContent,
  PluginLogger,
  ResolvedBlogContent,
  ResolvedDocsContent,
  ResolvedLocales,
  ResolvedPagesContent,
  ResolvedSidebars,
  SidebarCategoryItem,
  SidebarDocItem,
  SidebarItem,
  SidebarLinkItem,
  VersionedContent,
  VersionedDocsEntry,
} from './types.js';

export {
  actDocusaurusPlugin,
  applySidebarMappingToNodes,
  discoverContent,
  evaluateSidebarsModule,
  isDocusaurusVersionSupported,
  resolveConfig,
  runActBuild,
} from './plugin.js';

export {
  deriveParentChildren,
  ensureNoCategoryDocCollision,
  findOrphanDocs,
  sanitizeCategoryId,
  type SidebarMapping,
  type SyntheticCategoryNode,
} from './sidebar.js';

export { detectAchievedBand, type ObservedDocusaurusEmissions } from './conformance.js';

// Default export — Docusaurus convention: `plugins: [["@act-spec/plugin-docusaurus", {...}]]`.
export { actDocusaurusPlugin as default } from './plugin.js';

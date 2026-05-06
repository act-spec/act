/**
 * PRD-404 Docusaurus plugin — entry point. Implements the Docusaurus
 * plugin lifecycle (`loadContent` / `contentLoaded` / `postBuild`) and
 * delegates pipeline execution to `@act-spec/generator-core`.
 *
 * Library choices (ADR-006):
 *   - The PRD-400 framework is consumed from `@act-spec/generator-core`,
 *     not re-implemented locally. PRD-201's markdown adapter is consumed
 *     from `@act-spec/adapter-markdown`. No adapter logic is duplicated
 *     here — the plugin is pure glue between Docusaurus's lifecycle and
 *     generator-core's pipeline (avoiding the "generator overreach"
 *     anti-pattern).
 *   - The plugin is structurally typed against the slice declared in
 *     `./types.ts` and does not import from `@docusaurus/core` or
 *     `@docusaurus/types` at runtime. We deliberately do NOT declare them
 *     as peer dependencies: with `auto-install-peers=true` (common in
 *     pnpm workspaces) a peer entry would cause pnpm to install a
 *     parallel `@docusaurus/core` under the plugin's `node_modules`,
 *     creating a duplicate Docusaurus tree alongside the consumer's own.
 *     Compatibility with Docusaurus 3.x is documented in the README.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';

import {
  cleanupTmp,
  emitFiles,
  runPipeline,
  verifyCapabilityBacking,
  type BuildReport,
  type GeneratorConfig,
} from '@act-spec/generator-core';

import {
  ensureNoCategoryDocCollision,
  findOrphanDocs,
  type SidebarMapping,
} from './sidebar.js';
import type {
  ActDocusaurusOptions,
  ActDocusaurusPlugin,
  DocusaurusLoadContext,
  LoadedContent,
  PluginLogger,
  ResolvedDocsContent,
  ResolvedSidebars,
} from './types.js';

const PACKAGE_NAME = '@act-spec/plugin-docusaurus' as const;
const PACKAGE_VERSION = '0.0.0' as const;
const DOCUSAURUS_PEER_FLOOR = 3 as const;

/* v8 ignore start */
function defaultLogger(prefix: string): Required<PluginLogger> {
  return {
    debug: (m: string) => console.error(`${prefix} debug: ${m}`),
    info: (m: string) => console.warn(`${prefix}: ${m}`),
    warn: (m: string) => console.warn(`${prefix} warn: ${m}`),
    error: (m: string) => console.error(`${prefix} error: ${m}`),
  };
}
/* v8 ignore stop */

/**
 * PRD-404-R2 — peer-dependency floor probe. The default export refuses to
 * load against Docusaurus < 3.x. Exported for testing.
 */
export function isDocusaurusVersionSupported(version: string): boolean {
  const m = /^v?(\d+)\./.exec(version);
  if (m === null) return false;
  return Number(m[1]) === DOCUSAURUS_PEER_FLOOR;
}

/**
 * PRD-404-R16 — turn `ActDocusaurusOptions` into a fully-resolved
 * `GeneratorConfig`. Public so the conformance gate can build a config
 * without going through Docusaurus's lifecycle.
 *
 * `parseMode` (per A2 amendment) is forwarded to every auto-wired
 * markdown adapter via `MarkdownAdapterConfig.mode`. `parseMode: "fine"`
 * against `target: "core"` is a hard error at this stage — the plugin
 * surfaces the underlying PRD-201-R23 level-mismatch verbatim.
 */
export function resolveConfig(
  options: ActDocusaurusOptions,
  context: DocusaurusLoadContext,
): GeneratorConfig {
  const target = options.target ?? 'core';

  // PRD-404-R16 / A2 — parseMode pre-flight check before any adapter is
  // constructed. The error text mirrors PRD-201-R23 verbatim per A2.
  if (options.parseMode === 'fine' && target === 'core') {
    throw new Error(
      'PRD-404-R16 / PRD-201-R23: parseMode "fine" requires target >= "standard"; got target "core"',
    );
  }

  // PRD-404-R5 — auto-wire PRD-201 to docs (and blog unless skipped).
  const autoAdapters = (() => {
    const list: GeneratorConfig['adapters'] = [];
    const docsRoot = path.join(context.siteDir, 'docs');
    list.push({
      adapter: createMarkdownAdapter(),
      config: {
        sourceDir: docsRoot,
        ...(options.parseMode !== undefined ? { mode: options.parseMode } : {}),
      },
      actVersion: '0.1',
    });
    if (options.docusaurus?.skipBlog !== true) {
      const blogRoot = path.join(context.siteDir, 'blog');
      list.push({
        adapter: createMarkdownAdapter(),
        config: {
          sourceDir: blogRoot,
          ...(options.parseMode !== undefined ? { mode: options.parseMode } : {}),
        },
        actVersion: '0.1',
      });
    }
    return list;
  })();

  // PRD-404-R16 — `outputDir` and `baseUrl` resolved from Docusaurus, NOT
  // user-overridable. (Spec text: "users MUST NOT override".)
  const cfg: GeneratorConfig = {
    conformanceTarget: target,
    outputDir: context.outDir,
    adapters: options.adapters ?? autoAdapters,
    site: options.site ?? {
      name: context.siteConfig.title,
      canonical_url: context.siteConfig.url + (context.baseUrl || '/'),
    },
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
 * PRD-404-R4 first bullet — discover content sources. Reads docs / blog
 * directories, requires `sidebars.js`, surfaces locale + version metadata.
 */
export async function discoverContent(
  context: DocusaurusLoadContext,
  options: ActDocusaurusOptions,
): Promise<LoadedContent> {
  const docsInstanceId = options.docusaurus?.docsInstance ?? 'default';
  const docsInstances: ResolvedDocsContent[] = [
    { id: docsInstanceId, path: path.join(context.siteDir, 'docs') },
  ];

  // Resolve sidebars.js if present. Use a dynamic import so the plugin
  // works against either CJS (`module.exports = {...}`) or ESM exports.
  const sidebars = await loadSidebars(context.siteDir);

  const blogContent =
    options.docusaurus?.skipBlog !== true
      ? { path: path.join(context.siteDir, 'blog') }
      : undefined;

  const locales = {
    defaultLocale: context.i18n.defaultLocale,
    locales: context.i18n.locales,
    activeLocale: context.i18n.defaultLocale,
  };

  const versions = await loadVersionedDocsManifest(context.siteDir);

  const out: LoadedContent = {
    docsInstances,
    sidebars,
    locales,
    ...(blogContent !== undefined ? { blogContent } : {}),
    ...(versions !== undefined ? { versions } : {}),
  };
  return out;
}

async function loadSidebars(siteDir: string): Promise<ResolvedSidebars> {
  const candidates = [
    path.join(siteDir, 'sidebars.js'),
    path.join(siteDir, 'sidebars.cjs'),
    path.join(siteDir, 'sidebars.mjs'),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const text = await fs.readFile(candidate, 'utf8');
    return evaluateSidebarsModule(text);
  }
  return {};
}

/**
 * Internal — minimal `sidebars.js` evaluator. The fixture suite uses CJS
 * `module.exports = { docs: [...] }` shape; the evaluator runs the file in
 * a sandboxed Function with `module` and `exports` shims. This is
 * intentionally tighter than `require()` because (a) the sidebars file is
 * already trusted (PRD-109's source-repository trust boundary) and (b)
 * full Node `require` would fight ESM resolution.
 */
export function evaluateSidebarsModule(src: string): ResolvedSidebars {
  // The sidebars file lives inside the source repository (PRD-109's trust
  // boundary — same posture as Docusaurus's own `require('./sidebars.js')`
  // call). We sandbox via the Function constructor with `module`/`exports`
  // shims rather than `require()` (which fights ESM resolution). The
  // explicit eslint-disable is intentional and documented per the
  // Security section of PRD-404 (versioned-docs trust boundary cite).
  const moduleObj: { exports: unknown } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', src) as (
    m: typeof moduleObj,
    e: unknown,
  ) => void;
  fn(moduleObj, moduleObj.exports);
  const exported = moduleObj.exports;
  if (exported === null || typeof exported !== 'object') {
    throw new Error('PRD-404-R6: sidebars module did not export an object');
  }
  return exported as ResolvedSidebars;
}

async function loadVersionedDocsManifest(siteDir: string): Promise<LoadedContent['versions']> {
  const versionsJson = path.join(siteDir, 'versions.json');
  let raw: string;
  try {
    raw = await fs.readFile(versionsJson, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `PRD-404-R8: versions.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('PRD-404-R8: versions.json MUST be a JSON array of version IDs');
  }
  const included = parsed.map((id) => ({
    id: String(id),
    path: path.join(siteDir, 'versioned_docs', `version-${String(id)}`),
  }));
  return { included };
}

/**
 * PRD-404-R6 — apply sidebar-derived parent / children to a flat list of
 * already-emitted nodes. Mutates each node's `parent` and emits synthesized
 * category nodes (as plain `Node` shapes) when categories contained docs.
 *
 * Returns the augmented node list and the mapping diagnostics so callers
 * can record warnings (orphans, duplicates, skipped links) in the build
 * report.
 */
export function applySidebarMappingToNodes(
  nodes: Array<{ id: string; type: string; title: string; summary?: string; parent?: string; children?: string[] }>,
  mapping: SidebarMapping,
): {
  nodes: typeof nodes;
  syntheticEmissions: typeof nodes;
  orphanDocs: string[];
} {
  const realDocIds = new Set<string>(nodes.map((n) => n.id));
  ensureNoCategoryDocCollision(mapping.syntheticNodes, realDocIds);

  for (const node of nodes) {
    const parent = mapping.parentMap.get(node.id);
    if (parent !== undefined) node.parent = parent;
  }

  const syntheticEmissions = mapping.syntheticNodes.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    summary: s.summary,
    children: [...s.children],
    ...(s.parent !== undefined ? { parent: s.parent } : {}),
  }));

  const orphanDocs = findOrphanDocs(realDocIds, mapping);

  return { nodes, syntheticEmissions, orphanDocs };
}

/**
 * PRD-404-R5 — programmatic build entry. Mirrors `@act-spec/plugin-astro`'s
 * `runActBuild`: takes a fully-resolved `GeneratorConfig` and runs the
 * generator-core pipeline + emission + capability backing. Used by the
 * plugin's `postBuild` hook AND by the conformance gate.
 */
export async function runActBuild(opts: {
  config: GeneratorConfig;
  logger?: PluginLogger;
}): Promise<BuildReport> {
  const logger = opts.logger ?? defaultLogger('act-docusaurus');
  const startedAt = Date.now();
  try {
    const outcome = await runPipeline({
      config: opts.config,
      logger: {
        debug: logger.debug ?? logger.info,
        info: logger.info,
        warn: logger.warn,
        error: logger.error,
      },
    });
    const report = await emitFiles({
      outcome,
      outputDir: opts.config.outputDir,
      config: opts.config,
      startedAt,
    });
    verifyCapabilityBacking(outcome.capabilities, report.files);
    return report;
  } catch (err) {
    // PRD-404-R13 — clean up tmp files inside ACT-owned paths.
    await cleanupTmp([
      path.join(opts.config.outputDir, '.well-known'),
      path.join(opts.config.outputDir, 'act'),
    ]);
    throw err;
  }
}

/**
 * PRD-404-R1 / R4 — public factory. Returns a Docusaurus
 * `Plugin<LoadedContent>`-compatible object. The Docusaurus types are not
 * imported at runtime to keep the package usable without a Docusaurus
 * install (Docusaurus is a peerDep).
 */
export function actDocusaurusPlugin(
  context: DocusaurusLoadContext,
  options: ActDocusaurusOptions = {},
): ActDocusaurusPlugin {
  let cachedConfig: GeneratorConfig | undefined;

  function resolved(): GeneratorConfig {
    cachedConfig ??= resolveConfig(options, context);
    return cachedConfig;
  }

  // PRD-404-R16 — pre-flight `parseMode` check at factory time so config
  // errors surface before Docusaurus enters its own lifecycle.
  resolved();

  return {
    name: PACKAGE_NAME,

    async loadContent(): Promise<LoadedContent> {
      return discoverContent(context, options);
    },

    contentLoaded(args): void {
      // No-op in v0.1: the pipeline runs from `postBuild`. The hook is
      // implemented to satisfy PRD-404-R4's lifecycle declaration.
      void args;
    },

    async postBuild(args): Promise<void> {
      // Docusaurus passes the resolved `outDir`; if it disagrees with the
      // resolved config (rare — multi-instance with custom outDir), prefer
      // Docusaurus's resolution (PRD-404-R16: outputDir defaults to
      // Docusaurus's resolved outDir).
      const cfg = resolveConfig(options, { ...context, outDir: args.outDir });
      cachedConfig = cfg;
      const logger = context.siteConfig.logger;
      await runActBuild({
        config: cfg,
        ...(logger !== undefined ? { logger } : {}),
      });
    },
  };
}

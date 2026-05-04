/**
 * PRD-400 generator pipeline — framework code shared by every leaf generator.
 *
 * Extracted from `@act-spec/plugin-astro` per ADR-006 (trigger: ADR-004 §"Seam 2"
 * + Phase 6.2 Track B beginning with PRD-404 Docusaurus). Every first-party
 * generator (PRD-401 Astro, PRD-404 Docusaurus, PRD-405 Next.js, PRD-406
 * Remix, PRD-407 Nuxt, PRD-408 Eleventy, PRD-409 CLI) imports the pipeline,
 * envelope builders, and capability/pinning helpers from this module.
 *
 * Every export cites a PRD-400 requirement and is exercised by at least one
 * test in `pipeline.test.ts`.
 */
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  AdapterRunResult,
} from '@act-spec/adapter-framework';
import {
  bubbleManifestCapabilities,
  checkAdapterPinning,
  mergeRuns,
  runAdapter,
} from '@act-spec/adapter-framework';
import {
  deriveEtag,
  stripEtag,
  validateIndex,
  validateManifest,
  validateNode,
  validateSubtree,
} from '@act-spec/validator';
import type { ManifestSchema, IndexSchema, SubtreeSchema, NodeSchema } from '@act-spec/core';

import { emitLlmsTxt } from './emitters/llms-txt.js';
import {
  DEFAULT_LLMS_FULL_MAX_BYTES,
  emitLlmsFullTxt,
  nodeFetcherFromArray,
} from './emitters/llms-full-txt.js';

const ACT_VERSION = '0.1' as const;

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** PRD-400-R31 — minimal generator config shape. */
export interface GeneratorConfig {
  /** Conformance target. */
  conformanceTarget: 'core' | 'standard' | 'strict';
  /** Output dir (Astro: dist/). */
  outputDir: string;
  /** Adapter list. */
  adapters: Array<{
    adapter: Adapter<unknown>;
    config: Record<string, unknown>;
    /** Stage 1 — adapter package's declared act_version. */
    actVersion?: string;
    /** Stage 2 — adapter package's declared MINOR set. */
    actSpecMinors?: readonly string[];
  }>;
  /** PRD-400-R31 — site identity. */
  site: { name: string; description?: string; canonical_url?: string };
  /** PRD-400-R31 — URL templates. */
  urlTemplates?: {
    indexUrl?: string;
    nodeUrlTemplate?: string;
    subtreeUrlTemplate?: string;
    indexNdjsonUrl?: string;
  };
  /** PRD-400-R26. */
  failOnExtractionError?: boolean;
  /** PRD-400-R22. */
  incremental?: boolean;
  /** PRD-400-R20. */
  generator?: string;
  /**
   * PRD-400-R13 — depth used when fanning out a subtree from a root node.
   * Default 3. Examples with deep graphs (e.g., a catalog with categories +
   * many products) can lower this to 1–2 to keep the root subtree small;
   * agents continue to walk via per-node `children[]` once they've fetched
   * the root subtree.
   */
  subtreeDepth?: number;
  /**
   * v0.2 §3.4 / §3.5 — toggles for the back-compat surface emitted at the
   * site root (alongside `/.well-known/act.json`). Defaults: both true.
   *
   * Plugin authors can flip these off if a particular site already
   * publishes hand-authored versions, or for sites that have a non-public
   * audience.
   */
  emit?: {
    /** Emit `/llms.txt` at site root. Default true. */
    llmsTxt?: boolean;
    /** Emit `/llms-full.txt` at site root. Default true. */
    llmsFullTxt?: boolean;
    /** Max bytes for `/llms-full.txt` (UTF-8). Default 5_000_000. */
    llmsFullTxtMaxBytes?: number;
    /**
     * Emit ACT JSON (manifest, index, nodes, subtrees) pretty-printed
     * with 2-space indentation. Default `false` — production builds ship
     * minified to keep wire payloads small (~25-30% smaller before gzip;
     * gzip recovers most of the difference but minifying still helps for
     * un-gzipped CDN edges, mobile networks, and tooling that streams JSON
     * line-by-line). Set `true` for local debugging / hand-readable
     * fixtures. The build report sidecar (`.act-build-report.json`) is
     * always pretty-printed since it's an operator-facing artefact.
     */
    prettyJson?: boolean;
  };
}

/** PRD-400-R3 — generator plugin shape. Astro's `@act-spec/plugin-astro` returns one. */
export interface GeneratorPlugin {
  name: string;
  version: string;
  hooks?: {
    preBuild?: (ctx: BuildContext) => Promise<void> | void;
    postBuild?: (ctx: BuildContext, report: BuildReport) => Promise<void> | void;
    onError?: (ctx: BuildContext, err: Error) => Promise<void> | void;
  };
  config: GeneratorConfig;
}

/** PRD-400-R24 — read-only build context surfaced to hooks. */
export interface BuildContext {
  outputDir: string;
  config: GeneratorConfig;
  logger: Logger;
}

interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** PRD-400-R27 — sidecar build report. */
export interface BuildReport {
  startedAt: string;
  durationMs: number;
  conformanceTarget: 'core' | 'standard' | 'strict';
  conformanceAchieved: 'core' | 'standard' | 'strict';
  capabilities: Record<string, unknown>;
  files: Array<{ path: string; bytes: number; etag?: string; band: 'core' | 'standard' | 'strict' }>;
  warnings: string[];
  errors: string[];
}

/** PRD-400-R8 — derive an envelope's etag deterministically per PRD-103-R6/R8. */
export function computeEtag(envelope: Record<string, unknown>): string {
  return deriveEtag(stripEtag(envelope));
}

/**
 * PRD-400-R10 — assemble the manifest from observed emissions.
 *
 * Per PRD-100-R4 the Core required field set is:
 * `act_version, site.name, index_url, node_url_template, conformance.level, delivery`.
 *
 * Per amendments-queue.md A7, the manifest's `etag` is not required; the
 * generator does not advertise an envelope-level etag here (the field is
 * absent rather than freeform per the conservative interpretation).
 */
export function buildManifest(input: {
  config: GeneratorConfig;
  adapterCapabilities: Array<AdapterCapabilities>;
  achieved: 'core' | 'standard' | 'strict';
  generatedAt: string;
  nodeCount: number;
  /**
   * When the graph has exactly one root (no parent), the pipeline supplies
   * its id here so the manifest advertises a canonical entry point. Agents
   * (and the site browser) use it to fetch the root subtree without
   * scanning the index.
   */
  rootId?: string;
}): ManifestSchema.Manifest {
  const tpl = input.config.urlTemplates ?? {};
  const indexUrl = tpl.indexUrl ?? '/act/index.json';
  const nodeUrlTemplate = tpl.nodeUrlTemplate ?? '/act/nodes/{id}.json';
  const capabilities = bubbleManifestCapabilities(input.adapterCapabilities);
  const manifest: ManifestSchema.Manifest = {
    act_version: ACT_VERSION,
    site: {
      name: input.config.site.name,
      ...(input.config.site.description !== undefined ? { description: input.config.site.description } : {}),
      ...(input.config.site.canonical_url !== undefined ? { canonical_url: input.config.site.canonical_url } : {}),
    },
    generated_at: input.generatedAt,
    ...(input.config.generator !== undefined ? { generator: input.config.generator } : {}),
    index_url: indexUrl,
    node_url_template: nodeUrlTemplate,
    ...(tpl.subtreeUrlTemplate !== undefined ? { subtree_url_template: tpl.subtreeUrlTemplate } : {}),
    ...(input.achieved === 'strict' && tpl.indexNdjsonUrl !== undefined
      ? { index_ndjson_url: tpl.indexNdjsonUrl }
      : {}),
    ...(typeof input.rootId === 'string' && input.rootId.length > 0
      ? { root_id: input.rootId }
      : {}),
    capabilities,
    conformance: { level: input.achieved },
    delivery: 'static', // PRD-400-R10
    stats: { node_count: input.nodeCount },
  };
  return manifest;
}

/** PRD-400-R11 — assemble the index from emitted nodes. */
export function buildIndex(nodes: NodeSchema.Node[]): IndexSchema.Index {
  const entries: IndexSchema.IndexEntry[] = nodes.map((n) => {
    const summary = n.summary;
    if (typeof summary !== 'string' || summary.length === 0) {
      throw new Error(`PRD-400-R11: node "${n.id}" has empty summary`);
    }
    const entry: IndexSchema.IndexEntry = {
      id: n.id,
      type: n.type,
      title: n.title,
      summary,
      tokens: { summary: n.tokens.summary },
      etag: n.etag,
    };
    if (n.parent !== undefined) entry.parent = n.parent;
    if (n.children !== undefined) entry.children = [...n.children];
    const nTags = (n as Record<string, unknown>)['tags'];
    if (Array.isArray(nTags)) entry.tags = [...(nTags as string[])];
    if (n.updated_at !== undefined) entry.updated_at = n.updated_at;
    return entry;
  });
  // Index-level etag not enforced by schema (see A7); compute conservatively
  // over the canonical bytes of `nodes` so downstream caches can compare.
  const indexBody = { act_version: ACT_VERSION, nodes: entries };
  const etag = computeEtag(indexBody);
  return { ...indexBody, etag };
}

/**
 * PRD-400-R13 — build a subtree envelope (depth 3 default, max 8).
 *
 * Progressive-disclosure shape: the **root** of the subtree is inlined as a
 * full envelope (the agent asked for that node and may want its body), but
 * **descendants** ship with `content: []` so the subtree stays
 * navigation-weight. Agents discover what's available via title / type /
 * summary / children on each descendant entry, then fetch
 * `/act/nodes/{id}.json` for the body when they decide to drill in. This
 * mirrors how the flat `index.json` carries summary-level entries; a
 * subtree is effectively a scoped index plus the chosen root in full.
 *
 * Wire-format implication: schema-valid (empty `content[]` is permitted by
 * `node.schema.json`), but a deliberate departure from PRD-100-R32-R35's
 * literal "full envelopes" wording. Logged as an amendment in
 * `docs/amendments-queue.md` (A23).
 */
export function buildSubtree(
  rootId: string,
  nodes: NodeSchema.Node[],
  depth = 3,
): SubtreeSchema.Subtree {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const root = byId.get(rootId);
  if (!root) throw new Error(`buildSubtree: unknown rootId "${rootId}"`);
  const ordered: NodeSchema.Node[] = [];
  let truncated = false;
  function dfs(id: string, currentDepth: number): void {
    const n = byId.get(id);
    if (!n) return;
    if (currentDepth === 0) {
      // Subtree root — keep the full envelope.
      ordered.push(n);
    } else {
      // Descendant — strip the body so the subtree stays a navigation
      // index. `tokens.body` and `tokens.summary` stay so agents see the
      // cost of drilling in. Other fields (children, parent, source,
      // metadata, related, tags) survive untouched so the agent has every
      // navigational signal short of the body itself.
      const summary = { ...n, content: [] } as NodeSchema.Node;
      ordered.push(summary);
    }
    if (currentDepth >= depth) {
      if ((n.children ?? []).length > 0) truncated = true;
      return;
    }
    for (const c of n.children ?? []) dfs(c, currentDepth + 1);
  }
  dfs(rootId, 0);
  // Body-token sum reports the underlying full bodies (not the elided
  // descendants' empty content[]) so the subtree advertises the *cost an
  // agent would pay* if they fetched every descendant's body — a useful
  // signal for budgeting before drilling in.
  const totalBody = ordered.reduce((acc, n, i) => {
    const original = i === 0 ? n : byId.get(n.id);
    return acc + (Number(original?.tokens.body) || 0);
  }, 0);
  const totalSummary = ordered.reduce((acc, n) => acc + (n.tokens.summary || 0), 0);
  const body = {
    act_version: ACT_VERSION,
    root: rootId,
    depth,
    truncated,
    tokens: { body: totalBody, summary: totalSummary },
    nodes: ordered as [NodeSchema.Node, ...NodeSchema.Node[]],
  };
  const etag = computeEtag(body);
  return { ...body, etag };
}

/** PRD-400-R17 — compute achieved level from observed emissions. */
export function inferAchievedLevel(observed: {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
}): 'core' | 'standard' | 'strict' {
  if (observed.hasNdjson) return 'strict';
  if (observed.hasSubtree) return 'standard';
  if (observed.hasIndex) return 'core';
  return 'core';
}

/** PRD-400-R23 — atomic write (tmp + rename). Pure on POSIX. */
export async function atomicWrite(targetPath: string, body: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, targetPath);
}

/** PRD-401-R13 — sweep `*.tmp.*` files under ACT-owned paths after error. */
export async function cleanupTmp(roots: string[]): Promise<void> {
  for (const root of roots) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(root, e.name);
      if (e.isFile() && /\.tmp\.\d+\.\d+$/.test(e.name)) {
        await fs.rm(p, { force: true });
      } else if (e.isDirectory()) {
        await cleanupTmp([p]);
      }
    }
  }
}

/** PRD-400-R32 — refuse if target exceeds any adapter's declared level. */
export function enforceTargetLevel(
  config: GeneratorConfig,
  caps: Array<AdapterCapabilities>,
): void {
  const order: Record<string, number> = { core: 0, standard: 1, strict: 2 };
  for (let i = 0; i < caps.length; i += 1) {
    const c = caps[i]!;
    if (order[config.conformanceTarget]! > order[c.level]!) {
      throw new Error(
        `PRD-400-R32: target "${config.conformanceTarget}" exceeds adapter[${i}] declared level "${c.level}"`,
      );
    }
  }
}

/** PRD-400-R29/R30 — adapter pinning enforcement via @act-spec/adapter-framework helper. */
export function enforceAdapterPinning(config: GeneratorConfig): void {
  for (const a of config.adapters) {
    checkAdapterPinning(
      {
        ...(a.actVersion !== undefined ? { actVersion: a.actVersion } : {}),
        ...(a.actSpecMinors !== undefined ? { actSpecMinors: a.actSpecMinors } : {}),
      },
      ACT_VERSION,
    );
  }
}

/**
 * PRD-400-R1 / R2 — canonical pipeline. Runs every stage in fixed order.
 * Pipeline orchestration only — file emission lives in {@link emitFiles}.
 */
export interface PipelineRun {
  config: GeneratorConfig;
  logger: Logger;
}

export interface PipelineOutcome {
  manifest: ManifestSchema.Manifest;
  index: IndexSchema.Index;
  subtrees: Map<string, SubtreeSchema.Subtree>;
  nodes: NodeSchema.Node[];
  achieved: 'core' | 'standard' | 'strict';
  capabilities: Record<string, unknown>;
  warnings: string[];
}

export async function runPipeline(input: PipelineRun): Promise<PipelineOutcome> {
  const { config, logger } = input;
  // PRD-400-R29/R30
  enforceAdapterPinning(config);

  // PRD-400-R4 — adapters run sequentially; merge after.
  const runs: AdapterRunResult[] = [];
  for (const entry of config.adapters) {
    const ctx: AdapterContext = {
      config: entry.config,
      targetLevel: config.conformanceTarget,
      actVersion: ACT_VERSION,
      logger,
      signal: new AbortController().signal,
      state: {},
      ...(typeof config.site.canonical_url === 'string' && config.site.canonical_url.length > 0
        ? { siteOrigin: stripTrailingSlash(config.site.canonical_url) }
        : {}),
    };
    const r = await runAdapter(entry.adapter, entry.config, ctx);
    runs.push(r);
  }
  enforceTargetLevel(
    config,
    runs.map((r) => r.capabilities),
  );

  // PRD-400-R6 — merge contributions.
  const merged = mergeRuns(runs);
  const partials: string[] = [];
  const nodes: NodeSchema.Node[] = [];
  // Required PRD-100-R21 fields. A merged node missing any is a partial.
  const REQUIRED = ['act_version', 'id', 'type', 'title', 'summary', 'content', 'tokens'] as const;
  for (const node of merged.values()) {
    const missing = REQUIRED.filter((k) => (node as Record<string, unknown>)[k] === undefined);
    if (missing.length > 0) {
      partials.push(`${node.id}(missing:${missing.join(',')})`);
      continue;
    }
    nodes.push(node as NodeSchema.Node);
  }
  if (partials.length > 0) {
    throw new Error(
      `PRD-400-R7: ${partials.length} partial node(s) survived merge: ${partials.join(', ')}`,
    );
  }

  // PRD-400-R8 — recompute ETags deterministically.
  for (const n of nodes) n.etag = computeEtag(stripEtag(n as unknown as Record<string, unknown>));

  // PRD-400-R7 / R21 — schema validate.
  const errors: string[] = [];
  for (const n of nodes) {
    const r = validateNode(n);
    for (const g of r.gaps) errors.push(`node ${n.id}: ${g.requirement} ${g.missing}`);
  }
  if (errors.length > 0) {
    throw new Error(`PRD-400-R21: validation failed:\n${errors.join('\n')}`);
  }

  // PRD-400-R11 — index.
  const index = buildIndex(nodes);
  const indexResult = validateIndex(index);
  for (const g of indexResult.gaps) errors.push(`index: ${g.requirement} ${g.missing}`);
  if (errors.length > 0) {
    throw new Error(`PRD-400-R21: index validation failed:\n${errors.join('\n')}`);
  }

  // PRD-400-R13 — subtrees (Standard+).
  const subtrees = new Map<string, SubtreeSchema.Subtree>();
  if (config.conformanceTarget === 'standard' || config.conformanceTarget === 'strict') {
    if (config.urlTemplates?.subtreeUrlTemplate) {
      // Emit a subtree for every parentless graph root AND for every inner
      // node that has children. Inner-node subtrees give agents and the
      // site browser a single fetch that resolves the next-level fanout
      // (e.g. category → SKU titles) without an N+1 walk through the index.
      const roots = nodes.filter((n) => n.parent === undefined || n.parent === null);
      const innerWithChildren = nodes.filter(
        (n) => (n.parent !== undefined && n.parent !== null)
          && Array.isArray(n.children)
          && n.children.length > 0,
      );
      const depth = typeof config.subtreeDepth === 'number' && config.subtreeDepth >= 1
        ? config.subtreeDepth
        : 3;
      const targets = [...roots, ...innerWithChildren];
      for (const r of targets) {
        if (subtrees.has(r.id)) continue;
        const st = buildSubtree(r.id, nodes, depth);
        const stResult = validateSubtree(st);
        for (const g of stResult.gaps) errors.push(`subtree ${r.id}: ${g.requirement} ${g.missing}`);
        subtrees.set(r.id, st);
      }
    }
  }
  if (errors.length > 0) throw new Error(`PRD-400-R21: subtree validation failed:\n${errors.join('\n')}`);

  // PRD-400-R17 — infer achieved.
  const observed = {
    hasIndex: true,
    hasSubtree: subtrees.size > 0,
    hasNdjson: false, // NDJSON is Plus-only and PRD-401 v0.1 does not emit it.
  };
  const achieved = inferAchievedLevel(observed);

  // PRD-400-R10 — manifest. Advertise root_id when the graph has exactly
  // one parentless node so agents can find the entry point without
  // scanning the flat index.
  const graphRoots = nodes.filter((n) => n.parent === undefined || n.parent === null);
  const manifest = buildManifest({
    config,
    adapterCapabilities: runs.map((r) => r.capabilities),
    achieved,
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    ...(graphRoots.length === 1 ? { rootId: graphRoots[0]!.id } : {}),
  });
  const manifestResult = validateManifest(manifest);
  for (const g of manifestResult.gaps) errors.push(`manifest: ${g.requirement} ${g.missing}`);
  if (errors.length > 0) throw new Error(`PRD-400-R21: manifest validation failed:\n${errors.join('\n')}`);

  return {
    manifest,
    index,
    subtrees,
    nodes,
    achieved,
    capabilities: manifest.capabilities ?? {},
    warnings: runs.flatMap((r) => r.warnings),
  };
}

/** PRD-400-R9 / R23 / R27 — emit the static file set + sidecar build report. */
export async function emitFiles(opts: {
  outcome: PipelineOutcome;
  outputDir: string;
  config: GeneratorConfig;
  startedAt: number;
}): Promise<BuildReport> {
  const files: BuildReport['files'] = [];
  // PRD-105 layout: /.well-known/act.json, /act/index.json, /act/nodes/<id>.json, /act/subtrees/<id>.json
  const emitOpts = opts.config.emit ?? {};
  const prettyJson = emitOpts.prettyJson === true;
  const stringifyEnvelope = prettyJson
    ? (v: unknown): string => JSON.stringify(v, null, 2)
    : (v: unknown): string => JSON.stringify(v);

  const manifestPath = path.join(opts.outputDir, '.well-known', 'act.json');
  const indexPath = path.join(opts.outputDir, 'act', 'index.json');
  const manifestBody = stringifyEnvelope(opts.outcome.manifest);
  const indexBody = stringifyEnvelope(opts.outcome.index);
  await atomicWrite(manifestPath, manifestBody);
  files.push({ path: manifestPath, bytes: Buffer.byteLength(manifestBody, 'utf8'), band: 'core' });
  await atomicWrite(indexPath, indexBody);
  const indexEntry = {
    path: indexPath,
    bytes: Buffer.byteLength(indexBody, 'utf8'),
    band: 'core' as const,
    ...(opts.outcome.index.etag !== undefined ? { etag: opts.outcome.index.etag } : {}),
  };
  files.push(indexEntry);

  for (const node of opts.outcome.nodes) {
    const nodePath = path.join(opts.outputDir, 'act', 'nodes', `${node.id}.json`);
    const body = stringifyEnvelope(node);
    await atomicWrite(nodePath, body);
    files.push({ path: nodePath, bytes: Buffer.byteLength(body, 'utf8'), etag: node.etag, band: 'core' });
  }

  for (const [rootId, st] of opts.outcome.subtrees) {
    const stPath = path.join(opts.outputDir, 'act', 'subtrees', `${rootId}.json`);
    const body = stringifyEnvelope(st);
    await atomicWrite(stPath, body);
    files.push({ path: stPath, bytes: Buffer.byteLength(body, 'utf8'), etag: st.etag, band: 'standard' });
  }

  // v0.2 §3.4 / §3.5 — emit `/llms.txt` and `/llms-full.txt` at the SITE
  // ROOT (not under `/act/`) per the llms.txt convention. Both default
  // ON; opt-out via `config.emit.{llmsTxt,llmsFullTxt}: false`.
  const llmsTxtEnabled = emitOpts.llmsTxt !== false;
  const llmsFullTxtEnabled = emitOpts.llmsFullTxt !== false;
  if (llmsTxtEnabled) {
    const llmsTxtBody = emitLlmsTxt(opts.outcome.manifest, opts.outcome.index, {
      nodes: opts.outcome.nodes,
    });
    const llmsTxtPath = path.join(opts.outputDir, 'llms.txt');
    await atomicWrite(llmsTxtPath, llmsTxtBody);
    files.push({
      path: llmsTxtPath,
      bytes: Buffer.byteLength(llmsTxtBody, 'utf8'),
      band: 'core',
    });
  }
  if (llmsFullTxtEnabled) {
    const llmsFullBody = await emitLlmsFullTxt(
      opts.outcome.manifest,
      opts.outcome.index,
      nodeFetcherFromArray(opts.outcome.nodes),
      {
        maxBytes:
          typeof emitOpts.llmsFullTxtMaxBytes === 'number'
            ? emitOpts.llmsFullTxtMaxBytes
            : DEFAULT_LLMS_FULL_MAX_BYTES,
      },
    );
    const llmsFullPath = path.join(opts.outputDir, 'llms-full.txt');
    await atomicWrite(llmsFullPath, llmsFullBody);
    files.push({
      path: llmsFullPath,
      bytes: Buffer.byteLength(llmsFullBody, 'utf8'),
      band: 'core',
    });
  }

  const report: BuildReport = {
    startedAt: new Date(opts.startedAt).toISOString(),
    durationMs: Date.now() - opts.startedAt,
    conformanceTarget: opts.config.conformanceTarget,
    conformanceAchieved: opts.outcome.achieved,
    capabilities: opts.outcome.capabilities,
    files,
    warnings: opts.outcome.warnings,
    errors: [],
  };
  // PRD-400-R27 — sidecar at outputDir/.act-build-report.json (NOT under /act/).
  // The in-memory `report` carries absolute paths so callers that consume the
  // returned value (e.g. `verifyCapabilityBacking`) can use them directly.
  // The on-disk JSON, however, stores paths *relative to outputDir* — absolute
  // paths leak the build machine's user home directory and break byte-equal
  // reproducibility checks across hosts.
  const reportPath = path.join(opts.outputDir, '.act-build-report.json');
  const onDiskReport = {
    ...report,
    files: report.files.map((f) => ({
      ...f,
      path: path.relative(opts.outputDir, f.path),
    })),
  };
  await atomicWrite(reportPath, JSON.stringify(onDiskReport, null, 2));
  return report;
}

/** PRD-400-R18 — verify capabilities are backed by emitted files. */
export function verifyCapabilityBacking(
  capabilities: Record<string, unknown>,
  files: BuildReport['files'],
): void {
  const hasSubtreeFile = files.some((f) => f.path.includes('/act/subtrees/'));
  if (capabilities['subtree'] === true && !hasSubtreeFile) {
    throw new Error('PRD-400-R18: capabilities.subtree advertised but no subtree files emitted');
  }
  const hasNdjsonFile = files.some((f) => f.path.endsWith('.ndjson'));
  if (capabilities['ndjson_index'] === true && !hasNdjsonFile) {
    throw new Error('PRD-400-R18: capabilities.ndjson_index advertised but no NDJSON files emitted');
  }
}

/** PRD-400-R28 — framework conformance fixture corpus marker. */
export const PIPELINE_FRAMEWORK_VERSION = '0.1' as const;

/** PRD-400-R34 — versioned-tree emission opt-in (v0.1: not implemented). */
export const VERSIONED_TREES_SUPPORTED = false;

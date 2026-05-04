/**
 * PRD-200 adapter framework — types, lifecycle helpers, multi-source merge.
 *
 * This module lives in `@act-spec/adapter-markdown` (per ADR-003) rather
 * than `@act-spec/core` because PRD-201 is the only first-party leaf in
 * v0.1; promoting framework code to core requires three concrete consumers
 * (lead-typescript-engineer anti-pattern: premature abstraction in core).
 * The Astro generator (@act-spec/plugin-astro) imports from here.
 *
 * Every export cites a PRD-200 requirement and is exercised by at least one
 * test in `framework.test.ts` and/or `markdown.test.ts`.
 */
import type { NodeSchema } from '@act-spec/core';

/** PRD-200-R5 — `EmittedNode` is a fully-formed PRD-100-R21 node. */
export type EmittedNode = NodeSchema.Node;

/**
 * PRD-200-R5 — partial node contributors. Only `id` is mandatory (so the
 * merge step can key collisions per PRD-200-R12). The `_actPartial`
 * discriminator is framework-internal and stripped by the merge step
 * before final emission per PRD-200's wire-format section.
 */
export interface PartialEmittedNode extends Partial<EmittedNode> {
  id: string;
  _actPartial: true;
}

/** PRD-200-R22 — adapter's declared capabilities. */
export interface AdapterCapabilities {
  /** PRD-100-R4 / PRD-107-R1. The level the adapter actually emits at. */
  level: 'core' | 'standard' | 'strict';
  /** PRD-200-R6. Default 8 if absent. */
  concurrency_max?: number;
  /** PRD-200-R9. Adapter implements `delta`. Default false. */
  delta?: boolean;
  /** PRD-200-R10. Adapter namespaces IDs. Default true. */
  namespace_ids?: boolean;
  /** PRD-200-R15. Asymmetric scalar-merge knob. */
  precedence?: 'primary' | 'fallback';
  /**
   * PRD-200-R23. Capability flags the generator should bubble into the
   * manifest's `capabilities.*` object verbatim.
   */
  manifestCapabilities?: {
    etag?: boolean;
    subtree?: boolean;
    ndjson_index?: boolean;
    search?: { template_advertised?: boolean };
    change_feed?: boolean;
  };
  /** PRD-200-R27. Component-contract emission marker. */
  component_contract?: boolean;
}

/** PRD-200-R19 — read-only context surfaced to every lifecycle hook. */
export interface AdapterContext {
  /** Adapter-defined config; namespaced under the package name in user config. */
  config: Record<string, unknown>;
  /** Generator's target conformance level (PRD-200-R24). */
  targetLevel: 'core' | 'standard' | 'strict';
  /** Build's target ACT version MAJOR.MINOR (PRD-200-R25). */
  actVersion: string;
  /** Logger surface; PRD-401-R18 supplies Astro's logger here. */
  logger: AdapterLogger;
  /** Cancellation. */
  signal: AbortSignal;
  /** Per-build mutable scratch — adapter-owned. */
  state: Record<string, unknown>;
  /**
   * Canonical site origin (no trailing slash). Derived from
   * `GeneratorConfig.site.canonical_url`. Adapters use this to default
   * `source.human_url` when the per-node rendered URL is deterministic.
   * Undefined for builds without a canonical URL.
   */
  siteOrigin?: string;
}

/** Minimal logger surface compatible with Astro's `AstroIntegrationLogger`. */
export interface AdapterLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** PRD-200-R1 / R2 — adapter lifecycle interface. */
export interface Adapter<TItem = unknown> {
  /** PRD-200-R1. Stable identity (e.g., `"act-markdown"`). */
  readonly name: string;
  /** PRD-200-R8. Optional fast preflight. */
  precheck?(config: Record<string, unknown>): Promise<void> | void;
  /** PRD-200-R3. Opens connections; returns capabilities. */
  init(config: Record<string, unknown>, ctx: AdapterContext): Promise<AdapterCapabilities>;
  /** PRD-200-R4. Iterable of opaque source items. */
  enumerate(ctx: AdapterContext): AsyncIterable<TItem> | TItem[];
  /** PRD-200-R5. Per-item transform. */
  transform(item: TItem, ctx: AdapterContext): Promise<EmittedNode | PartialEmittedNode | null>;
  /** PRD-200-R9. Optional incremental enumeration. */
  delta?(since: string, ctx: AdapterContext): AsyncIterable<TItem> | TItem[];
  /** PRD-200-R7. Idempotent resource release. */
  dispose(ctx: AdapterContext): Promise<void> | void;
}

/** PRD-200-R13. Source identity stamped on every emitted node's `metadata.source`. */
export interface AdapterSourceStamp {
  adapter: string;
  source_id: string;
  source_path?: string;
  contributors?: string[];
}

/** Result of running one adapter to completion. */
export interface AdapterRunResult {
  adapter: string;
  capabilities: AdapterCapabilities;
  nodes: Array<EmittedNode | PartialEmittedNode>;
  /** PRD-200-R16 — per-item warnings (partial/failed extractions). */
  warnings: string[];
}

/**
 * Run one adapter through its full lifecycle (PRD-200-R2):
 * `precheck → init → enumerate → transform (concurrency-bounded) → dispose`.
 * `dispose` runs exactly once even on throw.
 */
export async function runAdapter<TItem>(
  adapter: Adapter<TItem>,
  config: Record<string, unknown>,
  ctx: AdapterContext,
): Promise<AdapterRunResult> {
  if (typeof adapter.precheck === 'function') {
    await adapter.precheck(config);
  }
  const capabilities = await adapter.init(config, ctx);

  // PRD-200-R24: refuse if generator target exceeds adapter's declared level.
  const order = ['core', 'standard', 'strict'] as const;
  if (order.indexOf(ctx.targetLevel) > order.indexOf(capabilities.level)) {
    await adapter.dispose(ctx);
    throw new Error(
      `PRD-200-R24: target level "${ctx.targetLevel}" exceeds adapter "${adapter.name}" declared level "${capabilities.level}"`,
    );
  }

  const concurrency = capabilities.concurrency_max ?? 8;
  const warnings: string[] = [];

  try {
    const items: TItem[] = [];
    const iter = adapter.enumerate(ctx);
    if (Array.isArray(iter)) {
      items.push(...iter);
    } else {
      for await (const it of iter) items.push(it);
    }

    // PRD-200-R6 / PRD-201-R11 — bounded concurrency, but preserve enumerate
    // order in the output array (deterministic emission).
    const slots: Array<EmittedNode | PartialEmittedNode | null> = Array.from(
      { length: items.length },
      () => null,
    );
    let cursor = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= items.length) return;
        const item = items[i] as TItem;
        const out = await adapter.transform(item, ctx);
        if (out === null) continue; // PRD-200-R5 deliberate skip
        const stamped = stampSource(out, adapter.name);
        slots[i] = stamped;
        const status =
          stamped.metadata && typeof stamped.metadata === 'object'
            ? (stamped.metadata as Record<string, unknown>)['extraction_status']
            : undefined;
        if (status === 'partial' || status === 'failed') {
          warnings.push(`${adapter.name}: ${stamped.id} extraction_status=${String(status)}`);
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, () => worker()),
    );
    const nodes: Array<EmittedNode | PartialEmittedNode> = slots.filter(
      (s): s is EmittedNode | PartialEmittedNode => s !== null,
    );
    return { adapter: adapter.name, capabilities, nodes, warnings };
  } finally {
    await adapter.dispose(ctx);
  }
}

/** PRD-200-R13. Stamp `metadata.source.adapter` if missing. Pure. */
export function stampSource<T extends EmittedNode | PartialEmittedNode>(
  node: T,
  adapterName: string,
): T {
  const meta = (node.metadata && typeof node.metadata === 'object'
    ? { ...(node.metadata as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const source =
    meta['source'] && typeof meta['source'] === 'object'
      ? { ...(meta['source'] as Record<string, unknown>) }
      : {};
  if (typeof source['adapter'] !== 'string') source['adapter'] = adapterName;
  meta['source'] = source;
  return { ...node, metadata: meta };
}

/**
 * PRD-200-R10. Apply per-adapter namespace if the adapter declared
 * `namespace_ids: true` (default). Pure transform on emitted nodes.
 */
export function namespaceIds<T extends EmittedNode | PartialEmittedNode>(
  nodes: T[],
  adapterNamespace: string | undefined,
  capabilities: AdapterCapabilities,
): T[] {
  const wantsNamespace = capabilities.namespace_ids !== false;
  if (!wantsNamespace || !adapterNamespace) return nodes;
  return nodes.map((n) => ({ ...n, id: `${adapterNamespace}/${n.id}` }));
}

/** PRD-200-R11 / PRD-100-R14 — adapter-defined override resolver. */
export interface IdResolution {
  /** Final ID (override > config > default). */
  id: string;
  /** Source of the resolution; surfaced in warnings. */
  via: 'override' | 'config' | 'default';
}

export function resolveId(opts: {
  override?: string | undefined;
  configRule?: string | undefined;
  defaultId: string;
}): IdResolution {
  if (typeof opts.override === 'string' && opts.override.length > 0) {
    return { id: opts.override, via: 'override' };
  }
  if (typeof opts.configRule === 'string' && opts.configRule.length > 0) {
    return { id: opts.configRule, via: 'config' };
  }
  return { id: opts.defaultId, via: 'default' };
}

/** PRD-200-R14 — per-adapter merge policy. */
export type MergePolicy = 'last-wins' | 'error';

export interface MergeOptions {
  /** Per-adapter policy keyed by adapter name. Defaults to last-wins. */
  policy?: Record<string, MergePolicy>;
}

/**
 * PRD-200-R12 — multi-source merge. Implements:
 *  1. Full + full → last-wins (or error per policy / R14).
 *  2. Partial deep-merge: objects deep, arrays concatenate, scalars per R15.
 *  3. Strips `_actPartial` discriminator before emission.
 *
 * A1 (open amendment) — `metadata.translations` is deduped by `(locale, id)`
 * after concat per A1's "Proposed fix". The dedupe lives at the bottom of
 * `mergeMetadata` and cites A1 in a comment.
 */
export function mergeContributions(
  ordered: Array<{
    adapter: string;
    capabilities: AdapterCapabilities;
    node: EmittedNode | PartialEmittedNode;
  }>,
  opts: MergeOptions = {},
): EmittedNode | PartialEmittedNode {
  if (ordered.length === 0) {
    throw new Error('mergeContributions: empty input');
  }
  const policy = opts.policy ?? {};
  const targetId = ordered[0]!.node.id;

  let acc: Record<string, unknown> = {};
  let accAdapter: string | undefined;
  // primary contributor (PRD-200-R15 #1) — the one that declared `precedence: "primary"`.
  let primaryAdapter: string | undefined;
  for (const c of ordered) {
    if (c.capabilities.precedence === 'primary') primaryAdapter = c.adapter;
  }

  for (const contribution of ordered) {
    const { adapter, capabilities, node } = contribution;
    const isPartial = '_actPartial' in node && node._actPartial === true;
    const incoming = stripFrameworkKeys(node);
    if (Object.keys(acc).length === 0) {
      acc = { ...incoming };
      accAdapter = adapter;
      continue;
    }

    // PRD-200-R12 #1: full + full collision.
    const accIsFull = !accAdapter || !('_actPartial' in (acc as object));
    if (!isPartial && accIsFull && accAdapter !== undefined) {
      const accPolicy = policy[accAdapter];
      const incomingPolicy = policy[adapter];
      if (accPolicy === 'error' || incomingPolicy === 'error') {
        throw new Error(
          `PRD-200-R14: ID collision on "${targetId}" between adapters "${accAdapter}" and "${adapter}" with merge: "error"`,
        );
      }
      // last-wins
      acc = { ...incoming };
      accAdapter = adapter;
      continue;
    }

    // PRD-200-R12 #3 / R15: partial deep-merge.
    acc = deepMerge(acc, incoming, {
      adapterAcc: accAdapter ?? '<unknown>',
      adapterIncoming: adapter,
      policy,
      primaryAdapter,
      capabilitiesIncoming: capabilities,
    });
    accAdapter = adapter;
  }

  return acc as EmittedNode | PartialEmittedNode;
}

/** Strip framework-internal `_act*` keys from a contribution. */
function stripFrameworkKeys(
  node: EmittedNode | PartialEmittedNode,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

interface MergeCtx {
  adapterAcc: string;
  adapterIncoming: string;
  policy: Record<string, MergePolicy>;
  primaryAdapter: string | undefined;
  capabilitiesIncoming: AdapterCapabilities;
}

function deepMerge(
  acc: Record<string, unknown>,
  incoming: Record<string, unknown>,
  ctx: MergeCtx,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...acc };
  for (const [k, vIn] of Object.entries(incoming)) {
    const vAcc = out[k];
    if (vAcc === undefined) {
      out[k] = vIn;
      continue;
    }
    if (Array.isArray(vAcc) && Array.isArray(vIn)) {
      // PRD-200-R12 #3: arrays concatenate in declared adapter order.
      let merged: unknown[] = [...(vAcc as unknown[]), ...(vIn as unknown[])];
      // A1 — dedupe metadata.translations by (locale, id). Cite amendments-queue.md A1.
      if (k === 'translations') {
        merged = dedupeTranslations(merged);
      }
      out[k] = merged;
      continue;
    }
    if (isPlainObject(vAcc) && isPlainObject(vIn)) {
      if (k === 'metadata') {
        out[k] = mergeMetadata(vAcc, vIn);
      } else {
        out[k] = deepMerge(vAcc, vIn, ctx);
      }
      continue;
    }
    // Scalar / type-mismatch: PRD-200-R15.
    out[k] = resolveScalar(vAcc, vIn, k, ctx);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function resolveScalar(
  vAcc: unknown,
  vIn: unknown,
  _key: string,
  ctx: MergeCtx,
): unknown {
  // PRD-200-R15 #1: primary contributor wins.
  if (ctx.primaryAdapter !== undefined) {
    if (ctx.adapterIncoming === ctx.primaryAdapter) return vIn;
    if (ctx.adapterAcc === ctx.primaryAdapter) return vAcc;
  }
  // PRD-200-R15 #1: fallback never overwrites an existing scalar.
  if (ctx.capabilitiesIncoming.precedence === 'fallback' && vAcc !== undefined) {
    return vAcc;
  }
  // PRD-200-R15 #3: error policy.
  if (ctx.policy[ctx.adapterIncoming] === 'error' || ctx.policy[ctx.adapterAcc] === 'error') {
    throw new Error(
      `PRD-200-R15: scalar conflict between "${ctx.adapterAcc}" and "${ctx.adapterIncoming}" with merge: "error"`,
    );
  }
  // PRD-200-R15 #2: last-writer-wins.
  return vIn;
}

function mergeMetadata(
  acc: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...acc };
  for (const [k, vIn] of Object.entries(incoming)) {
    const vAcc = out[k];
    if (vAcc === undefined) {
      out[k] = vIn;
      continue;
    }
    if (Array.isArray(vAcc) && Array.isArray(vIn)) {
      let merged: unknown[] = [...(vAcc as unknown[]), ...(vIn as unknown[])];
      // A1 — translations dedupe by (locale, id). See docs/amendments-queue.md A1.
      if (k === 'translations') merged = dedupeTranslations(merged);
      out[k] = merged;
      continue;
    }
    if (isPlainObject(vAcc) && isPlainObject(vIn)) {
      out[k] = mergeMetadata(vAcc, vIn);
      continue;
    }
    out[k] = vIn;
  }
  return out;
}

/**
 * A1 dedupe — see docs/amendments-queue.md entry A1.
 * Conservative interpretation: keep last entry for each (locale, id) tuple
 * (later wins per PRD-200-R12 default). Entries lacking either key are
 * preserved unchanged.
 */
function dedupeTranslations(entries: unknown[]): unknown[] {
  const seen = new Map<string, number>(); // key → index in `out`
  const out: unknown[] = [];
  for (const e of entries) {
    if (!isPlainObject(e)) {
      out.push(e);
      continue;
    }
    const locale = typeof e['locale'] === 'string' ? e['locale'] : undefined;
    const id = typeof e['id'] === 'string' ? e['id'] : undefined;
    if (locale === undefined || id === undefined) {
      out.push(e);
      continue;
    }
    const key = `${locale} ${id}`;
    if (seen.has(key)) {
      out[seen.get(key)!] = e; // later-wins
    } else {
      seen.set(key, out.length);
      out.push(e);
    }
  }
  return out;
}

/**
 * PRD-200-R12 — group adapter contributions by ID and merge.
 * Returns a map keyed by final node ID. Detects collisions (PRD-200-R10's
 * cross-adapter case) regardless of namespace_ids opt-out.
 */
export function mergeRuns(
  runs: AdapterRunResult[],
  opts: MergeOptions = {},
): Map<string, EmittedNode | PartialEmittedNode> {
  const grouped = new Map<
    string,
    Array<{
      adapter: string;
      capabilities: AdapterCapabilities;
      node: EmittedNode | PartialEmittedNode;
    }>
  >();
  for (const run of runs) {
    for (const node of run.nodes) {
      const list = grouped.get(node.id) ?? [];
      list.push({ adapter: run.adapter, capabilities: run.capabilities, node });
      grouped.set(node.id, list);
    }
  }
  const out = new Map<string, EmittedNode | PartialEmittedNode>();
  for (const [id, list] of grouped) {
    out.set(id, mergeContributions(list, opts));
  }
  return out;
}

/** PRD-200-R26 — generator-side adapter pinning check. */
export function checkAdapterPinning(
  declared: { actVersion?: string | undefined; actSpecMinors?: readonly string[] | undefined },
  target: string,
): void {
  if (declared.actSpecMinors !== undefined) {
    if (!declared.actSpecMinors.includes(target)) {
      throw new Error(
        `PRD-200-R26: adapter declares actSpecMinors=[${declared.actSpecMinors.join(', ')}] but target is ${target}`,
      );
    }
    return;
  }
  if (declared.actVersion !== undefined) {
    if (declared.actVersion !== target) {
      throw new Error(
        `PRD-200-R25: adapter pinned to act_version=${declared.actVersion} but target is ${target}`,
      );
    }
    return;
  }
  // No declaration at all — Stage 1 default refuses to run.
  throw new Error('PRD-200-R25: adapter declares no act_version pinning');
}

/**
 * PRD-200-R23 — bubble adapter capabilities into the manifest's
 * `capabilities.*` shape. OR-merges across multiple adapters.
 */
export function bubbleManifestCapabilities(
  caps: AdapterCapabilities[],
): NonNullable<NonNullable<Adapter>['name']> extends string
  ? Record<string, unknown>
  : never {
  const out: Record<string, unknown> = {};
  for (const c of caps) {
    const m = c.manifestCapabilities;
    if (!m) continue;
    if (m.etag === true) out['etag'] = true;
    if (m.subtree === true) out['subtree'] = true;
    if (m.ndjson_index === true) out['ndjson_index'] = true;
    if (m.change_feed === true) out['change_feed'] = true;
    if (m.search?.template_advertised === true) {
      const existing = (out['search'] as Record<string, unknown> | undefined) ?? {};
      out['search'] = { ...existing, template_advertised: true };
    }
  }
  return out;
}

/** PRD-200-R28 — framework conformance fixture set marker. */
export const FRAMEWORK_CONFORMANCE_VERSION = '0.1' as const;

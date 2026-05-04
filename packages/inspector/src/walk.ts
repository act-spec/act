/**
 * `walk` — full discovery walk with structured per-node output
 * (PRD-601-R7).
 *
 * Sequence:
 *   1. discoverManifest (PRD-101-R8 — delegated).
 *   2. parse the index from the manifest's `index_url`.
 *   3. for each entry (or sample-N), fetch the node envelope; record
 *      etag / status / per-node findings.
 *   4. compute the `tree_summary` (fanout, types, max_depth_observed).
 *
 * `--use-ndjson` (PRD-601-R19) is opt-in; when set against a non-Plus
 * producer the inspector emits an `ndjson-requires-strict` finding and
 * the CLI returns exit code 3.
 *
 * `--depth` (PRD-601-R7) caps the walk to nodes whose `parent`-chain
 * length from `root_id` is at most `N`.
 */
import { RequestBudget, RequestBudgetExceededError, InvocationCache, resolveUrlAgainst, substituteId, toFinding, isSameRegistrableDomain } from './http.js';
import { discoverManifest } from './discovery.js';
import { parseIndex, parseNdjsonIndex, parseNode } from './parsers.js';
import type { Finding, InspectResult, WalkOptions, WalkResult } from './types.js';

interface IndexEntry {
  id: string;
  type?: string;
  parent?: string | null;
  children?: string[];
  tokens?: { summary?: number; abstract?: number; body?: number };
  etag?: string;
}

function tokensFrom(entry: IndexEntry): { summary: number; abstract?: number; body?: number } {
  const out: { summary: number; abstract?: number; body?: number } = {
    summary: entry.tokens?.summary ?? 0,
  };
  if (typeof entry.tokens?.abstract === 'number') out.abstract = entry.tokens.abstract;
  if (typeof entry.tokens?.body === 'number') out.body = entry.tokens.body;
  return out;
}

export async function walk(url: string, opts: WalkOptions = {}): Promise<WalkResult> {
  const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const budget = new RequestBudget(opts.maxRequests ?? 256, fetcher);
  const cache = new InvocationCache();
  const findings: Finding[] = [];

  const disc = await discoverManifest(url, budget, cache, opts.noCache ?? false, opts.headers);
  findings.push(...disc.findings);
  const manifest = disc.manifest;
  if (manifest === null) {
    return {
      url: disc.manifestUrl,
      manifest: null,
      nodes: [],
      tree_summary: emptyTreeSummary(),
      findings,
      walk_summary: budget.summary(),
    };
  }

  // Cross-origin mount logging (PRD-601-R8): the inspector follows
  // mounts only when the operator opts in. Mounts whose `manifest_url`
  // crosses the registrable domain emit a finding (and are skipped if
  // `--no-follow-cross-origin` is set).
  recordCrossOriginMounts(manifest, disc.manifestUrl, opts, findings);

  const indexUrl = readUrl(manifest, 'index_url', disc.manifestUrl);
  const ndjsonUrl = readUrl(manifest, 'index_ndjson_url', disc.manifestUrl);
  const nodeUrlTemplate = readString(manifest, 'node_url_template');
  const declaredLevel = readDeclaredLevel(manifest);

  if (opts.useNdjson === true && declaredLevel !== 'strict') {
    findings.push({
      code: 'ndjson-requires-strict',
      message: `--use-ndjson requires a Strict producer; manifest declares level=${declaredLevel ?? '<unknown>'}.`,
      severity: 'error',
    });
    return {
      url: disc.manifestUrl,
      manifest,
      nodes: [],
      tree_summary: emptyTreeSummary(),
      findings,
      walk_summary: budget.summary(),
    };
  }

  let entries: IndexEntry[];
  try {
    entries = await fetchIndex(opts.useNdjson === true ? ndjsonUrl : indexUrl, opts.useNdjson === true, budget, cache, opts, findings);
  } catch (err) {
    findings.push(toFinding('index-fetch-failed', err));
    return {
      url: disc.manifestUrl,
      manifest,
      nodes: [],
      tree_summary: emptyTreeSummary(),
      findings,
      walk_summary: budget.summary(),
    };
  }

  const filtered = applyDepth(entries, opts.depth, manifest);
  const slice =
    opts.sample === undefined || opts.sample === 'all'
      ? filtered
      : filtered.slice(0, Math.max(0, opts.sample));

  const nodes: WalkResult['nodes'] = [];
  for (const entry of slice) {
    if (typeof nodeUrlTemplate !== 'string') {
      // No node template — degrade to index-derived metadata.
      nodes.push({
        id: entry.id,
        type: entry.type ?? '',
        parent: entry.parent ?? null,
        children: entry.children ?? [],
        tokens: tokensFrom(entry),
        etag: entry.etag ?? '',
        status: 'ok',
      });
      continue;
    }
    const nodeUrl = resolveUrlAgainst(disc.manifestUrl, substituteId(nodeUrlTemplate, entry.id));
    let res: Response;
    try {
      res = await budget.fetch(nodeUrl, withConditional(nodeUrl, cache, opts));
    } catch (err) {
      if (err instanceof RequestBudgetExceededError) {
        findings.push({
          code: 'request-budget-exceeded',
          message: `request budget (${err.limit}) exceeded after ${nodes.length} nodes.`,
          severity: 'error',
        });
        break;
      }
      const f = toFinding('node-fetch-failed', err);
      nodes.push({
        id: entry.id,
        type: entry.type ?? '',
        parent: entry.parent ?? null,
        children: entry.children ?? [],
        tokens: tokensFrom(entry),
        etag: entry.etag ?? '',
        status: 'error',
        findings: [f],
      });
      findings.push(f);
      continue;
    }
    if (!res.ok) {
      const f: Finding = {
        code: 'endpoint-404',
        message: `node ${entry.id}: HTTP ${res.status} from ${nodeUrl}.`,
        severity: 'error',
      };
      nodes.push({
        id: entry.id,
        type: entry.type ?? '',
        parent: entry.parent ?? null,
        children: entry.children ?? [],
        tokens: tokensFrom(entry),
        etag: entry.etag ?? '',
        status: 'error',
        findings: [f],
      });
      findings.push(f);
      continue;
    }
    cache.rememberFromResponse(nodeUrl, res);
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      const f = toFinding('node-parse-error', err);
      nodes.push({
        id: entry.id,
        type: entry.type ?? '',
        parent: entry.parent ?? null,
        children: entry.children ?? [],
        tokens: tokensFrom(entry),
        etag: entry.etag ?? '',
        status: 'error',
        findings: [f],
      });
      findings.push(f);
      continue;
    }
    const parsed = parseNode(body);
    const nFindings = parsed.findings.length > 0 ? parsed.findings : undefined;
    const node = parsed.value ?? (body as Record<string, unknown> | null);
    const tokens = (node?.['tokens'] as Record<string, number> | undefined) ?? {};
    nodes.push({
      id: entry.id,
      type: typeof node?.['type'] === 'string' ? (node['type']) : entry.type ?? '',
      parent: entry.parent ?? null,
      children: entry.children ?? [],
      tokens: {
        summary: typeof tokens['summary'] === 'number' ? tokens['summary'] : entry.tokens?.summary ?? 0,
        ...(typeof tokens['abstract'] === 'number' ? { abstract: tokens['abstract'] } : {}),
        ...(typeof tokens['body'] === 'number' ? { body: tokens['body'] } : {}),
      },
      etag: typeof node?.['etag'] === 'string' ? (node['etag']) : entry.etag ?? '',
      status: parsed.value === null ? 'error' : 'ok',
      ...(nFindings ? { findings: nFindings } : {}),
    });
    if (nFindings) findings.push(...nFindings);
  }

  return {
    url: disc.manifestUrl,
    manifest,
    nodes,
    tree_summary: computeTreeSummary(entries, nodes, manifest),
    findings,
    walk_summary: budget.summary(),
  };
}

async function fetchIndex(
  indexUrl: string | null,
  ndjson: boolean,
  budget: RequestBudget,
  cache: InvocationCache,
  opts: WalkOptions,
  findings: Finding[],
): Promise<IndexEntry[]> {
  if (indexUrl === null) {
    findings.push({
      code: 'endpoint-404',
      message: ndjson ? 'manifest does not advertise index_ndjson_url.' : 'manifest does not advertise index_url.',
      severity: 'error',
    });
    return [];
  }
  const res = await budget.fetch(indexUrl, withConditional(indexUrl, cache, opts));
  if (!res.ok) {
    findings.push({
      code: 'endpoint-404',
      message: `index unreachable: ${indexUrl} returned HTTP ${res.status}.`,
      severity: 'error',
    });
    return [];
  }
  cache.rememberFromResponse(indexUrl, res);
  if (ndjson) {
    const text = await res.text();
    const parsed = parseNdjsonIndex(text);
    findings.push(...parsed.findings);
    if (parsed.value === null) return [];
    const out: IndexEntry[] = [];
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        out.push(JSON.parse(line) as IndexEntry);
      } catch {
        // parseNdjsonIndex would have already flagged structural
        // errors; per-line JSON.parse defends only against tail noise.
      }
    }
    return out;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    findings.push(toFinding('index-parse-error', err));
    return [];
  }
  const parsed = parseIndex(body);
  findings.push(...parsed.findings);
  const idx = (parsed.value ?? (body as Record<string, unknown> | null));
  const nodes = (idx?.['nodes'] as IndexEntry[] | undefined) ?? [];
  return Array.isArray(nodes) ? nodes : [];
}

function withConditional(
  url: string,
  cache: InvocationCache,
  opts: WalkOptions,
): RequestInit {
  const out = new Headers();
  if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) out.set(k, v);
  if (opts.noCache !== true) {
    const inm = cache.ifNoneMatchFor(url);
    if (inm !== undefined) out.set('if-none-match', `"${inm}"`);
  }
  return { headers: out };
}

function readUrl(manifest: Record<string, unknown>, key: string, base: string): string | null {
  const v = manifest[key];
  if (typeof v !== 'string') return null;
  return resolveUrlAgainst(base, v);
}

function readString(manifest: Record<string, unknown>, key: string): string | null {
  const v = manifest[key];
  return typeof v === 'string' ? v : null;
}

function readDeclaredLevel(manifest: Record<string, unknown>): 'core' | 'standard' | 'strict' | null {
  const c = manifest['conformance'];
  if (!c || typeof c !== 'object') return null;
  const lv = (c as { level?: unknown }).level;
  return lv === 'core' || lv === 'standard' || lv === 'strict' ? lv : null;
}

function applyDepth(entries: IndexEntry[], depth: number | undefined, manifest: Record<string, unknown>): IndexEntry[] {
  if (depth === undefined) return entries;
  const rootId = typeof manifest['root_id'] === 'string' ? (manifest['root_id']) : 'root';
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const depthOf = (id: string, seen: Set<string>): number => {
    if (id === rootId) return 0;
    if (seen.has(id)) return Number.POSITIVE_INFINITY;
    seen.add(id);
    const e = byId.get(id);
    if (!e || e.parent === undefined || e.parent === null) return Number.POSITIVE_INFINITY;
    return 1 + depthOf(e.parent, seen);
  };
  return entries.filter((e) => depthOf(e.id, new Set()) <= depth);
}

function computeTreeSummary(
  entries: IndexEntry[],
  nodes: WalkResult['nodes'],
  manifest: Record<string, unknown>,
): InspectResult['tree_summary'] {
  const types: Record<string, number> = {};
  for (const e of entries) {
    const t = e.type ?? '';
    types[t] = (types[t] ?? 0) + 1;
  }
  const fanouts: number[] = [];
  for (const e of entries) {
    fanouts.push(Array.isArray(e.children) ? e.children.length : 0);
  }
  fanouts.sort((a, b) => a - b);
  const fanout = fanoutStats(fanouts);
  const rootId = typeof manifest['root_id'] === 'string' ? (manifest['root_id']) : 'root';
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  let maxDepth = 0;
  for (const n of nodes) {
    let d = 0;
    let cur: string | null | undefined = n.id;
    const seen = new Set<string>();
    while (cur !== rootId && cur !== undefined && cur !== null && !seen.has(cur)) {
      seen.add(cur);
      const e = byId.get(cur);
      if (!e || e.parent === undefined || e.parent === null) break;
      cur = e.parent;
      d += 1;
    }
    if (d > maxDepth) maxDepth = d;
  }
  return {
    total_nodes: entries.length,
    types,
    fanout,
    max_depth_observed: maxDepth,
  };
}

function fanoutStats(sorted: number[]): InspectResult['tree_summary']['fanout'] {
  if (sorted.length === 0) return { min: 0, max: 0, mean: 0, median: 0 };
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { min, max, mean, median };
}

function emptyTreeSummary(): InspectResult['tree_summary'] {
  return {
    total_nodes: 0,
    types: {},
    fanout: { min: 0, max: 0, mean: 0, median: 0 },
    max_depth_observed: 0,
  };
}

function recordCrossOriginMounts(
  manifest: Record<string, unknown>,
  manifestUrl: string,
  opts: WalkOptions,
  findings: Finding[],
): void {
  const mounts = manifest['mounts'];
  if (!Array.isArray(mounts)) return;
  for (const m of mounts) {
    if (!m || typeof m !== 'object') continue;
    const mu = (m as { manifest_url?: unknown }).manifest_url;
    if (typeof mu !== 'string') continue;
    if (!isSameRegistrableDomain(manifestUrl, mu)) {
      const prefixRaw = (m as { prefix?: unknown }).prefix;
      const prefix = typeof prefixRaw === 'string' ? prefixRaw : '<unknown>';
      findings.push({
        code: opts.noFollowCrossOrigin === true ? 'cross-origin-mount-suppressed' : 'cross-origin-mount',
        message:
          opts.noFollowCrossOrigin === true
            ? `mount ${prefix} → ${mu} not followed (--no-follow-cross-origin).`
            : `cross-origin mount: ${manifestUrl} → ${mu}. Set --no-follow-cross-origin to suppress.`,
        severity: 'warn',
      });
    }
  }
}

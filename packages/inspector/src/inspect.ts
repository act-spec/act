/**
 * `inspect` — sampled discovery walk + manifest pretty-print
 * (PRD-601-R5). Layered atop {@link walk} with a smaller default
 * sample (16) and a smaller default request budget (32 vs 256).
 *
 * The result shape carries the manifest's declared level / delivery /
 * endpoints / auth schemes verbatim — the inspector NEVER computes an
 * `achieved.level` (that is PRD-600's job; PRD-601-R21).
 */
import { walk } from './walk.js';
import type { InspectOptions, InspectResult } from './types.js';

export async function inspect(url: string, opts: InspectOptions = {}): Promise<InspectResult> {
  const sample = opts.sample ?? 16;
  // Compose a WalkOptions; deliberately smaller request budget per
  // PRD-601-R20 unless the caller overrides.
  const w = await walk(url, {
    ...opts,
    sample,
    maxRequests: opts.maxRequests ?? 32,
  });

  return {
    url: w.url,
    manifest: { value: w.manifest, findings: [] },
    declared: readDeclared(w.manifest as Record<string, unknown> | null),
    endpoints: readEndpoints(w.manifest as Record<string, unknown> | null, w.url),
    auth: readAuth(w.manifest as Record<string, unknown> | null),
    sampled_nodes: w.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: '',
      tokens: n.tokens,
      etag: n.etag,
      cache_hit: false, // populated when we can correlate; left false in v0.1.
    })),
    tree_summary: w.tree_summary,
    findings: w.findings,
    walk_summary: w.walk_summary,
  };
}

function readDeclared(manifest: Record<string, unknown> | null): InspectResult['declared'] {
  if (!manifest) return { level: null, delivery: null };
  const c = manifest['conformance'];
  let level: 'core' | 'standard' | 'strict' | null = null;
  if (c && typeof c === 'object') {
    const lv = (c as { level?: unknown }).level;
    if (lv === 'core' || lv === 'standard' || lv === 'strict') level = lv;
  }
  const d = manifest['delivery'];
  const delivery = d === 'static' || d === 'runtime' ? d : null;
  return { level, delivery };
}

function readEndpoints(manifest: Record<string, unknown> | null, manifestUrl: string): InspectResult['endpoints'] {
  if (!manifest) {
    return { well_known: manifestUrl, index: null, node_template: null };
  }
  const out: InspectResult['endpoints'] = {
    well_known: manifestUrl,
    index: typeof manifest['index_url'] === 'string' ? (manifest['index_url']) : null,
    node_template: typeof manifest['node_url_template'] === 'string' ? (manifest['node_url_template']) : null,
  };
  if (typeof manifest['subtree_url_template'] === 'string') out.subtree_template = manifest['subtree_url_template'];
  if (typeof manifest['index_ndjson_url'] === 'string') out.index_ndjson = manifest['index_ndjson_url'];
  if (typeof manifest['search_url_template'] === 'string') out.search_template = manifest['search_url_template'];
  return out;
}

function readAuth(manifest: Record<string, unknown> | null): InspectResult['auth'] {
  if (!manifest) return { schemes: [] };
  const a = manifest['auth'];
  if (!a || typeof a !== 'object') return { schemes: [] };
  const s = (a as { schemes?: unknown }).schemes;
  if (!Array.isArray(s)) return { schemes: [] };
  return { schemes: s.filter((x): x is string => typeof x === 'string') };
}

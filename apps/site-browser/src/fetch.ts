// SPDX-License-Identifier: Apache-2.0
/**
 * Site fetch dispatcher.
 *
 * Progressive walk model: `loadSite` fetches only the manifest plus (when the
 * manifest advertises one) the root subtree. The flat `index.json` is fetched
 * lazily — only when the operator opts into the diagnostic "Show full index"
 * affordance — so the displayed payload meter reflects what an agent that
 * respects subtrees actually traverses.
 *
 * We do not call `inspector.walk()` here — that primitive issues one HTTP
 * request per node and emits findings, which is the wrong shape for an
 * interactive lazy-load UI. We fetch each envelope directly and validate via
 * `@act-spec/validator`'s per-envelope validators.
 */
import { node as inspectorNode } from '@act-spec/inspector';
import {
  validateIndex,
  validateManifest,
  validateNode,
  validateSubtree,
} from '@act-spec/validator';
import type { Gap, Warning } from '@act-spec/validator';

export interface ManifestEnvelope {
  act_version: string;
  site: { name: string; description?: string; locale?: string; canonical_url?: string; [k: string]: unknown };
  generated_at?: string;
  generator?: string;
  index_url: string;
  index_ndjson_url?: string;
  node_url_template: string;
  subtree_url_template?: string;
  search_url_template?: string;
  root_id?: string;
  capabilities?: Record<string, unknown>;
  conformance: { level: 'core' | 'standard' | 'strict' };
  delivery: 'static' | 'runtime';
  [k: string]: unknown;
}

export interface IndexEntry {
  id: string;
  type: string;
  title: string;
  summary: string;
  parent?: string | null;
  children?: string[];
  tokens?: { summary?: number; abstract?: number; body?: number };
  etag?: string;
  tags?: string[];
  [k: string]: unknown;
}

export interface NodeEnvelope {
  id: string;
  type: string;
  title: string;
  summary?: string;
  parent?: string | null;
  children?: string[];
  tokens?: { summary?: number; abstract?: number; body?: number };
  etag?: string;
  tags?: string[];
  source?: { human_url?: string; edit_url?: string; [k: string]: unknown };
  metadata?: Record<string, unknown>;
  content?: unknown[];
  related?: unknown[];
  [k: string]: unknown;
}

export interface SubtreeEnvelope {
  act_version: string;
  root: string;
  depth?: number;
  truncated?: boolean;
  tokens?: { summary?: number; body?: number };
  nodes: NodeEnvelope[];
  etag?: string;
  [k: string]: unknown;
}

export interface SiteHandle {
  manifestUrl: string;
  manifest: ManifestEnvelope;
  rootId: string;
  errors: SiteError[];
  manifestGaps: Gap[];
  manifestWarnings: Warning[];
  /** Raw payload size of the manifest JSON, in UTF-8 bytes. */
  manifestBytes: number;
  /** Gzipped payload size — what a CDN with gzip enabled would ship. */
  manifestGzipBytes: number | null;
  /** Whether the manifest advertises a subtree URL template. */
  hasSubtreeTemplate: boolean;
}

export interface SiteError {
  scope: 'manifest' | 'index' | 'subtree' | 'node';
  message: string;
  cors?: boolean;
}

export interface SiteLoadFailure {
  errors: SiteError[];
}

const WELL_KNOWN_SUFFIX = '/.well-known/act.json';

/** Normalise user input into a fully qualified well-known URL. */
export function normaliseManifestUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.endsWith('/act.json') || trimmed.endsWith('.well-known/act.json')) {
    return trimmed;
  }
  // Strip a trailing slash before appending so we don't double-up.
  const noTrailing = trimmed.replace(/\/+$/, '');
  return `${noTrailing}${WELL_KNOWN_SUFFIX}`;
}

function resolveAgainst(base: string, ref: string): string {
  return new URL(ref, base).toString();
}

function substituteId(template: string, id: string): string {
  return template.replace(/\{id\}/g, encodeURIComponent(id));
}

function isCorsLikeError(err: unknown): boolean {
  // The browser surfaces CORS / opaque-network failures as a generic
  // TypeError from fetch. We can't distinguish CORS from DNS at the API
  // surface, so we treat any TypeError-from-fetch as "likely CORS".
  return err instanceof TypeError;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface FetchedJson {
  data: unknown;
  bytes: number;
  gzipBytes: number | null;
}

interface FetchedText {
  text: string;
  bytes: number;
  gzipBytes: number | null;
}

/** Fetch a JSON resource and return both the parsed body, the raw UTF-8
 * byte size, and the gzipped wire size (what a CDN would actually ship). */
async function fetchJsonWithSize(url: string): Promise<FetchedJson | { httpStatus: number }> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return { httpStatus: res.status };
  const text = await res.text();
  const bytes = byteLength(text);
  const gzipBytes = await gzippedByteLength(text);
  const data: unknown = JSON.parse(text) as unknown;
  return { data, bytes, gzipBytes };
}

/** Fetch a text resource (typically HTML). Returns body text + raw bytes
 * + gzipped bytes for honest production-cost comparison. */
async function fetchTextWithSize(url: string): Promise<FetchedText | { httpStatus: number }> {
  const res = await fetch(url, { headers: { accept: 'text/html, */*;q=0.1' } });
  if (!res.ok) return { httpStatus: res.status };
  const text = await res.text();
  const bytes = byteLength(text);
  const gzipBytes = await gzippedByteLength(text);
  return { text, bytes, gzipBytes };
}

/** UTF-8 byte length of a string. Uses TextEncoder if available
 * (browsers + Node ≥18); falls back to Blob in older environments. */
export function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return new Blob([text]).size;
}

/** Gzipped byte length of a string — what a CDN with `Content-Encoding:
 * gzip` would actually ship over the wire. Uses the browser's
 * CompressionStream API (Chromium 80+, Firefox 113+, Safari 16.4+);
 * returns null when unavailable so the caller can hide the figure. */
export async function gzippedByteLength(text: string): Promise<number | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const body = new Response(text).body;
    if (!body) return null;
    const stream = body.pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return buf.byteLength;
  } catch {
    return null;
  }
}

export async function loadSite(input: string): Promise<SiteHandle | SiteLoadFailure> {
  const errors: SiteError[] = [];
  const manifestUrl = normaliseManifestUrl(input);

  let manifestRaw: unknown;
  let manifestBytes = 0;
  let manifestGzipBytes: number | null = null;
  try {
    const res = await fetchJsonWithSize(manifestUrl);
    if ('httpStatus' in res) {
      errors.push({
        scope: 'manifest',
        message: `manifest fetch returned HTTP ${res.httpStatus} from ${manifestUrl}.`,
      });
      return { errors };
    }
    manifestRaw = res.data;
    manifestBytes = res.bytes;
    manifestGzipBytes = res.gzipBytes;
  } catch (err) {
    errors.push({
      scope: 'manifest',
      message: `manifest fetch failed: ${describeError(err)} (${manifestUrl}).`,
      ...(isCorsLikeError(err) ? { cors: true } : {}),
    });
    return { errors };
  }

  const manifestResult = validateManifest(manifestRaw);
  const blockingManifestGaps = manifestResult.gaps.filter(
    (g) => g.requirement === 'PRD-600-R1' || g.requirement === 'PRD-600-R2',
  );
  if (blockingManifestGaps.length > 0) {
    errors.push({
      scope: 'manifest',
      message: `manifest failed structural validation: ${blockingManifestGaps.map((g) => g.missing).join('; ')}`,
    });
    return { errors };
  }
  const manifest = manifestRaw as ManifestEnvelope;
  const rootId = typeof manifest.root_id === 'string' ? manifest.root_id : 'root';
  const hasSubtreeTemplate = typeof manifest.subtree_url_template === 'string';

  return {
    manifestUrl,
    manifest,
    rootId,
    errors,
    manifestGaps: [...manifestResult.gaps],
    manifestWarnings: [...manifestResult.warnings],
    manifestBytes,
    manifestGzipBytes,
    hasSubtreeTemplate,
  };
}

export interface SubtreeFetchOutcome {
  subtree: SubtreeEnvelope | null;
  bytes: number;
  gzipBytes: number | null;
  gaps: Gap[];
  warnings: Warning[];
  error?: SiteError;
}

/** Fetch a subtree envelope by id. The manifest must advertise
 * `subtree_url_template`; callers should check `handle.hasSubtreeTemplate`
 * before invoking. */
export async function loadSubtree(handle: SiteHandle, id: string): Promise<SubtreeFetchOutcome> {
  const tpl = handle.manifest.subtree_url_template;
  if (typeof tpl !== 'string' || tpl.length === 0) {
    return {
      subtree: null,
      bytes: 0,
      gzipBytes: null,
      gaps: [],
      warnings: [],
      error: {
        scope: 'subtree',
        message: `subtree fetch requested for ${id} but manifest does not advertise subtree_url_template.`,
      },
    };
  }
  const url = resolveAgainst(handle.manifestUrl, substituteId(tpl, id));
  try {
    const res = await fetchJsonWithSize(url);
    if ('httpStatus' in res) {
      return {
        subtree: null,
        bytes: 0,
        gzipBytes: null,
        gaps: [],
        warnings: [],
        error: {
          scope: 'subtree',
          message: `subtree ${id} fetch returned HTTP ${res.httpStatus} from ${url}.`,
        },
      };
    }
    const result = validateSubtree(res.data);
    return {
      subtree: res.data as SubtreeEnvelope,
      bytes: res.bytes,
      gzipBytes: res.gzipBytes,
      gaps: [...result.gaps],
      warnings: [...result.warnings],
    };
  } catch (err) {
    return {
      subtree: null,
      bytes: 0,
      gzipBytes: null,
      gaps: [],
      warnings: [],
      error: {
        scope: 'subtree',
        message: `subtree ${id} fetch failed: ${describeError(err)} (${url}).`,
        ...(isCorsLikeError(err) ? { cors: true } : {}),
      },
    };
  }
}

export interface IndexFetchOutcome {
  entries: IndexEntry[];
  bytes: number;
  gzipBytes: number | null;
  gaps: Gap[];
  warnings: Warning[];
  error?: SiteError;
}

/** Lazy index fetch — invoked only behind the operator-opt-in "Show full
 * index" affordance. The progressive-walk path never calls this. */
export async function loadIndexLazy(handle: SiteHandle): Promise<IndexFetchOutcome> {
  const url = resolveAgainst(handle.manifestUrl, handle.manifest.index_url);
  try {
    const res = await fetchJsonWithSize(url);
    if ('httpStatus' in res) {
      return {
        entries: [],
        bytes: 0,
        gzipBytes: null,
        gaps: [],
        warnings: [],
        error: {
          scope: 'index',
          message: `index fetch returned HTTP ${res.httpStatus} from ${url}.`,
        },
      };
    }
    const result = validateIndex(res.data);
    const env = res.data as { nodes?: unknown };
    const entries: IndexEntry[] = Array.isArray(env.nodes) ? (env.nodes as IndexEntry[]) : [];
    return {
      entries,
      bytes: res.bytes,
      gzipBytes: res.gzipBytes,
      gaps: [...result.gaps],
      warnings: [...result.warnings],
    };
  } catch (err) {
    return {
      entries: [],
      bytes: 0,
      gzipBytes: null,
      gaps: [],
      warnings: [],
      error: {
        scope: 'index',
        message: `index fetch failed: ${describeError(err)} (${url}).`,
        ...(isCorsLikeError(err) ? { cors: true } : {}),
      },
    };
  }
}

export interface NodeFetchOutcome {
  node: NodeEnvelope | null;
  gaps: Gap[];
  warnings: Warning[];
  /** Raw payload size of the node JSON, in UTF-8 bytes (0 on error). */
  bytes: number;
  /** Gzipped wire size of the node JSON. `null` if CompressionStream
   * isn't available or the fetch errored. */
  gzipBytes: number | null;
  error?: SiteError;
}

export async function loadNode(handle: SiteHandle, id: string): Promise<NodeFetchOutcome> {
  const tpl = handle.manifest.node_url_template;
  const nodeUrl = resolveAgainst(handle.manifestUrl, substituteId(tpl, id));
  try {
    const res = await fetchJsonWithSize(nodeUrl);
    if ('httpStatus' in res) {
      return {
        node: null,
        gaps: [],
        warnings: [],
        bytes: 0,
        gzipBytes: null,
        error: {
          scope: 'node',
          message: `node ${id} fetch returned HTTP ${res.httpStatus} from ${nodeUrl}.`,
        },
      };
    }
    const result = validateNode(res.data);
    return {
      node: res.data as NodeEnvelope,
      gaps: [...result.gaps],
      warnings: [...result.warnings],
      bytes: res.bytes,
      gzipBytes: res.gzipBytes,
    };
  } catch (err) {
    return {
      node: null,
      gaps: [],
      warnings: [],
      bytes: 0,
      gzipBytes: null,
      error: {
        scope: 'node',
        message: `node ${id} fetch failed: ${describeError(err)} (${nodeUrl}).`,
        ...(isCorsLikeError(err) ? { cors: true } : {}),
      },
    };
  }
}

export interface HtmlFetchOutcome {
  url: string;
  bytes: number;
  /** Gzipped wire size — what a CDN with `Content-Encoding: gzip` would
   * actually ship. `null` if CompressionStream is unavailable. */
  gzipBytes: number | null;
  ok: boolean;
  /** Reason the fetch couldn't measure (CORS, 4xx/5xx, network). */
  error?: string;
}

/** Fetch the rendered HTML page at `source.human_url` and return both its
 * UTF-8 byte size and gzipped size. Used by the site-browser to estimate
 * "what would the agent have spent walking HTML instead of ACT?". Errors
 * are tolerated; the caller surfaces unmeasured URLs in the meter tooltip. */
export async function loadHtml(url: string): Promise<HtmlFetchOutcome> {
  try {
    const res = await fetchTextWithSize(url);
    if ('httpStatus' in res) {
      return { url, bytes: 0, gzipBytes: null, ok: false, error: `HTTP ${res.httpStatus}` };
    }
    return { url, bytes: res.bytes, gzipBytes: res.gzipBytes, ok: true };
  } catch (err) {
    const cors = isCorsLikeError(err);
    return {
      url,
      bytes: 0,
      gzipBytes: null,
      ok: false,
      error: cors ? 'CORS or network failure' : describeError(err),
    };
  }
}

/** Re-export so callers can opt into the inspector's full discovery probe. */
export { inspectorNode };

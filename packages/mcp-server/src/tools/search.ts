/**
 * `act_search(url, query)` — naive substring search.
 *
 * IMPLEMENTATION (be honest about it):
 *
 *  1. Walk the tree (full discovery walk via `@act-spec/inspector`).
 *  2. For each node, check `title`, `summary`, and any prose blocks in
 *     `content[]` for a case-insensitive substring match against
 *     `query`.
 *
 * LIMITATIONS (advertised in the tool description):
 *
 *  - No tokenization, no stemming, no relevance ranking.
 *  - Single-string query only — no operators, no quoting, no fuzzy.
 *  - The walk fetches every node; on a large site this is slow and
 *    expensive. The tool documents this so callers can prefer
 *    `act_walk_subtree` followed by their own filter when they know
 *    a smaller scope.
 *
 * Producers that advertise a `search_url_template` (Plus only, per
 * PRD-100) should be preferred. The TODO is to dispatch to the
 * producer's search endpoint when present; for v0.1 we always do the
 * client-side walk so we have a uniform answer for every level.
 */
import { walk } from '@act-spec/inspector';
import { node as inspectorNode } from '@act-spec/inspector';

import type { ServerCache } from '../cache.js';
import type { SearchHit, SearchResult } from '../types.js';

export interface SearchDeps {
  fetch?: typeof globalThis.fetch;
  cache: ServerCache;
}

const EXCERPT_RADIUS = 60;

export async function actSearch(
  url: string,
  query: string,
  deps: SearchDeps,
): Promise<SearchResult> {
  const q = query.trim();
  if (q.length === 0) {
    return { url, query, hits: [], truncated: false, findings: [] };
  }
  const qLower = q.toLowerCase();

  const walkOpts: Parameters<typeof walk>[1] = { sample: 'all' };
  if (deps.fetch !== undefined) walkOpts.fetch = deps.fetch;
  const walkResult = await walk(url, walkOpts);

  if (walkResult.manifest === null) {
    return {
      url: walkResult.url,
      query,
      hits: [],
      truncated: false,
      findings: walkResult.findings,
    };
  }
  deps.cache.setManifest(url, walkResult.manifest);

  // The inspector's `walk` exposes `{id, type, parent, children, tokens,
  // etag, status}` per node — title/summary/content are inside the
  // per-node envelope and have to be read from the body. We fetch each
  // node (respecting the cache) and check title → summary → body, in
  // that order, so the `matched_in` field reports the first kind of
  // match we encounter.
  const hits: SearchHit[] = [];
  for (const n of walkResult.nodes) {
    let body = deps.cache.getNode(url, n.id);
    if (body === undefined) {
      const fetchOpts: Parameters<typeof inspectorNode>[2] = {};
      if (deps.fetch !== undefined) fetchOpts.fetch = deps.fetch;
      const got = await inspectorNode(url, n.id, fetchOpts);
      body = got.node;
      if (body !== null && body !== undefined) deps.cache.setNode(url, n.id, body);
    }
    if (body === null || body === undefined) continue;
    const b = body as Record<string, unknown>;
    const title = typeof b['title'] === 'string' ? (b['title']) : undefined;
    const summary = typeof b['summary'] === 'string' ? (b['summary']) : undefined;

    if (title !== undefined && title.toLowerCase().includes(qLower)) {
      hits.push({ id: n.id, type: n.type, title, matched_in: 'title' });
      continue;
    }
    if (summary !== undefined && summary.toLowerCase().includes(qLower)) {
      hits.push({
        id: n.id,
        type: n.type,
        title: title ?? n.id,
        matched_in: 'summary',
      });
      continue;
    }
    const proseHit = findInProse(b, qLower);
    if (proseHit !== null) {
      hits.push({
        id: n.id,
        type: n.type,
        title: title ?? n.id,
        matched_in: 'body',
        excerpt: proseHit,
      });
    }
  }

  return {
    url: walkResult.url,
    query,
    hits,
    truncated: false,
    findings: walkResult.findings,
  };
}

/**
 * Look inside a node envelope's `content[]` for prose blocks that
 * contain the (lowercased) query. Returns a short excerpt window or
 * null when no match.
 */
function findInProse(node: Record<string, unknown>, qLower: string): string | null {
  const content = node['content'];
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const t = b['type'];
    // We accept any block whose `text` is a string (prose, callout body,
    // markdown source). The naive search isn't picky; transparency
    // about that is in the tool description.
    if (
      typeof t === 'string' &&
      (t === 'prose' || t === 'markdown' || t === 'callout' || t === 'code')
    ) {
      const text = b['text'];
      if (typeof text === 'string') {
        const idx = text.toLowerCase().indexOf(qLower);
        if (idx >= 0) {
          return excerpt(text, idx, qLower.length);
        }
      }
    }
  }
  return null;
}

function excerpt(text: string, idx: number, qLen: number): string {
  const start = Math.max(0, idx - EXCERPT_RADIUS);
  const end = Math.min(text.length, idx + qLen + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

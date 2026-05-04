/**
 * Public types for `@act-spec/mcp-server`.
 *
 * The wire-format envelopes (`Manifest`, `Node`, ...) belong to
 * `@act-spec/core`; we re-export only the shapes our tools surface.
 */

export interface ServerConfig {
  /** Custom fetch adapter (for tests; defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** TTL in ms for manifest cache entries (default 60_000). */
  manifestTtlMs?: number;
  /** TTL in ms for node cache entries (default 300_000). */
  nodeTtlMs?: number;
  /** Optional LRU cap per cache (default 256). */
  maxCacheEntries?: number;
  /** Pre-bound site URL — clients may omit `url` from each tool call. */
  defaultSiteUrl?: string;
}

export interface LoadSiteResult {
  url: string;
  manifest: unknown;
  findings: unknown[];
}

export interface WalkSubtreeResult {
  url: string;
  root_id: string;
  depth: number;
  nodes: Array<{
    id: string;
    type: string;
    parent: string | null | undefined;
    children: string[];
    title?: string;
    summary?: string;
  }>;
  truncated: boolean;
  findings: unknown[];
}

export interface GetNodeResult {
  url: string;
  node: unknown;
  findings: unknown[];
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  /** Where the match was found. */
  matched_in: 'title' | 'summary' | 'body';
  /** Short context window around the match (for body hits). */
  excerpt?: string;
}

export interface SearchResult {
  url: string;
  query: string;
  hits: SearchHit[];
  /** True when the index/walk was truncated by request budget. */
  truncated: boolean;
  findings: unknown[];
}

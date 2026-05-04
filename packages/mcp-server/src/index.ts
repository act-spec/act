/**
 * @act-spec/mcp-server — universal MCP server for any ACT-emitting site.
 *
 * Distributed as `npx @act-spec/mcp-server <url>`. Boots a stdio MCP
 * transport and exposes four tools that map onto the ACT wire format:
 *
 *  - `act_load_site(url)`             → fetch the manifest
 *  - `act_walk_subtree(url, id, …)`   → BFS over the index
 *  - `act_get_node(url, id)`          → single envelope fetch
 *  - `act_search(url, query)`         → naive substring scan
 *
 * The server is composition: it wraps `@act-spec/inspector` for the
 * fetch / walk / cache mechanics and `@act-spec/core` for the wire-
 * format types. It does NOT re-implement any of those primitives.
 */

export const MCP_SERVER_PACKAGE_NAME = '@act-spec/mcp-server' as const;

export { createServer, type ActMcpServer } from './server.js';
export { ServerCache, type CacheOptions } from './cache.js';

export { actLoadSite } from './tools/load-site.js';
export { actGetNode } from './tools/get-node.js';
export { actWalkSubtree } from './tools/walk-subtree.js';
export { actSearch } from './tools/search.js';

export type {
  ServerConfig,
  LoadSiteResult,
  WalkSubtreeResult,
  GetNodeResult,
  SearchHit,
  SearchResult,
} from './types.js';

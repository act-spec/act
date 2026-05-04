/**
 * `createServer(config?)` — boots an MCP `Server` instance and wires
 * the four ACT tools onto its request handlers.
 *
 * The server uses the MCP TypeScript SDK's `Server` class from
 * `@modelcontextprotocol/sdk/server/index.js`. Tools are registered via
 * `setRequestHandler(ListToolsRequestSchema, ...)` and
 * `setRequestHandler(CallToolRequestSchema, ...)`.
 *
 * Transport binding is the caller's job — call `connectStdio(server)`
 * to bind stdio (the binary in `bin/` does this); the hosted variant
 * binds its own SSE transport.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ServerCache } from './cache.js';
import { actGetNode } from './tools/get-node.js';
import { actLoadSite } from './tools/load-site.js';
import { actSearch } from './tools/search.js';
import { actWalkSubtree } from './tools/walk-subtree.js';
import type { ServerConfig } from './types.js';

const SERVER_NAME = '@act-spec/mcp-server' as const;
const SERVER_VERSION = '0.0.0' as const;

const TOOL_DEFS = [
  {
    name: 'act_load_site',
    description:
      "Load an ACT-emitting site's manifest. Fetches `<url>/.well-known/act.json` and returns the parsed manifest plus any structural findings. Use this first to discover what content is available.",
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Site origin or any URL on the site (e.g. https://act-spec.org or https://act-spec.org/docs).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'act_walk_subtree',
    description:
      'Walk a subtree of the ACT content tree. Returns the node at `node_id` plus its descendants up to `depth` levels deep (default 3, max 8). Useful for browsing a documentation section without fetching the whole tree.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Site origin.' },
        node_id: { type: 'string', description: 'ACT node id to root the walk at.' },
        depth: {
          type: 'number',
          description: 'How many levels of descendants to include (default 3, max 8).',
          default: 3,
        },
      },
      required: ['url', 'node_id'],
    },
  },
  {
    name: 'act_get_node',
    description:
      'Fetch a single ACT node by id. Returns the full envelope including content blocks. Cheaper than walk_subtree when you already know which node you want.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Site origin.' },
        node_id: { type: 'string', description: 'ACT node id to fetch.' },
      },
      required: ['url', 'node_id'],
    },
  },
  {
    name: 'act_search',
    description:
      'Search the site by case-insensitive substring across node `title`, `summary`, and prose blocks. LIMITATIONS: this is naive substring matching only — no tokenization, no stemming, no relevance ranking, no operators or quoting. The implementation walks the entire index and fetches every node body that does not match on title/summary, so it is slow on large sites. Prefer `act_walk_subtree` when you can scope the search structurally.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Site origin.' },
        query: { type: 'string', description: 'Substring to search for (case-insensitive).' },
      },
      required: ['url', 'query'],
    },
  },
] as const;

export interface ActMcpServer {
  /** The underlying MCP `Server` instance — connect any transport to it. */
  readonly server: Server;
  /** Bind to a stdio transport (the canonical npx-distributed flavour). */
  connectStdio(): Promise<void>;
  /** Close the stdio transport (if any) and the server. Best-effort. */
  close(): Promise<void>;
}

export function createServer(config: ServerConfig = {}): ActMcpServer {
  const cache = new ServerCache({
    ...(config.manifestTtlMs !== undefined ? { manifestTtlMs: config.manifestTtlMs } : {}),
    ...(config.nodeTtlMs !== undefined ? { nodeTtlMs: config.nodeTtlMs } : {}),
    ...(config.maxCacheEntries !== undefined ? { maxEntries: config.maxCacheEntries } : {}),
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return Promise.resolve({ tools: TOOL_DEFS });
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const url = pickUrl(args, config);
      switch (name) {
        case 'act_load_site': {
          const out = await actLoadSite(url, {
            cache,
            ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
          });
          return toTextResult(out);
        }
        case 'act_walk_subtree': {
          const nodeId = requireString(args, 'node_id');
          const depth = typeof args['depth'] === 'number' ? args['depth'] : 3;
          const out = await actWalkSubtree(url, nodeId, depth, {
            cache,
            ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
          });
          return toTextResult(out);
        }
        case 'act_get_node': {
          const nodeId = requireString(args, 'node_id');
          const out = await actGetNode(url, nodeId, {
            cache,
            ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
          });
          return toTextResult(out);
        }
        case 'act_search': {
          const query = requireString(args, 'query');
          const out = await actSearch(url, query, {
            cache,
            ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
          });
          return toTextResult(out);
        }
        default:
          return toErrorResult(`unknown tool: ${name}`);
      }
    } catch (err) {
      return toErrorResult(err instanceof Error ? err.message : String(err));
    }
  });

  let stdioTransport: StdioServerTransport | null = null;
  return {
    server,
    async connectStdio() {
      stdioTransport = new StdioServerTransport();
      await server.connect(stdioTransport);
    },
    async close() {
      if (stdioTransport !== null) {
        try {
          await stdioTransport.close();
        } catch {
          // best-effort
        }
        stdioTransport = null;
      }
      try {
        await server.close();
      } catch {
        // best-effort
      }
    },
  };
}

function pickUrl(args: Record<string, unknown>, config: ServerConfig): string {
  const fromArgs = args['url'];
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  if (config.defaultSiteUrl !== undefined && config.defaultSiteUrl.length > 0) {
    return config.defaultSiteUrl;
  }
  throw new Error('missing required string argument: url');
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required string argument: ${key}`);
  }
  return v;
}

function toTextResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

function toErrorResult(message: string): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

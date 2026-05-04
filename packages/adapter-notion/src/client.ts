/**
 * Notion API client surface.
 *
 * Two implementations live behind a single `NotionSourceProvider` interface:
 *
 *   - `httpProvider({ token, baseUrl, notionApiVersion, fetch })` — talks
 *     to the live Notion API via `fetch`. Zero runtime deps; the `@notionhq/client`
 *     SDK is intentionally avoided to keep this package's dependency surface
 *     minimal (the adapter only needs four endpoints, and the JSON shapes
 *     are stable enough at API version `2022-06-28` that an in-tree wrapper
 *     is the right trade-off).
 *
 *   - `corpusProvider(corpus)` — backs the same interface from a recorded
 *     bundle of API responses. This is the canonical test path and is also
 *     useful for caller fixtures.
 */
import type {
  NotionBlock,
  NotionDatabase,
  NotionPage,
} from './types.js';
import { NotionAdapterError } from './errors.js';

/** Pinned Notion API version. Supersede via `NotionAdapterConfig.notionApiVersion`. */
export const NOTION_API_VERSION = '2022-06-28' as const;

/** Default API base. */
export const NOTION_API_BASE_URL = 'https://api.notion.com' as const;

/**
 * Recorded bundle the test suite (and conformance gate) feed in. Mirrors
 * the live API endpoints the adapter calls.
 */
export interface NotionSourceCorpus {
  database: NotionDatabase;
  pages: NotionPage[];
  /** Block trees keyed by page id. Missing entries imply an empty block list. */
  pageBlocks?: Record<string, NotionBlock[]>;
}

/** Provider interface — the adapter only ever talks through this. */
export interface NotionSourceProvider {
  /** Auth probe. Returns 'ok' when the token is accepted, 'unauthorized' on 401, 'database_not_found' on 404. */
  probeAuth(databaseId: string): Promise<'ok' | 'unauthorized' | 'database_not_found'>;
  /** Fetch the database object (`databases.retrieve`). */
  retrieveDatabase(databaseId: string): Promise<NotionDatabase>;
  /** Iterate every page in the database (`databases.query`). Pagination handled inside. */
  queryDatabasePages(databaseId: string): AsyncIterable<NotionPage>;
  /** Fetch the (recursive) block tree for a page (`blocks.children.list`). */
  listPageBlocks(pageId: string): Promise<NotionBlock[]>;
  /** Idempotent. */
  dispose(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Corpus-backed provider (for tests and callers with recorded responses)
// ---------------------------------------------------------------------------

/**
 * Build a NotionSourceProvider from a recorded corpus. Production-grade
 * for tests AND for any caller that has captured Notion API responses.
 */
export function corpusProvider(corpus: NotionSourceCorpus): NotionSourceProvider {
  return {
    probeAuth(databaseId: string) {
      if (databaseId !== corpus.database.id) {
        return Promise.resolve('database_not_found');
      }
      return Promise.resolve('ok');
    },
    retrieveDatabase(databaseId: string) {
      if (databaseId !== corpus.database.id) {
        throw new NotionAdapterError({
          code: 'database_not_found',
          message: `database '${databaseId}' not in corpus`,
        });
      }
      return Promise.resolve(corpus.database);
    },
    async *queryDatabasePages(databaseId: string) {
      if (databaseId !== corpus.database.id) return;
      // Deterministic order by page id (matches HTTP provider's normalization).
      const sorted = [...corpus.pages].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      for (const page of sorted) {
        await Promise.resolve();
        yield page;
      }
    },
    listPageBlocks(pageId: string) {
      const blocks = corpus.pageBlocks?.[pageId] ?? [];
      return Promise.resolve(blocks);
    },
    dispose() {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP-backed provider (live Notion API)
// ---------------------------------------------------------------------------

/** Minimal `fetch` typing — accepts either the global `fetch` or a stand-in. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface HttpProviderOpts {
  /** Notion integration token (raw string; resolved by the adapter). */
  token: string;
  /** Override API base. */
  baseUrl?: string;
  /** Override `Notion-Version` header. */
  notionApiVersion?: string;
  /** Inject a custom `fetch`. Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/**
 * Build an HTTP-backed provider. Talks to the live Notion API.
 */
export function httpProvider(opts: HttpProviderOpts): NotionSourceProvider {
  const baseUrl = (opts.baseUrl ?? NOTION_API_BASE_URL).replace(/\/$/, '');
  const apiVersion = opts.notionApiVersion ?? NOTION_API_VERSION;
  const fetcher: FetchLike =
    opts.fetch ??
    globalThis.fetch ??
    (() => {
      throw new NotionAdapterError({
        code: 'upstream_unavailable',
        message: 'No `fetch` available in this runtime; pass `fetch` explicitly',
      });
    });

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${opts.token}`,
      'Notion-Version': apiVersion,
      'Content-Type': 'application/json',
    };
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers: headers(),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetcher(url, init);
    if (res.status === 401) {
      throw new NotionAdapterError({
        code: 'auth_failed',
        message: `Notion API rejected the token (HTTP 401) for ${method} ${path}`,
      });
    }
    if (res.status === 404) {
      throw new NotionAdapterError({
        code: 'database_not_found',
        message: `Notion API returned 404 for ${method} ${path}`,
      });
    }
    if (res.status === 429) {
      throw new NotionAdapterError({
        code: 'rate_limit_exhausted',
        message: `Notion API rate-limited (HTTP 429) on ${method} ${path}`,
      });
    }
    if (!res.ok) {
      const detail = await safeReadBody(res);
      throw new NotionAdapterError({
        code: 'upstream_unavailable',
        message: `Notion API returned HTTP ${String(res.status)} on ${method} ${path}: ${detail}`,
      });
    }
    return await res.json();
  }

  return {
    async probeAuth(databaseId: string) {
      try {
        await request('GET', `/v1/databases/${databaseId}`);
        return 'ok';
      } catch (err) {
        if (err instanceof NotionAdapterError) {
          if (err.code === 'auth_failed') return 'unauthorized';
          if (err.code === 'database_not_found') return 'database_not_found';
        }
        throw err;
      }
    },
    async retrieveDatabase(databaseId: string) {
      const out = await request('GET', `/v1/databases/${databaseId}`);
      return out as NotionDatabase;
    },
    async *queryDatabasePages(databaseId: string) {
      let cursor: string | undefined;
      let safety = 0;
      do {
        if (safety++ > 1000) {
          throw new NotionAdapterError({
            code: 'upstream_unavailable',
            message: `paginate safety limit reached on databases.query ${databaseId}`,
          });
        }
        const body: Record<string, unknown> = { page_size: 100 };
        if (cursor !== undefined) body['start_cursor'] = cursor;
        const out = (await request('POST', `/v1/databases/${databaseId}/query`, body)) as {
          results: NotionPage[];
          has_more?: boolean;
          next_cursor?: string | null;
        };
        for (const p of out.results) yield p;
        cursor = out.has_more === true && out.next_cursor ? out.next_cursor : undefined;
      } while (cursor !== undefined);
    },
    async listPageBlocks(pageId: string) {
      // Walk top-level children, then recurse into any block with `has_children: true`.
      async function listChildren(blockId: string): Promise<NotionBlock[]> {
        const acc: NotionBlock[] = [];
        let cursor: string | undefined;
        let safety = 0;
        do {
          if (safety++ > 1000) {
            throw new NotionAdapterError({
              code: 'upstream_unavailable',
              message: `paginate safety limit reached on blocks.children.list ${blockId}`,
            });
          }
          const qs = cursor !== undefined ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
          const out = (await request('GET', `/v1/blocks/${blockId}/children${qs}`)) as {
            results: NotionBlock[];
            has_more?: boolean;
            next_cursor?: string | null;
          };
          for (const b of out.results) {
            if (b.has_children === true) {
              b.children = await listChildren(b.id);
            }
            acc.push(b);
          }
          cursor = out.has_more === true && out.next_cursor ? out.next_cursor : undefined;
        } while (cursor !== undefined);
        return acc;
      }
      return listChildren(pageId);
    },
    dispose() {
      // no persistent resources to release
    },
  };
}

async function safeReadBody(res: { text(): Promise<string> }): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 200);
  } catch {
    return '<unreadable body>';
  }
}

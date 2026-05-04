/**
 * Thin WordPress REST HTTP client. Builds Authorization headers from the
 * adapter's resolved auth, paginates collection endpoints, and surfaces
 * structured `WordPressAdapterError`s on transport / HTTP failures.
 *
 * The client is intentionally `fetch`-based so callers (and tests) can pass
 * a custom fetcher. No `axios` / `node-fetch` dependency.
 */
import { WordPressAdapterError } from './errors.js';
import type { ResolvedAuth } from './types.js';

/** A `fetch`-compatible function. The default uses globalThis.fetch (Node 20+). */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; method?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** Options for `createWordPressClient`. */
export interface ClientOptions {
  baseUrl: string;
  auth: ResolvedAuth;
  fetch?: FetchLike;
  /** Page size (1..100). Default 100. */
  perPage?: number;
  /** Optional per-request abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

/** REST collection slugs the client knows about. */
export type WordPressCollection =
  | 'posts'
  | 'pages'
  | 'categories'
  | 'tags'
  | 'users'
  | 'media';

/**
 * Build `Authorization` header value for the resolved auth, or `null` when
 * the adapter is configured for anonymous read-only access.
 */
export function buildAuthHeader(auth: ResolvedAuth): string | null {
  if (auth.kind === 'none') return null;
  if (auth.kind === 'bearer') return `Bearer ${auth.token}`;
  // application password — Basic Auth, base64(user:pass).
  const raw = `${auth.user}:${auth.password}`;
  // Use Buffer in Node; fall back to btoa in browsers (the adapter targets Node
  // but the helper is pure and portable).
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(raw, 'utf8').toString('base64')
      : (globalThis as { btoa?: (s: string) => string }).btoa?.(raw) ?? '';
  return `Basic ${b64}`;
}

/** Build the REST URL for a collection page. */
export function buildCollectionUrl(
  baseUrl: string,
  collection: WordPressCollection,
  page: number,
  perPage: number,
): string {
  const root = baseUrl.replace(/\/+$/, '');
  return `${root}/wp-json/wp/v2/${collection}?per_page=${perPage}&page=${page}&_embed=false&context=view`;
}

/** A single REST page result + the WP `X-WP-TotalPages` header value. */
export interface CollectionPage<T> {
  items: T[];
  totalPages: number;
}

/**
 * Fetch a single REST page. Throws `WordPressAdapterError` on transport or
 * HTTP failure; 401/403 surface as `auth_failed` so the operator gets a
 * targeted error instead of a generic HTTP one.
 */
export async function fetchCollectionPage<T>(
  opts: ClientOptions,
  collection: WordPressCollection,
  page: number,
): Promise<CollectionPage<T>> {
  const globalFetch =
    typeof globalThis.fetch === 'function' ? (globalThis.fetch as unknown as FetchLike) : undefined;
  const fetchFn: FetchLike | undefined = opts.fetch ?? globalFetch;
  if (fetchFn === undefined) {
    throw new WordPressAdapterError({
      code: 'transport_error',
      message:
        'WordPress adapter: no fetch implementation available. Pass `fetch` explicitly or run on Node 20+ where `globalThis.fetch` is defined.',
    });
  }
  const perPage = opts.perPage ?? 100;
  const url = buildCollectionUrl(opts.baseUrl, collection, page, perPage);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': '@act-spec/adapter-wordpress',
  };
  const authHeader = buildAuthHeader(opts.auth);
  if (authHeader !== null) headers['Authorization'] = authHeader;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchFn(url, {
      headers,
      method: 'GET',
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    throw new WordPressAdapterError({
      code: 'transport_error',
      message: `WordPress adapter: transport error fetching ${url}: ${(err as Error).message}`,
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new WordPressAdapterError({
      code: 'auth_failed',
      message: `WordPress adapter: HTTP ${String(response.status)} ${response.statusText} on ${url} — credentials rejected. Verify your application password or bearer token.`,
    });
  }
  if (!response.ok) {
    // 400 on `page=N+1` past the end is a documented WP behavior; treat as empty.
    if (response.status === 400 && page > 1) {
      return { items: [], totalPages: page - 1 };
    }
    throw new WordPressAdapterError({
      code: 'http_error',
      message: `WordPress adapter: HTTP ${String(response.status)} ${response.statusText} on ${url}`,
    });
  }
  const totalHeader = response.headers.get('X-WP-TotalPages');
  const totalPages = totalHeader !== null ? Number.parseInt(totalHeader, 10) : 1;
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new WordPressAdapterError({
      code: 'http_error',
      message: `WordPress adapter: invalid JSON from ${url}: ${(err as Error).message}`,
    });
  }
  if (!Array.isArray(body)) {
    throw new WordPressAdapterError({
      code: 'http_error',
      message: `WordPress adapter: expected array from ${url}, got ${typeof body}`,
    });
  }
  return {
    items: body as T[],
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
  };
}

/**
 * Fetch all pages of a collection, yielding items lazily. The loop stops
 * when `X-WP-TotalPages` is exhausted or the server returns an empty page.
 * Order is preserved (page 1 first).
 */
export async function* fetchCollection<T>(
  opts: ClientOptions,
  collection: WordPressCollection,
): AsyncGenerator<T> {
  let page = 1;
  // Cap iterations defensively in case `X-WP-TotalPages` is missing/wrong.
  for (let safety = 0; safety < 10_000; safety += 1) {
    const result = await fetchCollectionPage<T>(opts, collection, page);
    for (const item of result.items) yield item;
    if (result.items.length === 0) return;
    if (page >= result.totalPages) return;
    page += 1;
  }
}

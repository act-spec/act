/**
 * Unit tests for `@act-spec/adapter-wordpress`. Covers the factory contract,
 * config-schema validation, auth header construction, HTTP pagination via a
 * mocked fetch, post / page / category / tag / user mapping, Polylang and
 * WPML detection, and end-to-end runs through the adapter framework.
 */
import { describe, expect, it, vi } from 'vitest';
import { runAdapter } from '@act-spec/adapter-framework';
import type {
  AdapterContext,
  EmittedNode,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';
import { validateNode } from '@act-spec/validator';

import {
  RESERVED_METADATA_KEYS,
  WORDPRESS_ADAPTER_NAME,
  WORDPRESS_DEFAULT_CONCURRENCY,
  WORDPRESS_DEFAULT_NAMESPACE,
  WORDPRESS_DEFAULT_PER_PAGE,
  WordPressAdapterError,
  buildAuthHeader,
  buildCollectionUrl,
  createWordPressAdapter,
  detectI18nMode,
  extractLocale,
  extractTranslations,
  fetchCollection,
  fetchCollectionPage,
  htmlToParagraphs,
  httpProvider,
  mapWordPressItem,
  resolveAuth,
  tokenize,
} from './index.js';
import type {
  FetchLike,
  WordPressAdapterConfig,
  WordPressItem,
  WordPressPage,
  WordPressPost,
  WordPressSourceCorpus,
  WordPressTerm,
  WordPressUser,
} from './index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger(): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function ctx(
  config: Partial<WordPressAdapterConfig> = {},
  over: Partial<AdapterContext> = {},
): AdapterContext {
  return {
    config: config as unknown as Record<string, unknown>,
    targetLevel: 'standard',
    actVersion: '0.1',
    logger: makeLogger(),
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

function tinyPost(over: Partial<WordPressPost> = {}): WordPressPost {
  return {
    id: 1,
    slug: 'hello-world',
    link: 'https://wp.example/hello-world',
    title: { rendered: 'Hello, world' },
    content: { rendered: '<p>Welcome to WordPress.</p><p>Second paragraph.</p>' },
    excerpt: { rendered: '<p>A friendly hello.</p>' },
    author: 7,
    featured_media: 13,
    categories: [4],
    tags: [9],
    modified_gmt: '2026-01-02T03:04:05Z',
    ...over,
  };
}

function tinyPage(over: Partial<WordPressPage> = {}): WordPressPage {
  return {
    id: 100,
    slug: 'about',
    link: 'https://wp.example/about',
    title: { rendered: 'About' },
    content: { rendered: '<p>About this site.</p>' },
    excerpt: { rendered: '' },
    parent: 0,
    ...over,
  };
}

function tinyCategory(over: Partial<WordPressTerm> = {}): WordPressTerm {
  return {
    id: 4,
    name: 'News',
    slug: 'news',
    taxonomy: 'category',
    description: 'Announcements and updates.',
    count: 12,
    parent: 0,
    ...over,
  };
}

function tinyTag(over: Partial<WordPressTerm> = {}): WordPressTerm {
  return {
    id: 9,
    name: 'TypeScript',
    slug: 'typescript',
    taxonomy: 'post_tag',
    description: '',
    count: 3,
    ...over,
  };
}

function tinyUser(over: Partial<WordPressUser> = {}): WordPressUser {
  return {
    id: 7,
    name: 'Ada Lovelace',
    slug: 'ada',
    description: 'Mathematician.',
    ...over,
  };
}

function tinyCorpus(over: Partial<WordPressSourceCorpus> = {}): WordPressSourceCorpus {
  return {
    posts: [tinyPost()],
    pages: [tinyPage()],
    categories: [tinyCategory()],
    tags: [tinyTag()],
    users: [tinyUser()],
    ...over,
  };
}

function baseConfig(over: Partial<WordPressAdapterConfig> = {}): WordPressAdapterConfig {
  return {
    baseUrl: 'https://wp.example',
    ...over,
  };
}

function stripPartial(n: EmittedNode | PartialEmittedNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

/** Minimal Response shape conforming to FetchLike. */
function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
): Awaited<ReturnType<FetchLike>> {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

// ---------------------------------------------------------------------------
// Factory contract
// ---------------------------------------------------------------------------

describe('createWordPressAdapter — factory contract', () => {
  it('returns an Adapter whose name is "act-wordpress"', () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    expect(a.name).toBe(WORDPRESS_ADAPTER_NAME);
    expect(a.name).toBe('act-wordpress');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
    expect(typeof a.precheck).toBe('function');
  });

  it('exports stable defaults', () => {
    expect(WORDPRESS_DEFAULT_CONCURRENCY).toBe(4);
    expect(WORDPRESS_DEFAULT_PER_PAGE).toBe(100);
    expect(WORDPRESS_DEFAULT_NAMESPACE).toBe('wp');
    expect(RESERVED_METADATA_KEYS.has('source')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('locale')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('translations')).toBe(true);
  });

  it('reports level "standard" by default', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    const caps = await a.init(baseConfig() as unknown as Record<string, unknown>, ctx());
    expect(caps.level).toBe('standard');
    expect(caps.namespace_ids).toBe(false);
    expect(caps.manifestCapabilities?.etag).toBe(true);
  });

  it('downgrades level to "core" when target is core', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    const caps = await a.init(
      baseConfig() as unknown as Record<string, unknown>,
      ctx({}, { targetLevel: 'core' }),
    );
    expect(caps.level).toBe('core');
  });
});

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe('config schema', () => {
  it('accepts a minimal config { baseUrl }', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({ baseUrl: 'https://wp.example' }),
    ).resolves.toBeUndefined();
  });

  it('rejects missing baseUrl', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(a.precheck!({})).rejects.toMatchObject({
      code: 'config_invalid',
    });
  });

  it('rejects unknown top-level properties', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({ baseUrl: 'https://wp.example', not_a_field: 1 }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('accepts auth as a bearer string', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({ baseUrl: 'https://wp.example', auth: 'jwt-token' }),
    ).resolves.toBeUndefined();
  });

  it('accepts auth as { from_env }', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({ baseUrl: 'https://wp.example', auth: { from_env: 'WP_TOKEN' } }),
    ).resolves.toBeUndefined();
  });

  it('accepts auth as { user, appPassword }', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({
        baseUrl: 'https://wp.example',
        auth: { user: 'admin', appPassword: 'aaaa-bbbb-cccc-dddd' },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects perPage > 100', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({ baseUrl: 'https://wp.example', perPage: 500 }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('rejects unknown i18n.mode', async () => {
    const a = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      a.precheck!({ baseUrl: 'https://wp.example', i18n: { mode: 'magic' } }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

describe('resolveAuth', () => {
  it('returns kind "none" when no auth configured', () => {
    expect(resolveAuth(undefined)).toEqual({ kind: 'none' });
  });

  it('returns kind "bearer" for a string token', () => {
    expect(resolveAuth('tok')).toEqual({ kind: 'bearer', token: 'tok' });
  });

  it('reads bearer from env when given { from_env }', () => {
    process.env['WP_TEST_TOKEN'] = 'env-token';
    try {
      expect(resolveAuth({ from_env: 'WP_TEST_TOKEN' })).toEqual({
        kind: 'bearer',
        token: 'env-token',
      });
    } finally {
      delete process.env['WP_TEST_TOKEN'];
    }
  });

  it('throws env_missing when bearer env var is unset', () => {
    delete process.env['WP_NOT_SET_TOKEN'];
    expect(() => resolveAuth({ from_env: 'WP_NOT_SET_TOKEN' })).toThrow(
      WordPressAdapterError,
    );
  });

  it('returns kind "basic" for { user, appPassword }', () => {
    expect(
      resolveAuth({ user: 'admin', appPassword: 'aaaa bbbb cccc dddd' }),
    ).toEqual({ kind: 'basic', user: 'admin', password: 'aaaa bbbb cccc dddd' });
  });

  it('reads basic credentials from env when fields are { from_env }', () => {
    process.env['WP_USER'] = 'admin';
    process.env['WP_APP_PASS'] = 'app-pw';
    try {
      expect(
        resolveAuth({
          user: { from_env: 'WP_USER' },
          appPassword: { from_env: 'WP_APP_PASS' },
        }),
      ).toEqual({ kind: 'basic', user: 'admin', password: 'app-pw' });
    } finally {
      delete process.env['WP_USER'];
      delete process.env['WP_APP_PASS'];
    }
  });

  it('throws env_missing when basic env var is unset', () => {
    delete process.env['WP_USER_NOPE'];
    expect(() =>
      resolveAuth({
        user: { from_env: 'WP_USER_NOPE' },
        appPassword: 'x',
      }),
    ).toThrow(WordPressAdapterError);
  });
});

describe('buildAuthHeader', () => {
  it('returns null for kind=none', () => {
    expect(buildAuthHeader({ kind: 'none' })).toBeNull();
  });

  it('returns Bearer header for kind=bearer', () => {
    expect(buildAuthHeader({ kind: 'bearer', token: 't' })).toBe('Bearer t');
  });

  it('returns Basic header (base64 user:password) for kind=basic', () => {
    const h = buildAuthHeader({ kind: 'basic', user: 'admin', password: 'pw' });
    expect(h).toBe(`Basic ${Buffer.from('admin:pw', 'utf8').toString('base64')}`);
  });
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

describe('buildCollectionUrl', () => {
  it('builds wp-json/wp/v2/<collection> URLs with paging', () => {
    expect(buildCollectionUrl('https://wp.example', 'posts', 1, 100)).toBe(
      'https://wp.example/wp-json/wp/v2/posts?per_page=100&page=1&_embed=false&context=view',
    );
  });

  it('strips trailing slashes from baseUrl', () => {
    expect(buildCollectionUrl('https://wp.example/', 'pages', 2, 50)).toBe(
      'https://wp.example/wp-json/wp/v2/pages?per_page=50&page=2&_embed=false&context=view',
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP fetch (mocked)
// ---------------------------------------------------------------------------

describe('fetchCollectionPage / fetchCollection', () => {
  it('returns parsed items + totalPages from a mocked WordPress response', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse([tinyPost()], { headers: { 'X-WP-TotalPages': '1' } }));
    const result = await fetchCollectionPage<WordPressPost>(
      { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
      'posts',
      1,
    );
    expect(result.items).toHaveLength(1);
    expect(result.totalPages).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('injects Authorization: Bearer when kind=bearer', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse([], { headers: { 'X-WP-TotalPages': '0' } }));
    await fetchCollectionPage(
      {
        baseUrl: 'https://wp.example',
        auth: { kind: 'bearer', token: 't' },
        fetch: fetchMock,
      },
      'posts',
      1,
    );
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers!['Authorization']).toBe('Bearer t');
  });

  it('injects Authorization: Basic for application passwords', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse([], { headers: { 'X-WP-TotalPages': '0' } }));
    await fetchCollectionPage(
      {
        baseUrl: 'https://wp.example',
        auth: { kind: 'basic', user: 'admin', password: 'pw' },
        fetch: fetchMock,
      },
      'posts',
      1,
    );
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers!['Authorization']).toBe(
      `Basic ${Buffer.from('admin:pw', 'utf8').toString('base64')}`,
    );
  });

  it('omits Authorization when auth kind=none', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse([], { headers: { 'X-WP-TotalPages': '0' } }));
    await fetchCollectionPage(
      { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
      'posts',
      1,
    );
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers!['Authorization']).toBeUndefined();
  });

  it('throws auth_failed on HTTP 401', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { get: () => null },
        text: () => Promise.resolve('nope'),
        json: () => Promise.resolve({}),
      });
    await expect(
      fetchCollectionPage(
        { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
        'posts',
        1,
      ),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('throws auth_failed on HTTP 403', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: { get: () => null },
        text: () => Promise.resolve('nope'),
        json: () => Promise.resolve({}),
      });
    await expect(
      fetchCollectionPage(
        { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
        'posts',
        1,
      ),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('throws http_error on HTTP 500', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        headers: { get: () => null },
        text: () => Promise.resolve('boom'),
        json: () => Promise.resolve({}),
      });
    await expect(
      fetchCollectionPage(
        { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
        'posts',
        1,
      ),
    ).rejects.toMatchObject({ code: 'http_error' });
  });

  it('treats HTTP 400 on page > 1 as end-of-pagination (empty)', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => null },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    });
    const r = await fetchCollectionPage(
      { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
      'posts',
      2,
    );
    expect(r.items).toEqual([]);
  });

  it('throws transport_error when fetch rejects', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValueOnce(new Error('connection reset'));
    await expect(
      fetchCollectionPage(
        { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
        'posts',
        1,
      ),
    ).rejects.toMatchObject({ code: 'transport_error' });
  });

  it('paginates until totalPages is reached', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse([tinyPost({ id: 1, slug: 'a' })], { headers: { 'X-WP-TotalPages': '2' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse([tinyPost({ id: 2, slug: 'b' })], { headers: { 'X-WP-TotalPages': '2' } }),
      );
    const items: WordPressPost[] = [];
    for await (const p of fetchCollection<WordPressPost>(
      { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
      'posts',
    )) {
      items.push(p);
    }
    expect(items.map((p) => p.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops paginating when an empty page is returned', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse([], { headers: { 'X-WP-TotalPages': '0' } }),
      );
    const items: WordPressPost[] = [];
    for await (const p of fetchCollection<WordPressPost>(
      { baseUrl: 'https://wp.example', auth: { kind: 'none' }, fetch: fetchMock },
      'posts',
    )) {
      items.push(p);
    }
    expect(items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

describe('htmlToParagraphs', () => {
  it('splits on <p> boundaries and decodes named entities', () => {
    expect(htmlToParagraphs('<p>One &amp; two</p><p>Three</p>')).toEqual([
      'One & two',
      'Three',
    ]);
  });

  it('handles inline tags inside paragraphs', () => {
    expect(htmlToParagraphs('<p>Hello <em>world</em></p>')).toEqual(['Hello world']);
  });

  it('drops <script> and <style> bodies', () => {
    expect(
      htmlToParagraphs('<p>ok</p><script>alert(1)</script><p>fine</p>'),
    ).toEqual(['ok', 'fine']);
  });

  it('strips HTML comments', () => {
    expect(htmlToParagraphs('<p>x</p><!-- wp:paragraph --><p>y</p>')).toEqual([
      'x',
      'y',
    ]);
  });

  it('returns [] for empty / non-string input', () => {
    expect(htmlToParagraphs('')).toEqual([]);
    // intentional cast — exercising defensive path
    expect(htmlToParagraphs(undefined as unknown as string)).toEqual([]);
  });

  it('decodes numeric and hex entities', () => {
    expect(htmlToParagraphs('<p>A&#8211;B&#x2014;C</p>')).toEqual(['A–B—C']);
  });

  it('tolerates a truncated trailing tag', () => {
    expect(htmlToParagraphs('<p>ok</p><p>broken')).toContain('ok');
  });
});

describe('tokenize', () => {
  it('counts whitespace-separated words', () => {
    expect(tokenize('one two three')).toBe(3);
  });

  it('returns 0 for empty input', () => {
    expect(tokenize('')).toBe(0);
  });

  it('returns at least 1 for any whitespace-only candidate with text', () => {
    expect(tokenize('hello')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// i18n detection
// ---------------------------------------------------------------------------

describe('detectI18nMode / extractLocale / extractTranslations', () => {
  it('detects Polylang via post.lang', () => {
    expect(detectI18nMode(tinyPost({ lang: 'en' }))).toBe('polylang');
  });

  it('detects Polylang via post.translations map', () => {
    expect(detectI18nMode(tinyPost({ translations: { fr: 99 } }))).toBe('polylang');
  });

  it('detects WPML via wpml_current_locale', () => {
    expect(detectI18nMode(tinyPost({ wpml_current_locale: 'en' }))).toBe('wpml');
  });

  it('detects WPML via wpml_translations', () => {
    expect(detectI18nMode(tinyPost({ wpml_translations: { fr: { id: 99 } } }))).toBe(
      'wpml',
    );
  });

  it('returns "none" when no plugin markers present', () => {
    expect(detectI18nMode(tinyPost())).toBe('none');
    expect(detectI18nMode(undefined)).toBe('none');
  });

  it('extractLocale returns the Polylang locale code', () => {
    expect(extractLocale(tinyPost({ lang: 'fr' }), 'polylang')).toBe('fr');
  });

  it('extractLocale returns the WPML locale code', () => {
    expect(extractLocale(tinyPost({ wpml_current_locale: 'de' }), 'wpml')).toBe('de');
  });

  it('extractTranslations returns Polylang translation map', () => {
    expect(
      extractTranslations(tinyPost({ translations: { fr: 99, de: 100 } }), 'polylang'),
    ).toEqual({ fr: 99, de: 100 });
  });

  it('extractTranslations returns WPML translation map', () => {
    expect(
      extractTranslations(
        tinyPost({ wpml_translations: { fr: { id: 99 }, de: { id: 100 } } }),
        'wpml',
      ),
    ).toEqual({ fr: 99, de: 100 });
  });

  it('extractTranslations returns {} when mode is "none"', () => {
    expect(extractTranslations(tinyPost({ translations: { fr: 99 } }), 'none')).toEqual(
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// Mapper unit tests
// ---------------------------------------------------------------------------

describe('mapWordPressItem', () => {
  it('maps a post → leaf article envelope', () => {
    const node = mapWordPressItem(
      { kind: 'post', post: tinyPost() },
      baseConfig(),
      'none',
    );
    expect(node).not.toBeNull();
    const n = node as EmittedNode;
    expect(n.type).toBe('article');
    expect(n.id).toBe('wp/post/hello-world');
    expect(n.title).toBe('Hello, world');
    expect(n.summary).toBe('A friendly hello.');
    expect(Array.isArray(n.content)).toBe(true);
    expect((n.content as Array<{ type: string }>).every((b) => b.type === 'prose')).toBe(
      true,
    );
    const meta = (n as unknown as { metadata: Record<string, unknown> }).metadata;
    expect((meta['source'] as Record<string, unknown>)['adapter']).toBe('act-wordpress');
    expect(meta['modified_at']).toBe('2026-01-02T03:04:05Z');
  });

  it('maps a page → branch section envelope', () => {
    const node = mapWordPressItem(
      { kind: 'page', page: tinyPage() },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode;
    expect(n.type).toBe('section');
    expect(n.id).toBe('wp/page/about');
  });

  it('declares parent when page has parent != 0', () => {
    const node = mapWordPressItem(
      { kind: 'page', page: tinyPage({ parent: 50 }) },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode & { parent?: string };
    expect(n.parent).toBe('wp/page/50');
  });

  it('maps a category → branch section envelope', () => {
    const node = mapWordPressItem(
      { kind: 'category', term: tinyCategory() },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode;
    expect(n.type).toBe('section');
    expect(n.id).toBe('wp/category/news');
    expect(n.title).toBe('News');
    expect(n.summary).toBe('Announcements and updates.');
  });

  it('declares parent when category has non-zero parent', () => {
    const node = mapWordPressItem(
      { kind: 'category', term: tinyCategory({ parent: 1 }) },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode & { parent?: string };
    expect(n.parent).toBe('wp/category/1');
  });

  it('maps a tag → flat tag envelope', () => {
    const node = mapWordPressItem(
      { kind: 'tag', term: tinyTag() },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode;
    expect(n.type).toBe('tag');
    expect(n.id).toBe('wp/tag/typescript');
  });

  it('maps a user → profile envelope', () => {
    const node = mapWordPressItem(
      { kind: 'user', user: tinyUser() },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode;
    expect(n.type).toBe('profile');
    expect(n.id).toBe('wp/user/ada');
    expect(n.title).toBe('Ada Lovelace');
  });

  it('decodes HTML entities in titles', () => {
    const node = mapWordPressItem(
      {
        kind: 'post',
        post: tinyPost({ title: { rendered: 'A &amp; B &mdash; story' } }),
      },
      baseConfig(),
      'none',
    );
    expect((node as EmittedNode).title).toBe('A & B — story');
  });

  it('appends locale suffix to id when locale is detected', () => {
    const node = mapWordPressItem(
      { kind: 'post', post: tinyPost({ lang: 'fr' }) },
      baseConfig(),
      'polylang',
    );
    expect((node as EmittedNode).id).toBe('wp/post/hello-world@fr');
  });

  it('emits metadata.translations when Polylang map is present', () => {
    const node = mapWordPressItem(
      {
        kind: 'post',
        post: tinyPost({ lang: 'en', translations: { en: 1, fr: 2 } }),
      },
      baseConfig(),
      'polylang',
    );
    const meta = (node as unknown as { metadata: Record<string, unknown> }).metadata;
    expect(meta['locale']).toBe('en');
    expect(meta['translations']).toEqual([{ locale: 'fr', id: 'wp/post/2@fr' }]);
  });

  it('honors typeMap overrides', () => {
    const node = mapWordPressItem(
      { kind: 'post', post: tinyPost() },
      baseConfig({ typeMap: { post: 'blog-post' } }),
      'none',
    );
    expect((node as EmittedNode).type).toBe('blog-post');
  });

  it('honors namespace override', () => {
    const node = mapWordPressItem(
      { kind: 'post', post: tinyPost() },
      baseConfig({ namespace: 'blog' }),
      'none',
    );
    expect((node as EmittedNode).id).toBe('blog/post/hello-world');
  });

  it('returns null for a post missing title.rendered', () => {
    const bad = { kind: 'post', post: { id: 1, slug: 's' } as unknown as WordPressPost };
    expect(mapWordPressItem(bad as WordPressItem, baseConfig(), 'none')).toBeNull();
  });

  it('emits an extracted summary when no excerpt is provided', () => {
    const node = mapWordPressItem(
      {
        kind: 'post',
        post: tinyPost({ excerpt: { rendered: '' } }),
      },
      baseConfig(),
      'none',
    );
    const n = node as EmittedNode & { summary_source?: string };
    expect(n.summary_source).toBe('extracted');
    expect(n.summary).toContain('Hello, world');
  });
});

// ---------------------------------------------------------------------------
// End-to-end (corpus → runAdapter → validateNode)
// ---------------------------------------------------------------------------

describe('end-to-end through runAdapter', () => {
  it('runs the full lifecycle and emits validator-clean nodes', async () => {
    const adapter = createWordPressAdapter({ corpus: tinyCorpus() });
    const result = await runAdapter(adapter, baseConfig() as unknown as Record<string, unknown>, ctx());
    expect(result.adapter).toBe('act-wordpress');
    expect(result.nodes.length).toBeGreaterThanOrEqual(3);
    for (const node of result.nodes) {
      const stripped = stripPartial(node);
      const r = validateNode(stripped);
      // Surface the actual gap message if any so debugging the test failure is
      // straightforward; assert zero gaps.
      expect({ id: stripped['id'], gaps: r.gaps }).toEqual({
        id: stripped['id'],
        gaps: [],
      });
    }
  });

  it('respects include filters (only posts when others disabled)', async () => {
    const adapter = createWordPressAdapter({ corpus: tinyCorpus() });
    const result = await runAdapter(
      adapter,
      baseConfig({
        include: { posts: true, pages: false, categories: false },
      }) as unknown as Record<string, unknown>,
      ctx(),
    );
    const types = result.nodes.map((n) => (n as { type: string }).type);
    expect(types).toContain('article');
    expect(types).not.toContain('section');
  });

  it('auto-detects Polylang from corpus', async () => {
    const adapter = createWordPressAdapter({
      corpus: {
        posts: [tinyPost({ lang: 'fr', translations: { fr: 1, en: 99 } })],
      },
    });
    const result = await runAdapter(adapter, baseConfig() as unknown as Record<string, unknown>, ctx());
    const post = result.nodes.find((n) => (n as { type: string }).type === 'article');
    expect(post).toBeDefined();
    const meta = (post as unknown as { metadata: Record<string, unknown> }).metadata;
    expect(meta['locale']).toBe('fr');
  });

  it('honors explicit i18n.mode = none even when payload looks Polylang', async () => {
    const adapter = createWordPressAdapter({
      corpus: { posts: [tinyPost({ lang: 'fr', translations: { fr: 1, en: 2 } })] },
    });
    const result = await runAdapter(
      adapter,
      baseConfig({ i18n: { mode: 'none' } }) as unknown as Record<string, unknown>,
      ctx(),
    );
    const post = result.nodes.find((n) => (n as { type: string }).type === 'article');
    const meta = (post as unknown as { metadata: Record<string, unknown> }).metadata;
    expect(meta['locale']).toBeUndefined();
  });

  it('exposes httpProvider as a wireable surface (smoke)', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      // pages
      .mockResolvedValueOnce(jsonResponse([tinyPage()], { headers: { 'X-WP-TotalPages': '1' } }))
      // categories
      .mockResolvedValueOnce(jsonResponse([], { headers: { 'X-WP-TotalPages': '0' } }))
      // posts
      .mockResolvedValueOnce(jsonResponse([tinyPost()], { headers: { 'X-WP-TotalPages': '1' } }));
    const provider = httpProvider({
      baseUrl: 'https://wp.example',
      auth: { kind: 'none' },
      fetch: fetchMock,
    });
    const adapter = createWordPressAdapter({ provider });
    const result = await runAdapter(
      adapter,
      baseConfig({ include: { posts: true, pages: true, categories: true } }) as unknown as Record<string, unknown>,
      ctx(),
    );
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fails fast when init is called with a bad config', async () => {
    const adapter = createWordPressAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.init({} as Record<string, unknown>, ctx()),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('dispose is idempotent', async () => {
    const adapter = createWordPressAdapter({ corpus: tinyCorpus() });
    await adapter.init(baseConfig() as unknown as Record<string, unknown>, ctx());
    await adapter.dispose(ctx());
    await expect(adapter.dispose(ctx())).resolves.toBeUndefined();
  });
});

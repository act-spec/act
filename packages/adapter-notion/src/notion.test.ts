/**
 * Tests for the Notion adapter. Covers:
 *   - database -> branch envelope mapping
 *   - page -> leaf envelope mapping
 *   - block-tree -> prose conversion (per supported block type)
 *   - locale property extraction (select / multi_select / rich_text)
 *   - integration-token Bearer / Notion-Version header on the HTTP path
 *   - error paths (auth_failed, database_not_found, config_invalid)
 *
 * Plus a positive integration scenario that runs the full adapter through
 * `runAdapter` against a recorded corpus and validates each emitted node
 * via `@act-spec/validator`.
 */
import { describe, expect, it, vi } from 'vitest';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext } from '@act-spec/adapter-framework';
import { validateNode } from '@act-spec/validator';

import {
  NOTION_ADAPTER_NAME,
  NOTION_API_BASE_URL,
  NOTION_API_VERSION,
  NotionAdapterError,
  blocksToContent,
  corpusProvider,
  extractLocale,
  httpProvider,
  notionAdapter,
} from './index.js';
import type {
  NotionBlock,
  NotionDatabase,
  NotionPage,
  NotionSourceCorpus,
} from './index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    config: {},
    targetLevel: 'standard',
    actVersion: '0.1',
    logger: makeLogger(),
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

function tinyDatabase(over: Partial<NotionDatabase> = {}): NotionDatabase {
  return {
    object: 'database',
    id: 'db-fixture-0001',
    title: [{ type: 'text', plain_text: 'Sample DB' }],
    description: [{ type: 'text', plain_text: 'Test fixture database' }],
    last_edited_time: '2026-04-01T00:00:00.000Z',
    url: 'https://www.notion.so/db-fixture-0001',
    ...over,
  };
}

function tinyPage(over: Partial<NotionPage> = {}): NotionPage {
  return {
    object: 'page',
    id: 'page-fixture-001',
    last_edited_time: '2026-04-02T00:00:00.000Z',
    parent: { type: 'database_id', database_id: 'db-fixture-0001' },
    url: 'https://www.notion.so/page-fixture-001',
    properties: {
      Name: {
        type: 'title',
        title: [{ type: 'text', plain_text: 'Hello world' }],
      },
    },
    ...over,
  };
}

function tinyCorpus(over: Partial<NotionSourceCorpus> = {}): NotionSourceCorpus {
  const page = over.pages?.[0] ?? tinyPage();
  return {
    database: over.database ?? tinyDatabase(),
    pages: over.pages ?? [page],
    pageBlocks: over.pageBlocks ?? {
      [page.id]: [
        { object: 'block', id: 'b1', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'A short paragraph.' }] } },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// blocksToContent — block-type coverage
// ---------------------------------------------------------------------------

describe('blocksToContent', () => {
  it('maps paragraph -> prose:plain', () => {
    const out = blocksToContent([
      { object: 'block', id: 'b1', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'Hello.' }] } },
    ]);
    expect(out.blocks).toEqual([{ type: 'prose', format: 'plain', text: 'Hello.' }]);
    expect(out.unmapped).toEqual([]);
  });

  it.each([
    ['heading_1', 1],
    ['heading_2', 2],
    ['heading_3', 3],
  ])('maps %s -> prose:plain with level=%i', (notionType, level) => {
    const block: NotionBlock = {
      object: 'block',
      id: 'h1',
      type: notionType,
      [notionType]: { rich_text: [{ type: 'text', plain_text: 'Title' }] },
    } as NotionBlock;
    const out = blocksToContent([block]);
    expect(out.blocks).toEqual([{ type: 'prose', format: 'plain', text: 'Title', level }]);
  });

  it('groups consecutive bulleted_list_items into one prose:markdown block', () => {
    const out = blocksToContent([
      { object: 'block', id: 'l1', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'one' }] } },
      { object: 'block', id: 'l2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'two' }] } },
    ]);
    expect(out.blocks).toEqual([{ type: 'prose', format: 'markdown', text: '- one\n- two' }]);
  });

  it('groups numbered_list_items with `1.` marker', () => {
    const out = blocksToContent([
      { object: 'block', id: 'n1', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', plain_text: 'first' }] } },
      { object: 'block', id: 'n2', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', plain_text: 'second' }] } },
    ]);
    expect(out.blocks).toEqual([{ type: 'prose', format: 'markdown', text: '1. first\n1. second' }]);
  });

  it('flushes a list run when interrupted by a paragraph', () => {
    const out = blocksToContent([
      { object: 'block', id: 'l1', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'a' }] } },
      { object: 'block', id: 'p1', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'mid.' }] } },
      { object: 'block', id: 'l2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'b' }] } },
    ]);
    expect(out.blocks).toEqual([
      { type: 'prose', format: 'markdown', text: '- a' },
      { type: 'prose', format: 'plain', text: 'mid.' },
      { type: 'prose', format: 'markdown', text: '- b' },
    ]);
  });

  it('maps code -> code block with language', () => {
    const out = blocksToContent([
      { object: 'block', id: 'c1', type: 'code', code: { rich_text: [{ type: 'text', plain_text: 'console.log(1)' }], language: 'javascript' } },
    ]);
    expect(out.blocks).toEqual([{ type: 'code', language: 'javascript', text: 'console.log(1)' }]);
  });

  it('maps quote -> callout:quote', () => {
    const out = blocksToContent([
      { object: 'block', id: 'q1', type: 'quote', quote: { rich_text: [{ type: 'text', plain_text: 'wisdom' }] } },
    ]);
    expect(out.blocks).toEqual([{ type: 'callout', variant: 'quote', text: 'wisdom' }]);
  });

  it('maps divider -> data:divider', () => {
    const out = blocksToContent([{ object: 'block', id: 'd1', type: 'divider', divider: {} }]);
    expect(out.blocks).toEqual([{ type: 'data', shape: 'divider' }]);
  });

  it('degrades unknown block types to type:text with notion_type recorded', () => {
    const out = blocksToContent([
      {
        object: 'block',
        id: 'u1',
        type: 'embed',
        // Notion's embed block has its own field the adapter does not understand;
        // we still recover any plain text we can and record the original type.
        paragraph: { rich_text: [{ type: 'text', plain_text: 'fallback text' }] },
      } as NotionBlock,
    ]);
    expect(out.blocks).toEqual([{ type: 'text', notion_type: 'embed', text: 'fallback text' }]);
    expect(out.unmapped).toEqual(['embed']);
  });

  it('recurses into nested children flattening into the same block list', () => {
    const out = blocksToContent([
      {
        object: 'block',
        id: 'p1',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', plain_text: 'parent' }] },
        has_children: true,
        children: [
          { object: 'block', id: 'p2', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'child' }] } },
        ],
      },
    ]);
    expect(out.blocks).toEqual([
      { type: 'prose', format: 'plain', text: 'parent' },
      { type: 'prose', format: 'plain', text: 'child' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// extractLocale
// ---------------------------------------------------------------------------

describe('extractLocale', () => {
  it('reads a Notion `select` property by default property name `Locale`', () => {
    const page = tinyPage({
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'X' }] },
        Locale: { type: 'select', select: { name: 'en-US' } },
      },
    });
    expect(extractLocale(page)).toBe('en-US');
  });

  it('reads `multi_select` first entry', () => {
    const page = tinyPage({
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'X' }] },
        Locale: { type: 'multi_select', multi_select: [{ name: 'es-ES' }, { name: 'en-US' }] },
      },
    });
    expect(extractLocale(page)).toBe('es-ES');
  });

  it('reads `rich_text` joining plain_text', () => {
    const page = tinyPage({
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'X' }] },
        Lang: { type: 'rich_text', rich_text: [{ type: 'text', plain_text: 'de-' }, { type: 'text', plain_text: 'DE' }] },
      },
    });
    expect(extractLocale(page, { property: 'Lang' })).toBe('de-DE');
  });

  it('falls back to default when property is absent', () => {
    const page = tinyPage();
    expect(extractLocale(page, { default: 'en' })).toBe('en');
  });

  it('returns null when neither property nor default is available', () => {
    const page = tinyPage();
    expect(extractLocale(page)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// adapter lifecycle (corpus-backed) — database -> branch, page -> leaf
// ---------------------------------------------------------------------------

describe('notionAdapter (corpus-backed)', () => {
  it('emits one branch + one leaf for a database with one page', async () => {
    const corpus = tinyCorpus();
    const adapter = notionAdapter({ corpus });
    const c = ctx({ config: { accessToken: 'fixture-tok', databaseId: corpus.database.id } });
    const result = await runAdapter(adapter, c.config, c);
    expect(result.adapter).toBe(NOTION_ADAPTER_NAME);
    expect(result.nodes).toHaveLength(2);

    const branch = result.nodes[0]!;
    expect(branch.id).toBe(`cms/${corpus.database.id}`);
    expect(branch.type).toBe('collection');
    expect(branch.title).toBe('Sample DB');
    expect(branch.children).toEqual([`cms/${corpus.pages[0]!.id}`]);

    const leaf = result.nodes[1]!;
    expect(leaf.id).toBe(`cms/${corpus.pages[0]!.id}`);
    expect(leaf.type).toBe('article');
    expect(leaf.title).toBe('Hello world');
    expect(leaf.parent).toBe(branch.id);
    expect(leaf.content).toEqual([{ type: 'prose', format: 'plain', text: 'A short paragraph.' }]);
  });

  it('stamps locale into metadata.locale and the leaf id when locale is present', async () => {
    const page = tinyPage({
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'Hola mundo' }] },
        Locale: { type: 'select', select: { name: 'es-ES' } },
      },
    });
    const corpus = tinyCorpus({ pages: [page], pageBlocks: { [page.id]: [] } });
    const adapter = notionAdapter({ corpus });
    const c = ctx({ config: { accessToken: 'tok', databaseId: corpus.database.id } });
    const result = await runAdapter(adapter, c.config, c);
    const leaf = result.nodes[1]!;
    expect(leaf.id).toBe(`cms/es-es/${page.id}`);
    expect((leaf.metadata as Record<string, unknown>)['locale']).toBe('es-ES');
  });

  it('emits a partial node when no title property is present', async () => {
    const page: NotionPage = {
      object: 'page',
      id: 'no-title-page',
      properties: {
        Description: { type: 'rich_text', rich_text: [{ type: 'text', plain_text: 'just a body' }] },
      },
    };
    const corpus = tinyCorpus({ pages: [page], pageBlocks: { [page.id]: [] } });
    const adapter = notionAdapter({ corpus });
    const logger = makeLogger();
    const c = ctx({ config: { accessToken: 'tok', databaseId: corpus.database.id }, logger });
    const result = await runAdapter(adapter, c.config, c);
    const leaf = result.nodes[1]!;
    expect(leaf.title).toContain('Untitled');
    const meta = leaf.metadata as Record<string, unknown>;
    expect(meta['extraction_status']).toBe('partial');
    expect(meta['extraction_error']).toContain('no title property');
  });

  it('warns and falls back when block tree contains unmapped block types', async () => {
    const page = tinyPage({ id: 'unmapped-page' });
    const corpus = tinyCorpus({
      pages: [page],
      pageBlocks: {
        [page.id]: [
          { object: 'block', id: 'unk', type: 'embed', paragraph: { rich_text: [{ type: 'text', plain_text: 'extra' }] } } as NotionBlock,
        ],
      },
    });
    const adapter = notionAdapter({ corpus });
    const logger = makeLogger();
    const c = ctx({ config: { accessToken: 'tok', databaseId: corpus.database.id }, logger });
    await runAdapter(adapter, c.config, c);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unmapped block'));
  });

  it('reads tags from a multi_select property when configured', async () => {
    const page = tinyPage({
      properties: {
        Name: { type: 'title', title: [{ type: 'text', plain_text: 'Tagged' }] },
        Tags: { type: 'multi_select', multi_select: [{ name: 'alpha' }, { name: 'beta' }] },
      },
    });
    const corpus = tinyCorpus({ pages: [page], pageBlocks: { [page.id]: [] } });
    const adapter = notionAdapter({ corpus });
    const c = ctx({
      config: {
        accessToken: 'tok',
        databaseId: corpus.database.id,
        properties: { tags: 'Tags' },
      },
    });
    const result = await runAdapter(adapter, c.config, c);
    const leaf = result.nodes[1]!;
    expect(leaf.tags).toEqual(['alpha', 'beta']);
  });

  it('stamps metadata.source.adapter and metadata.source.human_url from page.url', async () => {
    const corpus = tinyCorpus();
    const adapter = notionAdapter({ corpus });
    const c = ctx({ config: { accessToken: 'tok', databaseId: corpus.database.id } });
    const result = await runAdapter(adapter, c.config, c);
    const leaf = result.nodes[1]!;
    const source = (leaf.metadata as Record<string, unknown>)['source'] as Record<string, unknown>;
    expect(source['adapter']).toBe(NOTION_ADAPTER_NAME);
    expect(source['human_url']).toBe(corpus.pages[0]!.url);
  });
});

// ---------------------------------------------------------------------------
// Conformance: every emitted node must validate cleanly
// ---------------------------------------------------------------------------

describe('notionAdapter conformance', () => {
  it('emits envelopes that pass validateNode with zero gaps', async () => {
    const page1 = tinyPage({ id: 'page-aaa', properties: { Name: { type: 'title', title: [{ type: 'text', plain_text: 'First' }] } } });
    const page2 = tinyPage({ id: 'page-bbb', properties: { Name: { type: 'title', title: [{ type: 'text', plain_text: 'Second' }] } } });
    const corpus: NotionSourceCorpus = {
      database: tinyDatabase(),
      pages: [page1, page2],
      pageBlocks: {
        [page1.id]: [
          { object: 'block', id: 'h', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', plain_text: 'Section' }] } },
          { object: 'block', id: 'p', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'Body.' }] } },
        ],
        [page2.id]: [
          { object: 'block', id: 'c', type: 'code', code: { rich_text: [{ type: 'text', plain_text: 'x = 1' }], language: 'python' } },
        ],
      },
    };
    const adapter = notionAdapter({ corpus });
    const c = ctx({ config: { accessToken: 'tok', databaseId: corpus.database.id } });
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes).toHaveLength(3);
    for (const n of result.nodes) {
      const probe = validateNode(stripPartial(n));
      expect(probe.gaps, `node ${n.id} gaps: ${JSON.stringify(probe.gaps)}`).toEqual([]);
    }
  });
});

function stripPartial(node: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP provider — Bearer + Notion-Version headers; pagination; error paths
// ---------------------------------------------------------------------------

describe('httpProvider', () => {
  function recordingFetch(scripted: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: init?.headers ?? {},
        ...(init?.body !== undefined ? { body: init.body } : {}),
      });
      const next = scripted[i++] ?? scripted[scripted.length - 1]!;
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: () => Promise.resolve(next.body),
        text: () => Promise.resolve(JSON.stringify(next.body)),
      };
    });
    return { calls, fetchImpl };
  }

  it('sends Bearer auth + Notion-Version on every request', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { status: 200, body: { object: 'database', id: 'db-1' } },
    ]);
    const provider = httpProvider({ token: 'secret-tok', fetch: fetchImpl });
    await provider.retrieveDatabase('db-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['Authorization']).toBe('Bearer secret-tok');
    expect(calls[0]!.headers['Notion-Version']).toBe(NOTION_API_VERSION);
    expect(calls[0]!.url).toBe(`${NOTION_API_BASE_URL}/v1/databases/db-1`);
  });

  it('paginates databases.query via has_more / next_cursor', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { status: 200, body: { results: [{ object: 'page', id: 'p1', properties: {} }], has_more: true, next_cursor: 'cursor-2' } },
      { status: 200, body: { results: [{ object: 'page', id: 'p2', properties: {} }], has_more: false, next_cursor: null } },
    ]);
    const provider = httpProvider({ token: 'tok', fetch: fetchImpl });
    const out: string[] = [];
    for await (const p of provider.queryDatabasePages('db-1')) out.push(p.id);
    expect(out).toEqual(['p1', 'p2']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toBe(JSON.stringify({ page_size: 100 }));
    expect(calls[1]!.body).toBe(JSON.stringify({ page_size: 100, start_cursor: 'cursor-2' }));
  });

  it('throws auth_failed on HTTP 401', async () => {
    const { fetchImpl } = recordingFetch([{ status: 401, body: { message: 'Invalid token' } }]);
    const provider = httpProvider({ token: 'bad', fetch: fetchImpl });
    await expect(provider.retrieveDatabase('db-1')).rejects.toMatchObject({
      name: 'NotionAdapterError',
      code: 'auth_failed',
    });
  });

  it('probeAuth maps HTTP 401 -> "unauthorized" and 404 -> "database_not_found"', async () => {
    const { fetchImpl: f401 } = recordingFetch([{ status: 401, body: {} }]);
    const p401 = httpProvider({ token: 'bad', fetch: f401 });
    expect(await p401.probeAuth('db-x')).toBe('unauthorized');

    const { fetchImpl: f404 } = recordingFetch([{ status: 404, body: {} }]);
    const p404 = httpProvider({ token: 'tok', fetch: f404 });
    expect(await p404.probeAuth('db-x')).toBe('database_not_found');
  });

  it('throws rate_limit_exhausted on HTTP 429', async () => {
    const { fetchImpl } = recordingFetch([{ status: 429, body: {} }]);
    const provider = httpProvider({ token: 'tok', fetch: fetchImpl });
    await expect(provider.retrieveDatabase('db-1')).rejects.toMatchObject({
      code: 'rate_limit_exhausted',
    });
  });

  it('honours custom apiBaseUrl and notionApiVersion', async () => {
    const { calls, fetchImpl } = recordingFetch([{ status: 200, body: { object: 'database', id: 'db-1' } }]);
    const provider = httpProvider({
      token: 'tok',
      baseUrl: 'https://notion.example.com',
      notionApiVersion: '2025-01-01',
      fetch: fetchImpl,
    });
    await provider.retrieveDatabase('db-1');
    expect(calls[0]!.url).toBe('https://notion.example.com/v1/databases/db-1');
    expect(calls[0]!.headers['Notion-Version']).toBe('2025-01-01');
  });

  it('walks nested block children recursively', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { status: 200, body: { results: [{ object: 'block', id: 'b1', type: 'paragraph', has_children: true }], has_more: false, next_cursor: null } },
      { status: 200, body: { results: [{ object: 'block', id: 'b1c1', type: 'paragraph' }], has_more: false, next_cursor: null } },
    ]);
    const provider = httpProvider({ token: 'tok', fetch: fetchImpl });
    const blocks = await provider.listPageBlocks('page-1');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.children).toHaveLength(1);
    expect(blocks[0]!.children![0]!.id).toBe('b1c1');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/v1/blocks/page-1/children');
    expect(calls[1]!.url).toContain('/v1/blocks/b1/children');
  });
});

// ---------------------------------------------------------------------------
// Adapter init() error paths
// ---------------------------------------------------------------------------

describe('notionAdapter init error paths', () => {
  it('throws config_invalid when accessToken is missing', () => {
    const adapter = notionAdapter({ corpus: tinyCorpus() });
    expect(() => adapter.precheck!({ databaseId: 'db-fixture-0001' })).toThrow(
      /accessToken/,
    );
  });

  it('throws config_invalid when databaseId is missing', () => {
    const adapter = notionAdapter({ corpus: tinyCorpus() });
    expect(() => adapter.precheck!({ accessToken: 'tok' })).toThrow(/databaseId/);
  });

  it('throws config_invalid for malformed properties / locale / idStrategy / concurrency', () => {
    const adapter = notionAdapter({ corpus: tinyCorpus() });
    expect(() =>
      adapter.precheck!({ accessToken: 'tok', databaseId: 'd', properties: 'bad' as unknown as object }),
    ).toThrow(/properties/);
    expect(() =>
      adapter.precheck!({ accessToken: 'tok', databaseId: 'd', locale: 'bad' as unknown as object }),
    ).toThrow(/locale/);
    expect(() =>
      adapter.precheck!({ accessToken: 'tok', databaseId: 'd', idStrategy: 'bad' as unknown as object }),
    ).toThrow(/idStrategy/);
    expect(() =>
      adapter.precheck!({ accessToken: 'tok', databaseId: 'd', concurrency: 'bad' as unknown as object }),
    ).toThrow(/concurrency/);
  });

  it('throws auth_failed when the corpus provider rejects the token (probe -> unauthorized)', async () => {
    const corpus = tinyCorpus();
    const provider = corpusProvider(corpus);
    // Force probe to return 'unauthorized' to exercise the init-time path.
    const adapter = notionAdapter({
      provider: {
        ...provider,
        probeAuth: () => Promise.resolve('unauthorized' as const),
      },
    });
    const c = ctx({ config: { accessToken: 'tok', databaseId: corpus.database.id } });
    await expect(runAdapter(adapter, c.config, c)).rejects.toMatchObject({
      code: 'auth_failed',
    });
  });

  it('throws database_not_found when the probe returns "database_not_found"', async () => {
    const corpus = tinyCorpus();
    const adapter = notionAdapter({ corpus });
    const c = ctx({ config: { accessToken: 'tok', databaseId: 'no-such-db' } });
    await expect(runAdapter(adapter, c.config, c)).rejects.toMatchObject({
      code: 'database_not_found',
    });
  });

  it('errors when env-var-referenced accessToken is unset and no provider is supplied', async () => {
    delete process.env['__ACT_NOTION_TEST_TOKEN__'];
    const adapter = notionAdapter(); // no provider, no corpus
    const c = ctx({
      config: {
        accessToken: { from_env: '__ACT_NOTION_TEST_TOKEN__' },
        databaseId: 'db-x',
      },
    });
    await expect(runAdapter(adapter, c.config, c)).rejects.toMatchObject({
      code: 'config_invalid',
    });
  });
});

// ---------------------------------------------------------------------------
// NotionAdapterError shape
// ---------------------------------------------------------------------------

describe('NotionAdapterError', () => {
  it('carries the closed-enum code on the instance', () => {
    const err = new NotionAdapterError({ code: 'auth_failed', message: 'bad' });
    expect(err.code).toBe('auth_failed');
    expect(err.name).toBe('NotionAdapterError');
    expect(err.message).toBe('bad');
  });
});

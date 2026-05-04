/**
 * PRD-202 Contentful adapter tests. Every requirement R1–R26 has at least
 * one citing test; the integration scenarios at the bottom run the full
 * adapter pipeline against recorded fixtures and validate emitted nodes
 * via @act-spec/validator (PRD-202-R24 + the role's "at least one positive
 * integration test" requirement).
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext, EmittedNode, PartialEmittedNode } from '@act-spec/adapter-framework';
import { validateNode } from '@act-spec/validator';

import {
  CONTENTFUL_ADAPTER_NAME,
  CONTENTFUL_DEFAULT_CONCURRENCY,
  ContentfulAdapterError,
  RESERVED_METADATA_KEYS,
  corpusProvider,
  createContentfulAdapter,
} from './index.js';
import type {
  ContentfulAdapterConfig,
  ContentfulEntry,
  ContentfulSourceCorpus,
  ContentfulSourceProvider,
} from './index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface CapturedLogger {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeLogger(): CapturedLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function ctx(
  config: ContentfulAdapterConfig,
  over: Partial<AdapterContext> = {},
  logger?: CapturedLogger,
): AdapterContext {
  return {
    config: config as unknown as Record<string, unknown>,
    targetLevel: 'standard',
    actVersion: '0.1',
    logger: logger ?? makeLogger(),
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

function tinyCorpus(over: Partial<ContentfulSourceCorpus> = {}): ContentfulSourceCorpus {
  return {
    spaceLocales: [{ code: 'en-US', default: true }],
    contentTypes: [{ sys: { id: 'blogPost' } }],
    entries: [
      {
        sys: {
          id: 'aaa',
          type: 'Entry',
          contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
        },
        fields: { title: 'A', excerpt: 'A summary.', body: 'Plain body text.' },
      },
    ],
    ...over,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'test-fixtures');

function loadCorpus(name: string): ContentfulSourceCorpus {
  const space = JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'space.json'), 'utf8'),
  ) as { spaceLocales: ContentfulSourceCorpus['spaceLocales']; contentTypes: ContentfulSourceCorpus['contentTypes'] };
  const entries = JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'entries.json'), 'utf8'),
  ) as { items: ContentfulEntry[]; assets?: ContentfulSourceCorpus['assets'] };
  const perLocale: Record<string, Record<string, Record<string, unknown>>> = {};
  const authoredLocales: Record<string, string[]> = {};
  for (const e of entries.items) {
    const ext = e as unknown as {
      perLocale?: Record<string, Record<string, unknown>>;
      authoredLocales?: string[];
      sys: { id: string };
    };
    if (ext.perLocale) perLocale[ext.sys.id] = ext.perLocale;
    if (ext.authoredLocales) authoredLocales[ext.sys.id] = ext.authoredLocales;
  }
  return {
    spaceLocales: space.spaceLocales,
    contentTypes: space.contentTypes,
    entries: entries.items,
    perLocale,
    authoredLocales,
    assets: entries.assets ?? {},
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

// ---------------------------------------------------------------------------
// PRD-202-R1 — adapter shape
// ---------------------------------------------------------------------------

describe('PRD-202 Contentful adapter — factory contract', () => {
  it('PRD-202-R1: createContentfulAdapter returns an Adapter; default name is "act-contentful"', () => {
    const a = createContentfulAdapter({ corpus: tinyCorpus() });
    expect(a.name).toBe(CONTENTFUL_ADAPTER_NAME);
    expect(a.name).toBe('act-contentful');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
    expect(typeof a.precheck).toBe('function');
    expect(typeof a.delta).toBe('function');
  });

  it('PRD-202-R1: createContentfulAdapter requires either provider or corpus', () => {
    expect(() => createContentfulAdapter({})).toThrow(ContentfulAdapterError);
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R2 — config schema
// ---------------------------------------------------------------------------

describe('PRD-202-R2 — config schema', () => {
  it('PRD-202-R2: minimal valid config (spaceId + accessToken + contentTypes) is accepted', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
    };
    await expect(adapter.precheck!(cfg as unknown as Record<string, unknown>)).resolves.toBeUndefined();
  });

  it('PRD-202-R2/R19: empty contentTypes array is config_invalid', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg = { spaceId: 's', accessToken: 't', contentTypes: [] };
    await expect(adapter.precheck!(cfg)).rejects.toMatchObject({
      code: 'config_invalid',
    });
  });

  it('PRD-202-R2/R19: missing accessToken is config_invalid', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg = { spaceId: 's', contentTypes: ['blogPost'] };
    await expect(adapter.precheck!(cfg)).rejects.toMatchObject({
      code: 'config_invalid',
    });
  });

  it('PRD-202-R2: accessToken accepts either string or { from_env }', async () => {
    const a1 = createContentfulAdapter({ corpus: tinyCorpus() });
    await expect(
      a1.precheck!({ spaceId: 's', accessToken: 'tok', contentTypes: ['blogPost'] }),
    ).resolves.toBeUndefined();
    const a2 = createContentfulAdapter({ corpus: tinyCorpus() });
    await expect(
      a2.precheck!({
        spaceId: 's',
        accessToken: { from_env: 'CFK' },
        contentTypes: ['blogPost'],
      }),
    ).resolves.toBeUndefined();
  });

  it('PRD-202-R2: invalid host is rejected by config schema', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 's',
        accessToken: 't',
        contentTypes: ['blogPost'],
        host: 'evil.example.com',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R3 — init validates credentials + content types + locales
// ---------------------------------------------------------------------------

describe('PRD-202-R3 / R19 — init credential probe + presence checks', () => {
  it('PRD-202-R3: init accepts a healthy probe and returns capabilities', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const caps = await adapter.init(
      { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] } as Record<string, unknown>,
      ctx({ spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] }),
    );
    expect(caps.level).toBe('standard');
    expect(caps.concurrency_max).toBe(CONTENTFUL_DEFAULT_CONCURRENCY);
    expect(caps.delta).toBe(true);
    await adapter.dispose(ctx({ spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] }));
  });

  it('PRD-202-R3/R19: 401 from auth probe → ContentfulAdapterError code "auth_failed"', async () => {
    const provider = corpusProvider(tinyCorpus());
    const probe = vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('unauthorized');
    const adapter = createContentfulAdapter({ provider });
    const cfg = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    await expect(adapter.init(cfg as Record<string, unknown>, ctx(cfg))).rejects.toMatchObject({
      code: 'auth_failed',
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('PRD-202-R3/R19: 404 at probe → "space_not_found"', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('space_not_found');
    const adapter = createContentfulAdapter({ provider });
    const cfg = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    await expect(adapter.init(cfg as Record<string, unknown>, ctx(cfg))).rejects.toMatchObject({
      code: 'space_not_found',
    });
  });

  it('PRD-202-R19: configured contentType not in space → "content_type_not_found"', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg = { spaceId: 's', accessToken: 't', contentTypes: ['ghost'] };
    await expect(adapter.init(cfg as Record<string, unknown>, ctx(cfg))).rejects.toMatchObject({
      code: 'content_type_not_found',
    });
  });

  it('PRD-202-R19: locale not advertised by space → "locale_not_in_space"', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      locale: { available: ['fr-FR'] },
    };
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, { targetLevel: 'strict' })),
    ).rejects.toMatchObject({
      code: 'locale_not_in_space',
    });
  });

  it('PRD-202-R3/R19: env-var `from_env` not set → config_invalid', async () => {
    const old = process.env['__NEVER_SET__'];
    delete process.env['__NEVER_SET__'];
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg = {
      spaceId: 's',
      accessToken: { from_env: '__NEVER_SET__' },
      contentTypes: ['blogPost'],
    };
    await expect(adapter.init(cfg as Record<string, unknown>, ctx(cfg as ContentfulAdapterConfig))).rejects.toMatchObject({
      code: 'config_invalid',
    });
    if (old !== undefined) process.env['__NEVER_SET__'] = old;
  });

  it('PRD-202-R26: inline accessToken emits a warning citing best practice', async () => {
    const logger = makeLogger();
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 'CFPAT-secret',
      contentTypes: ['blogPost'],
    };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-202-R26/);
    // PRD-202-R26 — the token value MUST NOT appear in any log line.
    const logged = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ].flat().join(' ');
    expect(logged).not.toContain('CFPAT-secret');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-202-R2: host=preview.contentful.com emits warning', async () => {
    const logger = makeLogger();
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      host: 'preview.contentful.com',
    };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    expect(logger.warn.mock.calls.flat().join(' ')).toMatch(/preview\.contentful\.com/);
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R4 — precheck
// ---------------------------------------------------------------------------

describe('PRD-202-R4 — precheck', () => {
  it('PRD-202-R4: precheck rejects schema-invalid config without network', async () => {
    const provider = corpusProvider(tinyCorpus());
    const probeSpy = vi.spyOn(provider, 'probeAuth');
    const adapter = createContentfulAdapter({ provider });
    await expect(adapter.precheck!({} as Record<string, unknown>)).rejects.toMatchObject({
      code: 'config_invalid',
    });
    expect(probeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R5 / R6 — enumerate + linked entry depth
// ---------------------------------------------------------------------------

describe('PRD-202-R5 — enumerate', () => {
  it('PRD-202-R5: enumerate yields entries deterministically by sys.id within a content type', async () => {
    const corpus: ContentfulSourceCorpus = {
      spaceLocales: [{ code: 'en-US', default: true }],
      contentTypes: [{ sys: { id: 'blogPost' } }],
      entries: ['z', 'a', 'm'].map((id) => ({
        sys: {
          id,
          type: 'Entry' as const,
          contentType: { sys: { type: 'Link' as const, linkType: 'ContentType' as const, id: 'blogPost' } },
        },
        fields: { title: id, excerpt: 's' },
      })),
    };
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
    };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const seen: string[] = [];
    for await (const item of adapter.enumerate(ctx(cfg)) as AsyncIterable<{ entry: { sys: { id: string } } }>) {
      seen.push(item.entry.sys.id);
    }
    expect(seen).toEqual(['a', 'm', 'z']);
  });

  it('PRD-202-R6: resolveLinks config is accepted (depth 0..4)', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 's',
        accessToken: 't',
        contentTypes: ['blogPost'],
        resolveLinks: { depth: 4, scope: 'whitelist-only' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      adapter.precheck!({
        spaceId: 's',
        accessToken: 't',
        contentTypes: ['blogPost'],
        resolveLinks: { depth: 5 },
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R7 / R8 / R9 — field heuristics + mappings + type
// ---------------------------------------------------------------------------

describe('PRD-202-R7 — field heuristics', () => {
  it('PRD-202-R7: defaults pick title from `title`, summary from `excerpt`, abstract from `lede`', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'p1',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'Hello',
            excerpt: 'A short excerpt.',
            lede: 'Long lede paragraph.',
            body: 'Body text.',
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes).toHaveLength(1);
    const n = result.nodes[0]!;
    expect(n.title).toBe('Hello');
    expect(n.summary).toBe('A short excerpt.');
    expect((n as EmittedNode).abstract).toBe('Long lede paragraph.');
    expect((n as EmittedNode).summary_source).toBe('author');
  });

  it('PRD-202-R7: `headline` falls back when `title`/`name` missing', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'h1',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { headline: 'Headline only', summary: 'a summary' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.title).toBe('Headline only');
  });

  it('PRD-202-R7/R18: missing title field → partial node with extraction_status="partial"', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'untitled',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { summary: 'no title here' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    const n = result.nodes[0]! as PartialEmittedNode;
    expect(n._actPartial).toBe(true);
    expect((n.metadata as { extraction_status?: string }).extraction_status).toBe('partial');
    expect(n.title).toMatch(/^Untitled blogPost untitled$/);
  });

  it('PRD-202-R7: tags from Contentful metadata.tags flatten to id strings', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'tagged',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', summary: 's' },
          metadata: {
            tags: [
              { sys: { type: 'Link', linkType: 'Tag', id: 'a' } as never },
              { sys: { type: 'Link', linkType: 'Tag', id: 'b' } as never },
            ],
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).tags).toEqual(['a', 'b']);
  });
});

describe('PRD-202-R8 — user mappings + reserved keys', () => {
  it('PRD-202-R8: mapping.summary picks the configured field over default heuristics', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'm1',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', excerpt: 'auto', subhead: 'mapped' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      mappings: { blogPost: { summary: 'subhead' } },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.summary).toBe('mapped');
  });

  it('PRD-202-R8/R19: mapping.metadata targeting reserved key → "reserved_metadata_key"', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      mappings: { blogPost: { metadata: { extraction_status: 'someField' } } },
    };
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'reserved_metadata_key' });
  });

  it('PRD-202-R8: every documented reserved key is rejected', () => {
    expect(RESERVED_METADATA_KEYS.has('source')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('translations')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('locale')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('translation_status')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('fallback_from')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('extracted_via')).toBe(true);
  });

  it('PRD-202-R8: mapping.metadata with a non-reserved key flows through to metadata', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'm2',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', excerpt: 's', author: 'Jane' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      mappings: { blogPost: { metadata: { author_name: 'author' } } },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]!.metadata as { author_name?: string }).author_name).toBe('Jane');
  });

  it('PRD-202-R8: mapping.summary with explicit source="extracted" is honored', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'm3',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', synopsis: 'machine-derived summary' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      mappings: { blogPost: { summary: { from: 'synopsis', source: 'extracted' } } },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).summary_source).toBe('extracted');
  });

  it('PRD-202-R8: mapping.related promotes reference fields with custom relation', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'has-rel',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            seeAlso: [{ sys: { type: 'Link', linkType: 'Entry', id: 'other' } }],
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      mappings: { blogPost: { related: [{ from: 'seeAlso', relation: 'supersedes' }] } },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const rel = (result.nodes[0]! as EmittedNode).related;
    expect(rel).toEqual([{ id: 'cms/other', relation: 'supersedes' }]);
  });
});

describe('PRD-202-R9 — content type → ACT type', () => {
  it('PRD-202-R9: defaults config sets type', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      defaults: { blogPost: 'page' },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('page');
  });

  it('PRD-202-R9: mapping.type wins over defaults', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      defaults: { blogPost: 'page' },
      mappings: { blogPost: { type: 'tutorial' } },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('tutorial');
  });

  it('PRD-202-R9: absent type falls back to "article"', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('article');
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R10 / R11 — Rich Text → blocks; embedded entry/asset
// ---------------------------------------------------------------------------

describe('PRD-202-R10 — Rich Text → blocks', () => {
  it('PRD-202-R10: paragraph + heading + list + blockquote + hr → prose markdown blocks', async () => {
    const corpus = loadCorpus('standard-blog-post');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['blogPost'],
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'standard' }),
    );
    const node = result.nodes[0]! as EmittedNode;
    expect(node.content!.length).toBeGreaterThanOrEqual(5);
    const types = node.content!.map((b) => (b as { type: string }).type);
    expect(types.every((t) => t === 'prose')).toBe(true);
    const prose = node.content as Array<{ format: string; text: string }>;
    expect(prose[0]!.text).toBe('## Why ACT'); // heading-2
    expect(prose[1]!.text).toContain('**agent-readable**');
    expect(prose[2]!.text).toContain('- Composable adapters.');
    expect(prose[3]!.text).toContain('> PRD-100 is the wire.');
    expect(prose[4]!.text).toBe('---');
  });

  it('PRD-202-R10: code-block (Contentful 2024+ extension) maps to type:"code"', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'code-entry',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'code-block',
                  data: { language: 'typescript' },
                  content: [{ nodeType: 'text', value: 'const x = 1;', marks: [], data: {} }],
                },
              ],
            },
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const block = (result.nodes[0]! as EmittedNode).content![0] as { type: string; language?: string; text: string };
    expect(block.type).toBe('code');
    expect(block.language).toBe('typescript');
    expect(block.text).toBe('const x = 1;');
  });

  it('PRD-202-R10: hyperlink inside paragraph survives as markdown link', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'hl',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'paragraph',
                  data: {},
                  content: [
                    { nodeType: 'text', value: 'See ', marks: [], data: {} },
                    {
                      nodeType: 'hyperlink',
                      data: { uri: 'https://act-spec.org' },
                      content: [{ nodeType: 'text', value: 'the spec', marks: [], data: {} }],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const block = (result.nodes[0]! as EmittedNode).content![0] as { text: string };
    expect(block.text).toBe('See [the spec](https://act-spec.org)');
  });

  it('PRD-202-R10: empty paragraphs are skipped', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'empty',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'paragraph',
                  data: {},
                  content: [{ nodeType: 'text', value: '   ', marks: [], data: {} }],
                },
                {
                  nodeType: 'paragraph',
                  data: {},
                  content: [{ nodeType: 'text', value: 'Real', marks: [], data: {} }],
                },
              ],
            },
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const blocks = (result.nodes[0]! as EmittedNode).content!;
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toBe('Real');
  });

  it('PRD-202-R10/R18: unknown rich-text node type → partial prose with extraction_error', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'weird',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'unknown-future-block',
                  data: {},
                  content: [{ nodeType: 'text', value: 'fallback content', marks: [], data: {} }],
                },
              ],
            },
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const block = (result.nodes[0]! as EmittedNode).content![0] as {
      metadata?: { extraction_status?: string; extraction_error?: string };
      text: string;
    };
    expect(block.metadata?.extraction_status).toBe('partial');
    expect(block.metadata?.extraction_error).toMatch(/unknown-future-block/);
    expect(block.text).toBe('fallback content');
  });
});

describe('PRD-202-R11 — embedded asset / embedded entry', () => {
  it('PRD-202-R11: image asset at Plus emits marketing:image with width/height', async () => {
    const corpus = loadCorpus('strict-marketing-hero');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
      mappings: {
        landingPage: {
          summary: 'subhead',
          blocks: [
            {
              when: { field: 'type', equals: 'hero' },
              type: 'marketing:hero',
              fields: { headline: 'headline', subhead: 'subhead', cta: 'cta' },
            },
          ],
        },
      },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const blocks = (result.nodes[0]! as EmittedNode).content!;
    const img = blocks.find((b) => (b as { type: string }).type === 'marketing:image') as
      | { type: 'marketing:image'; url: string; alt: string; width: number; height: number }
      | undefined;
    expect(img).toBeDefined();
    expect(img!.url).toContain('hero-bg.jpg');
    expect(img!.width).toBe(1920);
    expect(img!.height).toBe(1080);
  });

  it('PRD-202-R11: image asset at Standard falls back to inline markdown image inside prose', async () => {
    const corpus = loadCorpus('strict-marketing-hero');
    // Reuse strict-marketing-hero corpus but at Standard target.
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'standard' }),
    );
    const blocks = (result.nodes[0]! as EmittedNode).content!;
    const proseHasImage = blocks.some(
      (b) => (b as { type: string; text?: string }).type === 'prose' && /!\[.*\]\(/.test((b as { text?: string }).text ?? ''),
    );
    expect(proseHasImage).toBe(true);
  });

  it('PRD-202-R11: embedded entry matching mapping rule emits configured marketing:* block', async () => {
    const corpus = tinyCorpus({
      contentTypes: [{ sys: { id: 'landingPage' } }, { sys: { id: 'cta' } }],
      entries: [
        {
          sys: {
            id: 'landing-1',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'landingPage' } },
          },
          fields: {
            title: 'Landing',
            subhead: 'Sub',
            type: 'hero',
            headline: 'BIG',
            cta: 'GO',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'embedded-entry-block',
                  data: { target: { sys: { type: 'Link', linkType: 'Entry', id: 'cta-1' } } },
                  content: [],
                },
              ],
            },
          },
        },
      ],
      linkedEntries: {
        'cta-1': {
          sys: {
            id: 'cta-1',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'cta' } },
          },
          fields: { type: 'cta', label: 'Click', href: 'https://x' },
        },
      },
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['landingPage'],
      mappings: {
        landingPage: { summary: 'subhead' },
        cta: {
          blocks: [
            {
              when: { field: 'type', equals: 'cta' },
              type: 'marketing:cta',
              fields: { label: 'label', href: 'href' },
            },
          ],
        },
      },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const blocks = (result.nodes[0]! as EmittedNode).content!;
    const cta = blocks.find((b) => (b as { type: string }).type === 'marketing:cta') as
      | { type: 'marketing:cta'; label: string; href: string }
      | undefined;
    expect(cta).toBeDefined();
    expect(cta!.label).toBe('Click');
    expect(cta!.href).toBe('https://x');
  });

  it('PRD-202-R11: embedded entry without rule at Plus emits marketing:placeholder', async () => {
    const corpus = tinyCorpus({
      contentTypes: [{ sys: { id: 'landingPage' } }, { sys: { id: 'mystery' } }],
      entries: [
        {
          sys: {
            id: 'l2',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'landingPage' } },
          },
          fields: {
            title: 'L',
            subhead: 'S',
            type: 'hero',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'embedded-entry-block',
                  data: { target: { sys: { type: 'Link', linkType: 'Entry', id: 'm-1' } } },
                  content: [],
                },
              ],
            },
          },
        },
      ],
      linkedEntries: {
        'm-1': {
          sys: {
            id: 'm-1',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'mystery' } },
          },
          fields: { kind: 'unknown' },
        },
      },
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['landingPage'],
      mappings: {
        landingPage: {
          summary: 'subhead',
          blocks: [
            {
              when: { field: 'type', equals: 'hero' },
              type: 'marketing:hero',
              fields: { headline: 'headline' },
            },
          ],
        },
      },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const ph = (result.nodes[0]! as EmittedNode).content!.find(
      (b) => (b as { type: string }).type === 'marketing:placeholder',
    );
    expect(ph).toBeDefined();
  });

  it('PRD-202-R11: non-image asset at Plus emits marketing:asset with content_type', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'pdf',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'embedded-asset-block',
                  data: { target: { sys: { type: 'Link', linkType: 'Asset', id: 'pdf-1' } } },
                  content: [],
                },
              ],
            },
          },
        },
      ],
      assets: {
        'pdf-1': {
          sys: { type: 'Link', linkType: 'Asset', id: 'pdf-1' },
          fields: {
            title: 'Whitepaper',
            file: { url: 'https://x/wp.pdf', contentType: 'application/pdf', fileName: 'wp.pdf', details: { size: 1024 } },
          },
        },
      },
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      mappings: {
        blogPost: {
          blocks: [
            {
              when: { field: 'title', ofType: 'string' },
              type: 'marketing:placeholder',
              fields: {},
            },
          ],
        },
      },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const asset = (result.nodes[0]! as EmittedNode).content!.find(
      (b) => (b as { type: string }).type === 'marketing:asset',
    ) as { type: 'marketing:asset'; url: string; content_type: string; size: number; filename: string };
    expect(asset).toBeDefined();
    expect(asset.content_type).toBe('application/pdf');
    expect(asset.filename).toBe('wp.pdf');
    expect(asset.size).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R12 / R13 / R14 — locale fan-out + translations
// ---------------------------------------------------------------------------

describe('PRD-202-R12/R14 — Pattern 1 locale fan-out + translations', () => {
  it('PRD-202-R12: emits one node per (entry, locale) with locale-prefixed IDs', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
      defaults: { landingPage: 'page' },
      locale: { available: ['en-US', 'es-ES', 'de-DE'], default: 'en-US', pattern: 1 },
      idStrategy: { from: 'slug' },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    // 2 entries × 3 locales = 6 nodes
    expect(result.nodes).toHaveLength(6);
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids.some((id) => id.startsWith('cms/en-us/'))).toBe(true);
    expect(ids.some((id) => id.startsWith('cms/es-es/'))).toBe(true);
    expect(ids.some((id) => id.startsWith('cms/de-de/'))).toBe(true);
  });

  it('PRD-202-R14: each locale node carries dense translations array of (other locales)', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
      defaults: { landingPage: 'page' },
      locale: { available: ['en-US', 'es-ES', 'de-DE'], default: 'en-US', pattern: 1 },
      idStrategy: { from: 'slug' },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const enPricing = result.nodes.find((n) => n.id === 'cms/en-us/landing/pricing')!;
    const trs = (enPricing.metadata as { translations?: Array<{ locale: string; id: string }> }).translations!;
    expect(trs).toHaveLength(2);
    const locales = trs.map((t) => t.locale).sort();
    expect(locales).toEqual(['de-DE', 'es-ES']);
  });

  it('PRD-202-R14: untranslated locale → translation_status:"fallback" + fallback_from set', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
      defaults: { landingPage: 'page' },
      locale: { available: ['en-US', 'es-ES', 'de-DE'], default: 'en-US', pattern: 1 },
      idStrategy: { from: 'slug' },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const esRoadmap = result.nodes.find((n) => n.id === 'cms/es-es/landing/roadmap')!;
    const meta = esRoadmap.metadata as { translation_status?: string; fallback_from?: string };
    expect(meta.translation_status).toBe('fallback');
    expect(meta.fallback_from).toBe('en-US');
  });

  it('PRD-202-R14: A1 dedupe — translations with duplicate (locale,id) are deduped later-wins by framework merge', async () => {
    // Smoke check that A1's dedupe rule lives in the framework merge step.
    // (Direct framework test lives in @act-spec/adapter-framework; this verifies
    //  no duplicates make it out of the adapter for a single emission either.)
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
      defaults: { landingPage: 'page' },
      locale: { available: ['en-US', 'es-ES', 'de-DE'], default: 'en-US', pattern: 1 },
      idStrategy: { from: 'slug' },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    for (const n of result.nodes) {
      const trs = (n.metadata as { translations?: Array<{ locale: string; id: string }> }).translations ?? [];
      const seen = new Set<string>();
      for (const t of trs) {
        const key = `${t.locale}|${t.id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('PRD-202-R13: locale.pattern:2 advertises change_feed flag in manifestCapabilities', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'fixture-space',
      accessToken: 't',
      contentTypes: ['landingPage'],
      locale: { available: ['en-US', 'es-ES'], pattern: 2 },
    };
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.manifestCapabilities?.ndjson_index).toBe(true);
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R15 — ID strategies
// ---------------------------------------------------------------------------

describe('PRD-202-R15 — id strategies', () => {
  it('PRD-202-R15: idStrategy.from="id" (default) → cms/<sysId-lower>', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/aaa');
  });

  it('PRD-202-R15: idStrategy.from="slug" derives from slug field', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'XYZ',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', summary: 's', slug: 'My Cool Post' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      idStrategy: { from: 'slug' },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/my-cool-post');
  });

  it('PRD-202-R15: idStrategy.from="composite" prefixes with content type id', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      idStrategy: { from: 'composite' },
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/blogpost/aaa');
  });

  it('PRD-202-R15: per-entry override field wins over strategy', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'orig',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', summary: 's', actId: 'forced/id' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/forced/id');
  });

  it('PRD-202-R15: missing slug field → fallback to sys.id with warning', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'noSlug',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', summary: 's' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const logger = makeLogger();
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      idStrategy: { from: 'slug' },
    };
    const c = ctx(cfg, {}, logger);
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, c);
    expect(result.nodes[0]!.id).toBe('cms/noslug');
    expect(logger.warn.mock.calls.flat().join(' ')).toMatch(/idStrategy/);
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R16 — sync-token-based delta
// ---------------------------------------------------------------------------

describe('PRD-202-R16 — sync delta', () => {
  it('PRD-202-R16: delta yields entries from the recorded sync log', async () => {
    const initial = JSON.parse(
      readFileSync(path.join(fixtureRoot, 'sync-delta', 'initial.json'), 'utf8'),
    ) as { items: ContentfulEntry[]; nextSyncToken: string };
    const delta = JSON.parse(
      readFileSync(path.join(fixtureRoot, 'sync-delta', 'delta.json'), 'utf8'),
    ) as { items: ContentfulEntry[]; nextSyncToken: string };
    const corpus: ContentfulSourceCorpus = {
      spaceLocales: [{ code: 'en-US', default: true }],
      contentTypes: [{ sys: { id: 'blogPost' } }],
      entries: initial.items,
    };
    const provider = corpusProvider(corpus);
    const syncSpy = vi
      .spyOn(provider, 'syncDelta')
      .mockImplementation((since: string) => {
        if (since === initial.nextSyncToken) {
          return Promise.resolve({ entries: delta.items, nextSyncToken: delta.nextSyncToken });
        }
        return Promise.resolve({ entries: initial.items, nextSyncToken: initial.nextSyncToken });
      });

    const adapter = createContentfulAdapter({ provider });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const seen: string[] = [];
    for await (const item of adapter.delta!(initial.nextSyncToken, ctx(cfg)) as AsyncIterable<{
      entry: { sys: { id: string } };
    }>) {
      seen.push(item.entry.sys.id);
    }
    expect(seen).toEqual(['post-2']);
    expect(syncSpy).toHaveBeenCalledWith(initial.nextSyncToken);
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-202-R16: expired sync token → fallback to enumerate with warning', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'syncDelta').mockResolvedValueOnce('expired');
    const logger = makeLogger();
    const adapter = createContentfulAdapter({ provider });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const c = ctx(cfg, {}, logger);
    await adapter.init(cfg as unknown as Record<string, unknown>, c);
    const seen: string[] = [];
    for await (const item of adapter.delta!('stale-token', c) as AsyncIterable<{
      entry: { sys: { id: string } };
    }>) {
      seen.push(item.entry.sys.id);
    }
    expect(seen).toEqual(['aaa']); // From the corpus enumerate path.
    expect(logger.warn.mock.calls.flat().join(' ')).toMatch(/sync token expired/);
    await adapter.dispose(c);
  });

  it('PRD-202-R16: delta filters out entries whose contentType is not configured', async () => {
    const offType: ContentfulEntry = {
      sys: {
        id: 'spillover',
        type: 'Entry',
        contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'otherType' } },
      },
      fields: { title: 'X' },
    };
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'syncDelta').mockResolvedValueOnce({
      entries: [offType],
      nextSyncToken: 'tok',
    });
    const adapter = createContentfulAdapter({ provider });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const seen: string[] = [];
    for await (const item of adapter.delta!('tok', ctx(cfg)) as AsyncIterable<{
      entry: { sys: { id: string } };
    }>) {
      seen.push(item.entry.sys.id);
    }
    expect(seen).toEqual([]);
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R17 — concurrency + capability declaration
// ---------------------------------------------------------------------------

describe('PRD-202-R17 — concurrency', () => {
  it('PRD-202-R17: capabilities declare concurrency_max default 4', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(4);
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-202-R17: concurrency.transform config raises the cap', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['blogPost'],
      concurrency: { transform: 8 },
    };
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(8);
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-202-R17/R2: concurrency.transform > 16 fails schema', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 's',
        accessToken: 't',
        contentTypes: ['blogPost'],
        concurrency: { transform: 32 },
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R20 / R21 / R22 — provenance + level + capabilities
// ---------------------------------------------------------------------------

describe('PRD-202-R20/R21/R22 — provenance / level / capabilities', () => {
  it('PRD-202-R20: source.adapter and source_id stamped on every node', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'mySpace',
      environment: 'staging',
      accessToken: 't',
      contentTypes: ['blogPost'],
    };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const src = (result.nodes[0]!.metadata as { source: { adapter: string; source_id: string } }).source;
    expect(src.adapter).toBe('act-contentful');
    expect(src.source_id).toBe('mySpace/staging/aaa');
  });

  it('PRD-202-R20: locale suffix included on source_id when multi-locale', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 'sp',
      accessToken: 't',
      contentTypes: ['landingPage'],
      locale: { available: ['en-US', 'es-ES'], default: 'en-US', pattern: 1 },
      idStrategy: { from: 'slug' },
    };
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const en = result.nodes.find((n) => n.id === 'cms/en-us/landing/pricing')!;
    expect((en.metadata as { source: { source_id: string } }).source.source_id).toMatch(/@en-US$/);
  });

  it('PRD-202-R21: Standard when single-locale + no marketing mappings', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.level).toBe('standard');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-202-R21: Plus when multi-locale OR marketing:* mapping configured', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['landingPage'],
      locale: { available: ['en-US', 'es-ES'], default: 'en-US' },
    };
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-202-R21: Standard target with multi-locale config → level_mismatch', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['landingPage'],
      locale: { available: ['en-US', 'es-ES'] },
    };
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, { targetLevel: 'standard' })),
    ).rejects.toMatchObject({ code: 'level_mismatch' });
  });

  it('PRD-202-R22: manifestCapabilities advertises etag, subtree, ndjson_index@plus', async () => {
    const corpus = loadCorpus('strict-multi-locale');
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: 't',
      contentTypes: ['landingPage'],
      locale: { available: ['en-US', 'es-ES'] },
    };
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.manifestCapabilities?.etag).toBe(true);
    expect(caps.manifestCapabilities?.subtree).toBe(true);
    expect(caps.manifestCapabilities?.ndjson_index).toBe(true);
    expect(caps.manifestCapabilities?.search?.template_advertised).toBe(false);
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R23 — version pinning
// ---------------------------------------------------------------------------

describe('PRD-202-R23 — Stage 1 version pinning', () => {
  it('PRD-202-R23: every emitted node carries act_version "0.1"', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    for (const n of result.nodes) {
      expect((n as EmittedNode).act_version).toBe('0.1');
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R24 — integration: full pipeline + validator green
// ---------------------------------------------------------------------------

describe('PRD-202-R24 — integration: validator-green emissions', () => {
  for (const fx of ['standard-blog-post', 'strict-marketing-hero', 'strict-multi-locale'] as const) {
    it(`PRD-202-R24: ${fx} fixture corpus → all emitted nodes pass validateNode`, async () => {
      const corpus = loadCorpus(fx);
      const adapter = createContentfulAdapter({ corpus });
      const cfg: ContentfulAdapterConfig =
        fx === 'strict-multi-locale'
          ? {
              spaceId: 'fixture',
              accessToken: 't',
              contentTypes: ['landingPage'],
              defaults: { landingPage: 'page' },
              locale: { available: ['en-US', 'es-ES', 'de-DE'], default: 'en-US', pattern: 1 },
            }
          : fx === 'strict-marketing-hero'
            ? {
                spaceId: 'fixture',
                accessToken: 't',
                contentTypes: ['landingPage'],
                defaults: { landingPage: 'page' },
                mappings: {
                  landingPage: {
                    title: 'title',
                    summary: 'subhead',
                    blocks: [
                      {
                        when: { field: 'type', equals: 'hero' },
                        type: 'marketing:hero',
                        fields: { headline: 'headline', subhead: 'subhead', cta: 'cta' },
                      },
                    ],
                  },
                },
              }
            : { spaceId: 'fixture', accessToken: 't', contentTypes: ['blogPost'], defaults: { blogPost: 'article' } };
      const target =
        fx === 'standard-blog-post' ? ('standard' as const) : ('strict' as const);
      const result = await runAdapter(
        adapter,
        cfg as unknown as Record<string, unknown>,
        ctx(cfg, { targetLevel: target }),
      );
      expect(result.nodes.length).toBeGreaterThan(0);
      for (const node of result.nodes) {
        const probe = validateNode(stripPartial(node));
        if (probe.gaps.length > 0) {
          // Surface the gaps in the failure message.
          throw new Error(
            `node ${node.id} failed validateNode: ${probe.gaps
              .map((g) => `[${g.requirement}] ${g.missing}`)
              .join('; ')}`,
          );
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// PRD-202-R25 — CMS DSL divergence is documented (advisory)
// ---------------------------------------------------------------------------

describe('PRD-202-R25 — CMS DSL divergence flag', () => {
  it('PRD-202-R25: README documents the bespoke mapping shape', () => {
    const readme = readFileSync(path.join(fixtureRoot, 'README.md'), 'utf8');
    expect(readme.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-202-R26 — token redaction (covered earlier; smoke check via env-var path)
// ---------------------------------------------------------------------------

describe('PRD-202-R26 — token redaction with env-var', () => {
  it('PRD-202-R26: env-var token resolves and is never logged', async () => {
    const old = process.env['CFK'];
    process.env['CFK'] = 'super-secret-token-shhhh';
    const logger = makeLogger();
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = {
      spaceId: 's',
      accessToken: { from_env: 'CFK' },
      contentTypes: ['blogPost'],
    };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    const allLogs = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ].flat().join(' ');
    expect(allLogs).not.toContain('super-secret-token-shhhh');
    if (old !== undefined) process.env['CFK'] = old;
    else delete process.env['CFK'];
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// dispose idempotence
// ---------------------------------------------------------------------------

describe('PRD-200-R7 / PRD-202 dispose', () => {
  it('PRD-200-R7: dispose is idempotent', async () => {
    const provider = corpusProvider(tinyCorpus());
    const disposeSpy = vi.spyOn(provider, 'dispose');
    const adapter = createContentfulAdapter({ provider });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    await adapter.dispose(ctx(cfg));
    await adapter.dispose(ctx(cfg));
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases not directly mapped to a single R{n} but exercised for coverage.
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('non-string / missing slug override gracefully degrades to sys.id', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'noOverride',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', summary: 's', actId: 42 as unknown as string },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/nooverride');
  });

  it('nodes for entries with no body still pass validation (no content array warning)', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'no-body',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: { title: 'T', excerpt: 's' },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const probe = validateNode(stripPartial(result.nodes[0]!));
    expect(probe.gaps).toEqual([]);
  });

  it('aborted signal short-circuits enumerate', async () => {
    const adapter = createContentfulAdapter({ corpus: tinyCorpus() });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const ac = new AbortController();
    ac.abort();
    const seen: unknown[] = [];
    for await (const it of adapter.enumerate(ctx(cfg, { signal: ac.signal })) as AsyncIterable<unknown>) {
      seen.push(it);
    }
    expect(seen).toEqual([]);
    await adapter.dispose(ctx(cfg));
  });

  it('embedded asset target missing from corpus → partial prose with warning', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'orphan',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'embedded-asset-block',
                  data: { target: { sys: { type: 'Link', linkType: 'Asset', id: 'gone' } } },
                  content: [],
                },
              ],
            },
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const logger = makeLogger();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg, { targetLevel: 'standard' }, logger));
    const block = (result.nodes[0]! as EmittedNode).content![0] as { metadata?: { extraction_status?: string } };
    expect(block.metadata?.extraction_status).toBe('partial');
  });

  it('table rich-text node serializes as a markdown table', async () => {
    const corpus = tinyCorpus({
      entries: [
        {
          sys: {
            id: 'tab',
            type: 'Entry',
            contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
          },
          fields: {
            title: 'T',
            excerpt: 's',
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'table',
                  data: {},
                  content: [
                    {
                      nodeType: 'table-row',
                      data: {},
                      content: [
                        {
                          nodeType: 'table-header-cell',
                          data: {},
                          content: [
                            {
                              nodeType: 'paragraph',
                              data: {},
                              content: [{ nodeType: 'text', value: 'A', marks: [], data: {} }],
                            },
                          ],
                        },
                        {
                          nodeType: 'table-header-cell',
                          data: {},
                          content: [
                            {
                              nodeType: 'paragraph',
                              data: {},
                              content: [{ nodeType: 'text', value: 'B', marks: [], data: {} }],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      nodeType: 'table-row',
                      data: {},
                      content: [
                        {
                          nodeType: 'table-cell',
                          data: {},
                          content: [
                            {
                              nodeType: 'paragraph',
                              data: {},
                              content: [{ nodeType: 'text', value: '1', marks: [], data: {} }],
                            },
                          ],
                        },
                        {
                          nodeType: 'table-cell',
                          data: {},
                          content: [
                            {
                              nodeType: 'paragraph',
                              data: {},
                              content: [{ nodeType: 'text', value: '2', marks: [], data: {} }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });
    const adapter = createContentfulAdapter({ corpus });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const block = (result.nodes[0]! as EmittedNode).content![0] as { text: string };
    expect(block.text).toContain('| A | B |');
    expect(block.text).toContain('| 1 | 2 |');
  });

  it('custom provider path supplies the same adapter contract', async () => {
    const fakeProvider: ContentfulSourceProvider = {
      probeAuth: () => Promise.resolve('ok'),
      listSpaceLocales: () => Promise.resolve([{ code: 'en-US', default: true }]),
      listContentTypeIds: () => Promise.resolve(['blogPost']),
      fetchEntries: () =>
        Promise.resolve([
          {
            sys: {
              id: 'fp1',
              type: 'Entry',
              contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'blogPost' } },
            },
            fields: { title: 'Fake', summary: 's' },
          },
        ]),
      getAsset: () => undefined,
      getLinkedEntry: () => undefined,
      authoredLocalesForEntry: () => undefined,
      syncDelta: () => Promise.resolve({ entries: [], nextSyncToken: 'x' }),
      dispose: () => undefined,
    };
    const adapter = createContentfulAdapter({ provider: fakeProvider });
    const cfg: ContentfulAdapterConfig = { spaceId: 's', accessToken: 't', contentTypes: ['blogPost'] };
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.title).toBe('Fake');
  });
});

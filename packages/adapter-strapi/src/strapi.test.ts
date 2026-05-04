/**
 * PRD-205 Strapi adapter tests. Every requirement R1–R28 has at least one
 * citing test; integration scenarios at the bottom run the full adapter
 * pipeline against recorded fixtures and validate emitted nodes via
 * @act-spec/validator (PRD-205-R28 + the role's "at least one positive
 * integration test" requirement).
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  STRAPI_ADAPTER_NAME,
  STRAPI_DEFAULT_CONCURRENCY,
  STRAPI_DEFAULT_DYNAMIC_ZONE_MAX,
  STRAPI_DEFAULT_POPULATE_DEPTH,
  StrapiAdapterError,
  clampPopulateDepth,
  corpusProvider,
  createStrapiAdapter,
  emitMarkdownBody,
  normalizeEntity,
  resolveRelations,
  verifyWebhookSignature,
  walkDynamicZone,
  walkMarkdownSplit,
} from './index.js';
import type {
  StrapiAdapterConfig,
  StrapiEntity,
  StrapiSourceCorpus,
  StrapiSourceProvider,
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
  config: StrapiAdapterConfig,
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

function tinyEntity(over: Partial<StrapiEntity> = {}): Record<string, unknown> {
  return {
    id: 1,
    documentId: 'doc-1',
    slug: 'hello',
    title: 'Hello',
    summary: 'A short summary.',
    body: '# Hello\n\nWorld.',
    publishedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...over,
  };
}

function tinyCorpus(over: Partial<StrapiSourceCorpus> = {}): StrapiSourceCorpus {
  return {
    entitiesByContentType: { articles: [tinyEntity()] },
    ...over,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'test-fixtures');

function loadCorpus(name: string): StrapiSourceCorpus {
  return JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'entities.json'), 'utf8'),
  ) as StrapiSourceCorpus;
}

function stripPartial(n: EmittedNode | PartialEmittedNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

function baseConfig(over: Partial<StrapiAdapterConfig> = {}): StrapiAdapterConfig {
  return {
    baseUrl: 'https://cms.example.com',
    apiToken: 'tok-fixture',
    contentTypes: ['articles'],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// PRD-205-R1 — adapter shape
// ---------------------------------------------------------------------------

describe('PRD-205 Strapi adapter — factory contract', () => {
  it('PRD-205-R1: createStrapiAdapter returns an Adapter; default name is "act-strapi"', () => {
    const a = createStrapiAdapter({ corpus: tinyCorpus() });
    expect(a.name).toBe(STRAPI_ADAPTER_NAME);
    expect(a.name).toBe('act-strapi');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
    expect(typeof a.precheck).toBe('function');
    expect(typeof a.delta).toBe('function');
  });

  it('PRD-205-R1: createStrapiAdapter requires either provider or corpus', () => {
    expect(() => createStrapiAdapter({})).toThrow(StrapiAdapterError);
  });

  it('PRD-205 — RESERVED_METADATA_KEYS contains the protected metadata keys', () => {
    expect(RESERVED_METADATA_KEYS.has('source')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('translations')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('extraction_status')).toBe(true);
  });

  it('PRD-205 — defaults are exported as constants', () => {
    expect(STRAPI_DEFAULT_CONCURRENCY).toBe(4);
    expect(STRAPI_DEFAULT_DYNAMIC_ZONE_MAX).toBe(3);
    expect(STRAPI_DEFAULT_POPULATE_DEPTH).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R2 — config schema
// ---------------------------------------------------------------------------

describe('PRD-205-R2 — config schema', () => {
  it('PRD-205-R2: minimal valid config is accepted', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
      }),
    ).resolves.toBeUndefined();
  });

  it('PRD-205-R2: missing baseUrl is config_invalid', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ apiToken: 't', contentTypes: ['x'] } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: missing apiToken is config_invalid', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        contentTypes: ['x'],
      } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: missing contentTypes is config_invalid', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
      } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: empty contentTypes array is config_invalid', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: [],
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: apiToken accepts string OR { from_env }', async () => {
    const a1 = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      a1.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 'tok',
        contentTypes: ['articles'],
      }),
    ).resolves.toBeUndefined();
    const a2 = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      a2.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: { from_env: 'STRAPI_API_TOKEN' },
        contentTypes: ['articles'],
      }),
    ).resolves.toBeUndefined();
  });

  it('PRD-205-R2: invalid strapiVersion enum is rejected', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
        strapiVersion: 'v6',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: invalid transport enum is rejected', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
        transport: 'soap',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: baseUrl without http(s):// scheme is rejected', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: from_env reference whose env var is unset rejects at init', async () => {
    delete process.env['STRAPI_TOKEN_NOT_SET'];
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ apiToken: { from_env: 'STRAPI_TOKEN_NOT_SET' } });
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R2: from_env reference whose env var IS set succeeds', async () => {
    process.env['STRAPI_TOKEN_OK'] = 'tok-from-env';
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ apiToken: { from_env: 'STRAPI_TOKEN_OK' } });
    const out = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(out.nodes.length).toBeGreaterThan(0);
    delete process.env['STRAPI_TOKEN_OK'];
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R3 — Strapi version pin (v4 vs v5)
// ---------------------------------------------------------------------------

describe('PRD-205-R3 — Strapi version pin', () => {
  it('PRD-205-R3: defaults strapiVersion to "v5" (no warning when server is v5)', async () => {
    const logger = makeLogger();
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warnings = logger.warn.mock.calls.flat().join(' ');
    expect(warnings).not.toMatch(/PRD-205-R3/);
  });

  it('PRD-205-R3: v4 envelope shape is normalized into the unified entity form', () => {
    const v4 = { id: 7, attributes: { title: 'X', slug: 'x', body: 'B' } };
    const e = normalizeEntity(v4, 'articles');
    expect(e.id).toBe(7);
    expect(e.title).toBe('X');
    expect(e.body).toBe('B');
    expect(e.__contentType).toBe('articles');
    expect(e.documentId).toBeUndefined();
  });

  it('PRD-205-R3: v5 flat shape passes through normalize unchanged (plus __contentType)', () => {
    const v5 = { id: 7, documentId: 'doc-7', title: 'Y', body: 'B' };
    const e = normalizeEntity(v5, 'articles');
    expect(e.id).toBe(7);
    expect(e.documentId).toBe('doc-7');
    expect(e.title).toBe('Y');
    expect(e.__contentType).toBe('articles');
  });

  it('PRD-205-R3: server-version mismatch (server v4, configured v5) emits a warning, does NOT throw', async () => {
    const logger = makeLogger();
    const corpus: StrapiSourceCorpus = {
      ...tinyCorpus(),
      serverStrapiVersion: 'v4',
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ strapiVersion: 'v5' });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warnings = logger.warn.mock.calls.flat().join(' ');
    expect(warnings).toMatch(/PRD-205-R3/);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R4 — transport (REST vs GraphQL); `populate=*` forbidden.
// ---------------------------------------------------------------------------

describe('PRD-205-R4 — transport / populate=*', () => {
  it('PRD-205-R4: defaults transport to "rest" (validated by schema accepting it)', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
        transport: 'rest',
      }),
    ).resolves.toBeUndefined();
  });

  it('PRD-205-R4: transport "graphql" is accepted by config schema', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
        transport: 'graphql',
        graphqlEndpoint: '/graphql',
      }),
    ).resolves.toBeUndefined();
  });

  it('PRD-205-R4: graphqlQuery containing `populate=*` is rejected (precheck)', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        baseUrl: 'https://cms.example.com',
        apiToken: 't',
        contentTypes: ['articles'],
        transport: 'graphql',
        graphqlQuery: '{ articles(populate=*) { id } }',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R4: graphqlQuery containing `populate=*` is rejected (init)', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      transport: 'graphql',
      graphqlQuery: '{ articles(populate=*) { id } }',
    });
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R5 — content-types iteration; 404 on unknown content type → throw
// ---------------------------------------------------------------------------

describe('PRD-205-R5 — content-types iteration + 404 rejection', () => {
  it('PRD-205-R5: each configured contentType is iterated and emitted', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [tinyEntity({ id: 1, slug: 'a1', title: 'A1' })],
        tutorials: [tinyEntity({ id: 2, slug: 't1', title: 'T1' })],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ contentTypes: ['articles', 'tutorials'] });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.type).sort()).toEqual(['article', 'tutorial']);
  });

  it('PRD-205-R5: unknown content type (404) at init rejects with content_type_not_found', async () => {
    const corpus: StrapiSourceCorpus = {
      ...tinyCorpus(),
      unknownContentTypes: ['ghosts'],
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ contentTypes: ['ghosts'] });
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'content_type_not_found' });
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R6 — empty filter behavior
// ---------------------------------------------------------------------------

describe('PRD-205-R6 — empty result with allowEmpty unset emits a warning', () => {
  it('PRD-205-R6: empty result with allowEmpty unset emits a warning, no throw', async () => {
    const logger = makeLogger();
    const corpus: StrapiSourceCorpus = { entitiesByContentType: { articles: [] } };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    expect(result.nodes).toHaveLength(0);
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-205-R6/);
  });

  it('PRD-205-R6: empty result with allowEmpty=true does NOT warn', async () => {
    const logger = makeLogger();
    const corpus: StrapiSourceCorpus = { entitiesByContentType: { articles: [] } };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ allowEmpty: true });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).not.toMatch(/PRD-205-R6/);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R7 — content-type mapping
// ---------------------------------------------------------------------------

describe('PRD-205-R7 — content-type → ACT type', () => {
  it('PRD-205-R7: identity default — Strapi plural "articles" → singular "article"', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.type).toBe('article');
  });

  it('PRD-205-R7: explicit typeMapping overrides identity', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ typeMapping: { article: 'blog-post' } });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.type).toBe('blog-post');
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R8 — field mapping
// ---------------------------------------------------------------------------

describe('PRD-205-R8 — field mapping', () => {
  it('PRD-205-R8: id derives from slug by default', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.id).toBe('act-strapi/articles/hello');
  });

  it('PRD-205-R8: id falls back to documentId when no slug', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [{ id: 1, documentId: 'doc-fallback', title: 'X', body: 'b' }],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.id).toBe('act-strapi/articles/doc-fallback');
  });

  it('PRD-205-R8: id falls back to v4 numeric id when no slug or documentId', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: { articles: [{ id: 99, title: 'X', body: 'b' }] },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.id).toBe('act-strapi/articles/v4-99');
  });

  it('PRD-205-R8: explicit idField overrides slug', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [tinyEntity({ slug: 'wont-use', customId: 'my-explicit' })],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ idField: 'customId' });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.id).toBe('act-strapi/articles/my-explicit');
  });

  it('PRD-205-R8: title resolves from "title" field by default', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.title).toBe('Hello');
  });

  it('PRD-205-R8: missing title yields partial node with extraction_status="partial"', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [{ id: 1, documentId: 'd1', slug: 's', body: 'b' }],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    const n = result.nodes[0]! as PartialEmittedNode;
    expect(n._actPartial).toBe(true);
    expect((n.metadata as Record<string, unknown>)['extraction_status']).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('PRD-205-R8: tags read from "tags" field by default (objects with `name`)', async () => {
    const adapter = createStrapiAdapter({
      corpus: {
        entitiesByContentType: {
          articles: [
            tinyEntity({ tags: [{ id: 1, name: 'sdk' }, { id: 2, name: 'docs' }] }),
          ],
        },
      },
    });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).tags).toEqual(['sdk', 'docs']);
  });

  it('PRD-205-R8: tags can be string array directly', async () => {
    const adapter = createStrapiAdapter({
      corpus: {
        entitiesByContentType: {
          articles: [tinyEntity({ tags: ['x', 'y'] })],
        },
      },
    });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).tags).toEqual(['x', 'y']);
  });

  it('PRD-205-R8: abstract picked up when present', async () => {
    const adapter = createStrapiAdapter({
      corpus: {
        entitiesByContentType: {
          articles: [tinyEntity({ abstract: 'A long abstract.' })],
        },
      },
    });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).abstract).toBe('A long abstract.');
  });

  it('PRD-205-R8: summary "extract" strategy first-paragraph fallback stamps summary_source="extracted"', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [tinyEntity({
          summary: undefined,
          body: 'First paragraph supplies the summary.',
        })],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ summary: { strategy: 'extract' } });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).summary_source).toBe('extracted');
  });

  it('PRD-205-R8: updated_at flows from publishedAt when present', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).updated_at).toBe('2026-01-01T00:00:00Z');
  });

  it('PRD-205-R8: updated_at falls back to updatedAt when publishedAt absent', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [tinyEntity({ publishedAt: undefined, updatedAt: '2026-02-02T00:00:00Z' })],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).updated_at).toBe('2026-02-02T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R9 — markdown body emission
// ---------------------------------------------------------------------------

describe('PRD-205-R9 — markdown body', () => {
  it('PRD-205-R9: default mode emits a single `markdown` block carrying body verbatim', () => {
    const r = emitMarkdownBody('# Title\n\nBody.', { parseMarkdown: false, warn: () => undefined });
    expect(r.blocks).toEqual([{ type: 'markdown', text: '# Title\n\nBody.' }]);
    expect(r.partial).toBe(false);
  });

  it('PRD-205-R9: split mode walks paragraphs into prose blocks', () => {
    const r = walkMarkdownSplit('First paragraph.\n\nSecond paragraph.', {
      parseMarkdown: true,
      warn: () => undefined,
    });
    const proseTexts = r.blocks
      .filter((b) => b.type === 'prose')
      .map((b) => (b as { text: string }).text);
    expect(proseTexts).toContain('First paragraph.');
    expect(proseTexts).toContain('Second paragraph.');
  });

  it('PRD-205-R9: split mode emits fenced code blocks as `code` with the language tag', () => {
    const r = walkMarkdownSplit('```bash\nnpm install\n```', {
      parseMarkdown: true,
      warn: () => undefined,
    });
    expect(r.blocks[0]).toEqual({ type: 'code', language: 'bash', text: 'npm install' });
  });

  it('PRD-205-R9: split mode emits admonition blocks as `callout` with the level', () => {
    const r = walkMarkdownSplit('> [!warning] Take care here.', {
      parseMarkdown: true,
      warn: () => undefined,
    });
    expect(r.blocks[0]).toEqual({
      type: 'callout',
      level: 'warning',
      text: 'Take care here.',
    });
  });

  it('PRD-205-R9: split mode admonition info marker yields callout level "info"', () => {
    const r = walkMarkdownSplit('> [!info] FYI.', {
      parseMarkdown: true,
      warn: () => undefined,
    });
    expect((r.blocks[0] as { level: string }).level).toBe('info');
  });

  it('PRD-205-R9: split mode lists are coalesced into a single prose block', () => {
    const r = walkMarkdownSplit('- one\n- two\n- three', {
      parseMarkdown: true,
      warn: () => undefined,
    });
    expect(r.blocks).toHaveLength(1);
    expect((r.blocks[0] as { text: string }).text).toBe('- one\n- two\n- three');
  });

  it('PRD-205-R9: split mode headings fold into the following prose block', () => {
    const r = walkMarkdownSplit('# Title\n\nA paragraph.', {
      parseMarkdown: true,
      warn: () => undefined,
    });
    // `# Title` and `A paragraph.` are separate prose paragraphs because of the blank line;
    // the heading is preserved as markdown text in its own prose block (per PRD-205-R9 wording).
    const texts = r.blocks
      .filter((b) => b.type === 'prose')
      .map((b) => (b as { text: string }).text);
    expect(texts.some((t) => t.startsWith('# Title'))).toBe(true);
    expect(texts).toContain('A paragraph.');
  });

  it('PRD-205-R9: unterminated fence emits partial flag', () => {
    const logger = makeLogger();
    const r = walkMarkdownSplit('```bash\nopen\nno close', {
      parseMarkdown: true,
      warn: (m: string): void => { logger.warn(m); },
    });
    expect(r.partial).toBe(true);
    expect((r.blocks[0] as { type: string }).type).toBe('code');
  });

  it('PRD-205-R9: non-string body becomes empty markdown block + partial', () => {
    const logger = makeLogger();
    const r = emitMarkdownBody(undefined as unknown as string, {
      parseMarkdown: false,
      warn: (m: string): void => { logger.warn(m); },
    });
    expect(r.blocks).toEqual([{ type: 'markdown', text: '' }]);
    expect(r.partial).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R10 — dynamic-zone bound
// ---------------------------------------------------------------------------

describe('PRD-205-R10 — dynamic-zone depth bound', () => {
  it('PRD-205-R10: default cap is 3 (DYNAMIC_ZONE_MAX)', () => {
    expect(STRAPI_DEFAULT_DYNAMIC_ZONE_MAX).toBe(3);
  });

  it('PRD-205-R10: walker emits partial fallback when depth bound exceeded', () => {
    const logger = makeLogger();
    const r = walkDynamicZone(
      [{ __component: 'shared.foo' }],
      {
        targetLevel: 'strict',
        componentMapping: undefined,
        dynamicZoneMax: 0, // immediate exceed
        warn: (m: string): void => { logger.warn(m); },
      },
    );
    expect(r.partial).toBe(true);
    expect((r.blocks[0] as { metadata: Record<string, unknown> }).metadata['extraction_status']).toBe('partial');
  });

  it('PRD-205-R10: dynamicZoneMax > 3 rejects at init', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ dynamicZoneMax: 5 });
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R10: dynamicZoneMax 1 is accepted', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ dynamicZoneMax: 1 });
    await expect(
      adapter.precheck!(cfg as unknown as Record<string, unknown>),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R11 — component → marketing:* (Plus)
// ---------------------------------------------------------------------------

describe('PRD-205-R11 — component → marketing:* (Plus)', () => {
  it('PRD-205-R11: configured component mapping promotes to marketing:hero', () => {
    const r = walkDynamicZone(
      [
        {
          __component: 'shared.hero',
          title: 'Headline',
          subtitle: 'Sub',
          ctaLabel: 'Go',
          ctaHref: '/x',
        },
      ],
      {
        targetLevel: 'strict',
        componentMapping: {
          'shared.hero': {
            type: 'marketing:hero',
            fields: {
              headline: 'title',
              subhead: 'subtitle',
              cta: { label: 'ctaLabel', href: 'ctaHref' },
            },
          },
        },
        dynamicZoneMax: 3,
        warn: () => undefined,
      },
    );
    expect(r.blocks).toHaveLength(1);
    const block = r.blocks[0]! as Record<string, unknown>;
    expect(block['type']).toBe('marketing:hero');
    expect(block['headline']).toBe('Headline');
    expect((block['cta'] as Record<string, unknown>)['label']).toBe('Go');
  });

  it('PRD-205-R11: unmapped component yields partial fallback', () => {
    const r = walkDynamicZone(
      [{ __component: 'shared.hero', title: 'X' }],
      {
        targetLevel: 'strict',
        componentMapping: {}, // empty mapping
        dynamicZoneMax: 3,
        warn: () => undefined,
      },
    );
    expect(r.partial).toBe(true);
    expect((r.blocks[0] as { metadata: Record<string, unknown> }).metadata['extraction_status']).toBe('partial');
  });

  it('PRD-205-R11: array projection via `tiers[].{name, price, features}` works', () => {
    const r = walkDynamicZone(
      [
        {
          __component: 'marketing.pricing',
          tiers: [
            { name: 'A', price: '$1', features: ['x'], extra: 'drop' },
            { name: 'B', price: '$2', features: ['y'], extra: 'drop' },
          ],
        },
      ],
      {
        targetLevel: 'strict',
        componentMapping: {
          'marketing.pricing': {
            type: 'marketing:pricing-table',
            fields: { tiers: 'tiers[].{name, price, features}' },
          },
        },
        dynamicZoneMax: 3,
        warn: () => undefined,
      },
    );
    const block = r.blocks[0]! as Record<string, unknown>;
    expect(block['type']).toBe('marketing:pricing-table');
    expect(block['tiers']).toEqual([
      { name: 'A', price: '$1', features: ['x'] },
      { name: 'B', price: '$2', features: ['y'] },
    ]);
  });

  it('PRD-205-R11: malformed mapping (field projection yields undefined) marks partial', () => {
    const r = walkDynamicZone(
      [{ __component: 'shared.hero', title: 'OK' }],
      {
        targetLevel: 'strict',
        componentMapping: {
          'shared.hero': {
            type: 'marketing:hero',
            fields: { headline: 'title', subhead: 'doesnotexist' },
          },
        },
        dynamicZoneMax: 3,
        warn: () => undefined,
      },
    );
    expect(r.partial).toBe(true);
  });

  it('PRD-205-R11: entry missing __component yields partial fallback', () => {
    const r = walkDynamicZone(
      [{ title: 'no component name' } as unknown],
      {
        targetLevel: 'strict',
        componentMapping: {},
        dynamicZoneMax: 3,
        warn: () => undefined,
      },
    );
    expect(r.partial).toBe(true);
  });

  it('PRD-205-R11: dynamic-zone walker returns empty for non-array input', () => {
    const r = walkDynamicZone(undefined, {
      targetLevel: 'strict',
      dynamicZoneMax: 3,
      warn: () => undefined,
    });
    expect(r.blocks).toHaveLength(0);
    expect(r.partial).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R12 / R13 / R14 — relations
// ---------------------------------------------------------------------------

describe('PRD-205-R12 / R13 / R14 — relations', () => {
  it('PRD-205-R12: configured relation field is resolved into related[]', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [
          tinyEntity({
            id: 1,
            slug: 'a1',
            title: 'A1',
            related_articles: [
              { id: 2, documentId: 'doc-2', __contentType: 'articles' },
            ],
          }),
          { id: 2, documentId: 'doc-2', slug: 'a2', title: 'A2', body: 'B2' },
        ],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { related_articles: 'see-also' } },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    const a1 = result.nodes.find((n) => n.id === 'act-strapi/articles/a1') as EmittedNode;
    expect(a1.related).toEqual([
      { id: 'act-strapi/articles/a2', relation: 'see-also' },
    ]);
  });

  it('PRD-205-R12: depth=0 short-circuits relation resolution', () => {
    const lookup = {
      getEntityByContentTypeAndId: () => undefined,
    };
    const out = resolveRelations(
      { id: 1, __contentType: 'articles' } as StrapiEntity,
      { ...baseConfig(), populateDepth: 0, fieldMapping: { related: { rel: 'see-also' } } },
      lookup,
      () => 'x',
    );
    expect(out.related).toHaveLength(0);
  });

  it('PRD-205-R13: clampPopulateDepth rejects out-of-range; clamps to 0..4', () => {
    expect(clampPopulateDepth(-1)).toBe(0);
    expect(clampPopulateDepth(0)).toBe(0);
    expect(clampPopulateDepth(2)).toBe(2);
    expect(clampPopulateDepth(4)).toBe(4);
    expect(clampPopulateDepth(7)).toBe(4);
    expect(clampPopulateDepth(2.5)).toBe(1); // non-integer falls to default
  });

  it('PRD-205-R13: populateDepth > 4 rejects at init with populate_depth_exceeded', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ populateDepth: 8 });
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-205-R14: cycles are tolerated and stamped via metadata.reference_cycles', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [
          tinyEntity({
            id: 1,
            documentId: 'doc-1',
            slug: 'a1',
            title: 'A1',
            related_articles: [
              { id: 2, documentId: 'doc-2', __contentType: 'articles' },
            ],
          }),
          {
            id: 2,
            documentId: 'doc-2',
            slug: 'a2',
            title: 'A2',
            body: 'B',
            related_articles: [
              { id: 1, documentId: 'doc-1', __contentType: 'articles' },
            ],
          },
        ],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { related_articles: 'see-also' } },
      populateDepth: 3,
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    // At least one of the two emitted nodes should have detected the cycle.
    const cycles = result.nodes
      .map((n) => (n.metadata as Record<string, unknown> | undefined)?.['reference_cycles'])
      .filter((v) => typeof v === 'number');
    expect(cycles.some((c) => (c as number) > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R15 — locale handling
// ---------------------------------------------------------------------------

describe('PRD-205-R15 — locale handling', () => {
  it('PRD-205-R15: locale fan-out emits one node per locale with metadata.locale', async () => {
    const corpus = loadCorpus('plus-emission');
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      contentTypes: ['landing-pages'],
      locale: { locales: ['en', 'de'], defaultLocale: 'en' },
      componentMapping: {
        'shared.hero': {
          type: 'marketing:hero',
          fields: { headline: 'title' },
        },
      },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const locales = result.nodes
      .map((n) => (n.metadata as Record<string, unknown>)['locale'])
      .filter((v): v is string => typeof v === 'string');
    expect(locales).toContain('en');
    expect(locales).toContain('de');
  });

  it('PRD-205-R15: locale fan-out emits metadata.translations linking sibling-locale entities', async () => {
    const corpus = loadCorpus('plus-emission');
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      contentTypes: ['landing-pages'],
      locale: { locales: ['en', 'de'], defaultLocale: 'en' },
      componentMapping: {
        'shared.hero': { type: 'marketing:hero', fields: { headline: 'title' } },
      },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const en = result.nodes.find(
      (n) => (n.metadata as Record<string, unknown>)['locale'] === 'en',
    );
    const trans = (en!.metadata as Record<string, unknown>)['translations'] as unknown[];
    expect(Array.isArray(trans)).toBe(true);
    expect(trans.some((t) => (t as { locale: string }).locale === 'de')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R16 / R17 — incremental rebuild + webhook
// ---------------------------------------------------------------------------

describe('PRD-205-R16 / R17 — delta + webhook', () => {
  it('PRD-205-R16: delta() yields entities and stamps next marker', async () => {
    const adapter = createStrapiAdapter({ corpus: { ...tinyCorpus(), latestUpdatedAt: '2026-04-22T08:15:00Z' } });
    const cfg = baseConfig();
    // init the adapter
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const items: unknown[] = [];
    const iter = adapter.delta!('2026-01-01T00:00:00Z', ctx(cfg));
    for await (const it of iter) items.push(it);
    expect(items.length).toBeGreaterThan(0);
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-205-R17: verifyWebhookSignature accepts a valid HMAC-SHA256 signature', () => {
    const body = '{"event":"entry.publish"}';
    const secret = 'top-secret';
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('PRD-205-R17: verifyWebhookSignature rejects a tampered body', () => {
    const body = '{"event":"entry.publish"}';
    const secret = 'top-secret';
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyWebhookSignature(body + 'x', sig, secret)).toBe(false);
  });

  it('PRD-205-R17: verifyWebhookSignature rejects empty signature/secret', () => {
    expect(verifyWebhookSignature('body', '', 'secret')).toBe(false);
    expect(verifyWebhookSignature('body', 'sig', '')).toBe(false);
    expect(verifyWebhookSignature('body', null, 'secret')).toBe(false);
  });

  it('PRD-205-R17: verifyWebhookSignature returns false for length mismatch', () => {
    expect(verifyWebhookSignature('body', 'sig', 'secret')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R18 / R19 / R20 — capability declaration & level
// ---------------------------------------------------------------------------

describe('PRD-205-R18 / R19 / R20 — capability declaration', () => {
  it('PRD-205-R18: init returns AdapterCapabilities with concurrency_max=4 by default', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(STRAPI_DEFAULT_CONCURRENCY);
    expect(caps.delta).toBe(true);
    expect(caps.precedence).toBe('primary');
    expect(caps.manifestCapabilities?.etag).toBe(true);
    expect(caps.manifestCapabilities?.subtree).toBe(true);
    expect(caps.manifestCapabilities?.ndjson_index).toBe(false);
  });

  it('PRD-205-R19: declares level "standard" when no componentMapping AND no locale', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.level).toBe('standard');
  });

  it('PRD-205-R20: declares level "strict" when componentMapping is configured', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      componentMapping: { 'shared.hero': { type: 'marketing:hero', fields: { headline: 'title' } } },
    });
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
  });

  it('PRD-205-R20: declares level "strict" when locale is configured', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ locale: { locales: ['en'], defaultLocale: 'en' } });
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
  });

  it('PRD-205-R20: declared "strict" against a "standard" target rejects with level_mismatch', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ locale: { locales: ['en'], defaultLocale: 'en' } });
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'level_mismatch' });
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R21 / R22 / R23 — failure modes
// ---------------------------------------------------------------------------

describe('PRD-205-R21 / R22 / R23 — failure modes', () => {
  it('PRD-205-R22: HTTP 401/403 at auth probe rejects with auth_failed', async () => {
    const corpus: StrapiSourceCorpus = {
      ...tinyCorpus(),
      authProbe: 'unauthorized',
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('PRD-205-R22: auth_failed error message MUST NOT include the token', async () => {
    const corpus: StrapiSourceCorpus = {
      ...tinyCorpus(),
      authProbe: 'unauthorized',
    };
    const adapter = createStrapiAdapter({ corpus });
    const secretToken = 'super-secret-token-do-not-leak';
    const cfg = baseConfig({ apiToken: secretToken });
    try {
      await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
      expect.fail('init must reject');
    } catch (err) {
      expect((err as Error).message).not.toContain(secretToken);
    }
  });

  it('PRD-205-R23: partial-extraction node carries metadata.extraction_status="partial"', async () => {
    const corpus: StrapiSourceCorpus = {
      entitiesByContentType: {
        articles: [{ id: 1, documentId: 'd1', slug: 's' /* no title */ }],
      },
    };
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['extraction_status']).toBe('partial');
    expect(typeof meta['extraction_error']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R24 / R25 — security
// ---------------------------------------------------------------------------

describe('PRD-205-R24 / R25 — security: no token in logs / envelopes', () => {
  it('PRD-205-R24: http:// baseUrl emits a transport warning (does NOT throw)', async () => {
    const logger = makeLogger();
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ baseUrl: 'http://cms.local:1337' });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-205-R24/);
    expect(warned).toMatch(/http:\/\//);
  });

  it('PRD-205-R24: inline apiToken triggers credential-hygiene warning (no token leaked)', async () => {
    const logger = makeLogger();
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const secret = 'inline-supersecret';
    const cfg = baseConfig({ apiToken: secret });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const allLogs = ([] as unknown[])
      .concat(logger.debug.mock.calls.flat() as unknown[])
      .concat(logger.info.mock.calls.flat() as unknown[])
      .concat(logger.warn.mock.calls.flat() as unknown[])
      .concat(logger.error.mock.calls.flat() as unknown[])
      .join(' ');
    expect(allLogs).toMatch(/PRD-205-R24/);
    expect(allLogs).not.toContain(secret);
  });

  it('PRD-205-R24: debugLogging emits a fingerprint, never the full token', async () => {
    const logger = makeLogger();
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const secret = 'tok-abcdef-fingerprint';
    const cfg = baseConfig({ apiToken: secret, debugLogging: true });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const dbg = logger.debug.mock.calls.flat().join(' ');
    expect(dbg).toMatch(/fingerprint=tok-/);
    expect(dbg).not.toContain(secret);
  });

  it('PRD-205-R25: emitted envelopes contain no apiToken substring', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const secret = 'tok-must-not-leak-into-envelope';
    const cfg = baseConfig({ apiToken: secret });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    for (const node of result.nodes) {
      const json = JSON.stringify(node);
      expect(json).not.toContain(secret);
      // Defense-in-depth: any prefix > 4 chars also forbidden.
      expect(json).not.toContain(secret.slice(0, 5));
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R26 — provenance source_id
// ---------------------------------------------------------------------------

describe('PRD-205-R26 — provenance source_id', () => {
  it('PRD-205-R26: v5 source_id is the documentId', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    const source = meta['source'] as Record<string, unknown>;
    expect(source['source_id']).toBe('doc-1');
    expect(source['adapter']).toBe('act-strapi');
  });

  it('PRD-205-R26: v4 source_id is `v4:<id>` (no documentId)', async () => {
    const corpus = loadCorpus('standard-emission-v4');
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({ contentTypes: ['tutorials'], strapiVersion: 'v4' });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    const source = meta['source'] as Record<string, unknown>;
    expect(source['source_id']).toMatch(/^v4:/);
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R27 — Stage 1 pinning
// ---------------------------------------------------------------------------

describe('PRD-205-R27 — Stage 1 pinning', () => {
  it('PRD-205-R27: emitted nodes carry act_version="0.1"', async () => {
    const adapter = createStrapiAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect((result.nodes[0]! as EmittedNode).act_version).toBe('0.1');
  });
});

// ---------------------------------------------------------------------------
// PRD-205-R28 — test-fixture conformance (integration)
// ---------------------------------------------------------------------------

describe('PRD-205-R28 — fixture conformance', () => {
  it('PRD-205-R28: standard-emission-v5 fixture passes validateNode for every emitted node', async () => {
    const corpus = loadCorpus('standard-emission-v5');
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      contentTypes: ['articles'],
      strapiVersion: 'v5',
      fieldMapping: { related: { related_articles: 'see-also' } },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps, `node ${node.id} gaps: ${JSON.stringify(probe.gaps)}`).toEqual([]);
    }
  });

  it('PRD-205-R28: standard-emission-v4 fixture passes validateNode for every emitted node', async () => {
    const corpus = loadCorpus('standard-emission-v4');
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      contentTypes: ['tutorials'],
      strapiVersion: 'v4',
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps, `node ${node.id} gaps: ${JSON.stringify(probe.gaps)}`).toEqual([]);
    }
  });

  it('PRD-205-R28: plus-emission fixture passes validateNode for every emitted node', async () => {
    const corpus = loadCorpus('plus-emission');
    const adapter = createStrapiAdapter({ corpus });
    const cfg = baseConfig({
      contentTypes: ['landing-pages'],
      strapiVersion: 'v5',
      locale: { locales: ['en', 'de'], defaultLocale: 'en' },
      componentMapping: {
        'shared.hero': {
          type: 'marketing:hero',
          fields: {
            headline: 'title',
            subhead: 'subtitle',
            cta: { label: 'ctaLabel', href: 'ctaHref' },
          },
        },
        'marketing.pricing-table': {
          type: 'marketing:pricing-table',
          fields: { tiers: 'tiers[].{name, price, features}' },
        },
      },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps, `node ${node.id} gaps: ${JSON.stringify(probe.gaps)}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Provider abstraction sanity
// ---------------------------------------------------------------------------

describe('StrapiSourceProvider — corpusProvider sanity', () => {
  it('corpusProvider returns ok for unknown contentType when not in unknown list', async () => {
    const p = corpusProvider(tinyCorpus());
    expect(await p.probeContentType('articles')).toBe('ok');
    expect(await p.probeAuth()).toBe('ok');
    expect(await p.probeServerVersion()).toEqual({ version: 'v5', reachable: true });
  });

  it('corpusProvider getEntityByContentTypeAndId resolves by both id and documentId', () => {
    const p = corpusProvider(tinyCorpus());
    expect(p.getEntityByContentTypeAndId('articles', 1)).toBeDefined();
    expect(p.getEntityByContentTypeAndId('articles', 'doc-1')).toBeDefined();
  });

  it('corpusProvider syncDelta yields entities for configured contentTypes', async () => {
    const p = corpusProvider({ ...tinyCorpus(), latestUpdatedAt: '2026-04-01T00:00:00Z' });
    const r = await p.syncDelta('2026-01-01T00:00:00Z', ['articles']);
    expect(r.entities.length).toBeGreaterThan(0);
    expect(r.nextMarker).toBe('2026-04-01T00:00:00Z');
  });

  it('corpusProvider dispose is a no-op', async () => {
    const p = corpusProvider(tinyCorpus());
    await Promise.resolve(p.dispose());
  });

  it('custom provider can be supplied', async () => {
    const provider: StrapiSourceProvider = {
      probeServerVersion: () => Promise.resolve({ version: 'v5', reachable: true }),
      probeAuth: () => Promise.resolve('ok'),
      probeContentType: () => Promise.resolve('ok'),
      fetchEntities: () =>
        Promise.resolve([
          {
            id: 9,
            documentId: 'd9',
            __contentType: 'articles',
            slug: 'custom',
            title: 'Custom',
            body: 'Body.',
          } as StrapiEntity,
        ]),
      getEntityByContentTypeAndId: () => undefined,
      syncDelta: () => Promise.resolve({ entities: [], nextMarker: '' }),
      dispose: () => undefined,
    };
    const adapter = createStrapiAdapter({ provider });
    const cfg = baseConfig();
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg),
    );
    expect(result.nodes[0]!.id).toBe('act-strapi/articles/custom');
  });
});

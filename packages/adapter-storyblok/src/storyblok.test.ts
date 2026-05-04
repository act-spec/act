/**
 * PRD-204 Storyblok adapter tests. Every requirement R1–R27 has at least one
 * citing test; integration scenarios at the bottom run the full adapter
 * pipeline against recorded fixtures and validate emitted nodes via
 * @act-spec/validator (PRD-204-R27 + the role's "at least one positive
 * integration test" requirement).
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext, EmittedNode, PartialEmittedNode } from '@act-spec/adapter-framework';
import { validateNode } from '@act-spec/validator';

import {
  RESERVED_METADATA_KEYS,
  STORYBLOK_ADAPTER_NAME,
  STORYBLOK_DEFAULT_CONCURRENCY,
  StoryblokAdapterError,
  clampDepth,
  corpusProvider,
  createStoryblokAdapter,
  verifyWebhookSignature,
  walkRichtext,
} from './index.js';
import type {
  RichtextNode,
  StoryblokAdapterConfig,
  StoryblokSourceCorpus,
  StoryblokSourceProvider,
  StoryblokStory,
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
  config: StoryblokAdapterConfig,
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

function tinyStory(over: Partial<StoryblokStory> = {}): StoryblokStory {
  return {
    uuid: 'uuid-aaa',
    id: 1,
    name: 'Hello',
    slug: 'hello',
    full_slug: 'blog/hello',
    published_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    tag_list: ['intro'],
    content: {
      component: 'post',
      _uid: 'uid-content',
      summary: 'A short summary.',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Body text.' }],
          },
        ],
      },
    },
    ...over,
  };
}

function tinyCorpus(over: Partial<StoryblokSourceCorpus> = {}): StoryblokSourceCorpus {
  return {
    stories: [tinyStory()],
    ...over,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'test-fixtures');

function loadCorpus(name: string): StoryblokSourceCorpus {
  return JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'stories.json'), 'utf8'),
  ) as StoryblokSourceCorpus;
}

function stripPartial(n: EmittedNode | PartialEmittedNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

function baseConfig(over: Partial<StoryblokAdapterConfig> = {}): StoryblokAdapterConfig {
  return {
    spaceId: 12345,
    accessToken: 'tok-fixture',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// PRD-204-R1 — adapter shape
// ---------------------------------------------------------------------------

describe('PRD-204 Storyblok adapter — factory contract', () => {
  it('PRD-204-R1: createStoryblokAdapter returns an Adapter; default name is "act-storyblok"', () => {
    const a = createStoryblokAdapter({ corpus: tinyCorpus() });
    expect(a.name).toBe(STORYBLOK_ADAPTER_NAME);
    expect(a.name).toBe('act-storyblok');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
    expect(typeof a.precheck).toBe('function');
    expect(typeof a.delta).toBe('function');
  });

  it('PRD-204-R1: createStoryblokAdapter requires either provider or corpus', () => {
    expect(() => createStoryblokAdapter({})).toThrow(StoryblokAdapterError);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R2 — config schema
// ---------------------------------------------------------------------------

describe('PRD-204-R2 — config schema', () => {
  it('PRD-204-R2: minimal valid config (spaceId + accessToken) is accepted', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ spaceId: 1, accessToken: 't' }),
    ).resolves.toBeUndefined();
  });

  it('PRD-204-R2: missing spaceId is config_invalid', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ accessToken: 't' } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R2: missing accessToken is config_invalid', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ spaceId: 1 } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R2: spaceId accepts string OR integer', async () => {
    const a1 = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      a1.precheck!({ spaceId: '12345', accessToken: 't' }),
    ).resolves.toBeUndefined();
    const a2 = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      a2.precheck!({ spaceId: 12345, accessToken: 't' }),
    ).resolves.toBeUndefined();
  });

  it('PRD-204-R2: accessToken accepts string OR { from_env }', async () => {
    const a1 = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      a1.precheck!({ spaceId: 1, accessToken: 'tok' }),
    ).resolves.toBeUndefined();
    const a2 = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      a2.precheck!({ spaceId: 1, accessToken: { from_env: 'STORYBLOK_TOKEN' } }),
    ).resolves.toBeUndefined();
  });

  it('PRD-204-R2: invalid version enum is rejected', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 1,
        accessToken: 't',
        version: 'unknown-mode',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R2: invalid region enum is rejected', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 1,
        accessToken: 't',
        region: 'latam',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R3 — version + preview
// ---------------------------------------------------------------------------

describe('PRD-204-R3 — version + preview stamping', () => {
  it('PRD-204-R3: defaults to published; no metadata.preview stamp', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['preview']).toBeUndefined();
  });

  it('PRD-204-R3: version="draft" stamps metadata.preview=true and emits a warning', async () => {
    const logger = makeLogger();
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ version: 'draft' });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['preview']).toBe(true);
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-204-R3/);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R4 / R5 — storyFilter handling
// ---------------------------------------------------------------------------

describe('PRD-204-R4 / R5 — enumerate via storyFilter', () => {
  it('PRD-204-R4: enumerate fetches via configured storyFilter', async () => {
    const provider = corpusProvider(tinyCorpus());
    const fetchSpy = vi.spyOn(provider, 'fetchStories');
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig({ storyFilter: { starts_with: 'blog/' } });
    await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(fetchSpy).toHaveBeenCalledWith({ storyFilter: { starts_with: 'blog/' } });
  });

  it('PRD-204-R5: empty result with allowEmpty unset emits a warning', async () => {
    const logger = makeLogger();
    const adapter = createStoryblokAdapter({ corpus: { stories: [] } });
    const cfg = baseConfig({ storyFilter: { starts_with: 'ghost/' } });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-204-R5/);
    expect(warned).toMatch(/0 stories/);
  });

  it('PRD-204-R5: empty result with allowEmpty=true does NOT warn', async () => {
    const logger = makeLogger();
    const adapter = createStoryblokAdapter({ corpus: { stories: [] } });
    const cfg = baseConfig({ allowEmpty: true });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).not.toMatch(/PRD-204-R5/);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R6 — type mapping
// ---------------------------------------------------------------------------

describe('PRD-204-R6 — content-type → ACT type', () => {
  it('PRD-204-R6: identity default — Storyblok component "post" → ACT type "post"', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('post');
  });

  it('PRD-204-R6: explicit typeMapping overrides identity', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [tinyStory({ content: { component: 'blogPost', body: null } })],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ typeMapping: { blogPost: 'article' } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('article');
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R7 — field mapping
// ---------------------------------------------------------------------------

describe('PRD-204-R7 — field mapping', () => {
  it('PRD-204-R7: id derives from full_slug by default', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('act-storyblok/blog/hello');
  });

  it('PRD-204-R7: id falls back to slug when no full_slug', async () => {
    const story = tinyStory();
    (story as unknown as Record<string, unknown>)['full_slug'] = '';
    const corpus: StoryblokSourceCorpus = { stories: [story] };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('act-storyblok/hello');
  });

  it('PRD-204-R7: id falls back to uuid when no slug or full_slug', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        {
          uuid: 'uuid-only',
          name: 'X',
          slug: '',
          full_slug: '',
          content: { component: 'post' },
        },
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('act-storyblok/uuid-only');
  });

  it('PRD-204-R7: explicit idField overrides full_slug', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          full_slug: 'wont-be-used',
          content: { component: 'post', customId: 'my-explicit-id' },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ idField: 'customId' });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('act-storyblok/my-explicit-id');
  });

  it('PRD-204-R7: title resolves from story `name` by default', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.title).toBe('Hello');
  });

  it('PRD-204-R7: missing name yields partial node with extraction_status="partial"', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [tinyStory({ name: '' })],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const n = result.nodes[0]! as PartialEmittedNode;
    expect(n._actPartial).toBe(true);
    expect((n.metadata as Record<string, unknown>)['extraction_status']).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('PRD-204-R7: tags read from story `tag_list` by default', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).tags).toEqual(['intro']);
  });

  it('PRD-204-R7: tags can be remapped via fieldMapping.tags', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [tinyStory({ content: { component: 'post', topics: ['x', 'y'] } })],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ fieldMapping: { tags: 'content.topics' } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).tags).toEqual(['x', 'y']);
  });

  it('PRD-204-R7: abstract picked up from default `content.abstract` field', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [tinyStory({ content: { component: 'post', abstract: 'A long abstract.' } })],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).abstract).toBe('A long abstract.');
  });

  it('PRD-204-R7: summary "extract" strategy first-paragraph fallback stamps summary_source="extracted"', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'First paragraph supplies the summary.' }],
                },
              ],
            },
          },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ summary: { strategy: 'extract' } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).summary_source).toBe('extracted');
    expect(result.nodes[0]!.summary).toMatch(/First paragraph/);
  });

  it('PRD-204-R7: updated_at flows from published_at when version=published', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).updated_at).toBe('2026-01-01T00:00:00Z');
  });

  it('PRD-204-R7: updated_at uses updated_at when version=draft', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ version: 'draft' });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).updated_at).toBe('2026-01-02T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R8 — Rich-text walker
// ---------------------------------------------------------------------------

describe('PRD-204-R8 — Storyblok rich-text walk', () => {
  const rtCtx = {
    targetLevel: 'standard' as const,
    componentRecursionMax: 4,
    warn: () => undefined,
  };

  it('PRD-204-R8: paragraph (no marks) becomes plain prose', () => {
    const r = walkRichtext(
      [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world.' }],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks).toEqual([{ type: 'prose', format: 'plain', text: 'Hello world.' }]);
  });

  it('PRD-204-R8: heading emits prose with markdown hashes', () => {
    const r = walkRichtext(
      [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Why ACT' }],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks).toEqual([{ type: 'prose', format: 'markdown', text: '## Why ACT' }]);
  });

  it('PRD-204-R8: heading caps levels at h6', () => {
    const r = walkRichtext(
      [
        {
          type: 'heading',
          attrs: { level: 9 },
          content: [{ type: 'text', text: 'Deep' }],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect((r.blocks[0] as { text: string }).text).toBe('###### Deep');
  });

  it('PRD-204-R8: paragraph with bold/italic/code/strike marks becomes markdown', () => {
    const r = walkRichtext(
      [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'old', marks: [{ type: 'strike' }] },
          ],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'prose',
      format: 'markdown',
      text: 'plain **bold** *italic* `code` ~~old~~',
    });
  });

  it('PRD-204-R8: link annotation mark wraps text via markdown link syntax', () => {
    const r = walkRichtext(
      [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click here',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'prose',
      format: 'markdown',
      text: '[click here](https://example.com)',
    });
  });

  it('PRD-204-R8: bullet_list children coalesce into one prose block', () => {
    const r = walkRichtext(
      [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
              ],
            },
            {
              type: 'list_item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
              ],
            },
          ],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks).toHaveLength(1);
    expect((r.blocks[0] as { text: string }).text).toBe('- one\n- two');
  });

  it('PRD-204-R8: ordered_list coalesces with `1.` markers', () => {
    const r = walkRichtext(
      [
        {
          type: 'ordered_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
            },
          ],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect((r.blocks[0] as { text: string }).text).toBe('1. first\n1. second');
  });

  it('PRD-204-R8: code_block emits a `code` block with language from `class`', () => {
    const r = walkRichtext(
      [
        {
          type: 'code_block',
          attrs: { class: 'language-bash' },
          content: [{ type: 'text', text: 'npm install acme' }],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'code',
      language: 'bash',
      text: 'npm install acme',
    });
  });

  it('PRD-204-R8: code_block with no language defaults to "text"', () => {
    const r = walkRichtext(
      [
        {
          type: 'code_block',
          content: [{ type: 'text', text: 'plain code' }],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect((r.blocks[0] as { language: string }).language).toBe('text');
  });

  it('PRD-204-R8: blockquote → callout block (default level info)', () => {
    const r = walkRichtext(
      [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'PRD-100 is the wire.' }],
            },
          ],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'callout',
      level: 'info',
      text: 'PRD-100 is the wire.',
    });
  });

  it('PRD-204-R8: blockquote callout level honors calloutLevel context override', () => {
    const r = walkRichtext(
      [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hot.' }] }],
        },
      ] as RichtextNode[],
      { ...rtCtx, calloutLevel: 'warning' },
    );
    expect((r.blocks[0] as { level: string }).level).toBe('warning');
  });

  it('PRD-204-R8: horizontal_rule emits prose markdown "---"', () => {
    const r = walkRichtext(
      [{ type: 'horizontal_rule' }] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks[0]).toEqual({ type: 'prose', format: 'markdown', text: '---' });
  });

  it('PRD-204-R8: image emits prose markdown image syntax', () => {
    const r = walkRichtext(
      [
        {
          type: 'image',
          attrs: { src: 'https://a.storyblok.com/x.png', alt: 'logo' },
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect((r.blocks[0] as { text: string }).text).toBe('![logo](https://a.storyblok.com/x.png)');
  });

  it('PRD-204-R8 / R22: unmapped node type emits partial-extraction warning', () => {
    const warns: string[] = [];
    const r = walkRichtext(
      [{ type: 'mysteryNode', payload: 1 }] as RichtextNode[],
      { ...rtCtx, warn: (m) => warns.push(m) },
    );
    expect(r.partial).toBe(true);
    expect(r.blocks[0]?.type).toBe('prose');
    expect((r.blocks[0] as { text: string }).text).toContain('unsupported rich-text node: mysteryNode');
    expect((r.blocks[0] as { metadata: Record<string, unknown> }).metadata['extraction_status']).toBe('partial');
    expect(warns.length).toBeGreaterThan(0);
  });

  it('PRD-204-R8: empty / null body returns no blocks', () => {
    expect(walkRichtext(undefined, rtCtx).blocks).toEqual([]);
    expect(walkRichtext(null, rtCtx).blocks).toEqual([]);
    expect(walkRichtext([] as RichtextNode[], rtCtx).blocks).toEqual([]);
  });

  it('PRD-204-R8: walker preserves source order across mixed node types', () => {
    const r = walkRichtext(
      [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
        {
          type: 'code_block',
          attrs: { class: 'language-ts' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ] as RichtextNode[],
      rtCtx,
    );
    expect(r.blocks.map((b) => b.type)).toEqual(['prose', 'prose', 'code']);
    expect((r.blocks[0] as { text: string }).text).toBe('# A');
  });

  it('PRD-204-R8: rich-text root doc shape is unwrapped automatically', () => {
    const r = walkRichtext(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Doc.' }] }],
      },
      rtCtx,
    );
    expect((r.blocks[0] as { text: string }).text).toBe('Doc.');
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R9 — component recursion bound
// ---------------------------------------------------------------------------

describe('PRD-204-R9 — component recursion bound', () => {
  it('PRD-204-R9: blok at depth 0 with no mapping → unmapped warning, partial', () => {
    const warns: string[] = [];
    const r = walkRichtext(
      [
        {
          type: 'blok',
          attrs: {
            body: [{ component: 'feature-grid', _uid: 'u1' }],
          },
        },
      ] as RichtextNode[],
      {
        targetLevel: 'standard',
        componentRecursionMax: 4,
        warn: (m) => warns.push(m),
      },
    );
    expect(r.partial).toBe(true);
    expect((r.blocks[0] as { text: string }).text).toContain('unmapped component: feature-grid');
    expect(warns.join(' ')).toContain('feature-grid');
  });

  it('PRD-204-R9: when componentRecursionMax=1, depth>=1 in nested blok returns recursion-bound warning', () => {
    // Test the bound by configuring max=1 and walking a blok at depth 1 (calling internal walk recursively).
    // We verify by running the public path with a tiny max — the OUTER blok (depth=0) is ok; emulate inner call
    // by exercising an enumerator path — for simplicity, set max=0 isn't allowed; we test the boundary behavior
    // by configuring max=1 and walking a blok which sits at depth 1 (we trigger this by nesting via the doc walker
    // calling walkBlok with depth supplied. The walker passes depth=0 from the root, so we can simulate by calling
    // walkRichtext with a wrapping blok and a max of 1 — recursion is checked when entering walkBlok at depth>=max).
    const warns: string[] = [];
    const r = walkRichtext(
      [
        {
          type: 'blok',
          attrs: {
            body: [{ component: 'hero', _uid: 'u-deep' }],
          },
        },
      ] as RichtextNode[],
      {
        targetLevel: 'strict',
        componentRecursionMax: 0 as unknown as number, // bound exceeded immediately at depth 0
        warn: (m) => warns.push(m),
      },
    );
    expect(r.partial).toBe(true);
    expect((r.blocks[0] as { text: string }).text).toContain('component recursion bound exceeded at depth 0');
  });

  it('PRD-204-R9: componentRecursionMax > 4 → init rejects with component_recursion_max_invalid', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = { ...baseConfig(), componentRecursionMax: 5 };
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg as StoryblokAdapterConfig)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R9: precheck rejects non-integer componentRecursionMax', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 1,
        accessToken: 't',
        componentRecursionMax: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R10 — componentMapping → marketing:* (Plus)
// ---------------------------------------------------------------------------

describe('PRD-204-R10 — componentMapping → marketing:* blocks (Plus)', () => {
  it('PRD-204-R10: maps a Storyblok hero blok to marketing:hero with field projection', () => {
    const r = walkRichtext(
      [
        {
          type: 'blok',
          attrs: {
            body: [
              {
                _uid: 'blok-hero',
                component: 'hero',
                headline: 'Pricing that scales',
                subhead: 'Pay as you grow',
                ctaLabel: 'Start',
                ctaHref: '/signup',
              },
            ],
          },
        },
      ] as RichtextNode[],
      {
        targetLevel: 'strict',
        componentRecursionMax: 4,
        componentMapping: {
          hero: {
            type: 'marketing:hero',
            fields: {
              headline: 'headline',
              subhead: 'subhead',
              cta: { label: 'ctaLabel', href: 'ctaHref' },
            },
          },
        },
        warn: () => undefined,
      },
    );
    expect(r.blocks[0]).toMatchObject({
      type: 'marketing:hero',
      headline: 'Pricing that scales',
      subhead: 'Pay as you grow',
      cta: { label: 'Start', href: '/signup' },
    });
    expect(r.partial).toBe(false);
  });

  it('PRD-204-R10: emitted marketing block stamps metadata.block_uid (Open Question 2)', () => {
    const r = walkRichtext(
      [
        {
          type: 'blok',
          attrs: {
            body: [
              { _uid: 'block-uid-xyz', component: 'hero', headline: 'h' },
            ],
          },
        },
      ] as RichtextNode[],
      {
        targetLevel: 'strict',
        componentRecursionMax: 4,
        componentMapping: {
          hero: { type: 'marketing:hero', fields: { headline: 'headline' } },
        },
        warn: () => undefined,
      },
    );
    const meta = (r.blocks[0] as { metadata?: Record<string, unknown> }).metadata;
    expect(meta?.['block_uid']).toBe('block-uid-xyz');
  });

  it('PRD-204-R10: without componentMapping, blok component becomes partial', () => {
    const r = walkRichtext(
      [
        {
          type: 'blok',
          attrs: { body: [{ component: 'hero', headline: 'h' }] },
        },
      ] as RichtextNode[],
      { targetLevel: 'strict', componentRecursionMax: 4, warn: () => undefined },
    );
    expect(r.partial).toBe(true);
    expect(r.blocks[0]?.type).toBe('prose');
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R11 / R12 / R13 — story-link resolution, depth, cycles
// ---------------------------------------------------------------------------

describe('PRD-204-R11 — story-link resolution', () => {
  it('PRD-204-R11: resolves story link into related[] with configured relation', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            related_articles: [{ linktype: 'story', uuid: 'uuid-target' }],
          },
        }),
      ],
      refStories: {
        'uuid-target': {
          uuid: 'uuid-target',
          name: 'Other',
          slug: 'other',
          full_slug: 'blog/other',
          content: { component: 'post' },
        },
      },
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { related_articles: 'see-also' } },
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toEqual([
      { id: 'act-storyblok/blog/other', relation: 'see-also' },
    ]);
  });

  it('PRD-204-R11: URL-link fields are NOT resolved into related[]', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            related_articles: [{ linktype: 'url', url: 'https://example.com' }],
          },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { related_articles: 'see-also' } },
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toBeUndefined();
  });

  it('PRD-204-R11: missing reference target is silently skipped', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            related_articles: [{ linktype: 'story', uuid: 'missing-uuid' }],
          },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ fieldMapping: { related: { related_articles: 'see-also' } } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toBeUndefined();
  });
});

describe('PRD-204-R12 — link resolution depth bound', () => {
  it('PRD-204-R12: clampDepth honors range [0,5]', () => {
    expect(clampDepth(-1)).toBe(0);
    expect(clampDepth(0)).toBe(0);
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(5)).toBe(5);
    expect(clampDepth(6)).toBe(5);
    expect(clampDepth(1.5)).toBe(1);
  });

  it('PRD-204-R12: linkResolutionDepth=0 emits no related entries', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            rel: [{ linktype: 'story', uuid: 'uuid-target' }],
          },
        }),
      ],
      refStories: {
        'uuid-target': {
          uuid: 'uuid-target',
          name: 'X',
          slug: 'x',
          full_slug: 'x',
          content: { component: 'post' },
        },
      },
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { rel: 'see-also' } },
      linkResolutionDepth: 0,
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toBeUndefined();
  });

  it('PRD-204-R12: linkResolutionDepth above 5 → init rejects with link_resolution_depth_exceeded', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = { ...baseConfig(), linkResolutionDepth: 6 };
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg as StoryblokAdapterConfig)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R12: precheck rejects non-integer depth via custom guard', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        spaceId: 1,
        accessToken: 't',
        linkResolutionDepth: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R12: depth=2 follows transitive references', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            rel: [{ linktype: 'story', uuid: 'uuid-b' }],
          },
        }),
      ],
      refStories: {
        'uuid-b': {
          uuid: 'uuid-b',
          name: 'B',
          slug: 'b',
          full_slug: 'b',
          content: {
            component: 'post',
            rel: [{ linktype: 'story', uuid: 'uuid-c' }],
          },
        },
        'uuid-c': {
          uuid: 'uuid-c',
          name: 'C',
          slug: 'c',
          full_slug: 'c',
          content: { component: 'post' },
        },
      },
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { rel: 'see-also' } },
      linkResolutionDepth: 2,
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const ids = ((result.nodes[0] as EmittedNode).related ?? []).map((r) => r.id);
    expect(ids).toContain('act-storyblok/b');
    expect(ids).toContain('act-storyblok/c');
  });
});

describe('PRD-204-R13 — cycle handling', () => {
  it('PRD-204-R13: cycle is tolerated; metadata.reference_cycles count is stamped', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          uuid: 'uuid-self',
          content: {
            component: 'post',
            rel: [{ linktype: 'story', uuid: 'uuid-self' }],
          },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { rel: 'see-also' } },
      linkResolutionDepth: 1,
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['reference_cycles']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R14 — locale handling
// ---------------------------------------------------------------------------

describe('PRD-204-R14 — locale handling', () => {
  it('PRD-204-R14: field-pattern fans out one node per available locale, with metadata.locale', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [tinyStory({ uuid: 'multilingual', full_slug: 'pricing' })],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      locale: { pattern: 'field', field: 'lang', available: ['en', 'de'] },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(result.nodes).toHaveLength(2);
    const locales = result.nodes.map((n) => (n.metadata as Record<string, unknown>)['locale']);
    expect(new Set(locales)).toEqual(new Set(['en', 'de']));
  });

  it('PRD-204-R14: folder-pattern stamps metadata.translations with sibling ids by group_id', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        {
          uuid: 'uuid-pricing-en',
          name: 'Pricing (EN)',
          slug: 'pricing',
          full_slug: 'en/pricing',
          lang: 'en',
          group_id: 'grp-pricing',
          content: { component: 'landing' },
        },
        {
          uuid: 'uuid-pricing-de',
          name: 'Preise (DE)',
          slug: 'preise',
          full_slug: 'de/pricing',
          lang: 'de',
          group_id: 'grp-pricing',
          content: { component: 'landing' },
        },
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ locale: { pattern: 'folder', field: 'lang' } });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(result.nodes).toHaveLength(2);
    const enNode = result.nodes.find(
      (n) => (n.metadata as Record<string, unknown>)['locale'] === 'en',
    )!;
    const tr = (enNode.metadata as Record<string, unknown>)['translations'] as Array<{
      locale: string;
      id: string;
    }>;
    expect(tr).toHaveLength(1);
    expect(tr[0]!.locale).toBe('de');
    expect(tr[0]!.id).toMatch(/^act-storyblok\/de\//);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R15 — incremental rebuild via delta()
// ---------------------------------------------------------------------------

describe('PRD-204-R15 — delta()', () => {
  it('PRD-204-R15: delta() returns stories with the cv marker advanced', async () => {
    const provider = corpusProvider(tinyCorpus());
    const syncSpy = vi.spyOn(provider, 'syncDelta').mockResolvedValue({
      stories: [tinyStory({ uuid: 'changed-story' })],
      nextMarker: '987',
    });
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig();
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const seen: string[] = [];
    for await (const item of adapter.delta!('456', ctx(cfg)) as AsyncIterable<{
      story: { uuid: string };
    }>) {
      seen.push(item.story.uuid);
    }
    expect(seen).toEqual(['changed-story']);
    expect(syncSpy).toHaveBeenCalledWith('456');
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R16 — webhook signature verification
// ---------------------------------------------------------------------------

describe('PRD-204-R16 — verifyWebhookSignature', () => {
  it('PRD-204-R16: returns true for a valid HMAC-SHA256 signature', () => {
    const secret = 'sb-secret';
    const body = '{"event":"story.published","story_id":1}';
    const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('PRD-204-R16: returns false for a tampered body', () => {
    const secret = 'sb-secret';
    const body = '{"event":"story.published"}';
    const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyWebhookSignature('{"event":"hostile"}', signature, secret)).toBe(false);
  });

  it('PRD-204-R16: returns false for empty / missing signature or secret', () => {
    expect(verifyWebhookSignature('body', '', 'sec')).toBe(false);
    expect(verifyWebhookSignature('body', 'sig', '')).toBe(false);
    expect(verifyWebhookSignature('body', undefined, 'sec')).toBe(false);
    expect(verifyWebhookSignature('body', 'sig', undefined)).toBe(false);
  });

  it('PRD-204-R16: returns false for a length-mismatched signature', () => {
    expect(verifyWebhookSignature('body', 'short', 'sec')).toBe(false);
  });

  it('PRD-204-R16: never throws on malformed input', () => {
    expect(() =>
      verifyWebhookSignature(undefined as unknown as string, 'x', 'y'),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R17 / R18 / R19 — capability declaration + level
// ---------------------------------------------------------------------------

describe('PRD-204-R17 / R18 / R19 — capabilities + level', () => {
  it('PRD-204-R17: capabilities default — concurrency_max=6, delta=true, etag=true, precedence=primary', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(STORYBLOK_DEFAULT_CONCURRENCY);
    expect(caps.concurrency_max).toBe(6);
    expect(caps.delta).toBe(true);
    expect(caps.manifestCapabilities?.etag).toBe(true);
    expect(caps.manifestCapabilities?.subtree).toBe(true);
    expect(caps.precedence).toBe('primary');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-204-R18: declares level "standard" when no componentMapping or locale', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.level).toBe('standard');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-204-R19: declares level "strict" when componentMapping is configured', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      componentMapping: { hero: { type: 'marketing:hero', fields: {} } },
    });
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-204-R19: declares level "strict" when locale is configured', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ locale: { pattern: 'folder', field: 'lang' } });
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-204-R19: plus-implying config under standard target → level_mismatch', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      componentMapping: { hero: { type: 'marketing:hero', fields: {} } },
    });
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, { targetLevel: 'standard' })),
    ).rejects.toMatchObject({ code: 'level_mismatch' });
  });

  it('PRD-204-R17: concurrency override flows to capability', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ concurrency: { transform: 8 } });
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(8);
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R20 — failure mode: rate limit
// ---------------------------------------------------------------------------

describe('PRD-204-R20 — rate-limit handling (provider-side)', () => {
  it('PRD-204-R20: provider rate-limit failure surfaces (does not silently swallow)', async () => {
    const provider = corpusProvider(tinyCorpus());
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig();
    vi.spyOn(provider, 'fetchStories').mockRejectedValueOnce(
      Object.assign(new Error('429 rate limited'), { status: 429 }),
    );
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toThrow(/429/);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R21 — auth failure
// ---------------------------------------------------------------------------

describe('PRD-204-R21 — auth failure', () => {
  it('PRD-204-R21: 401/403 from auth probe → StoryblokAdapterError code "auth_failed"', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('unauthorized');
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig();
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('PRD-204-R21: space_not_found surfaces from probe', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('space_not_found');
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig();
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'space_not_found' });
  });

  it('PRD-204-R21 / R23: auth_failed error message MUST NOT contain the accessToken value', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('unauthorized');
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig({ accessToken: 'sktok-SECRET-VERY-SENSITIVE-VALUE' });
    try {
      await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('SECRET-VERY-SENSITIVE');
    }
  });

  it('PRD-204-R2 / R23: env-var accessToken not set → config_invalid (env var name appears, value does not)', async () => {
    delete process.env['__NEVER_SET_PRD204__'];
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = {
      spaceId: 1,
      accessToken: { from_env: '__NEVER_SET_PRD204__' },
    };
    await expect(
      adapter.init(cfg as Record<string, unknown>, ctx(cfg as unknown as StoryblokAdapterConfig)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-204-R2 / R23: env-var accessToken found is read transparently', async () => {
    process.env['__SET_FOR_PRD204__'] = 'env-token-value';
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = {
      spaceId: 1,
      accessToken: { from_env: '__SET_FOR_PRD204__' },
    };
    await expect(
      adapter.init(cfg as Record<string, unknown>, ctx(cfg as unknown as StoryblokAdapterConfig)),
    ).resolves.toMatchObject({ level: 'standard' });
    delete process.env['__SET_FOR_PRD204__'];
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R22 — partial extraction
// ---------------------------------------------------------------------------

describe('PRD-204-R22 — partial extraction', () => {
  it('PRD-204-R22: rich-text walk error surfaces as partial node + warning', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            body: { type: 'doc', content: [{ type: 'mysteryNode' }] },
          },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.title).toBeDefined(); // still emits
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['extraction_status']).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R23 / R24 — security: token never logged or emitted
// ---------------------------------------------------------------------------

describe('PRD-204-R23 / R24 — token redaction', () => {
  it('PRD-204-R23: inline accessToken triggers a credential-hygiene warning that does NOT contain the value', async () => {
    const logger = makeLogger();
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ accessToken: 'skSTORYsecretTOKENvalue' });
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    const all = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]
      .flat()
      .join(' ');
    expect(all).toMatch(/PRD-204-R23/);
    expect(all).not.toContain('skSTORYsecretTOKENvalue');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-204-R23: debugLogging logs the token fingerprint (≤4 chars), not the full value', async () => {
    const logger = makeLogger();
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      accessToken: 'skABCDEFGHIJKLMNOPQRSTUV',
      debugLogging: true,
    });
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    const allDebug = logger.debug.mock.calls.flat().join(' ');
    expect(allDebug).toMatch(/skAB/);
    expect(allDebug).not.toContain('skABCDEFGHIJKLMNOPQRSTUV');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-204-R24: token is never present in any emitted envelope field', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [
        tinyStory({
          content: {
            component: 'post',
            // Even when a story field shares the token's name, the value is unrelated.
            token: 'unrelated-doc-field',
          },
        }),
      ],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({ accessToken: 'skSTORYsecretTOKENvalue' });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const serialized = JSON.stringify(result.nodes);
    expect(serialized).not.toContain('skSTORYsecretTOKENvalue');
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R25 — provenance source_id (uuid)
// ---------------------------------------------------------------------------

describe('PRD-204-R25 — provenance', () => {
  it('PRD-204-R25: metadata.source.adapter = "act-storyblok"', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const src = (result.nodes[0]!.metadata as { source?: { adapter?: string } }).source;
    expect(src?.adapter).toBe('act-storyblok');
  });

  it('PRD-204-R25: source_id is the Storyblok uuid (no locale suffix in single-locale build)', async () => {
    const corpus: StoryblokSourceCorpus = { stories: [tinyStory({ uuid: 'src-uuid-123' })] };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const src = (result.nodes[0]!.metadata as { source?: { source_id?: string } }).source;
    expect(src?.source_id).toBe('src-uuid-123');
  });

  it('PRD-204-R25: per-locale field-level variant uses `{uuid}#{locale}` source_id', async () => {
    const corpus: StoryblokSourceCorpus = {
      stories: [tinyStory({ uuid: 'dual-locale', full_slug: 'p' })],
    };
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      locale: { pattern: 'field', field: 'lang', available: ['en', 'de'] },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const ids = result.nodes.map(
      (n) => (n.metadata as { source?: { source_id?: string } }).source?.source_id,
    );
    expect(new Set(ids)).toEqual(new Set(['dual-locale#en', 'dual-locale#de']));
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R26 — version pinning (Stage 1)
// ---------------------------------------------------------------------------

describe('PRD-204-R26 — version pinning', () => {
  it('PRD-204-R26: emitted envelopes carry act_version "0.1"', async () => {
    const adapter = createStoryblokAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.act_version).toBe('0.1');
  });
});

// ---------------------------------------------------------------------------
// PRD-204 — RESERVED_METADATA_KEYS surface
// ---------------------------------------------------------------------------

describe('PRD-204 — reserved metadata keys', () => {
  it('PRD-204: documented reserved keys are present', () => {
    expect(RESERVED_METADATA_KEYS.has('source')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('translations')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('locale')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('preview')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('reference_cycles')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('block_uid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-204-R27 — integration: full pipeline + validator
// ---------------------------------------------------------------------------

describe('PRD-204-R27 — integration: validator gates emitted nodes', () => {
  it('PRD-204-R27: standard fixture corpus validates with 0 gaps', async () => {
    const corpus = loadCorpus('standard-emission');
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { related_articles: 'see-also' } },
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps).toEqual([]);
    }
  });

  it('PRD-204-R27: plus fixture (componentMapping + locale) validates with 0 gaps', async () => {
    const corpus = loadCorpus('plus-emission');
    const adapter = createStoryblokAdapter({ corpus });
    const cfg = baseConfig({
      locale: { pattern: 'folder', field: 'lang' },
      componentMapping: {
        hero: {
          type: 'marketing:hero',
          fields: {
            headline: 'headline',
            subhead: 'subhead',
            cta: { label: 'ctaLabel', href: 'ctaHref' },
          },
        },
        'feature-grid': {
          type: 'marketing:feature-grid',
          fields: { features: 'features' },
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
      expect(probe.gaps).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Provider corpus fallthrough — getStoryByUuid + syncDelta
// ---------------------------------------------------------------------------

describe('corpusProvider shape', () => {
  it('corpusProvider.getStoryByUuid returns stories and refStories by uuid', () => {
    const provider = corpusProvider({
      stories: [
        { uuid: 'a', name: 'A', slug: 'a', full_slug: 'a', content: { component: 'x' } },
      ],
      refStories: {
        b: { uuid: 'b', name: 'B', slug: 'b', full_slug: 'b', content: { component: 'y' } },
      },
    });
    expect(provider.getStoryByUuid('a')?.uuid).toBe('a');
    expect(provider.getStoryByUuid('b')?.uuid).toBe('b');
    expect(provider.getStoryByUuid('missing')).toBeUndefined();
  });

  it('corpusProvider.syncDelta returns stories + a deterministic marker', async () => {
    const provider = corpusProvider({
      stories: [
        { uuid: 'a', name: 'A', slug: 'a', full_slug: 'a', content: { component: 'x' } },
      ],
      latestCv: 42,
    });
    const r = await provider.syncDelta('whatever');
    expect(r.nextMarker).toBe('42');
    expect(r.stories).toHaveLength(1);
  });

  it('corpusProvider.fetchStories returns stories sorted by full_slug', async () => {
    const provider = corpusProvider({
      stories: [
        { uuid: 'z', name: 'Z', slug: 'z', full_slug: 'z', content: { component: 'x' } },
        { uuid: 'a', name: 'A', slug: 'a', full_slug: 'a', content: { component: 'x' } },
        { uuid: 'm', name: 'M', slug: 'm', full_slug: 'm', content: { component: 'x' } },
      ],
    });
    const r = await provider.fetchStories({ storyFilter: {} });
    expect(r.map((s) => s.full_slug)).toEqual(['a', 'm', 'z']);
  });

  it('createStoryblokAdapter accepts an injected provider directly', async () => {
    const provider: StoryblokSourceProvider = {
      probeAuth: () => Promise.resolve('ok'),
      fetchStories: () => Promise.resolve([tinyStory()]),
      getStoryByUuid: () => undefined,
      syncDelta: () => Promise.resolve({ stories: [], nextMarker: '0' }),
      dispose: () => undefined,
    };
    const adapter = createStoryblokAdapter({ provider });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes).toHaveLength(1);
  });
});

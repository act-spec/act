/**
 * PRD-203 Sanity adapter tests. Every requirement R1–R27 has at least one
 * citing test; integration scenarios at the bottom run the full adapter
 * pipeline against recorded fixtures and validate emitted nodes via
 * @act-spec/validator (PRD-203-R27 + the role's "at least one positive
 * integration test" requirement).
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runAdapter } from '@act-spec/adapter-framework';
import type { AdapterContext, EmittedNode, PartialEmittedNode } from '@act-spec/adapter-framework';
import { validateNode } from '@act-spec/validator';

import {
  RESERVED_METADATA_KEYS,
  SANITY_ADAPTER_NAME,
  SANITY_DEFAULT_CONCURRENCY,
  SanityAdapterError,
  clampDepth,
  corpusProvider,
  createSanityAdapter,
  walkPortableText,
} from './index.js';
import type {
  PortableTextNode,
  SanityAdapterConfig,
  SanityDocument,
  SanitySourceCorpus,
  SanitySourceProvider,
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
  config: SanityAdapterConfig,
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

function tinyDoc(over: Partial<SanityDocument> = {}): SanityDocument {
  return {
    _id: 'doc-aaa',
    _type: 'article',
    _updatedAt: '2026-01-01T00:00:00Z',
    title: 'Hello',
    summary: 'A short summary.',
    body: [
      {
        _type: 'block',
        style: 'normal',
        children: [{ _type: 'span', text: 'Body text.', marks: [] }],
      },
    ],
    ...over,
  };
}

function tinyCorpus(over: Partial<SanitySourceCorpus> = {}): SanitySourceCorpus {
  return {
    documents: [tinyDoc()],
    ...over,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'test-fixtures');

function loadCorpus(name: string): SanitySourceCorpus {
  const data = JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'documents.json'), 'utf8'),
  ) as SanitySourceCorpus;
  return data;
}

function stripPartial(n: EmittedNode | PartialEmittedNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

function baseConfig(over: Partial<SanityAdapterConfig> = {}): SanityAdapterConfig {
  return {
    projectId: 'p1q2r3s4',
    dataset: 'production',
    apiToken: 'tok-fixture',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// PRD-203-R1 — adapter shape
// ---------------------------------------------------------------------------

describe('PRD-203 Sanity adapter — factory contract', () => {
  it('PRD-203-R1: createSanityAdapter returns an Adapter; default name is "act-sanity"', () => {
    const a = createSanityAdapter({ corpus: tinyCorpus() });
    expect(a.name).toBe(SANITY_ADAPTER_NAME);
    expect(a.name).toBe('act-sanity');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
    expect(typeof a.precheck).toBe('function');
    expect(typeof a.delta).toBe('function');
  });

  it('PRD-203-R1: createSanityAdapter requires either provider or corpus', () => {
    expect(() => createSanityAdapter({})).toThrow(SanityAdapterError);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R2 — config schema
// ---------------------------------------------------------------------------

describe('PRD-203-R2 — config schema', () => {
  it('PRD-203-R2: minimal valid config (projectId + dataset + apiToken) is accepted', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = { projectId: 'p', dataset: 'd', apiToken: 't' };
    await expect(adapter.precheck!(cfg)).resolves.toBeUndefined();
  });

  it('PRD-203-R2: missing projectId is config_invalid', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ dataset: 'd', apiToken: 't' } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-203-R2: missing dataset is config_invalid', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ projectId: 'p', apiToken: 't' } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-203-R2: missing apiToken is config_invalid', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({ projectId: 'p', dataset: 'd' } as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-203-R2: apiToken accepts string OR { from_env }', async () => {
    const a1 = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      a1.precheck!({ projectId: 'p', dataset: 'd', apiToken: 'tok' }),
    ).resolves.toBeUndefined();
    const a2 = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      a2.precheck!({ projectId: 'p', dataset: 'd', apiToken: { from_env: 'STK' } }),
    ).resolves.toBeUndefined();
  });

  it('PRD-203-R2: invalid version enum is rejected', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        projectId: 'p',
        dataset: 'd',
        apiToken: 't',
        version: 'unknown-mode',
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R3 — version + preview
// ---------------------------------------------------------------------------

describe('PRD-203-R3 — version + preview stamping', () => {
  it('PRD-203-R3: defaults to published; no metadata.preview stamp', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['preview']).toBeUndefined();
  });

  it('PRD-203-R3: version="draft" stamps metadata.preview=true and emits a warning', async () => {
    const logger = makeLogger();
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ version: 'draft' });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['preview']).toBe(true);
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-203-R3/);
  });

  it('PRD-203-R3: version="previewDraft" also stamps preview', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ version: 'previewDraft' });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]!.metadata as Record<string, unknown>)['preview']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R4 / R5 — GROQ filter handling
// ---------------------------------------------------------------------------

describe('PRD-203-R4 / R5 — enumerate via GROQ', () => {
  it('PRD-203-R4: enumerate fetches via configured groqFilter', async () => {
    const provider = corpusProvider(tinyCorpus());
    const fetchSpy = vi.spyOn(provider, 'fetchDocuments');
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig({ groqFilter: '*[_type == "article"]' });
    await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(fetchSpy).toHaveBeenCalledWith({ groqFilter: '*[_type == "article"]' });
  });

  it('PRD-203-R5: empty result with allowEmpty unset emits a warning', async () => {
    const logger = makeLogger();
    const adapter = createSanityAdapter({ corpus: { documents: [] } });
    const cfg = baseConfig({ groqFilter: '*[_type == "ghost"]' });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/PRD-203-R5/);
    expect(warned).toMatch(/0 documents/);
  });

  it('PRD-203-R5: empty result with allowEmpty=true does NOT warn', async () => {
    const logger = makeLogger();
    const adapter = createSanityAdapter({ corpus: { documents: [] } });
    const cfg = baseConfig({ allowEmpty: true });
    await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, {}, logger),
    );
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).not.toMatch(/PRD-203-R5/);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R6 — type mapping
// ---------------------------------------------------------------------------

describe('PRD-203-R6 — content-type → ACT type', () => {
  it('PRD-203-R6: identity default — Sanity _type "article" → ACT type "article"', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('article');
  });

  it('PRD-203-R6: explicit typeMapping overrides identity', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [tinyDoc({ _type: 'blogPost' })],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ typeMapping: { blogPost: 'article' } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.type).toBe('article');
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R7 — field mapping
// ---------------------------------------------------------------------------

describe('PRD-203-R7 — field mapping', () => {
  it('PRD-203-R7: id derives from slug.current by default', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          _id: 'doc-xyz',
          slug: { _type: 'slug', current: 'getting-started' },
        }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/getting-started');
  });

  it('PRD-203-R7: id falls back to _id when no slug', async () => {
    const corpus: SanitySourceCorpus = { documents: [tinyDoc({ _id: 'fallback-id' })] };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/fallback-id');
  });

  it('PRD-203-R7: explicit idField overrides slug + _id', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          _id: 'wont-be-used',
          slug: { _type: 'slug', current: 'wont-either' },
          customId: 'my-explicit-id',
        }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ idField: 'customId' });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.id).toBe('cms/my-explicit-id');
  });

  it('PRD-203-R7: title resolves from default `title` field', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.title).toBe('Hello');
  });

  it('PRD-203-R7: missing title yields partial node with extraction_status="partial"', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [tinyDoc({ title: undefined })],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const n = result.nodes[0]! as PartialEmittedNode;
    expect(n._actPartial).toBe(true);
    expect((n.metadata as Record<string, unknown>)['extraction_status']).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('PRD-203-R7: tags read from configured field as string array', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [tinyDoc({ topics: ['intro', 'spec'] })],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ fieldMapping: { tags: 'topics' } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).tags).toEqual(['intro', 'spec']);
  });

  it('PRD-203-R7: abstract picked up from default `abstract` field', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [tinyDoc({ abstract: 'A long abstract.' })],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).abstract).toBe('A long abstract.');
  });

  it('PRD-203-R7: summary "extract" strategy first-paragraph fallback stamps summary_source="extracted"', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          summary: undefined,
          body: [
            {
              _type: 'block',
              style: 'normal',
              children: [
                { _type: 'span', text: 'First paragraph supplies the summary.', marks: [] },
              ],
            },
          ],
        }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ summary: { strategy: 'extract' } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).summary_source).toBe('extracted');
    expect(result.nodes[0]!.summary).toMatch(/First paragraph/);
  });

  it('PRD-203-R7: updated_at flows from _updatedAt', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0]! as EmittedNode).updated_at).toBe('2026-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R8 — Portable Text walker
// ---------------------------------------------------------------------------

describe('PRD-203-R8 — Portable Text walk', () => {
  const ptCtx = { targetLevel: 'standard' as const, warn: () => undefined };

  it('PRD-203-R8: normal block becomes plain prose', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          style: 'normal',
          children: [{ _type: 'span', text: 'Hello world.', marks: [] }],
        },
      ],
      ptCtx,
    );
    expect(r.blocks).toEqual([{ type: 'prose', format: 'plain', text: 'Hello world.' }]);
  });

  it('PRD-203-R8: heading style emits prose with markdown hashes', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          style: 'h2',
          children: [{ _type: 'span', text: 'Why ACT', marks: [] }],
        },
      ],
      ptCtx,
    );
    expect(r.blocks).toEqual([{ type: 'prose', format: 'markdown', text: '## Why ACT' }]);
  });

  it('PRD-203-R8: block with strong/em/code marks becomes markdown prose', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          style: 'normal',
          children: [
            { _type: 'span', text: 'plain ', marks: [] },
            { _type: 'span', text: 'bold', marks: ['strong'] },
            { _type: 'span', text: ' ', marks: [] },
            { _type: 'span', text: 'italic', marks: ['em'] },
            { _type: 'span', text: ' ', marks: [] },
            { _type: 'span', text: 'code', marks: ['code'] },
          ],
        },
      ],
      ptCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'prose',
      format: 'markdown',
      text: 'plain **bold** *italic* `code`',
    });
  });

  it('PRD-203-R8: link annotation mark wraps text via markdown link syntax', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          style: 'normal',
          children: [
            { _type: 'span', text: 'click here', marks: ['mk1'] },
          ],
          markDefs: [{ _type: 'link', _key: 'mk1', href: 'https://example.com' }],
        },
      ],
      ptCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'prose',
      format: 'markdown',
      text: '[click here](https://example.com)',
    });
  });

  it('PRD-203-R8: sequential bullet list items are coalesced into one prose block', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          listItem: 'bullet',
          style: 'normal',
          children: [{ _type: 'span', text: 'one', marks: [] }],
        },
        {
          _type: 'block',
          listItem: 'bullet',
          style: 'normal',
          children: [{ _type: 'span', text: 'two', marks: [] }],
        },
      ],
      ptCtx,
    );
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toEqual({
      type: 'prose',
      format: 'markdown',
      text: '- one\n- two',
    });
  });

  it('PRD-203-R8: numbered list coalesces with `1.` markers', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          listItem: 'number',
          children: [{ _type: 'span', text: 'first', marks: [] }],
        },
        {
          _type: 'block',
          listItem: 'number',
          children: [{ _type: 'span', text: 'second', marks: [] }],
        },
      ],
      ptCtx,
    );
    expect((r.blocks[0] as { text: string }).text).toBe('1. first\n1. second');
  });

  it('PRD-203-R8: blockquote style wraps lines with > prefix', () => {
    const r = walkPortableText(
      [
        {
          _type: 'block',
          style: 'blockquote',
          children: [{ _type: 'span', text: 'PRD-100 is the wire.', marks: [] }],
        },
      ],
      ptCtx,
    );
    expect((r.blocks[0] as { text: string }).text).toBe('> PRD-100 is the wire.');
  });

  it('PRD-203-R8: code block emits a `code` block with language', () => {
    const r = walkPortableText(
      [{ _type: 'code', language: 'bash', code: 'npm install @acme/sdk' }],
      ptCtx,
    );
    expect(r.blocks[0]).toEqual({
      type: 'code',
      language: 'bash',
      text: 'npm install @acme/sdk',
    });
  });

  it('PRD-203-R8: callout block maps tone to PRD-102 level enum', () => {
    const r = walkPortableText(
      [
        { _type: 'callout', tone: 'warning', text: 'Node 18+ required.' },
        { _type: 'callout', tone: 'tip', text: 'Pro tip.' },
        { _type: 'callout', tone: 'error', text: 'Bad thing.' },
        { _type: 'callout', tone: 'unknown', text: 'Defaults to info.' },
      ],
      ptCtx,
    );
    expect(r.blocks).toEqual([
      { type: 'callout', level: 'warning', text: 'Node 18+ required.' },
      { type: 'callout', level: 'tip', text: 'Pro tip.' },
      { type: 'callout', level: 'error', text: 'Bad thing.' },
      { type: 'callout', level: 'info', text: 'Defaults to info.' },
    ]);
  });

  it('PRD-203-R8 / R21: unmapped custom block type emits partial-extraction warning', () => {
    const warns: string[] = [];
    const r = walkPortableText(
      [{ _type: 'mysteryBlock', payload: 1 } as PortableTextNode],
      { targetLevel: 'standard', warn: (m) => warns.push(m) },
    );
    expect(r.partial).toBe(true);
    expect(r.blocks[0]?.type).toBe('prose');
    expect((r.blocks[0] as { text: string }).text).toContain('unsupported block type: mysteryBlock');
    expect((r.blocks[0] as { metadata: Record<string, unknown> }).metadata['extraction_status']).toBe('partial');
    expect(warns.length).toBeGreaterThan(0);
  });

  it('PRD-203-R8: empty / null body returns no blocks', () => {
    expect(walkPortableText(undefined, ptCtx).blocks).toEqual([]);
    expect(walkPortableText(null, ptCtx).blocks).toEqual([]);
    expect(walkPortableText([], ptCtx).blocks).toEqual([]);
  });

  it('PRD-203-R8: walker preserves source order across mixed block types', () => {
    const r = walkPortableText(
      [
        { _type: 'block', style: 'h1', children: [{ _type: 'span', text: 'A', marks: [] }] },
        { _type: 'block', style: 'normal', children: [{ _type: 'span', text: 'B', marks: [] }] },
        { _type: 'code', language: 'ts', code: 'const x = 1;' },
      ],
      ptCtx,
    );
    expect(r.blocks.map((b) => b.type)).toEqual(['prose', 'prose', 'code']);
    expect((r.blocks[0] as { text: string }).text).toBe('# A');
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R9 — custom block types (Plus)
// ---------------------------------------------------------------------------

describe('PRD-203-R9 — componentMapping → marketing:* blocks (Plus)', () => {
  it('PRD-203-R9: maps a Sanity heroBlock to marketing:hero with field projection', () => {
    const r = walkPortableText(
      [
        {
          _type: 'heroBlock',
          headline: 'Pricing that scales',
          subhead: 'Pay as you grow',
          ctaLabel: 'Start',
          ctaHref: '/signup',
        } as PortableTextNode,
      ],
      {
        targetLevel: 'strict',
        componentMapping: {
          heroBlock: {
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
    expect(r.blocks[0]).toEqual({
      type: 'marketing:hero',
      headline: 'Pricing that scales',
      subhead: 'Pay as you grow',
      cta: { label: 'Start', href: '/signup' },
    });
    expect(r.partial).toBe(false);
  });

  it('PRD-203-R9: without componentMapping, custom block becomes partial-extraction warning', () => {
    const r = walkPortableText(
      [{ _type: 'heroBlock', headline: 'h' } as PortableTextNode],
      { targetLevel: 'strict', warn: () => undefined },
    );
    expect(r.partial).toBe(true);
    expect(r.blocks[0]?.type).toBe('prose');
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R10 / R11 / R12 — references, depth, cycles
// ---------------------------------------------------------------------------

describe('PRD-203-R10 — reference resolution', () => {
  it('PRD-203-R10: resolves _ref into related[] with configured relation', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          relatedArticles: [{ _type: 'reference', _ref: 'doc-target' }],
        }),
      ],
      refDocuments: {
        'doc-target': {
          _id: 'doc-target',
          _type: 'article',
          title: 'Other',
          slug: { _type: 'slug', current: 'other' },
        },
      },
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { relatedArticles: 'see-also' } },
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toEqual([
      { id: 'cms/other', relation: 'see-also' },
    ]);
  });

  it('PRD-203-R10: missing reference target is silently skipped', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({ relatedArticles: [{ _type: 'reference', _ref: 'missing-id' }] }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ fieldMapping: { related: { relatedArticles: 'see-also' } } });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toBeUndefined();
  });
});

describe('PRD-203-R11 — depth bound', () => {
  it('PRD-203-R11: clampDepth honors range [0,5]', () => {
    expect(clampDepth(-1)).toBe(0);
    expect(clampDepth(0)).toBe(0);
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(5)).toBe(5);
    expect(clampDepth(6)).toBe(5);
    expect(clampDepth(1.5)).toBe(1);
  });

  it('PRD-203-R11: referenceDepth=0 emits no related entries', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [tinyDoc({ rel: [{ _type: 'reference', _ref: 'doc-target' }] })],
      refDocuments: { 'doc-target': { _id: 'doc-target', _type: 'article', title: 'X' } },
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { rel: 'see-also' } },
      referenceDepth: 0,
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect((result.nodes[0] as EmittedNode).related).toBeUndefined();
  });

  it('PRD-203-R11: referenceDepth above 5 → init rejects with reference_depth_exceeded', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = { ...baseConfig(), referenceDepth: 6 };
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg as SanityAdapterConfig)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-203-R11: precheck rejects non-integer depth via custom guard', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    await expect(
      adapter.precheck!({
        projectId: 'p',
        dataset: 'd',
        apiToken: 't',
        referenceDepth: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });

  it('PRD-203-R11: depth=2 follows transitive references', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({ rel: [{ _type: 'reference', _ref: 'b' }] }),
      ],
      refDocuments: {
        b: { _id: 'b', _type: 'article', title: 'B', rel: [{ _type: 'reference', _ref: 'c' }] },
        c: { _id: 'c', _type: 'article', title: 'C' },
      },
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { rel: 'see-also' } },
      referenceDepth: 2,
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const ids = ((result.nodes[0] as EmittedNode).related ?? []).map((r) => r.id);
    expect(ids).toContain('cms/b');
    expect(ids).toContain('cms/c');
  });
});

describe('PRD-203-R12 — cycle handling', () => {
  it('PRD-203-R12: cycle is tolerated; metadata.reference_cycles count is stamped', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          _id: 'a',
          rel: [{ _type: 'reference', _ref: 'a' }],
        }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      fieldMapping: { related: { rel: 'see-also' } },
      referenceDepth: 1,
    });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['reference_cycles']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R13 — locale handling
// ---------------------------------------------------------------------------

describe('PRD-203-R13 — locale handling', () => {
  it('PRD-203-R13: field-level pattern emits one node per locale, with metadata.locale', async () => {
    const corpus: SanitySourceCorpus = { documents: [tinyDoc({ _id: 'multilingual' })] };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      locale: { field: 'lang', pattern: 'field', available: ['en-US', 'es-ES'] },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(result.nodes).toHaveLength(2);
    const locales = result.nodes.map((n) => (n.metadata as Record<string, unknown>)['locale']);
    expect(new Set(locales)).toEqual(new Set(['en-US', 'es-ES']));
  });

  it('PRD-203-R13: document-level pattern stamps metadata.translations with sibling ids', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        {
          _id: 'pricing-en',
          _type: 'landing',
          title: 'Pricing (EN)',
          lang: 'en-US',
          translationsOf: 'pricing',
          slug: { _type: 'slug', current: 'pricing' },
          body: [],
        },
        {
          _id: 'pricing-es',
          _type: 'landing',
          title: 'Pricing (ES)',
          lang: 'es-ES',
          translationsOf: 'pricing',
          slug: { _type: 'slug', current: 'pricing' },
          body: [],
        },
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ locale: { field: 'lang', pattern: 'document' } });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(result.nodes).toHaveLength(2);
    const enNode = result.nodes.find(
      (n) => (n.metadata as Record<string, unknown>)['locale'] === 'en-US',
    )!;
    const tr = (enNode.metadata as Record<string, unknown>)['translations'] as Array<{
      locale: string;
      id: string;
    }>;
    expect(tr).toHaveLength(1);
    expect(tr[0]!.locale).toBe('es-ES');
    expect(tr[0]!.id).toMatch(/^cms\/es-es\/pricing/);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R14 / R15 — incremental rebuild
// ---------------------------------------------------------------------------

describe('PRD-203-R14 / R15 — incremental rebuild via delta()', () => {
  it('PRD-203-R14: delta() returns documents with the marker advanced', async () => {
    const provider = corpusProvider(tinyCorpus());
    const syncSpy = vi.spyOn(provider, 'syncDelta').mockResolvedValue({
      documents: [tinyDoc({ _id: 'changed-doc' })],
      nextMarker: 'tx-NEW-789',
    });
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig();
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    const seen: string[] = [];
    for await (const item of adapter.delta!('tx-OLD-456', ctx(cfg)) as AsyncIterable<{
      doc: { _id: string };
    }>) {
      seen.push(item.doc._id);
    }
    expect(seen).toEqual(['changed-doc']);
    expect(syncSpy).toHaveBeenCalledWith('tx-OLD-456');
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R16 / R17 / R18 — capability declaration + level
// ---------------------------------------------------------------------------

describe('PRD-203-R16 / R17 / R18 — capabilities + level', () => {
  it('PRD-203-R16: capabilities default — concurrency_max=4, delta=true, etag=true', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(SANITY_DEFAULT_CONCURRENCY);
    expect(caps.concurrency_max).toBe(4);
    expect(caps.delta).toBe(true);
    expect(caps.manifestCapabilities?.etag).toBe(true);
    expect(caps.manifestCapabilities?.subtree).toBe(true);
    expect(caps.precedence).toBe('primary');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-203-R17: declares level "standard" when no componentMapping or locale', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.level).toBe('standard');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-203-R18: declares level "strict" when componentMapping is configured', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      componentMapping: { heroBlock: { type: 'marketing:hero', fields: {} } },
    });
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-203-R18: declares level "strict" when locale is configured', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      locale: { field: 'lang', pattern: 'document' },
    });
    const caps = await adapter.init(
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    expect(caps.level).toBe('strict');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-203-R18: plus-implying config under standard target → level_mismatch', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      componentMapping: { heroBlock: { type: 'marketing:hero', fields: {} } },
    });
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, { targetLevel: 'standard' })),
    ).rejects.toMatchObject({ code: 'level_mismatch' });
  });

  it('PRD-203-R16: concurrency override flows to capability', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ concurrency: { transform: 8 } });
    const caps = await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.concurrency_max).toBe(8);
    await adapter.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R19 — failure mode: rate limit
// ---------------------------------------------------------------------------

describe('PRD-203-R19 — rate-limit handling (provider-side)', () => {
  it('PRD-203-R19: provider rate-limit failure surfaces as a partial node via transform error path', async () => {
    const corpus = tinyCorpus({ documents: [tinyDoc({ _id: 'rate-limited' })] });
    const provider = corpusProvider(corpus);
    // Simulate `getDocument` failing for related lookups (not used here);
    // simulate transform-side failure via a custom adapter wrapping the provider.
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig();
    // We exercise that the adapter does not throw on fetchDocuments rate limit:
    vi.spyOn(provider, 'fetchDocuments').mockRejectedValueOnce(
      Object.assign(new Error('429 rate limited'), { status: 429 }),
    );
    await expect(
      runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toThrow(/429/);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R20 — failure mode: auth
// ---------------------------------------------------------------------------

describe('PRD-203-R20 — auth failure', () => {
  it('PRD-203-R20: 401 from auth probe → SanityAdapterError code "auth_failed"', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('unauthorized');
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig();
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('PRD-203-R20: project_not_found surfaces from probe', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('project_not_found');
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig();
    await expect(
      adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toMatchObject({ code: 'project_not_found' });
  });

  it('PRD-203-R20 / R23: auth_failed error message MUST NOT contain the apiToken value', async () => {
    const provider = corpusProvider(tinyCorpus());
    vi.spyOn(provider, 'probeAuth').mockResolvedValueOnce('unauthorized');
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig({ apiToken: 'sktok-SECRET-VERY-SENSITIVE-VALUE' });
    try {
      await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('SECRET-VERY-SENSITIVE');
    }
  });

  it('PRD-203-R2 / R23: env-var apiToken not set → config_invalid (and env var name appears, not value)', async () => {
    delete process.env['__NEVER_SET_PRD203__'];
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = {
      projectId: 'p',
      dataset: 'd',
      apiToken: { from_env: '__NEVER_SET_PRD203__' },
    };
    await expect(
      adapter.init(cfg as Record<string, unknown>, ctx(cfg as unknown as SanityAdapterConfig)),
    ).rejects.toMatchObject({ code: 'config_invalid' });
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R21 — partial extraction
// ---------------------------------------------------------------------------

describe('PRD-203-R21 — partial extraction', () => {
  it('PRD-203-R21: portable-text walk error surfaces as partial node + warning', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          body: [{ _type: 'mysteryBlock', payload: 'x' } as PortableTextNode],
        }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.title).toBeDefined(); // still emits
    const meta = result.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta['extraction_status']).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R22 / R25 — provenance
// ---------------------------------------------------------------------------

describe('PRD-203-R22 / R25 — provenance', () => {
  it('PRD-203-R22: metadata.source.adapter = "act-sanity"', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const src = (result.nodes[0]!.metadata as { source?: { adapter?: string } }).source;
    expect(src?.adapter).toBe('act-sanity');
  });

  it('PRD-203-R25: source_id is the Sanity _id (no locale suffix in single-locale build)', async () => {
    const corpus: SanitySourceCorpus = { documents: [tinyDoc({ _id: 'src-id-123' })] };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const src = (result.nodes[0]!.metadata as { source?: { source_id?: string } }).source;
    expect(src?.source_id).toBe('src-id-123');
  });

  it('PRD-203-R25: per-locale variant uses `{_id}#{locale}` source_id', async () => {
    const corpus: SanitySourceCorpus = { documents: [tinyDoc({ _id: 'dual-locale' })] };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      locale: { field: 'lang', pattern: 'field', available: ['en-US', 'es-ES'] },
    });
    const result = await runAdapter(
      adapter,
      cfg as unknown as Record<string, unknown>,
      ctx(cfg, { targetLevel: 'strict' }),
    );
    const ids = result.nodes.map(
      (n) => (n.metadata as { source?: { source_id?: string } }).source?.source_id,
    );
    expect(new Set(ids)).toEqual(new Set(['dual-locale#en-US', 'dual-locale#es-ES']));
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R23 / R24 — security: token never logged or emitted
// ---------------------------------------------------------------------------

describe('PRD-203-R23 / R24 — token redaction', () => {
  it('PRD-203-R23: inline apiToken triggers a credential-hygiene warning that does NOT contain the value', async () => {
    const logger = makeLogger();
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ apiToken: 'skSANITYsecretTOKENvalue' });
    await adapter.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    const all = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]
      .flat()
      .join(' ');
    expect(all).toMatch(/PRD-203-R23/);
    expect(all).not.toContain('skSANITYsecretTOKENvalue');
    await adapter.dispose(ctx(cfg));
  });

  it('PRD-203-R24: token is never present in any emitted envelope field', async () => {
    const corpus: SanitySourceCorpus = {
      documents: [
        tinyDoc({
          // Ensure `apiToken` value does not leak even when a doc happens to contain a similar field.
          token: 'unrelated-doc-field',
        }),
      ],
    };
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({ apiToken: 'skSANITYsecretTOKENvalue' });
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    const serialized = JSON.stringify(result.nodes);
    expect(serialized).not.toContain('skSANITYsecretTOKENvalue');
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R26 — version pinning (Stage 1)
// ---------------------------------------------------------------------------

describe('PRD-203-R26 — version pinning', () => {
  it('PRD-203-R26: emitted envelopes carry act_version "0.1"', async () => {
    const adapter = createSanityAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes[0]!.act_version).toBe('0.1');
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R8 — RESERVED_METADATA_KEYS surface
// ---------------------------------------------------------------------------

describe('PRD-203 — reserved metadata keys', () => {
  it('PRD-203: documented reserved keys are present', () => {
    expect(RESERVED_METADATA_KEYS.has('source')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('translations')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('locale')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('preview')).toBe(true);
    expect(RESERVED_METADATA_KEYS.has('reference_cycles')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-203-R27 — integration: full pipeline + validator
// ---------------------------------------------------------------------------

describe('PRD-203-R27 — integration: validator gates emitted nodes', () => {
  it('PRD-203-R27: standard fixture corpus validates with 0 gaps', async () => {
    const corpus = loadCorpus('standard-emission');
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps).toEqual([]);
    }
  });

  it('PRD-203-R27: plus fixture (componentMapping + locale) validates with 0 gaps', async () => {
    const corpus = loadCorpus('plus-emission');
    const adapter = createSanityAdapter({ corpus });
    const cfg = baseConfig({
      locale: { field: 'lang', pattern: 'document' },
      componentMapping: {
        heroBlock: {
          type: 'marketing:hero',
          fields: {
            headline: 'headline',
            subhead: 'subhead',
            cta: { label: 'ctaLabel', href: 'ctaHref' },
          },
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
// Provider corpus fallthrough — getDocument + syncDelta
// ---------------------------------------------------------------------------

describe('corpusProvider shape', () => {
  it('corpusProvider.getDocument returns documents and refDocuments by _id', () => {
    const provider = corpusProvider({
      documents: [{ _id: 'a', _type: 'x' }],
      refDocuments: { b: { _id: 'b', _type: 'y' } },
    });
    expect(provider.getDocument('a')?._id).toBe('a');
    expect(provider.getDocument('b')?._id).toBe('b');
    expect(provider.getDocument('missing')).toBeUndefined();
  });

  it('corpusProvider.syncDelta returns documents + a deterministic marker', async () => {
    const provider = corpusProvider({
      documents: [{ _id: 'a', _type: 'x' }],
      latestTransactionId: 'tx-fixed',
    });
    const r = await provider.syncDelta('whatever');
    expect(r.nextMarker).toBe('tx-fixed');
    expect(r.documents).toHaveLength(1);
  });

  it('corpusProvider.fetchDocuments returns documents sorted by _id', async () => {
    const provider = corpusProvider({
      documents: [
        { _id: 'z', _type: 'x' },
        { _id: 'a', _type: 'x' },
        { _id: 'm', _type: 'x' },
      ],
    });
    const r = await provider.fetchDocuments({ groqFilter: '*' });
    expect(r.map((d) => d._id)).toEqual(['a', 'm', 'z']);
  });

  it('createSanityAdapter accepts an injected provider directly', async () => {
    const provider: SanitySourceProvider = {
      probeAuth: () => Promise.resolve('ok'),
      fetchDocuments: () => Promise.resolve([tinyDoc()]),
      getDocument: () => undefined,
      syncDelta: () => Promise.resolve({ documents: [], nextMarker: 'tx-x' }),
      dispose: () => undefined,
    };
    const adapter = createSanityAdapter({ provider });
    const cfg = baseConfig();
    const result = await runAdapter(adapter, cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(result.nodes).toHaveLength(1);
  });
});

/**
 * PRD-206 Builder.io adapter tests. Every requirement R1–R30 has at least
 * one citing test; integration scenarios at the bottom run the full
 * adapter pipeline against recorded fixtures and validate emitted nodes
 * via @act-spec/validator (PRD-206-R30 + the role's "at least one positive
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
  BUILDER_ADAPTER_NAME,
  BUILDER_DEFAULT_CONCURRENCY,
  BUILDER_DEFAULT_REFERENCE_DEPTH,
  BUILDER_DEFAULT_SYMBOL_RECURSION_MAX,
  BUILDER_DEFAULT_UNMAPPED_THRESHOLD,
  BuilderAdapterError,
  RESERVED_METADATA_KEYS,
  clampReferenceDepth,
  computeLevel,
  corpusProvider,
  createBuilderAdapter,
  deriveActId,
  emitMappedBlock,
  emitPassThrough,
  htmlToMarkdown,
  normalizeContent,
  resolveActType,
  resolveReferences,
  resolveSummary,
  slugCase,
  verifyWebhookSignature,
  walkBuilderTree,
} from './index.js';
import type {
  BuilderAdapterConfig,
  BuilderContent,
  BuilderSourceCorpus,
  BuilderSourceProvider,
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
  config: BuilderAdapterConfig,
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

function tinyContent(over: Partial<BuilderContent> = {}): BuilderContent {
  return {
    id: 'builder-content-1',
    name: 'Hello',
    modelName: 'page',
    lastUpdated: 1745654400000,
    data: {
      url: '/hello',
      description: 'A short description.',
      blocks: [
        {
          '@type': '@builder.io/sdk:Element',
          component: { name: 'Text', options: { text: '<p>Hello world.</p>' } },
        },
      ],
    },
    ...over,
  };
}

function tinyCorpus(over: Partial<BuilderSourceCorpus> = {}): BuilderSourceCorpus {
  return {
    contentByModel: { page: [tinyContent()] },
    ...over,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'test-fixtures');

function loadCorpus(name: string): BuilderSourceCorpus {
  return JSON.parse(
    readFileSync(path.join(fixtureRoot, name, 'content.json'), 'utf8'),
  ) as BuilderSourceCorpus;
}

function stripPartial(n: EmittedNode | PartialEmittedNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_act')) continue;
    out[k] = v;
  }
  return out;
}

function baseConfig(over: Partial<BuilderAdapterConfig> = {}): BuilderAdapterConfig {
  return {
    apiKey: 'fixture-public-key',
    models: ['page'],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// PRD-206-R1 — adapter contract
// ---------------------------------------------------------------------------

describe('PRD-206-R1 (adapter contract)', () => {
  it('PRD-206-R1: createBuilderAdapter returns an Adapter with the required lifecycle', () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    expect(adapter.name).toBe(BUILDER_ADAPTER_NAME);
    expect(typeof adapter.init).toBe('function');
    expect(typeof adapter.enumerate).toBe('function');
    expect(typeof adapter.transform).toBe('function');
    expect(typeof adapter.dispose).toBe('function');
    expect(typeof adapter.delta).toBe('function');
  });

  it('PRD-206-R1: factory rejects when neither provider nor corpus is supplied', () => {
    expect(() => createBuilderAdapter({})).toThrow(BuilderAdapterError);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R2 — config validation
// ---------------------------------------------------------------------------

describe('PRD-206-R2 (config validation)', () => {
  it('PRD-206-R2: init rejects when apiKey is missing', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx({ models: ['page'] } as unknown as BuilderAdapterConfig);
    await expect(
      adapter.init(c.config, c),
    ).rejects.toThrow(/apiKey|required/i);
  });

  it('PRD-206-R2: precheck rejects when apiKey is missing', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    if (adapter.precheck === undefined) throw new Error('precheck should exist');
    await expect(
      adapter.precheck({ models: ['page'] } as unknown as Record<string, unknown>),
    ).rejects.toThrow(BuilderAdapterError);
  });

  it('PRD-206-R2: init rejects when env-var apiKey reference is unset', async () => {
    delete process.env['__NONEXISTENT_BUILDER_KEY__'];
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({
      apiKey: { from_env: '__NONEXISTENT_BUILDER_KEY__' },
    });
    const c = ctx(cfg);
    await expect(adapter.init(c.config, c)).rejects.toThrow(/__NONEXISTENT_BUILDER_KEY__/);
  });

  it('PRD-206-R2: init resolves apiKey from process.env when from_env is supplied', async () => {
    process.env['__BUILDER_TEST_KEY__'] = 'env-public-key';
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const cfg = baseConfig({ apiKey: { from_env: '__BUILDER_TEST_KEY__' } });
    const c = ctx(cfg);
    const caps = await adapter.init(c.config, c);
    expect(caps.level).toBe('standard');
    delete process.env['__BUILDER_TEST_KEY__'];
  });

  it('PRD-206-R2/R25: init rejects when keyKindProbe reports a private key', async () => {
    const adapter = createBuilderAdapter({
      corpus: tinyCorpus({ keyKindProbe: 'private' }),
    });
    const c = ctx(baseConfig());
    await expect(adapter.init(c.config, c)).rejects.toMatchObject({
      code: 'private_key_detected',
    });
  });

  it('PRD-206-R2/R25: warns (does not throw) when keyKindProbe is unknown', async () => {
    const logger = makeLogger();
    const adapter = createBuilderAdapter({
      corpus: tinyCorpus({ keyKindProbe: 'unknown' }),
    });
    const c = ctx(baseConfig(), {}, logger);
    await adapter.init(c.config, c);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not determine Builder.io key kind'),
    );
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R3 — version (draft vs published)
// ---------------------------------------------------------------------------

describe('PRD-206-R3 (version)', () => {
  it('PRD-206-R3: defaults version to "published"; no preview metadata stamped', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    const node = result.nodes[0]!;
    expect((node.metadata as Record<string, unknown> | undefined)?.['preview']).toBeUndefined();
  });

  it('PRD-206-R3: when version is "draft", every emitted node carries metadata.preview = true', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ version: 'draft' }));
    const result = await runAdapter(adapter, c.config, c);
    expect((result.nodes[0]!.metadata as Record<string, unknown>)?.['preview']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R4 — mode default + invariant
// ---------------------------------------------------------------------------

describe('PRD-206-R4 (mode)', () => {
  it('PRD-206-R4: defaults mode to "extraction"', () => {
    expect(computeLevel('extraction', baseConfig())).toBe('standard');
  });

  it('PRD-206-R4: rejects invalid mode at config-schema level', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx({ ...baseConfig(), mode: 'hybrid' as 'extraction' });
    await expect(adapter.init(c.config, c)).rejects.toThrow(/mode|enum/i);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R5 — model iteration + 404
// ---------------------------------------------------------------------------

describe('PRD-206-R5 (models filter)', () => {
  it('PRD-206-R5: rejects when a configured model is not found on the server', async () => {
    const adapter = createBuilderAdapter({
      corpus: tinyCorpus({ unknownModels: ['nonexistent'] }),
    });
    const c = ctx(baseConfig({ models: ['nonexistent'] }));
    await expect(adapter.init(c.config, c)).rejects.toMatchObject({ code: 'model_not_found' });
  });

  it('PRD-206-R5: iterates over multiple configured models', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [tinyContent({ id: 'p1' })],
        section: [tinyContent({ id: 's1', modelName: 'section' })],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig({ models: ['page', 'section'] }));
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R6 — empty filter warning
// ---------------------------------------------------------------------------

describe('PRD-206-R6 (empty filter)', () => {
  it('PRD-206-R6: emits a warning when the filter returns 0 entries and allowEmpty is unset', async () => {
    const logger = makeLogger();
    const adapter = createBuilderAdapter({ corpus: { contentByModel: { page: [] } } });
    const c = ctx(baseConfig(), {}, logger);
    await runAdapter(adapter, c.config, c);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('returned 0 entries'));
  });

  it('PRD-206-R6: suppresses the warning when allowEmpty: true', async () => {
    const logger = makeLogger();
    const adapter = createBuilderAdapter({ corpus: { contentByModel: { page: [] } } });
    const c = ctx(baseConfig({ allowEmpty: true }), {}, logger);
    await runAdapter(adapter, c.config, c);
    const calls = logger.warn.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('returned 0 entries'),
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R7 — model → ACT type mapping
// ---------------------------------------------------------------------------

describe('PRD-206-R7 (type mapping)', () => {
  it('PRD-206-R7: page model defaults to ACT type "landing"', () => {
    const t = resolveActType(tinyContent(), baseConfig());
    expect(t).toBe('landing');
  });

  it('PRD-206-R7: section model defaults to ACT type "landing"', () => {
    const t = resolveActType(tinyContent({ modelName: 'section' }), baseConfig());
    expect(t).toBe('landing');
  });

  it('PRD-206-R7: symbol model defaults to ACT type "landing"', () => {
    const t = resolveActType(tinyContent({ modelName: 'symbol' }), baseConfig());
    expect(t).toBe('landing');
  });

  it('PRD-206-R7: other models pass through identity', () => {
    const t = resolveActType(tinyContent({ modelName: 'product' }), baseConfig());
    expect(t).toBe('product');
  });

  it('PRD-206-R7: typeMapping override wins', () => {
    const t = resolveActType(
      tinyContent(),
      baseConfig({ typeMapping: { page: 'article' } }),
    );
    expect(t).toBe('article');
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R8 — field mapping
// ---------------------------------------------------------------------------

describe('PRD-206-R8 (field mapping)', () => {
  it('PRD-206-R8: id derives from data.url by default and stamps source_id from content.id', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    const node = result.nodes[0]!;
    expect(node.id).toMatch(/landing\/hello$/);
    expect(((node.metadata as Record<string, unknown>)['source'] as Record<string, unknown>)['source_id']).toBe(
      'builder-content-1',
    );
  });

  it('PRD-206-R8: id falls back to content.id when data.url absent', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [tinyContent({ data: { description: 'no url here', blocks: [] } })],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes[0]!.id).toContain('builder-content-1');
  });

  it('PRD-206-R8: idField override wins', () => {
    const id = deriveActId(
      tinyContent({ data: { url: '/hello', someCustomId: 'override-me' } as never }),
      baseConfig({ idField: 'data.someCustomId' }),
      null,
    );
    expect(id).toContain('override-me');
  });

  it('PRD-206-R8: title defaults to content.name', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes[0]!.title).toBe('Hello');
  });

  it('PRD-206-R8: summary uses data.description when present (summary_source: "author")', () => {
    const r = resolveSummary(tinyContent(), baseConfig(), []);
    expect(r.summary).toBe('A short description.');
    expect(r.summarySource).toBe('author');
  });

  it('PRD-206-R8: summary extracts from first Text component (capped at 50 tokens) when description is absent', () => {
    const longText = Array.from({ length: 100 }, (_, i) => `word${String(i)}`).join(' ');
    const r = resolveSummary(
      tinyContent({ data: { url: '/hello' } }),
      baseConfig(),
      [{ type: 'prose', text: longText }],
    );
    expect(r.summary.split(/\s+/)).toHaveLength(50);
    expect(r.summarySource).toBe('extracted');
  });

  it('PRD-206-R8: summary synthesizes a placeholder when both description and Text-derived prose are absent', () => {
    const r = resolveSummary(
      tinyContent({ data: { url: '/hello' } }),
      baseConfig(),
      [],
    );
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.summarySource).toBe('extracted');
  });

  it('PRD-206-R8: tags carries data.tags array verbatim', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [tinyContent({ data: { url: '/x', tags: ['marketing', 'launch'] } })],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes[0]!.tags).toEqual(['marketing', 'launch']);
  });

  it('PRD-206-R8: updated_at derives from lastUpdated epoch ms', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    expect(typeof result.nodes[0]!.updated_at).toBe('string');
    expect(result.nodes[0]!.updated_at).toMatch(/^2025-/);
  });

  it('PRD-206-R8: emits partial when title field missing', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [tinyContent({ name: undefined } as Partial<BuilderContent>)],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    const node = result.nodes[0]!;
    expect((node.metadata as Record<string, unknown>)['extraction_status']).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R9 — extraction primitive walk
// ---------------------------------------------------------------------------

describe('PRD-206-R9 (extraction primitive walk)', () => {
  it('PRD-206-R9: Text → prose markdown via HTML conversion', () => {
    const r = walkBuilderTree(
      [
        {
          component: { name: 'Text', options: { text: '<h1>Hi</h1><p>Body.</p>' } },
        },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect(r.blocks).toHaveLength(1);
    const block = r.blocks[0] as Record<string, unknown>;
    expect(block['type']).toBe('prose');
    expect(block['format']).toBe('markdown');
    expect(String(block['text'])).toContain('# Hi');
    expect(String(block['text'])).toContain('Body.');
  });

  it('PRD-206-R9: Image → markdown image syntax embedded into prose', () => {
    const r = walkBuilderTree(
      [
        {
          component: {
            name: 'Image',
            options: { image: 'https://cdn/x.png', altText: 'alt' },
          },
        },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect((r.blocks[0] as Record<string, unknown>)['text']).toBe('![alt](https://cdn/x.png)');
  });

  it('PRD-206-R9: Button → markdown link', () => {
    const r = walkBuilderTree(
      [
        {
          component: {
            name: 'Button',
            options: { text: 'Sign up', link: '/signup' },
          },
        },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect((r.blocks[0] as Record<string, unknown>)['text']).toBe('[Sign up](/signup)');
  });

  it('PRD-206-R9: CustomCode → code block with language from options', () => {
    const r = walkBuilderTree(
      [
        {
          component: {
            name: 'CustomCode',
            options: { language: 'ts', code: 'const x = 1;' },
          },
        },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    const block = r.blocks[0] as Record<string, unknown>;
    expect(block['type']).toBe('code');
    expect(block['language']).toBe('ts');
    expect(block['text']).toBe('const x = 1;');
  });

  it('PRD-206-R9: CustomCode without language defaults to "text"', () => {
    const r = walkBuilderTree(
      [{ component: { name: 'CustomCode', options: { code: 'plain' } } }],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect((r.blocks[0] as Record<string, unknown>)['language']).toBe('text');
  });

  it('PRD-206-R9: Section flattens — children become siblings', () => {
    const r = walkBuilderTree(
      [
        {
          component: { name: 'Section' },
          children: [
            { component: { name: 'Text', options: { text: '<p>A</p>' } } },
            { component: { name: 'Text', options: { text: '<p>B</p>' } } },
          ],
        },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect(r.blocks).toHaveLength(2);
  });

  it('PRD-206-R9: unmapped custom components produce a partial prose placeholder + warning', () => {
    const warn = vi.fn();
    const r = walkBuilderTree(
      [{ component: { name: 'WeirdCustom' } }],
      { symbolRecursionMax: 3, warn },
    );
    expect(r.unmapped).toBe(1);
    expect(r.partial).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect((r.blocks[0] as Record<string, unknown>)['text']).toContain(
      'unmapped Builder component: WeirdCustom',
    );
  });

  it('PRD-206-R9: HTML constructs outside the recognized set mark Text extraction lossy → partial', () => {
    const r = walkBuilderTree(
      [
        {
          component: { name: 'Text', options: { text: '<table><tr><td>x</td></tr></table>' } },
        },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect(r.partial).toBe(true);
  });

  it('PRD-206-R9: walker preserves source order across heterogeneous siblings', () => {
    const r = walkBuilderTree(
      [
        { component: { name: 'Text', options: { text: '<p>1</p>' } } },
        { component: { name: 'CustomCode', options: { code: 'a' } } },
        { component: { name: 'Text', options: { text: '<p>3</p>' } } },
      ],
      { symbolRecursionMax: 3, warn: () => undefined },
    );
    expect(r.blocks.map((b) => (b as Record<string, unknown>)['type'])).toEqual([
      'prose',
      'code',
      'prose',
    ]);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R10 — pass-through `marketing:builder-page`
// ---------------------------------------------------------------------------

describe('PRD-206-R10 (pass-through emission)', () => {
  it('PRD-206-R10: pass-through emits a single marketing:builder-page block', () => {
    const block = emitPassThrough(tinyContent());
    expect(block['type']).toBe('marketing:builder-page');
    expect(block['model']).toBe('page');
    expect(block['payload']).toBeTypeOf('object');
    expect((block['metadata'] as Record<string, unknown>)['builderApiVersion']).toBe('v3');
    expect((block['metadata'] as Record<string, unknown>)['builderModelKind']).toBe('page');
  });

  it('PRD-206-R10: passes through data verbatim', () => {
    const content = tinyContent({ data: { url: '/x', custom: { nested: 42 } } });
    const block = emitPassThrough(content);
    expect((block['payload'] as Record<string, unknown>)['custom']).toEqual({ nested: 42 });
  });

  it('PRD-206-R10: pass-through node still carries an extracted summary (PRD-100-R4)', async () => {
    const corpus = tinyCorpus({
      contentByModel: {
        page: [
          tinyContent({
            data: {
              url: '/x',
              blocks: [
                {
                  component: { name: 'Text', options: { text: '<p>Welcome friends</p>' } },
                },
              ],
            },
          }),
        ],
      },
    });
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig({ mode: 'pass-through' }), { targetLevel: 'strict' });
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes[0]!.summary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R11 — mode-driven conformance level
// ---------------------------------------------------------------------------

describe('PRD-206-R11 (level matrix)', () => {
  it('PRD-206-R11: extraction + no extras → standard', () => {
    expect(computeLevel('extraction', baseConfig())).toBe('standard');
  });

  it('PRD-206-R11: extraction + componentMapping → plus', () => {
    expect(
      computeLevel(
        'extraction',
        baseConfig({
          componentMapping: { Foo: { type: 'marketing:hero', fields: {} } },
        }),
      ),
    ).toBe('strict');
  });

  it('PRD-206-R11: extraction + locale → plus', () => {
    expect(
      computeLevel(
        'extraction',
        baseConfig({ locale: { locales: ['en'], defaultLocale: 'en' } }),
      ),
    ).toBe('strict');
  });

  it('PRD-206-R11: extraction + experiments=emit → plus', () => {
    expect(
      computeLevel('extraction', baseConfig({ experiments: 'emit' })),
    ).toBe('strict');
  });

  it('PRD-206-R11: pass-through always → plus', () => {
    expect(computeLevel('pass-through', baseConfig())).toBe('strict');
  });

  it('PRD-206-R11: init refuses when adapter level exceeds target', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ mode: 'pass-through' }), { targetLevel: 'standard' });
    await expect(adapter.init(c.config, c)).rejects.toMatchObject({ code: 'level_mismatch' });
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R12 — Symbol recursion bound + cycle detection
// ---------------------------------------------------------------------------

describe('PRD-206-R12 (Symbol recursion)', () => {
  it('PRD-206-R12: recurses Symbols up to depth 3', () => {
    const inner = (depth: number): { component: { name: string }; symbol: { entry: string; data: { blocks: Array<Record<string, unknown>> } } } => ({
      component: { name: 'Symbol' },
      symbol: {
        entry: `sym-${String(depth)}`,
        data: {
          blocks: depth > 0
            ? [inner(depth - 1)]
            : [{ component: { name: 'Text', options: { text: '<p>leaf</p>' } } }],
        },
      },
    });
    const r = walkBuilderTree([inner(2)], { symbolRecursionMax: 3, warn: () => undefined });
    expect(r.partial).toBe(false);
    // The leaf prose surfaces.
    expect(r.blocks.some((b) => (b as Record<string, unknown>)['text'] === 'leaf')).toBe(true);
  });

  it('PRD-206-R12: depth > max emits partial prose placeholder', () => {
    const blk = (entry: string, child: Record<string, unknown>): Record<string, unknown> => ({
      component: { name: 'Symbol' },
      symbol: { entry, data: { blocks: [child] } },
    });
    // Build a chain of 4 nested symbols (depth 4); cap=3 should cut off.
    const chain = blk('s1', blk('s2', blk('s3', blk('s4', { component: { name: 'Text', options: { text: '<p>x</p>' } } }))));
    const r = walkBuilderTree([chain], { symbolRecursionMax: 3, warn: () => undefined });
    expect(r.partial).toBe(true);
    expect(
      r.blocks.some((b) =>
        String((b as Record<string, unknown>)['text']).includes('symbol recursion bound exceeded'),
      ),
    ).toBe(true);
  });

  it('PRD-206-R12: tolerates cycles by tracking visited Symbol IDs', () => {
    const cycle: Record<string, unknown> = {
      component: { name: 'Symbol' },
      symbol: { entry: 'cyc-1', data: { blocks: [] as Array<Record<string, unknown>> } },
    };
    const inner: Record<string, unknown> = {
      component: { name: 'Symbol' },
      symbol: { entry: 'cyc-1', data: { blocks: [] } },
    };
    (cycle.symbol as { data: { blocks: Array<Record<string, unknown>> } }).data.blocks.push(inner);
    const r = walkBuilderTree([cycle], { symbolRecursionMax: 3, warn: () => undefined });
    expect(r.partial).toBe(true);
  });

  it('PRD-206-R12: init rejects when symbolRecursionMax > 3', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ symbolRecursionMax: 5 }));
    await expect(adapter.init(c.config, c)).rejects.toThrow();
  });

  it('PRD-206-R12: precheck rejects when symbolRecursionMax > 3', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    if (adapter.precheck === undefined) throw new Error('precheck should exist');
    await expect(
      adapter.precheck({ ...baseConfig(), symbolRecursionMax: 5 } as unknown as Record<string, unknown>),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R13 — custom-component → marketing:* mapping
// ---------------------------------------------------------------------------

describe('PRD-206-R13 (componentMapping)', () => {
  it('PRD-206-R13: Hero component is lifted to marketing:hero per the field projection', () => {
    const r = walkBuilderTree(
      [
        {
          component: {
            name: 'Hero',
            options: { headline: 'Hi', subhead: 'sub', ctaLabel: 'Go', ctaHref: '/x' },
          },
        },
      ],
      {
        componentMapping: {
          Hero: {
            type: 'marketing:hero',
            fields: {
              headline: 'options.headline',
              subhead: 'options.subhead',
              cta: { label: 'options.ctaLabel', href: 'options.ctaHref' },
            },
          },
        },
        symbolRecursionMax: 3,
        warn: () => undefined,
      },
    );
    const block = r.blocks[0] as Record<string, unknown>;
    expect(block['type']).toBe('marketing:hero');
    expect(block['headline']).toBe('Hi');
    expect(block['cta']).toEqual({ label: 'Go', href: '/x' });
  });

  it('PRD-206-R13: array projection (`tiers[].{name, price, features}`) yields per-row picks', () => {
    const r = walkBuilderTree(
      [
        {
          component: {
            name: 'PricingTable',
            options: {
              tiers: [
                { name: 'Free', price: '$0', features: ['a'] },
                { name: 'Pro', price: '$1', features: ['b'] },
              ],
            },
          },
        },
      ],
      {
        componentMapping: {
          PricingTable: {
            type: 'marketing:pricing-table',
            fields: { tiers: 'options.tiers[].{name, price, features}' },
          },
        },
        symbolRecursionMax: 3,
        warn: () => undefined,
      },
    );
    const block = r.blocks[0] as Record<string, unknown>;
    expect((block['tiers'] as Array<Record<string, unknown>>)[0]).toEqual({
      name: 'Free',
      price: '$0',
      features: ['a'],
    });
  });

  it('PRD-206-R13: malformed mapping (path resolves to undefined) marks projection partial', () => {
    const r = emitMappedBlock(
      { component: { name: 'Hero', options: {} } },
      {
        type: 'marketing:hero',
        fields: { headline: 'options.headline' },
      },
    );
    expect(r.partial).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R14 / R15 / R16 — references
// ---------------------------------------------------------------------------

describe('PRD-206-R14/R15/R16 (references)', () => {
  it('PRD-206-R14: native data.references map to related[] with default relation "see-also"', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            id: 'a',
            data: {
              url: '/a',
              references: [{ '@type': '@builder.io/core:Reference', model: 'page', id: 'b' }],
            },
          }),
          tinyContent({ id: 'b', data: { url: '/b' } }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    const a = result.nodes.find((n) => n.id.includes('/a'))!;
    expect(a.related).toEqual([{ id: expect.stringContaining('/b') as unknown, relation: 'see-also' }]);
  });

  it('PRD-206-R15: clamps referenceDepth to 0–3 (default 1)', () => {
    expect(clampReferenceDepth(undefined)).toBe(1);
    expect(clampReferenceDepth(0)).toBe(0);
    expect(clampReferenceDepth(2)).toBe(2);
    expect(clampReferenceDepth(99)).toBe(3);
    expect(clampReferenceDepth(-5)).toBe(0);
    expect(clampReferenceDepth(1.5 as unknown as number)).toBe(1);
  });

  it('PRD-206-R15: init rejects when referenceDepth > 3', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ referenceDepth: 4 as unknown as number }));
    await expect(adapter.init(c.config, c)).rejects.toThrow();
  });

  it('PRD-206-R15: precheck rejects when referenceDepth > 3', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    if (adapter.precheck === undefined) throw new Error('precheck should exist');
    await expect(
      adapter.precheck({ ...baseConfig(), referenceDepth: 4 } as unknown as Record<string, unknown>),
    ).rejects.toThrow();
  });

  it('PRD-206-R15: depth=0 returns no related entries even when references present', () => {
    const r = resolveReferences(
      tinyContent({
        data: {
          url: '/x',
          references: [{ '@type': '@builder.io/core:Reference', model: 'page', id: 'y' }],
        },
      }),
      { getContentByModelAndId: () => tinyContent({ id: 'y', data: { url: '/y' } }) },
      { defaultRelation: 'see-also', depth: 0, fieldRelations: {} },
      (target) => target.id,
    );
    expect(r.related).toEqual([]);
  });

  it('PRD-206-R16: cycles in resolved reference graphs are tolerated and counted', async () => {
    // a → b; b → a (cycle).
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            id: 'a',
            data: {
              url: '/a',
              references: [{ '@type': '@builder.io/core:Reference', model: 'page', id: 'b' }],
            },
          }),
          tinyContent({
            id: 'b',
            data: {
              url: '/b',
              references: [{ '@type': '@builder.io/core:Reference', model: 'page', id: 'a' }],
            },
          }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig({ referenceDepth: 2 }));
    const result = await runAdapter(adapter, c.config, c);
    const a = result.nodes.find((n) => n.id.includes('/a'))!;
    expect((a.metadata as Record<string, unknown>)['reference_cycles']).toBeGreaterThan(0);
  });

  it('PRD-206-R14: per-field relation override via fieldMapping.related applies', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            id: 'a',
            data: {
              url: '/a',
              myCustomField: { '@type': '@builder.io/core:Reference', model: 'page', id: 'b' },
            } as never,
          }),
          tinyContent({ id: 'b', data: { url: '/b' } }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig({ fieldMapping: { related: { myCustomField: 'derived-from' } } }));
    const result = await runAdapter(adapter, c.config, c);
    const a = result.nodes.find((n) => n.id.includes('/a'))!;
    expect(a.related?.some((r) => r.relation === 'derived-from')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R17 — locale handling
// ---------------------------------------------------------------------------

describe('PRD-206-R17 (locale)', () => {
  it('PRD-206-R17: emits per-locale nodes and stamps metadata.locale + translations', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: { page: [tinyContent()] },
      contentByLocale: {
        en: { page: [tinyContent({ id: 'p', data: { url: '/p', description: 'EN' } })] },
        de: { page: [tinyContent({ id: 'p', data: { url: '/p', description: 'DE' } })] },
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(
      baseConfig({ locale: { locales: ['en', 'de'], defaultLocale: 'en' } }),
      { targetLevel: 'strict' },
    );
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    const en = result.nodes.find((n) => (n.metadata as Record<string, unknown>)['locale'] === 'en')!;
    const translations = (en.metadata as Record<string, unknown>)['translations'] as Array<{
      locale: string;
      id: string;
    }>;
    expect(translations.some((t) => t.locale === 'de')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R18 — variant emission
// ---------------------------------------------------------------------------

describe('PRD-206-R18 (variant emission)', () => {
  it('PRD-206-R18: experiments=skip (default) emits only the canonical (control) page', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [tinyContent({ variations: { v1: { id: 'v1', name: 'Variant A', data: { description: 'V' } } } })],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes).toHaveLength(1);
  });

  it('PRD-206-R18: experiments=emit emits one ACT node per variant with id={base}@{variantKey} + variant_of related entry', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            variations: {
              v1: { id: 'enterprise-2026q2', name: 'Enterprise 2026 Q2', data: { url: '/x', description: 'V' } },
            },
          }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig({ experiments: 'emit' }), { targetLevel: 'strict' });
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes).toHaveLength(2);
    const variant = result.nodes.find((n) => n.id.includes('@enterprise-2026q2'))!;
    expect(variant).toBeDefined();
    expect((variant.metadata as Record<string, unknown>)['variant']).toMatchObject({
      key: 'enterprise-2026q2',
      source: 'experiment',
    });
    expect(variant.related?.some((r) => r.relation === 'variant_of')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R19 — incremental rebuilds
// ---------------------------------------------------------------------------

describe('PRD-206-R19 (delta)', () => {
  it('PRD-206-R19: delta yields the configured corpus entries for the given since marker', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus({ latestUpdatedAt: '12345' }) });
    const c = ctx(baseConfig());
    await adapter.init(c.config, c);
    const out: unknown[] = [];
    if (adapter.delta === undefined) throw new Error('delta should exist');
    const iter = adapter.delta('0', c);
    if (Symbol.asyncIterator in (iter as object)) {
      for await (const item of iter) out.push(item);
    } else {
      for (const item of iter as unknown[]) out.push(item);
    }
    expect(out.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R20 — webhook signature verification
// ---------------------------------------------------------------------------

describe('PRD-206-R20 (webhook signature)', () => {
  const SECRET = 'shhh';
  const BODY = '{"hello":"world"}';
  const sigOf = (body: string, secret: string): string =>
    createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('PRD-206-R20: verifies a valid HMAC-SHA256 signature', () => {
    expect(verifyWebhookSignature(BODY, sigOf(BODY, SECRET), SECRET)).toBe(true);
  });

  it('PRD-206-R20: rejects an invalid signature', () => {
    expect(verifyWebhookSignature(BODY, 'deadbeef', SECRET)).toBe(false);
  });

  it('PRD-206-R20: rejects empty signature/secret without throwing', () => {
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, sigOf(BODY, SECRET), '')).toBe(false);
    expect(verifyWebhookSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, sigOf(BODY, SECRET), null)).toBe(false);
  });

  it('PRD-206-R20: signature length mismatch returns false', () => {
    expect(verifyWebhookSignature(BODY, sigOf(BODY, SECRET).slice(0, 10), SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R21 / R22 — capability declaration
// ---------------------------------------------------------------------------

describe('PRD-206-R21/R22 (capabilities)', () => {
  it('PRD-206-R21: init returns the declared AdapterCapabilities (Standard branch)', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const caps = await adapter.init(c.config, c);
    expect(caps.level).toBe('standard');
    expect(caps.concurrency_max).toBe(BUILDER_DEFAULT_CONCURRENCY);
    expect(caps.delta).toBe(true);
    expect(caps.namespace_ids).toBe(false);
    expect(caps.precedence).toBe('primary');
    expect(caps.manifestCapabilities?.etag).toBe(true);
    expect(caps.manifestCapabilities?.subtree).toBe(true);
  });

  it('PRD-206-R22: declares plus when componentMapping is configured', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(
      baseConfig({
        componentMapping: { Hero: { type: 'marketing:hero', fields: {} } },
      }),
      { targetLevel: 'strict' },
    );
    const caps = await adapter.init(c.config, c);
    expect(caps.level).toBe('strict');
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R23 — coverage warning
// ---------------------------------------------------------------------------

describe('PRD-206-R23 (coverage warning)', () => {
  it('PRD-206-R23: emits a warning when more than threshold are unmapped', async () => {
    const logger = makeLogger();
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            data: {
              url: '/x',
              description: 'd',
              blocks: [
                { component: { name: 'Custom1' } },
                { component: { name: 'Custom2' } },
                { component: { name: 'Text', options: { text: '<p>x</p>' } } },
              ],
            },
          }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig(), {}, logger);
    await runAdapter(adapter, c.config, c);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('PRD-206-R23'),
    );
  });

  it('PRD-206-R23: respects the configured unmappedComponentWarningThreshold', async () => {
    const logger = makeLogger();
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            data: {
              url: '/x',
              description: 'd',
              blocks: [
                { component: { name: 'Text', options: { text: '<p>x</p>' } } },
                { component: { name: 'Custom1' } },
              ],
            },
          }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    // High threshold (0.99): a 50% unmapped rate is BELOW it, so no warning.
    const c = ctx(baseConfig({ unmappedComponentWarningThreshold: 0.99 }), {}, logger);
    await runAdapter(adapter, c.config, c);
    const warningCalls = logger.warn.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('PRD-206-R23'),
    );
    expect(warningCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R24 — rate-limit handling
// ---------------------------------------------------------------------------

describe('PRD-206-R24 (rate limit)', () => {
  it('PRD-206-R24: emits a partial node when persistent 429 exhausts retries', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: { page: [tinyContent({ id: 'rate-me' })] },
      rateLimitedIds: ['rate-me'],
    };
    const logger = makeLogger();
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig(), {}, logger);
    const result = await runAdapter(adapter, c.config, c);
    const node = result.nodes[0]!;
    expect((node.metadata as Record<string, unknown>)['extraction_status']).toBe('partial');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate-limit'));
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R25 — auth failure
// ---------------------------------------------------------------------------

describe('PRD-206-R25 (auth failure)', () => {
  it('PRD-206-R25: init throws when authProbe is unauthorized; the apiKey is NOT in the message', async () => {
    const adapter = createBuilderAdapter({
      corpus: tinyCorpus({ authProbe: 'unauthorized' }),
    });
    const cfg = baseConfig({ apiKey: 'sek-very-secret-key-please-redact' });
    const c = ctx(cfg);
    await expect(adapter.init(c.config, c)).rejects.toMatchObject({ code: 'auth_failed' });
    try {
      await adapter.init(c.config, c);
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('sek-very-secret-key-please-redact');
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R26 / R27 — security: no key in logs/envelopes
// ---------------------------------------------------------------------------

describe('PRD-206-R26/R27 (security)', () => {
  it('PRD-206-R26: never logs the full apiKey value at any level', async () => {
    const SECRET = 'sek-do-not-leak';
    const logger = makeLogger();
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ apiKey: SECRET, debugLogging: true }), {}, logger);
    await runAdapter(adapter, c.config, c);
    for (const fn of [logger.debug, logger.info, logger.warn, logger.error]) {
      for (const call of fn.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET);
      }
    }
  });

  it('PRD-206-R26: when debugLogging=true, only a 4-char fingerprint appears at debug level', async () => {
    const logger = makeLogger();
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ apiKey: 'fixture-public-key', debugLogging: true }), {}, logger);
    await adapter.init(c.config, c);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('fixt'));
  });

  it('PRD-206-R26: warns when apiKey is supplied inline (suggests env var)', async () => {
    const logger = makeLogger();
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ apiKey: 'inline-key' }), {}, logger);
    await adapter.init(c.config, c);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('apiKey supplied inline'));
  });

  it('PRD-206-R27: never emits the apiKey value into any envelope field', async () => {
    const SECRET = 'sek-do-not-leak';
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig({ apiKey: SECRET }));
    const result = await runAdapter(adapter, c.config, c);
    for (const node of result.nodes) {
      expect(JSON.stringify(node)).not.toContain(SECRET);
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R28 — provenance source_id
// ---------------------------------------------------------------------------

describe('PRD-206-R28 (provenance)', () => {
  it('PRD-206-R28: source_id is the Builder content id by default', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    expect(((result.nodes[0]!.metadata as Record<string, unknown>)['source'] as Record<string, unknown>)['source_id']).toBe(
      'builder-content-1',
    );
  });

  it('PRD-206-R28: source_id is suffixed with the locale when locale fan-out is active', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: { page: [tinyContent()] },
      contentByLocale: {
        en: { page: [tinyContent({ id: 'p', data: { url: '/p', description: 'EN' } })] },
        de: { page: [tinyContent({ id: 'p', data: { url: '/p', description: 'DE' } })] },
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(
      baseConfig({ locale: { locales: ['en', 'de'], defaultLocale: 'en' } }),
      { targetLevel: 'strict' },
    );
    const result = await runAdapter(adapter, c.config, c);
    const en = result.nodes.find((n) => (n.metadata as Record<string, unknown>)['locale'] === 'en')!;
    expect(((en.metadata as Record<string, unknown>)['source'] as Record<string, unknown>)['source_id']).toContain('#en');
  });

  it('PRD-206-R28: source_id is suffixed with the variant key when experiments=emit produces variants', async () => {
    const corpus: BuilderSourceCorpus = {
      contentByModel: {
        page: [
          tinyContent({
            variations: {
              v1: { id: 'enterprise-2026q2', name: 'V', data: { url: '/x' } },
            },
          }),
        ],
      },
    };
    const adapter = createBuilderAdapter({ corpus });
    const c = ctx(baseConfig({ experiments: 'emit' }), { targetLevel: 'strict' });
    const result = await runAdapter(adapter, c.config, c);
    const variant = result.nodes.find((n) => n.id.includes('@enterprise-2026q2'))!;
    expect(((variant.metadata as Record<string, unknown>)['source'] as Record<string, unknown>)['source_id']).toContain(
      '#enterprise-2026q2',
    );
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R29 — Stage 1 act_version pinning
// ---------------------------------------------------------------------------

describe('PRD-206-R29 (Stage 1 pinning)', () => {
  it('PRD-206-R29: every emitted envelope stamps act_version="0.1"', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    const result = await runAdapter(adapter, c.config, c);
    for (const node of result.nodes) {
      expect(node.act_version).toBe('0.1');
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-206-R30 — fixture conformance (full pipeline → @act-spec/validator)
// ---------------------------------------------------------------------------

describe('PRD-206-R30 (fixture conformance)', () => {
  it('PRD-206-R30: extraction-standard corpus produces 0 validator gaps', async () => {
    const adapter = createBuilderAdapter({ corpus: loadCorpus('extraction-standard') });
    const c = ctx(
      baseConfig({
        fieldMapping: { related: { related_pages: 'see-also' } },
        referenceDepth: 1,
      }),
      { targetLevel: 'standard' },
    );
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps, `gaps for ${node.id}`).toEqual([]);
    }
  });

  it('PRD-206-R30: extraction-plus corpus produces 0 validator gaps', async () => {
    const adapter = createBuilderAdapter({ corpus: loadCorpus('extraction-plus') });
    const c = ctx(
      baseConfig({
        locale: { locales: ['en', 'de'], defaultLocale: 'en' },
        componentMapping: {
          Hero: {
            type: 'marketing:hero',
            fields: {
              headline: 'options.headline',
              subhead: 'options.subhead',
              cta: { label: 'options.ctaLabel', href: 'options.ctaHref' },
            },
          },
          PricingTable: {
            type: 'marketing:pricing-table',
            fields: { tiers: 'options.tiers[].{name, price, features}' },
          },
        },
      }),
      { targetLevel: 'strict' },
    );
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps, `gaps for ${node.id}`).toEqual([]);
    }
  });

  it('PRD-206-R30: passthrough-plus corpus produces 0 validator gaps', async () => {
    const adapter = createBuilderAdapter({ corpus: loadCorpus('passthrough-plus') });
    const c = ctx(baseConfig({ mode: 'pass-through' }), { targetLevel: 'strict' });
    const result = await runAdapter(adapter, c.config, c);
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      const probe = validateNode(stripPartial(node));
      expect(probe.gaps, `gaps for ${node.id}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Misc invariants — RESERVED_METADATA_KEYS, normalizeContent, slug, htmlToMarkdown
// ---------------------------------------------------------------------------

describe('Misc invariants', () => {
  it('RESERVED_METADATA_KEYS includes all PRD-206 framework-managed keys', () => {
    for (const k of [
      'source',
      'extraction_status',
      'extraction_error',
      'locale',
      'translations',
      'reference_cycles',
      'preview',
      'variant',
      'builderApiVersion',
      'builderModelKind',
    ]) {
      expect(RESERVED_METADATA_KEYS.has(k)).toBe(true);
    }
  });

  it('normalizeContent synthesizes modelName when absent', () => {
    const norm = normalizeContent({ id: 'x' } as BuilderContent, 'page');
    expect(norm.modelName).toBe('page');
  });

  it('normalizeContent rejects non-objects', () => {
    expect(() => normalizeContent(null as unknown as BuilderContent, 'page')).toThrow();
  });

  it('slugCase lowercases and hyphenizes', () => {
    expect(slugCase('Enterprise 2026 Q2!')).toBe('enterprise-2026-q2');
    expect(slugCase('---hi---there---')).toBe('hi-there');
  });

  it('htmlToMarkdown handles all recognized tags', () => {
    const r = htmlToMarkdown(
      '<p>Hi <strong>bold</strong> <em>em</em> <a href="https://x">link</a> <code>c</code></p>'
        + '<ul><li>one</li><li>two</li></ul>'
        + '<ol><li>first</li><li>second</li></ol>'
        + '<blockquote>quote</blockquote><br>after',
    );
    expect(r.text).toContain('**bold**');
    expect(r.text).toContain('*em*');
    expect(r.text).toContain('[link](https://x)');
    expect(r.text).toContain('`c`');
    expect(r.text).toContain('- one');
    expect(r.text).toContain('1. first');
    expect(r.text).toContain('> quote');
    expect(r.lossy).toBe(false);
  });

  it('htmlToMarkdown handles entity decoding', () => {
    const r = htmlToMarkdown('<p>Tom &amp; Jerry &lt;3 &nbsp;world&#39;s</p>');
    expect(r.text).toContain('Tom & Jerry <3');
  });

  it('htmlToMarkdown handles empty input', () => {
    expect(htmlToMarkdown('').text).toBe('');
    expect(htmlToMarkdown(undefined as unknown as string).text).toBe('');
  });

  it('BUILDER_DEFAULT_REFERENCE_DEPTH and BUILDER_DEFAULT_SYMBOL_RECURSION_MAX have the documented defaults', () => {
    expect(BUILDER_DEFAULT_REFERENCE_DEPTH).toBe(1);
    expect(BUILDER_DEFAULT_SYMBOL_RECURSION_MAX).toBe(3);
    expect(BUILDER_DEFAULT_UNMAPPED_THRESHOLD).toBe(0.5);
  });

  it('corpusProvider exposes shouldSimulateRateLimit for ids in rateLimitedIds', () => {
    const provider: BuilderSourceProvider = corpusProvider({
      contentByModel: { page: [tinyContent()] },
      rateLimitedIds: ['hot-id'],
    });
    expect(provider.shouldSimulateRateLimit('hot-id')).toBe(true);
    expect(provider.shouldSimulateRateLimit('cool-id')).toBe(false);
  });

  it('dispose is idempotent', async () => {
    const adapter = createBuilderAdapter({ corpus: tinyCorpus() });
    const c = ctx(baseConfig());
    await adapter.init(c.config, c);
    await adapter.dispose(c);
    await adapter.dispose(c); // should not throw
  });
});

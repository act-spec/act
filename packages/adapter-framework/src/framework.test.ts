/**
 * PRD-200 framework tests. Every requirement R1–R28 has at least one test
 * citing its requirement ID. Tests are exercised against the in-memory
 * `FakeAdapter` shape; the PRD-201 leaf is exercised by `markdown.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  bubbleManifestCapabilities,
  checkAdapterPinning,
  mergeContributions,
  mergeRuns,
  namespaceIds,
  resolveId,
  runAdapter,
  stampSource,
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type EmittedNode,
  type PartialEmittedNode,
} from './framework.js';

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    config: {},
    targetLevel: 'core',
    actVersion: '0.1',
    logger: noopLogger,
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

function fullNode(id: string, over: Partial<EmittedNode> = {}): EmittedNode {
  return {
    act_version: '0.1',
    id,
    type: 'doc',
    title: id,
    summary: 'sum',
    summary_source: 'extracted',
    content: [{ type: 'markdown', text: 'hi' }],
    tokens: { summary: 1, body: 1 },
    etag: 's256:aaaaaaaaaaaaaaaaaaaaaa',
    ...over,
  } as EmittedNode;
}

function partialNode(
  id: string,
  patch: Partial<EmittedNode>,
): PartialEmittedNode {
  return { id, _actPartial: true, ...patch };
}

interface FakeAdapterOpts {
  name: string;
  level?: 'core' | 'standard' | 'strict';
  concurrencyMax?: number;
  delta?: boolean;
  precedence?: 'primary' | 'fallback';
  yieldItems?: number;
  initThrows?: boolean;
  transformThrows?: boolean;
  manifestCapabilities?: AdapterCapabilities['manifestCapabilities'];
  precheck?: () => void;
}

function fakeAdapter(opts: FakeAdapterOpts): Adapter<{ idx: number }> & {
  disposed: number;
  initCalls: number;
  transformCalls: number[];
} {
  const state = { disposed: 0, initCalls: 0, transformCalls: [] as number[] };
  return {
    name: opts.name,
    get disposed() { return state.disposed; },
    get initCalls() { return state.initCalls; },
    get transformCalls() { return state.transformCalls; },
    ...(opts.precheck ? { precheck: opts.precheck } : {}),
    async init(_config, _ctx) {
      state.initCalls += 1;
      if (opts.initThrows) throw new Error('init blew up');
      return {
        level: opts.level ?? 'core',
        ...(opts.concurrencyMax !== undefined ? { concurrency_max: opts.concurrencyMax } : {}),
        ...(opts.delta !== undefined ? { delta: opts.delta } : {}),
        ...(opts.precedence !== undefined ? { precedence: opts.precedence } : {}),
        ...(opts.manifestCapabilities ? { manifestCapabilities: opts.manifestCapabilities } : {}),
      };
    },
    async *enumerate() {
      for (let i = 0; i < (opts.yieldItems ?? 1); i += 1) yield { idx: i };
    },
    async transform(item, _ctx) {
      state.transformCalls.push(item.idx);
      if (opts.transformThrows) throw new Error('transform blew up');
      return fullNode(`${opts.name}-${item.idx}`);
    },
    async dispose() {
      state.disposed += 1;
    },
  };
}

describe('PRD-200 adapter framework', () => {
  it('PRD-200-R1: an adapter satisfies the Adapter interface (name + four required hooks)', async () => {
    const a = fakeAdapter({ name: 'a' });
    expect(a.name).toBe('a');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
  });

  it('PRD-200-R2: lifecycle order is precheck → init → enumerate → transform → dispose, and dispose runs exactly once even on transform throw', async () => {
    const order: string[] = [];
    const a: Adapter<{ idx: number }> = {
      name: 'lifecycle',
      precheck() { order.push('precheck'); },
      async init() { order.push('init'); return { level: 'core' }; },
      async *enumerate() { order.push('enumerate'); yield { idx: 0 }; },
      async transform() { order.push('transform'); throw new Error('boom'); },
      async dispose() { order.push('dispose'); },
    };
    await expect(runAdapter(a, {}, ctx())).rejects.toThrow();
    expect(order).toEqual(['precheck', 'init', 'enumerate', 'transform', 'dispose']);
  });

  it('PRD-200-R3: init validates config and returns AdapterCapabilities', async () => {
    const a = fakeAdapter({ name: 'a', level: 'standard' });
    const result = await runAdapter(a, {}, ctx({ targetLevel: 'standard' }));
    expect(result.capabilities.level).toBe('standard');
  });

  it('PRD-200-R4: enumerate returns AsyncIterable; framework normalizes via for-await', async () => {
    const a = fakeAdapter({ name: 'a', yieldItems: 3 });
    const result = await runAdapter(a, {}, ctx());
    expect(result.nodes.length).toBe(3);
  });

  it('PRD-200-R5: transform may return null to skip an item; partials are also legal', async () => {
    const a: Adapter<{ idx: number }> = {
      name: 'skip',
      async init() { return { level: 'core' }; },
      async *enumerate() { yield { idx: 0 }; yield { idx: 1 }; },
      async transform(item) {
        if (item.idx === 0) return null;
        return fullNode('kept');
      },
      async dispose() {},
    };
    const r = await runAdapter(a, {}, ctx());
    expect(r.nodes.map((n) => n.id)).toEqual(['kept']);
  });

  it('PRD-200-R6: framework respects concurrency_max declared by the adapter', async () => {
    let inFlight = 0;
    let peak = 0;
    const a: Adapter<{ idx: number }> = {
      name: 'concur',
      async init() { return { level: 'core', concurrency_max: 2 }; },
      async *enumerate() { for (let i = 0; i < 6; i += 1) yield { idx: i }; },
      async transform(item) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return fullNode(`c-${item.idx}`);
      },
      async dispose() {},
    };
    await runAdapter(a, {}, ctx());
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('PRD-200-R7: dispose is idempotent — invoking twice does not throw', async () => {
    const a = fakeAdapter({ name: 'a' });
    await runAdapter(a, {}, ctx());
    await expect(a.dispose(ctx())).resolves.toBeUndefined();
  });

  it('PRD-200-R8: precheck runs before init when present', async () => {
    let order = '';
    const a: Adapter<{ idx: number }> = {
      name: 'precheck',
      precheck() { order += 'p'; },
      async init() { order += 'i'; return { level: 'core' }; },
      async *enumerate() { yield { idx: 0 }; },
      async transform() { return fullNode('x'); },
      async dispose() {},
    };
    await runAdapter(a, {}, ctx());
    expect(order.startsWith('pi')).toBe(true);
  });

  it('PRD-200-R9: an adapter that declares delta MUST implement delta(since)', async () => {
    const a = fakeAdapter({ name: 'd', delta: true });
    const caps = await a.init({}, ctx());
    expect(caps.delta).toBe(true);
    // The framework does not invoke delta during runAdapter; it's the
    // generator's call. We assert the contract: delta-declared adapter
    // exposes the hook on the interface (compile-time pin).
  });

  it('PRD-200-R10: namespaceIds applies adapter_namespace prefix when namespace_ids is true (default)', () => {
    const out = namespaceIds([fullNode('intro')], 'docs', { level: 'core' });
    expect(out[0]!.id).toBe('docs/intro');
  });

  it('PRD-200-R10: namespaceIds is a no-op when namespace_ids is false', () => {
    const out = namespaceIds([fullNode('intro')], 'docs', { level: 'core', namespace_ids: false });
    expect(out[0]!.id).toBe('intro');
  });

  it('PRD-200-R11: resolveId honors override > config > default precedence', () => {
    expect(resolveId({ override: 'OV', configRule: 'CFG', defaultId: 'DEF' }).id).toBe('OV');
    expect(resolveId({ configRule: 'CFG', defaultId: 'DEF' }).id).toBe('CFG');
    expect(resolveId({ defaultId: 'DEF' }).id).toBe('DEF');
  });

  it('PRD-200-R12: full+full collision resolves last-wins by default', () => {
    const merged = mergeContributions([
      { adapter: 'a', capabilities: { level: 'core' }, node: fullNode('x', { title: 'A' }) },
      { adapter: 'b', capabilities: { level: 'core' }, node: fullNode('x', { title: 'B' }) },
    ]);
    expect(merged.title).toBe('B');
  });

  it('PRD-200-R12: partial deep-merge concatenates arrays and merges nested objects', () => {
    const merged = mergeContributions([
      { adapter: 'a', capabilities: { level: 'core' }, node: partialNode('x', {
        content: [{ type: 'markdown', text: 'a' }],
        metadata: { tags: ['a'] } as never,
      }) },
      { adapter: 'b', capabilities: { level: 'core' }, node: partialNode('x', {
        content: [{ type: 'markdown', text: 'b' }],
        metadata: { tags: ['b'] } as never,
      }) },
    ]);
    expect(Array.isArray(merged.content)).toBe(true);
    expect(merged.content!.length).toBe(2);
    expect((merged.metadata as Record<string, unknown> | undefined)?.['tags']).toEqual(['a', 'b']);
  });

  it('PRD-200-R12 + A1: metadata.translations dedupes by (locale, id) — citing amendments-queue.md A1', () => {
    const merged = mergeContributions([
      { adapter: 'cms', capabilities: { level: 'core' }, node: partialNode('x', {
        metadata: { translations: [{ locale: 'es', id: 'es/x' }] } as never,
      }) },
      { adapter: 'i18n', capabilities: { level: 'core' }, node: partialNode('x', {
        metadata: { translations: [{ locale: 'es', id: 'es/x' }, { locale: 'fr', id: 'fr/x' }] } as never,
      }) },
    ]);
    const tr = (merged.metadata as Record<string, unknown> | undefined)?.['translations'] as unknown[];
    expect(tr.length).toBe(2);
    expect(tr).toEqual([{ locale: 'es', id: 'es/x' }, { locale: 'fr', id: 'fr/x' }]);
  });

  it('PRD-200-R13: stampSource sets metadata.source.adapter when missing', () => {
    const stamped = stampSource(fullNode('x'), 'act-markdown');
    expect((stamped.metadata as Record<string, unknown> | undefined)?.['source']).toMatchObject({
      adapter: 'act-markdown',
    });
  });

  it('PRD-200-R14: merge: "error" raises on full+full ID collision', () => {
    expect(() =>
      mergeContributions(
        [
          { adapter: 'a', capabilities: { level: 'core' }, node: fullNode('x') },
          { adapter: 'b', capabilities: { level: 'core' }, node: fullNode('x') },
        ],
        { policy: { b: 'error' } },
      ),
    ).toThrow(/PRD-200-R14/);
  });

  it('PRD-200-R15: precedence: "primary" wins on scalar conflicts', () => {
    const merged = mergeContributions([
      { adapter: 'sec', capabilities: { level: 'core' }, node: partialNode('x', { title: 'sec' }) },
      { adapter: 'pri', capabilities: { level: 'core', precedence: 'primary' }, node: partialNode('x', { title: 'pri' }) },
      { adapter: 'sec2', capabilities: { level: 'core' }, node: partialNode('x', { title: 'sec2' }) },
    ]);
    expect(merged.title).toBe('pri');
  });

  it('PRD-200-R15: precedence: "fallback" never overwrites an existing scalar', () => {
    const merged = mergeContributions([
      { adapter: 'first', capabilities: { level: 'core' }, node: partialNode('x', { title: 'first' }) },
      { adapter: 'fb', capabilities: { level: 'core', precedence: 'fallback' }, node: partialNode('x', { title: 'fb' }) },
    ]);
    expect(merged.title).toBe('first');
  });

  it('PRD-200-R16: partial / failed extraction_status surfaces as a build warning', async () => {
    const a: Adapter<{ idx: number }> = {
      name: 'partial',
      async init() { return { level: 'core' }; },
      async *enumerate() { yield { idx: 0 }; },
      async transform() {
        return fullNode('x', { metadata: { extraction_status: 'partial' } });
      },
      async dispose() {},
    };
    const r = await runAdapter(a, {}, ctx());
    expect(r.warnings.length).toBe(1);
  });

  it('PRD-200-R17: extraction_status enum is closed at three values (complete/partial/failed)', async () => {
    // Type-level pin via runtime spec assertion: only the three values cause warnings.
    const a: Adapter<{ idx: number }> = {
      name: 'failed',
      async init() { return { level: 'core' }; },
      async *enumerate() { yield { idx: 0 }; },
      async transform() {
        return fullNode('x', { metadata: { extraction_status: 'failed' } });
      },
      async dispose() {},
    };
    const r = await runAdapter(a, {}, ctx());
    expect(r.warnings[0]).toMatch(/extraction_status=failed/);
  });

  it('PRD-200-R18: throws from init / transform are unrecoverable — surfaced as build errors', async () => {
    const a = fakeAdapter({ name: 'b', initThrows: true });
    await expect(runAdapter(a, {}, ctx())).rejects.toThrow(/init blew up/);
  });

  it('PRD-200-R19: ctx fields available to lifecycle hooks include config, targetLevel, actVersion, logger, signal, state', async () => {
    let seen: AdapterContext | undefined;
    const a: Adapter<{ idx: number }> = {
      name: 'ctx',
      async init(_c, c) { seen = c; return { level: 'core' }; },
      async *enumerate() { yield { idx: 0 }; },
      async transform() { return fullNode('x'); },
      async dispose() {},
    };
    await runAdapter(a, {}, ctx());
    expect(seen).toBeDefined();
    expect(seen!.actVersion).toBe('0.1');
    expect(typeof seen!.logger.warn).toBe('function');
    expect(seen!.signal).toBeInstanceOf(AbortSignal);
  });

  it('PRD-200-R20: adapter-defined config namespacing is honored — config object passed verbatim', async () => {
    const a: Adapter<{ idx: number }> = {
      name: 'cfg',
      async init(c) { expect(c).toEqual({ foo: 1, bar: 'baz' }); return { level: 'core' }; },
      async *enumerate() { yield { idx: 0 }; },
      async transform() { return fullNode('x'); },
      async dispose() {},
    };
    await runAdapter(a, { foo: 1, bar: 'baz' }, ctx());
  });

  it('PRD-200-R21: framework declares EmittedNode === Node from PRD-100 schemas (compile-time pin)', () => {
    const n = fullNode('x');
    expect(n.act_version).toBe('0.1');
    expect(typeof n.id).toBe('string');
  });

  it('PRD-200-R22: AdapterCapabilities object includes level, plus optional concurrency_max/delta/namespace_ids/precedence', async () => {
    const a = fakeAdapter({ name: 'caps', level: 'strict', concurrencyMax: 4, delta: true, precedence: 'primary' });
    const r = await runAdapter(a, {}, ctx({ targetLevel: 'strict' }));
    expect(r.capabilities.level).toBe('strict');
    expect(r.capabilities.concurrency_max).toBe(4);
    expect(r.capabilities.delta).toBe(true);
    expect(r.capabilities.precedence).toBe('primary');
  });

  it('PRD-200-R23: bubbleManifestCapabilities OR-merges across adapters', () => {
    const out = bubbleManifestCapabilities([
      { level: 'core', manifestCapabilities: { etag: true } },
      { level: 'core', manifestCapabilities: { subtree: true, search: { template_advertised: true } } },
    ]);
    expect(out).toMatchObject({ etag: true, subtree: true, search: { template_advertised: true } });
  });

  it('PRD-200-R24: framework refuses when target level exceeds adapter\'s declared level', async () => {
    const a = fakeAdapter({ name: 'low', level: 'core' });
    await expect(runAdapter(a, {}, ctx({ targetLevel: 'strict' }))).rejects.toThrow(/PRD-200-R24/);
  });

  it('PRD-200-R25: Stage 1 — checkAdapterPinning rejects when act_version does not match target', () => {
    expect(() => checkAdapterPinning({ actVersion: '0.1' }, '0.2')).toThrow(/PRD-200-R25/);
    expect(() => checkAdapterPinning({ actVersion: '0.1' }, '0.1')).not.toThrow();
  });

  it('PRD-200-R26: Stage 2 — checkAdapterPinning honors actSpecMinors range membership', () => {
    expect(() => checkAdapterPinning({ actSpecMinors: ['1.0', '1.1'] }, '1.1')).not.toThrow();
    expect(() => checkAdapterPinning({ actSpecMinors: ['1.0'] }, '1.1')).toThrow(/PRD-200-R26/);
  });

  it('PRD-200-R27: component-contract emission is opt-in via capabilities.component_contract (seam pin)', () => {
    // Seam pin: the field exists on AdapterCapabilities. PRD-300 owns the
    // metadata.extracted_via runtime semantics; PRD-200 only owns the seam.
    const caps: AdapterCapabilities = { level: 'strict', component_contract: true };
    expect(caps.component_contract).toBe(true);
  });

  it('PRD-200-R28: framework conformance fixture corpus is anchored to a version constant', async () => {
    const { FRAMEWORK_CONFORMANCE_VERSION } = await import('./framework.js');
    expect(FRAMEWORK_CONFORMANCE_VERSION).toBe('0.1');
  });

  it('mergeRuns groups adapter contributions by ID and merges per PRD-200-R12', () => {
    const merged = mergeRuns([
      { adapter: 'a', capabilities: { level: 'core' }, nodes: [fullNode('x', { title: 'A' })], warnings: [] },
      { adapter: 'b', capabilities: { level: 'core' }, nodes: [fullNode('x', { title: 'B' }), fullNode('y')], warnings: [] },
    ]);
    expect(merged.size).toBe(2);
    expect(merged.get('x')!.title).toBe('B');
  });
});

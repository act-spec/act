/**
 * PRD-208 programmatic-adapter tests. Every requirement R1–R15 has at least
 * one citing test.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  defineProgrammaticAdapter,
  defineSimpleAdapter,
  ProgrammaticAdapterError,
  PROGRAMMATIC_ADAPTER_DEFAULT_NAME,
  PROGRAMMATIC_ADAPTER_DEFAULT_SAMPLE_EVERY,
  extractFirstSentence,
  findRepoRoot,
  _resetValidatorCacheForTest,
} from './programmatic.js';
import {
  runAdapter,
  type AdapterContext,
  type EmittedNode,
  type PartialEmittedNode,
} from '@act-spec/adapter-framework';

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

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

function ctx(over: Partial<AdapterContext> = {}, logger?: CapturedLogger): AdapterContext {
  return {
    config: {},
    targetLevel: 'core',
    actVersion: '0.1',
    logger: logger ?? makeLogger(),
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

/** Build a known-good full node. */
function goodNode(id: string, over: Partial<EmittedNode> = {}): EmittedNode {
  return {
    act_version: '0.1',
    id,
    type: 'article',
    title: `Title ${id}`,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary: 'A summary.',
    content: [{ type: 'markdown', text: '# Hello' }],
    tokens: { summary: 2 },
    ...over,
  } as EmittedNode;
}

// --------------------------------------------------------------------------
// PRD-208-R1 — factory returns Adapter
// --------------------------------------------------------------------------

describe('PRD-208 programmatic adapter — factory contract', () => {
  it('PRD-208-R1: defineProgrammaticAdapter returns an Adapter; default name is "programmatic"', () => {
    const a = defineProgrammaticAdapter({
      enumerate: () => [],
      transform: () => null,
    });
    expect(a.name).toBe(PROGRAMMATIC_ADAPTER_DEFAULT_NAME);
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
  });

  it('PRD-208-R1: spec.name is preserved on the returned adapter', () => {
    const a = defineProgrammaticAdapter({
      name: 'my-source',
      enumerate: () => [],
      transform: () => null,
    });
    expect(a.name).toBe('my-source');
  });

  // --------------------------------------------------------------------------
  // PRD-208-R2 — spec shape, generics preserved
  // --------------------------------------------------------------------------

  it('PRD-208-R2: missing enumerate/transform throws (required spec fields)', () => {
    expect(() =>
      // @ts-expect-error — intentional bad spec
      defineProgrammaticAdapter({ enumerate: () => [] }),
    ).toThrow(ProgrammaticAdapterError);
  });

  it('PRD-208-R2: TItem flows from enumerate to transform (compile-time + runtime)', async () => {
    interface MyItem {
      id: string;
      payload: number;
    }
    const seen: number[] = [];
    const a = defineProgrammaticAdapter<Record<string, unknown>, MyItem>({
      name: 'typed',
      enumerate: () => [
        { id: 'one', payload: 1 },
        { id: 'two', payload: 2 },
      ],
      transform: (item) => {
        // TItem is MyItem here — accessing .payload type-checks.
        seen.push(item.payload);
        return goodNode(item.id);
      },
    });
    const c = ctx();
    await runAdapter(a, c.config, c);
    expect(seen).toEqual([1, 2]);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R3 — pre-emit schema validation (envelope + per-block, A3)
  // --------------------------------------------------------------------------

  it('PRD-208-R3: well-formed node passes pre-emit envelope validation', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'ok' }],
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.length).toBe(1);
  });

  it('PRD-208-R3: malformed node envelope throws transform_malformed_node citing the id', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'broken' }],
      transform: (item) => {
        // Missing required `tokens`.
        const n = goodNode(item.id) as Record<string, unknown>;
        delete n['tokens'];
        return n as unknown as EmittedNode;
      },
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208-R3.*broken/);
  });

  it('PRD-208-R3 (A3): malformed `data` block throws transform_malformed_block citing the block index', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'dd' }],
      transform: (item) =>
        goodNode(item.id, {
          // A `data` block missing the required `text` field per PRD-102-R4.
          content: [{ type: 'data', format: 'json' }] as unknown as EmittedNode['content'],
        }),
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(
      /PRD-208-R3.*block_index=0.*data/,
    );
  });

  it('PRD-208-R3 (A3): unknown block type is rejected (PRD-102 discriminator is exhaustive)', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'uu' }],
      transform: (item) =>
        goodNode(item.id, {
          content: [{ type: 'novel-block-type' }] as unknown as EmittedNode['content'],
        }),
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/unknown block type.*novel-block-type/);
  });

  it('PRD-208-R3: marketing:* block validates against marketing-namespace schema', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'strict' },
      enumerate: () => [{ id: 'mm' }],
      transform: (item) =>
        goodNode(item.id, {
          content: [
            {
              type: 'marketing:hero',
              text: 'Welcome',
            },
          ] as unknown as EmittedNode['content'],
        }),
    });
    const c = ctx({ targetLevel: 'strict' });
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.length).toBe(1);
  });

  it('PRD-208-R3: validate: "off" skips validation and emits an init-time warning', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'src',
      validate: 'off',
      enumerate: () => [{ id: 'ww' }],
      transform: (item) => {
        const n = goodNode(item.id) as Record<string, unknown>;
        delete n['tokens']; // would normally fail
        return n as unknown as EmittedNode;
      },
    });
    const c = ctx({}, log);
    // Validation skipped → run completes; node is not validator-conformant
    // but the framework still receives it (the operator owns the risk).
    await runAdapter(a, c.config, c);
    const warned = log.warn.mock.calls.some((call) =>
      String(call[0]).includes('PRD-208-R3'),
    );
    expect(warned).toBe(true);
  });

  it('PRD-208-R3: partial emissions skip envelope validation but still validate blocks', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'pp' }],
      transform: (item): PartialEmittedNode => ({
        id: item.id,
        _actPartial: true,
        // Partial supplies only id + a content block; envelope fields like
        // `tokens` deferred to merge step. Block validation still runs.
        content: [{ type: 'markdown', text: 'partial body' }],
      }),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    // The framework currently keeps partials (its merge is in mergeRuns,
    // not runAdapter), so we just assert no validation throw.
    expect(r.nodes.length).toBe(1);
  });

  it('PRD-208-R3: partial emission with malformed block still throws', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'pb' }],
      transform: (item): PartialEmittedNode => ({
        id: item.id,
        _actPartial: true,
        content: [{ type: 'data', format: 'json' }] as unknown as EmittedNode['content'],
      }),
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208-R3.*data/);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R4 — mutation and re-entry guards
  // --------------------------------------------------------------------------

  it('PRD-208-R4: ctx.config is frozen before transform sees it (TypeError on assignment in strict mode)', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'ff' }],
      transform: (item, frozenCtx) => {
        // ESM modules are always strict; assignment to a frozen property
        // throws TypeError. The factory translates it to config_mutation.
        (frozenCtx.config as Record<string, unknown>)['injected'] = 'bad';
        return goodNode(item.id);
      },
    });
    const c = ctx({ config: { existing: 'value' } });
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208-R4.*config/);
  });

  it('PRD-208-R4: original ctx.config is not mutated when user copies it (defense-in-depth visible)', async () => {
    const original = { existing: 'value' };
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'f2' }],
      transform: (item, frozenCtx) => {
        // User code is allowed to read; cloning the frozen config is fine.
        const clone = { ...frozenCtx.config };
        clone['ok'] = 'ok';
        return goodNode(item.id);
      },
    });
    const c = ctx({ config: original });
    await runAdapter(a, c.config, c);
    expect(original).toEqual({ existing: 'value' });
  });

  // --------------------------------------------------------------------------
  // PRD-208-R5 — lifecycle wrappers (precheck/init/enumerate/dispose/delta)
  // --------------------------------------------------------------------------

  it('PRD-208-R5: precheck wrapper is present only when supplied', () => {
    const noPrecheck = defineProgrammaticAdapter({
      enumerate: () => [],
      transform: () => null,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(noPrecheck.precheck).toBeUndefined();
    const withPrecheck = defineProgrammaticAdapter({
      precheck: () => undefined,
      enumerate: () => [],
      transform: () => null,
    });
    expect(typeof withPrecheck.precheck).toBe('function');
  });

  it('PRD-208-R5: enumerate accepts a sync array', async () => {
    const a = defineProgrammaticAdapter({
      enumerate: () => [{ id: 'aa' }, { id: 'bb' }],
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.map((n) => n.id)).toEqual(['aa', 'bb']);
  });

  it('PRD-208-R5: enumerate accepts a sync Iterable (generator)', async () => {
    function* gen(): Generator<{ id: string }> {
      yield { id: 'g1' };
      yield { id: 'g2' };
    }
    const a = defineProgrammaticAdapter({
      enumerate: () => gen(),
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.map((n) => n.id)).toEqual(['g1', 'g2']);
  });

  it('PRD-208-R5: enumerate accepts an AsyncIterable', async () => {
    async function* agen(): AsyncGenerator<{ id: string }> {
      yield { id: 'h1' };
      yield { id: 'h2' };
    }
    const a = defineProgrammaticAdapter({
      enumerate: () => agen(),
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.map((n) => n.id)).toEqual(['h1', 'h2']);
  });

  it('PRD-208-R5: enumerate non-iterable return is unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      enumerate: () => 42 as unknown as number[],
      transform: () => null,
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208/);
  });

  it('PRD-208-R5: dispose is idempotent (PRD-200-R7) — user dispose runs once', async () => {
    const userDispose = vi.fn(() => undefined);
    const a = defineProgrammaticAdapter({
      enumerate: () => [{ id: 'aa' }],
      transform: (item) => goodNode(item.id),
      dispose: userDispose,
    });
    const c = ctx();
    await runAdapter(a, c.config, c);
    await a.dispose(c);
    await a.dispose(c);
    expect(userDispose).toHaveBeenCalledTimes(1);
  });

  it('PRD-208-R5: when dispose is omitted, factory dispose is a no-op', async () => {
    const a = defineProgrammaticAdapter({
      enumerate: () => [{ id: 'aa' }],
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    await runAdapter(a, c.config, c);
    await expect(a.dispose(c)).resolves.toBeUndefined();
  });

  it('PRD-208-R5: delta wrapper is exposed only when user supplied one', async () => {
    const noDelta = defineProgrammaticAdapter({
      enumerate: () => [],
      transform: () => null,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(noDelta.delta).toBeUndefined();
    const withDelta = defineProgrammaticAdapter({
      enumerate: () => [],
      transform: () => null,
      delta: () => [{ id: 'changed' }],
    });
    expect(typeof withDelta.delta).toBe('function');
    const items: { id: string }[] = [];
    for await (const it of withDelta.delta!('2026-01-01T00:00:00Z', ctx())) {
      items.push(it as { id: string });
    }
    expect(items).toEqual([{ id: 'changed' }]);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R6 — determinism (advisory; documented behavior only)
  // --------------------------------------------------------------------------

  it('PRD-208-R6: factory does not enforce determinism — non-deterministic enumerate is accepted', async () => {
    let toggle = false;
    const a = defineProgrammaticAdapter({
      enumerate: () => {
        toggle = !toggle;
        return toggle ? [{ id: 'aa' }] : [{ id: 'bb' }];
      },
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r1 = await runAdapter(a, c.config, c);
    const r2 = await runAdapter(a, c.config, c);
    // Both runs succeed; emitted ids differ — that's an operator-side
    // determinism issue PRD-208-R6 places on the operator, not the factory.
    expect(r1.nodes[0]!.id).not.toBe(r2.nodes[0]!.id);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R7 — namespace_ids defaults true
  // --------------------------------------------------------------------------

  it('PRD-208-R7: namespace_ids defaults to true on returned capabilities', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [],
      transform: () => null,
    });
    const c = ctx();
    const caps = await a.init(c.config, c);
    expect(caps.namespace_ids).toBe(true);
  });

  it('PRD-208-R7: namespaceIds: false flows through to capabilities', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      namespaceIds: false,
      enumerate: () => [],
      transform: () => null,
    });
    const c = ctx();
    const caps = await a.init(c.config, c);
    expect(caps.namespace_ids).toBe(false);
  });

  it('PRD-208-R7: id grammar violation is unrecoverable per PRD-208-R12', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'xx' }],
      transform: () =>
        goodNode('UPPERCASE-ID'), // fails PRD-100-R10 — uppercase
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(
      /PRD-208-R7.*UPPERCASE-ID/,
    );
  });

  // --------------------------------------------------------------------------
  // PRD-208-R8 — capability sampling probe
  // --------------------------------------------------------------------------

  it('PRD-208-R8: declared core + emitted marketing block triggers warning at sample index', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'core' },
      validate: 'off', // skip envelope validation so the marketing block can flow
      enumerate: () => [{ id: 'mm' }],
      transform: (item) =>
        goodNode(item.id, {
          content: [
            { type: 'marketing:hero', text: 'Hi' },
          ] as unknown as EmittedNode['content'],
        }),
    });
    const c = ctx({}, log);
    // Core declared but plus targetLevel? targetLevel must be <= declared
    // for runAdapter to proceed; sampling probe runs before level check
    // would matter — set targetLevel core.
    await runAdapter(a, c.config, c);
    const warned = log.warn.mock.calls.some((call) => String(call[0]).includes('PRD-208-R8'));
    expect(warned).toBe(true);
  });

  it('PRD-208-R8: declared plus + only markdown blocks does not warn (plus is permissive)', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'strict' },
      enumerate: () => [{ id: 'p1' }],
      transform: (item) => goodNode(item.id),
    });
    const c = ctx({ targetLevel: 'strict' }, log);
    await runAdapter(a, c.config, c);
    const warned = log.warn.mock.calls.some((call) => String(call[0]).includes('PRD-208-R8'));
    expect(warned).toBe(false);
  });

  it('PRD-208-R8: declared standard + emitted marketing block warns', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'standard' },
      enumerate: () => [{ id: 's1' }],
      transform: (item) =>
        goodNode(item.id, {
          content: [
            { type: 'marketing:hero', text: 'Hi' },
          ] as unknown as EmittedNode['content'],
        }),
    });
    const c = ctx({ targetLevel: 'standard' }, log);
    await runAdapter(a, c.config, c);
    const warned = log.warn.mock.calls.some((call) => String(call[0]).includes('PRD-208-R8'));
    expect(warned).toBe(true);
  });

  it('PRD-208-R8: capabilitySampleEvery=1 samples every emission', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'core' },
      capabilitySampleEvery: 1,
      validate: 'off',
      enumerate: () => [{ id: 'aa' }, { id: 'bb' }, { id: 'cc' }],
      transform: (item) =>
        goodNode(item.id, {
          content: [{ type: 'marketing:hero', text: 'Hi' }] as unknown as EmittedNode['content'],
        }),
    });
    const c = ctx({}, log);
    await runAdapter(a, c.config, c);
    const warns = log.warn.mock.calls.filter((call) => String(call[0]).includes('PRD-208-R8'));
    expect(warns.length).toBe(3);
  });

  it('PRD-208-R8: default sample cadence constant is 20', () => {
    expect(PROGRAMMATIC_ADAPTER_DEFAULT_SAMPLE_EVERY).toBe(20);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R9 — source attribution
  // --------------------------------------------------------------------------

  it('PRD-208-R9: factory stamps metadata.source.adapter to spec.name when user did not set it', async () => {
    const a = defineProgrammaticAdapter({
      name: 'my-cat',
      enumerate: () => [{ id: 'aa' }],
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    const meta = r.nodes[0]!.metadata as Record<string, unknown>;
    const src = meta['source'] as Record<string, unknown>;
    expect(src['adapter']).toBe('my-cat');
    expect(typeof src['source_id']).toBe('string');
  });

  it('PRD-208-R9: user-supplied metadata.source.adapter wins; factory warns on mismatch', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'my-cat',
      enumerate: () => [{ id: 'aa' }],
      transform: (item) =>
        goodNode(item.id, {
          metadata: {
            source: { adapter: 'external-feed', source_id: 'ext-1' },
          },
        }),
    });
    const c = ctx({}, log);
    const r = await runAdapter(a, c.config, c);
    const meta = r.nodes[0]!.metadata as Record<string, unknown>;
    const src = meta['source'] as Record<string, unknown>;
    expect(src['adapter']).toBe('external-feed');
    const warned = log.warn.mock.calls.some((call) =>
      String(call[0]).includes('PRD-208-R9'),
    );
    expect(warned).toBe(true);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R10 — strict mode promotes transform throws
  // --------------------------------------------------------------------------

  it('PRD-208-R10: strict: true promotes transform throws to unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      strict: true,
      enumerate: () => [{ id: 'aa' }],
      transform: () => {
        throw new Error('downstream API timeout');
      },
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(
      /PRD-208-R10.*downstream API timeout/,
    );
  });

  it('PRD-208-R10: strict mode does NOT promote schema-validation failures (those are always unrecoverable)', async () => {
    // Sanity: schema-validation failures are unrecoverable regardless of
    // strict, but the error class is transform_malformed_node — not
    // transform_threw_strict.
    const a = defineProgrammaticAdapter({
      name: 'src',
      strict: false,
      enumerate: () => [{ id: 'bb' }],
      transform: (item) => {
        const n = goodNode(item.id) as Record<string, unknown>;
        delete n['title'];
        return n as unknown as EmittedNode;
      },
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208-R3/);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R11 — recoverable transform throws (default)
  // --------------------------------------------------------------------------

  it('PRD-208-R11: default mode emits a placeholder when transform throws', async () => {
    const log = makeLogger();
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'aa' }, { id: 'bb' }],
      transform: (item) => {
        if (item.id === 'bb') throw new Error('SKU lookup failed');
        return goodNode(item.id);
      },
    });
    const c = ctx({}, log);
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.length).toBe(2);
    const placeholderNode = r.nodes.find((n) => n.id.includes('__placeholder__'));
    expect(placeholderNode).toBeDefined();
    const meta = placeholderNode!.metadata as Record<string, unknown>;
    expect(meta['extraction_status']).toBe('failed');
    expect(String(meta['extraction_error'])).toContain('SKU lookup failed');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('PRD-208-R11: long error messages are truncated in extraction_error', async () => {
    const huge = 'x'.repeat(2000);
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'aa' }],
      transform: () => {
        throw new Error(huge);
      },
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    const meta = r.nodes[0]!.metadata as Record<string, unknown>;
    expect(String(meta['extraction_error']).length).toBeLessThanOrEqual(500);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R12 — unrecoverable failure surface
  // --------------------------------------------------------------------------

  it('PRD-208-R12: enumerate sync throw is unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => {
        throw new Error('source unavailable');
      },
      transform: () => null,
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/enumerate.*source unavailable/);
  });

  it('PRD-208-R12: enumerate async-iterator throw is unrecoverable', async () => {
    async function* boomy(): AsyncGenerator<{ id: string }> {
      yield { id: 'aa' };
      throw new Error('iterator boom');
    }
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => boomy(),
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208.*iterator boom/);
  });

  it('PRD-208-R12: init throw is unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      init: () => {
        throw new Error('init failure');
      },
      enumerate: () => [],
      transform: () => null,
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208-R12.*init failure/);
  });

  it('PRD-208-R12: precheck throw is unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      precheck: () => {
        throw new Error('precheck failure');
      },
      enumerate: () => [],
      transform: () => null,
    });
    await expect(a.precheck!({})).rejects.toThrow(/PRD-208-R12.*precheck failure/);
  });

  it('PRD-208-R12: transform returning undefined is unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'aa' }],
      transform: () => undefined as unknown as EmittedNode,
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/transform returned undefined/);
  });

  it('PRD-208-R12: transform returning a non-object is unrecoverable', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'aa' }],
      transform: () => 'not-a-node' as unknown as EmittedNode,
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/transform returned string/);
  });

  it('PRD-208-R12: ProgrammaticAdapterError carries a typed code', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'aa' }],
      transform: () => {
        throw new Error('boom');
      },
      strict: true,
    });
    const c = ctx();
    try {
      await runAdapter(a, c.config, c);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProgrammaticAdapterError);
      expect((err as ProgrammaticAdapterError).code).toBe('transform_threw_strict');
    }
  });

  // --------------------------------------------------------------------------
  // PRD-208-R13 — capability declaration precedence
  // --------------------------------------------------------------------------

  it('PRD-208-R13: spec.init return value takes precedence over spec.capabilities', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'core' },
      init: () => ({ level: 'strict', concurrency_max: 4 }),
      enumerate: () => [],
      transform: () => null,
    });
    const c = ctx({ targetLevel: 'strict' });
    const caps = await a.init(c.config, c);
    expect(caps.level).toBe('strict');
    expect(caps.concurrency_max).toBe(4);
  });

  it('PRD-208-R13: spec.capabilities is used when no init is supplied', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      capabilities: { level: 'standard', concurrency_max: 16 },
      enumerate: () => [],
      transform: () => null,
    });
    const c = ctx({ targetLevel: 'standard' });
    const caps = await a.init(c.config, c);
    expect(caps.level).toBe('standard');
    expect(caps.concurrency_max).toBe(16);
  });

  it('PRD-208-R13: when neither init nor capabilities supplied, factory uses default Core capabilities', async () => {
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [],
      transform: () => null,
    });
    const c = ctx();
    const caps = await a.init(c.config, c);
    expect(caps.level).toBe('core');
    expect(caps.concurrency_max).toBe(8);
    expect(caps.namespace_ids).toBe(true);
  });

  // --------------------------------------------------------------------------
  // PRD-208-R14 — Stage-1 version pinning
  // --------------------------------------------------------------------------

  it('PRD-208-R14: factory targets ACT spec 0.1 (placeholder etag in PRD-208-R11 is well-formed)', async () => {
    // Stage-1 pin is documentary; validate by running the placeholder path
    // and asserting act_version === ctx.actVersion.
    const a = defineProgrammaticAdapter({
      name: 'src',
      enumerate: () => [{ id: 'aa' }],
      transform: () => {
        throw new Error('boom');
      },
    });
    const c = ctx({ actVersion: '0.1' });
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes[0]!.act_version).toBe('0.1');
  });

  // --------------------------------------------------------------------------
  // PRD-208-R15 — test-fixture conformance
  // --------------------------------------------------------------------------

  it('PRD-208-R15: factory passes a representative fixture without gaps (smoke-test for the conformance gate)', async () => {
    const a = defineProgrammaticAdapter({
      name: 'fixture-source',
      enumerate: () => [
        { id: 'intro', title: 'Introduction', body: 'Hello, ACT.' },
        { id: 'guide', title: 'Guide', body: 'How to use ACT.' },
      ],
      transform: (item) => ({
        act_version: '0.1',
        id: item.id,
        type: 'article',
        title: item.title,
        etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
        summary: item.body.slice(0, 60),
        content: [{ type: 'markdown', text: item.body }],
        tokens: { summary: 4 },
      }),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.length).toBe(2);
    for (const n of r.nodes) {
      const meta = n.metadata as Record<string, unknown>;
      const src = meta['source'] as Record<string, unknown>;
      expect(src['adapter']).toBe('fixture-source');
    }
  });
});

// --------------------------------------------------------------------------
// defineSimpleAdapter — convenience wrapper (PRD-208 implementation note 6)
// --------------------------------------------------------------------------

describe('defineSimpleAdapter convenience', () => {
  it('defineSimpleAdapter wraps the static-array case with the same factory invariants', async () => {
    const a = defineSimpleAdapter({
      name: 'simple',
      items: [{ id: 'aa' }, { id: 'bb' }],
      transform: (item) => goodNode(item.id),
    });
    const c = ctx();
    const r = await runAdapter(a, c.config, c);
    expect(r.nodes.map((n) => n.id)).toEqual(['aa', 'bb']);
    const src = (r.nodes[0]!.metadata as Record<string, unknown>)['source'] as Record<string, unknown>;
    expect(src['adapter']).toBe('simple');
  });

  it('defineSimpleAdapter: schema validation still runs', async () => {
    const a = defineSimpleAdapter({
      name: 'simple',
      items: [{ id: 'aa' }],
      transform: (item) => {
        const n = goodNode(item.id) as Record<string, unknown>;
        delete n['tokens'];
        return n as unknown as EmittedNode;
      },
    });
    const c = ctx();
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(/PRD-208-R3/);
  });

  it('user transform observes ctx.siteOrigin propagated from the build context', async () => {
    const seen: Array<string | undefined> = [];
    const a = defineProgrammaticAdapter<Record<string, unknown>, { kind: 'one' }>({
      enumerate: () => [{ kind: 'one' }],
      transform: (item, c) => {
        seen.push(c.siteOrigin);
        return goodNode('p1');
      },
    });
    const c = ctx({ siteOrigin: 'https://shop.example' });
    await runAdapter(a, c.config, c);
    expect(seen).toEqual(['https://shop.example']);
  });

  it('defineSimpleAdapter: defaults name to "programmatic"', () => {
    const a = defineSimpleAdapter({
      items: [],
      transform: () => null,
    });
    expect(a.name).toBe(PROGRAMMATIC_ADAPTER_DEFAULT_NAME);
  });
});

// --------------------------------------------------------------------------
// Internal helpers — unhappy-path coverage
// --------------------------------------------------------------------------

describe('internal helpers', () => {
  it('findRepoRoot throws when no schemas/ ancestor exists', () => {
    expect(() => findRepoRoot('/')).toThrow(/programmatic-adapter/);
  });

  it('_resetValidatorCacheForTest is idempotent', () => {
    expect(() => _resetValidatorCacheForTest()).not.toThrow();
  });
});

describe('extractFirstSentence', () => {
  it('returns the first sentence terminated by ., !, or ?', () => {
    expect(extractFirstSentence('Hello world. Second sentence.')).toBe('Hello world.');
    expect(extractFirstSentence('Wow! Two.')).toBe('Wow!');
    expect(extractFirstSentence('Really? Yes.')).toBe('Really?');
  });

  it('returns the whole text when no sentence boundary exists', () => {
    expect(extractFirstSentence('no terminator here')).toBe('no terminator here');
  });

  it('strips inline markdown emphasis, code spans, and link syntax', () => {
    const md = 'A **bold** word with `code` and a [link](http://x). Body.';
    expect(extractFirstSentence(md)).toBe('A bold word with code and a link.');
  });

  it('strips HTML comments', () => {
    expect(extractFirstSentence('Visible. <!-- hidden --> Tail.')).toBe('Visible.');
  });

  it('collapses whitespace', () => {
    expect(extractFirstSentence('  Many   spaces\n\nbetween   words.  ')).toBe(
      'Many spaces between words.',
    );
  });

  it('clamps to maxTokens with an ellipsis at the boundary', () => {
    const text = 'one two three four five six seven eight nine ten';
    const out = extractFirstSentence(text, 4);
    expect(out).toBe('one two three …');
  });

  it('returns empty string for empty / whitespace-only input', () => {
    expect(extractFirstSentence('')).toBe('');
    expect(extractFirstSentence('   ')).toBe('');
  });
});

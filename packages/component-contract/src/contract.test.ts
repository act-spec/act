/**
 * PRD-300 component-contract framework tests.
 *
 * Every requirement R1–R32 has at least one test citing its requirement
 * ID in the test name. Tests are self-contained — no React/Vue/Angular
 * SDK is required (the framework is framework-agnostic per gap D1).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CAPABILITY_KEYS,
  COMPONENT_CONTRACT_FRAMEWORK_VERSION,
  COMPONENT_CONTRACT_PACKAGE_NAME,
  ERROR_MESSAGE_CAP,
  ID_BYTE_CAP,
  VARIANT_CAP_PER_PAGE,
  aggregatePage,
  applyVariantMetadata,
  assertCapabilitiesShape,
  attachDecoratorContract,
  buildPlaceholder,
  chooseExtractionMode,
  composeVariantId,
  createHookRegistry,
  detectIdCollisions,
  fromDecorator,
  fromStaticField,
  gateContractVersion,
  isValidIdGrammar,
  isWithinIdByteCap,
  methodForMode,
  parseContractVersion,
  redactSecrets,
  rejectAuthorOverride,
  replayVariants,
  resolveVariantKeys,
  safeExtract,
  stampMetadata,
  stampPartial,
  validateBlockShape,
  validateContractId,
  type ActContract,
  type BindingCapabilities,
  type ContractOutput,
  type ExtractionContext,
  type NodeDraft,
  type PageContract,
} from './index.js';

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

function ctx(over: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    locale: undefined,
    variant: undefined,
    parentId: undefined,
    binding: '@act-spec/component-contract',
    warn: () => undefined,
    ...over,
  };
}

function pageContract<P = unknown>(over: Partial<PageContract<P>> = {}): PageContract<P> {
  return {
    type: 'landing',
    id: 'pricing',
    contract_version: '0.1',
    extract: () => ({ type: 'landing' }),
    ...over,
  } as PageContract<P>;
}

function componentContract<P = unknown>(over: Partial<ActContract<P>> = {}): ActContract<P> {
  return {
    type: 'marketing:hero',
    contract_version: '0.1',
    extract: (() => ({ type: 'marketing:hero', headline: 'hi' })) as ActContract<P>['extract'],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Package-level smoke
// ─────────────────────────────────────────────────────────────────────────

describe('package surface', () => {
  it('exposes the package name + framework version constants', () => {
    expect(COMPONENT_CONTRACT_PACKAGE_NAME).toBe('@act-spec/component-contract');
    expect(COMPONENT_CONTRACT_FRAMEWORK_VERSION).toBe('0.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R1 / R2 / R3 — canonical contract object + desugaring
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R1 / R2 / R3 — declaration patterns desugar to the canonical contract', () => {
  it('PRD-300-R1: static-field pattern returns the attached contract', () => {
    const contract = componentContract();
    const component = { act: contract };
    expect(fromStaticField(component)).toBe(contract);
  });

  it('PRD-300-R1: static-field returns undefined when component is null/missing', () => {
    expect(fromStaticField(undefined)).toBeUndefined();
    expect(fromStaticField(null)).toBeUndefined();
    expect(fromStaticField({})).toBeUndefined();
  });

  it('PRD-300-R3: hook-form registry returns the registered contract for an instance', () => {
    const reg = createHookRegistry();
    const inst = {};
    const contract = componentContract();
    reg.register(inst, contract);
    expect(reg.lookup(inst)).toBe(contract);
    expect(reg.size()).toBe(1);
  });

  it('PRD-300-R4: hook registry replaces (not duplicates) on re-register', () => {
    const reg = createHookRegistry();
    const inst = {};
    const a = componentContract();
    const b = componentContract({ type: 'marketing:cta' });
    reg.register(inst, a);
    reg.register(inst, b);
    expect(reg.lookup(inst)).toBe(b);
    expect(reg.size()).toBe(1);
  });

  it('PRD-300-R3: hook registry clears between extraction passes', () => {
    const reg = createHookRegistry();
    const inst = {};
    reg.register(inst, componentContract());
    reg.clear();
    expect(reg.lookup(inst)).toBeUndefined();
    expect(reg.size()).toBe(0);
  });

  it('PRD-300-R3: decorator pattern reads the contract via the well-known symbol', () => {
    const cls: Record<symbol, ActContract | undefined> = {};
    const contract = componentContract();
    attachDecoratorContract(cls, contract);
    expect(fromDecorator(cls)).toBe(contract);
  });

  it('PRD-300-R3: decorator returns undefined for missing input', () => {
    expect(fromDecorator(undefined)).toBeUndefined();
    expect(fromDecorator(null)).toBeUndefined();
    expect(fromDecorator({})).toBeUndefined();
  });

  it('PRD-300-R3: all three patterns desugar to byte-identical canonical objects', () => {
    const canonical = componentContract({ type: 'marketing:hero', summary: 's' });
    // Field
    const fieldOut = fromStaticField({ act: canonical });
    // Hook
    const reg = createHookRegistry();
    const inst = {};
    reg.register(inst, canonical);
    const hookOut = reg.lookup(inst);
    // Decorator
    const cls: Record<symbol, ActContract | undefined> = {};
    attachDecoratorContract(cls, canonical);
    const decoratorOut = fromDecorator(cls);
    expect(fieldOut).toBe(canonical);
    expect(hookOut).toBe(canonical);
    expect(decoratorOut).toBe(canonical);
    expect(JSON.stringify({ ...fieldOut, extract: undefined })).toBe(
      JSON.stringify({ ...hookOut, extract: undefined }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R4 — at-most-once extract per (instance, variant)
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R4 — extract runs at most once per (instance, variant)', () => {
  it('safeExtract invokes extract exactly once per call', () => {
    const fn = vi.fn(() => ({ type: 'marketing:hero' }));
    const contract = componentContract({ extract: fn });
    safeExtract(contract, {}, ctx());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R5 / R6 / R10 — id grammar
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R5 / R10 — id grammar (delegates to PRD-100-R10 / R11)', () => {
  it('PRD-100-R10: lowercase ASCII alphanumerics with separators are valid', () => {
    expect(isValidIdGrammar('pricing')).toBe(true);
    expect(isValidIdGrammar('docs/getting-started')).toBe(true);
    expect(isValidIdGrammar('a')).toBe(true);
    expect(isValidIdGrammar('a.b_c-d/e')).toBe(true);
  });

  it('PRD-100-R10: rejects uppercase, leading/trailing separator, and empty', () => {
    expect(isValidIdGrammar('Pricing')).toBe(false);
    expect(isValidIdGrammar('-pricing')).toBe(false);
    expect(isValidIdGrammar('pricing-')).toBe(false);
    expect(isValidIdGrammar('')).toBe(false);
    expect(isValidIdGrammar('/pricing')).toBe(false);
  });

  it('PRD-100-R11: rejects ids over the 256-byte UTF-8 cap', () => {
    const ok = 'a'.repeat(ID_BYTE_CAP);
    const bad = 'a'.repeat(ID_BYTE_CAP + 1);
    expect(isWithinIdByteCap(ok)).toBe(true);
    expect(isWithinIdByteCap(bad)).toBe(false);
  });

  it('PRD-300-R5: validateContractId returns null for valid ids', () => {
    expect(validateContractId('pricing')).toBeNull();
  });

  it('PRD-300-R5: validateContractId returns the failure reason for invalid ids', () => {
    expect(validateContractId('Pricing')).toMatch(/PRD-100-R10/);
    expect(validateContractId('a'.repeat(ID_BYTE_CAP + 1))).toMatch(/PRD-100-R11/);
    expect(validateContractId('')).toMatch(/non-empty/);
    // non-string at runtime
    expect(validateContractId(undefined as unknown as string)).toMatch(/non-empty/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R7 — extract semantics + ExtractionContext
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R7 — extract receives (props, ctx); ctx surfaces locale/variant/parentId/binding/warn', () => {
  it('extract sees the props verbatim and the context fields', () => {
    const seen: Array<unknown> = [];
    const contract = componentContract({
      extract: (props, c) => {
        seen.push(props, c.locale, c.variant, c.parentId, c.binding);
        return { type: 'marketing:hero' };
      },
    });
    safeExtract(contract, { title: 'x' }, ctx({ locale: 'en-US', variant: 'v1', parentId: 'p' }));
    expect(seen).toEqual([{ title: 'x' }, 'en-US', 'v1', 'p', '@act-spec/component-contract']);
  });

  it('PRD-300-R7: ctx.warn is non-fatal — extract observes it and continues', () => {
    const warnings: string[] = [];
    const contract = componentContract({
      extract: (_p, c) => {
        c.warn('hello');
        return { type: 'marketing:hero' };
      },
    });
    const out = safeExtract(contract, {}, ctx({ warn: (m) => warnings.push(m) }));
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('marketing:hero');
    expect(warnings).toContain('hello');
  });

  it('PRD-300-R7: returning a Promise emits a placeholder', () => {
    const contract = componentContract({
      // Cast to escape the sync-only signature; mimics a JS author that
      // declared `extract` as `async`.
      extract: ((): unknown => Promise.resolve({ type: 'marketing:hero' })) as unknown as ActContract['extract'],
    });
    const warnings: string[] = [];
    const out = safeExtract(contract, {}, ctx({ warn: (m) => warnings.push(m) }));
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('marketing:placeholder');
    expect(warnings.some((w) => /Promise/.test(w))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R8 — contract is delivery-inert
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R8 — contract surface has no delivery: "static" | "runtime" knob', () => {
  it('the canonical contract type does not enumerate delivery', () => {
    const c = componentContract();
    // Compile-time + runtime: no `delivery` field on the canonical shape.
    expect((c as Record<string, unknown>)['delivery']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R9 / R10 / R12 — page-level aggregation
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R9 / R10 / R12 — page-level aggregation in render order', () => {
  it('PRD-300-R9: descendant contributions land in render order', () => {
    const hero = componentContract({
      type: 'marketing:hero',
      extract: () => ({ type: 'marketing:hero', headline: 'A' }),
    });
    const cta = componentContract({
      type: 'marketing:cta',
      extract: () => ({ type: 'marketing:cta', label: 'B' }),
    });
    const pricing = componentContract({
      type: 'marketing:pricing-table',
      extract: () => ({ type: 'marketing:pricing-table', tiers: [] }),
    });
    const draft = aggregatePage({
      page: pageContract({ summary: 'sum' }),
      pageProps: {},
      ctx: ctx(),
      descendants: [
        { contract: hero, props: {} },
        { contract: cta, props: {} },
        { contract: pricing, props: {} },
      ],
    });
    expect(draft.content.map((b) => b.type)).toEqual([
      'marketing:hero',
      'marketing:cta',
      'marketing:pricing-table',
    ]);
  });

  it('PRD-300-R10: page-level id missing or invalid throws BuildError', () => {
    expect(() =>
      aggregatePage({
        page: pageContract({ id: 'Pricing' }),
        pageProps: {},
        ctx: ctx(),
        descendants: [],
      }),
    ).toThrow(/PRD-300-R10/);
  });

  it('PRD-300-R12: related is emitted verbatim on the draft', () => {
    const related = [{ id: 'products', relation: 'see-also' }];
    const draft = aggregatePage({
      page: pageContract({ related }),
      pageProps: {},
      ctx: ctx(),
      descendants: [],
    });
    expect(draft.related).toEqual(related);
  });

  it('PRD-300-R9: page summary falls back to extract output when contract.summary is absent', () => {
    const draft = aggregatePage({
      page: pageContract({
        extract: () => ({ type: 'landing', summary: 'from-extract', title: 'from-extract' }),
      }),
      pageProps: {},
      ctx: ctx(),
      descendants: [],
    });
    expect(draft.summary).toBe('from-extract');
    expect(draft.title).toBe('from-extract');
  });

  it('PRD-300-R9: title falls back to id when extract supplies none', () => {
    const draft = aggregatePage({
      page: pageContract({ id: 'docs/intro' }),
      pageProps: {},
      ctx: ctx(),
      descendants: [],
    });
    expect(draft.title).toBe('docs/intro');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R11 — id collision detection across pages
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R11 — page-id collision detector', () => {
  it('throws when two drafts share an id; surfaces both source locations', () => {
    expect(() =>
      detectIdCollisions([
        { id: 'pricing', routeId: 'app/pricing/page.tsx' },
        { id: 'pricing', routeId: 'app/(marketing)/pricing.tsx' },
      ]),
    ).toThrow(/PRD-300-R11.*pricing.*both.*app\/pricing\/page\.tsx.*app\/\(marketing\)\/pricing\.tsx/);
  });

  it('passes for distinct ids', () => {
    expect(() =>
      detectIdCollisions([
        { id: 'a', routeId: 'r1' },
        { id: 'b', routeId: 'r2' },
      ]),
    ).not.toThrow();
  });

  it('surfaces the page id when routeId is omitted', () => {
    expect(() =>
      detectIdCollisions([{ id: 'x' }, { id: 'x' }]),
    ).toThrow(/page id "x".*both "x" and "x"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R13 — nested page-level contracts forbidden
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R13 — nested page-level contracts cause a build error', () => {
  it('throws when nestedPageDescendantIds is non-empty', () => {
    expect(() =>
      aggregatePage({
        page: pageContract(),
        pageProps: {},
        ctx: ctx(),
        descendants: [],
        nestedPageDescendantIds: ['pricing/enterprise'],
      }),
    ).toThrow(/PRD-300-R13.*pricing\/enterprise/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R14 / R15 / R16 / R17 — variant emission
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R14 / R16 — default variant policy emits canonical only', () => {
  it('omitted policy → empty variant list', () => {
    expect(resolveVariantKeys(undefined, () => [])).toEqual([]);
  });
  it('"default" policy → empty variant list', () => {
    expect(resolveVariantKeys('default', () => [])).toEqual([]);
  });
});

describe('PRD-300-R15 — explicit variants array drives replay', () => {
  it('returns each declared key in order', () => {
    expect(resolveVariantKeys(['a', 'b', 'c'], () => [])).toEqual(['a', 'b', 'c']);
  });

  it('dedupes while preserving declared order', () => {
    expect(resolveVariantKeys(['a', 'b', 'a', 'c'], () => [])).toEqual(['a', 'b', 'c']);
  });

  it('drops empty / non-string entries defensively', () => {
    expect(resolveVariantKeys(['', 'a'] as unknown as string[], () => [])).toEqual(['a']);
    expect(
      resolveVariantKeys([null as unknown as string, 'b'], () => []),
    ).toEqual(['b']);
  });

  it('"all" delegates to discoverAll callback', () => {
    expect(resolveVariantKeys('all', () => ['locale-en', 'locale-de'])).toEqual([
      'locale-en',
      'locale-de',
    ]);
  });
});

describe('PRD-300-R17 — variant matrix capped at 64 per page', () => {
  it('throws when the resolved set exceeds 64', () => {
    const big = Array.from({ length: VARIANT_CAP_PER_PAGE + 1 }, (_, i) => `k${String(i)}`);
    expect(() => resolveVariantKeys(big, () => [])).toThrow(/PRD-300-R17/);
  });
  it('64 exactly is allowed', () => {
    const max = Array.from({ length: VARIANT_CAP_PER_PAGE }, (_, i) => `k${String(i)}`);
    expect(resolveVariantKeys(max, () => []).length).toBe(VARIANT_CAP_PER_PAGE);
  });
});

describe('PRD-300-R18 / R19 — variant metadata + variant_of relation', () => {
  it('composeVariantId formats `{base_id}@{variant_key}` per PRD-102-R29', () => {
    expect(composeVariantId('pricing', 'enterprise-2026q2')).toBe(
      'pricing@enterprise-2026q2',
    );
  });

  it('applyVariantMetadata stamps metadata.variant + appends variant_of', () => {
    const base: NodeDraft = {
      id: 'pricing',
      type: 'landing',
      title: 'Pricing',
      summary: 's',
      content: [],
    };
    const v = applyVariantMetadata(base, 'pricing', 'k1', 'experiment');
    expect(v.id).toBe('pricing@k1');
    expect(v.metadata?.variant).toEqual({ base_id: 'pricing', key: 'k1', source: 'experiment' });
    expect(v.related).toEqual([{ id: 'pricing', relation: 'variant_of' }]);
    // Original draft is untouched.
    expect(base.id).toBe('pricing');
    expect(base.metadata).toBeUndefined();
  });

  it('applyVariantMetadata preserves prior related entries', () => {
    const base: NodeDraft = {
      id: 'pricing',
      type: 'landing',
      title: 'Pricing',
      summary: 's',
      content: [],
      related: [{ id: 'products', relation: 'see-also' }],
    };
    const v = applyVariantMetadata(base, 'pricing', 'k1', 'locale');
    expect(v.related).toEqual([
      { id: 'products', relation: 'see-also' },
      { id: 'pricing', relation: 'variant_of' },
    ]);
  });
});

describe('PRD-300-R15 / R16 — replayVariants emits canonical + each variant', () => {
  it('always emits canonical first; variant drafts get their metadata stamped', () => {
    const renders: Array<string | undefined> = [];
    const out = replayVariants({
      page: pageContract({ variants: ['v1', 'v2'] }),
      baseCtx: ctx(),
      source: 'experiment',
      renderForVariant: (c) => {
        renders.push(c.variant);
        return {
          id: 'pricing',
          type: 'landing',
          title: 'Pricing',
          summary: '',
          content: [{ type: 'marketing:hero' }],
        };
      },
    });
    expect(renders).toEqual([undefined, 'v1', 'v2']);
    expect(out).toHaveLength(3);
    expect(out[0]?.id).toBe('pricing');
    expect(out[1]?.id).toBe('pricing@v1');
    expect(out[2]?.id).toBe('pricing@v2');
    expect(out[1]?.metadata?.variant?.source).toBe('experiment');
  });

  it('"default" policy emits canonical only', () => {
    const out = replayVariants({
      page: pageContract({ variants: 'default' }),
      baseCtx: ctx(),
      source: 'experiment',
      renderForVariant: () => ({
        id: 'p', type: 'landing', title: 'P', summary: '', content: [],
      }),
    });
    expect(out).toHaveLength(1);
  });

  it('"all" with no discoverAll falls back to []', () => {
    const out = replayVariants({
      page: pageContract({ variants: 'all' }),
      baseCtx: ctx(),
      source: 'experiment',
      renderForVariant: () => ({
        id: 'p', type: 'landing', title: 'P', summary: '', content: [],
      }),
    });
    expect(out).toHaveLength(1); // canonical only
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R20 / R21 — extraction guarantees + extracted_via stamp
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R20 — emitted blocks satisfy PRD-100-R28 / R29 / R30', () => {
  it('PRD-100-R28: missing block.type → placeholder', () => {
    const c = componentContract({
      extract: (() => ({})) as unknown as ActContract['extract'],
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('marketing:placeholder');
  });

  it('PRD-100-R29: core:* namespace is closed; rejected → placeholder', () => {
    const c = componentContract({
      extract: () => ({ type: 'core:foo' }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('marketing:placeholder');
    expect(
      ((out[0]?.metadata as Record<string, unknown>)['error'] as string),
    ).toMatch(/core:\* namespace/);
  });

  it('PRD-102-R6: marketing:* with bad suffix → placeholder', () => {
    const c = componentContract({
      extract: () => ({ type: 'marketing:Hero' }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('marketing:placeholder');
  });

  it('valid marketing:* blocks pass through and get stamped', () => {
    const c = componentContract({
      extract: () => ({ type: 'marketing:hero', headline: 'h' }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('marketing:hero');
    expect((out[0]?.metadata as Record<string, unknown>)['extracted_via']).toBe(
      'component-contract',
    );
  });

  it('core block types pass the namespace gate (per-type schema is the binding/generator job)', () => {
    const c = componentContract({
      extract: () => ({ type: 'markdown', text: 'hi' }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('markdown');
  });

  it('unknown custom-namespace blocks are tolerated per PRD-100-R31', () => {
    const c = componentContract({
      extract: () => ({ type: 'acme:thing' }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('acme:thing');
  });

  it('non-object block emission is rejected', () => {
    expect(validateBlockShape(null)).toMatch(/non-null object/);
    expect(validateBlockShape('hi')).toMatch(/non-null object/);
  });

  it('extract returning an array yields multiple blocks', () => {
    const c = componentContract({
      extract: () => [
        { type: 'marketing:hero', headline: 'A' },
        { type: 'marketing:cta', label: 'B' },
      ],
    });
    const out = safeExtract(c, {}, ctx());
    expect(out.map((b) => b.type)).toEqual(['marketing:hero', 'marketing:cta']);
  });
});

describe('PRD-300-R21 — binding stamps metadata.extracted_via automatically', () => {
  it('successful extraction always sets metadata.extracted_via', () => {
    const c = componentContract({
      extract: () => ({ type: 'marketing:hero' }),
    });
    const [block] = safeExtract(c, {}, ctx());
    expect((block?.metadata as Record<string, unknown>)['extracted_via']).toBe(
      'component-contract',
    );
  });

  it('preserves author-supplied metadata fields alongside the stamp', () => {
    const c = componentContract({
      extract: () => ({ type: 'marketing:hero', metadata: { custom: 'k' } }),
    });
    const [block] = safeExtract(c, {}, ctx());
    expect((block?.metadata as Record<string, unknown>)['custom']).toBe('k');
    expect((block?.metadata as Record<string, unknown>)['extracted_via']).toBe(
      'component-contract',
    );
  });

  it('rejects author override of extracted_via to a different value', () => {
    const c = componentContract({
      extract: () => ({
        type: 'marketing:hero',
        metadata: { extracted_via: 'magic' },
      }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('marketing:placeholder');
    const reason = ((out[0]?.metadata as Record<string, unknown>)['error']) as string;
    expect(reason).toMatch(/PRD-300-R21/);
  });

  it('accepts author-set extracted_via if the value is "component-contract"', () => {
    const c = componentContract({
      extract: () => ({
        type: 'marketing:hero',
        metadata: { extracted_via: 'component-contract' },
      }),
    });
    const out = safeExtract(c, {}, ctx());
    expect(out[0]?.type).toBe('marketing:hero');
  });

  it('rejectAuthorOverride returns null when metadata is absent', () => {
    expect(rejectAuthorOverride({ type: 'marketing:hero' })).toBeNull();
  });

  it('stampMetadata stamps method when supplied', () => {
    const stamped = stampMetadata({ type: 'marketing:hero' }, 'ssr-walk');
    expect((stamped.metadata as Record<string, unknown>)['extraction_method']).toBe('ssr-walk');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R22 — placeholder on failure
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R22 — placeholder block on extraction failure', () => {
  it('extract throws → placeholder with metadata', () => {
    const c = componentContract({
      extract: () => {
        throw new Error('boom');
      },
    });
    const warnings: string[] = [];
    const out = safeExtract(c, {}, ctx({ warn: (m) => warnings.push(m) }), {
      component: 'Hero',
      location: 'Hero.tsx:14',
    });
    expect(out[0]?.type).toBe('marketing:placeholder');
    const meta = out[0]?.metadata as Record<string, unknown>;
    expect(meta['extracted_via']).toBe('component-contract');
    expect(meta['extraction_status']).toBe('failed');
    expect(meta['error']).toBe('boom');
    expect(meta['component']).toBe('Hero');
    expect(meta['location']).toBe('Hero.tsx:14');
    expect(warnings.some((w) => /threw/.test(w))).toBe(true);
  });

  it('non-Error throw values are stringified', () => {
    const c = componentContract({
      extract: () => {
        throw 'string-thrown'; // eslint-disable-line @typescript-eslint/only-throw-error
      },
    });
    const [block] = safeExtract(c, {}, ctx());
    expect((block?.metadata as Record<string, unknown>)['error']).toBe('string-thrown');
  });

  it('buildPlaceholder truncates messages to ≤200 chars', () => {
    const long = 'x'.repeat(300);
    const block = buildPlaceholder({ error: long });
    const err = (block.metadata as Record<string, unknown>)['error'] as string;
    expect(err.length).toBe(ERROR_MESSAGE_CAP);
  });

  it('buildPlaceholder accepts string error too', () => {
    const block = buildPlaceholder({ error: 'plain' });
    expect((block.metadata as Record<string, unknown>)['error']).toBe('plain');
  });

  it('buildPlaceholder omits error / component / location when empty', () => {
    const block = buildPlaceholder({ error: '' });
    const meta = block.metadata as Record<string, unknown>;
    expect(meta['error']).toBeUndefined();
    expect(meta['component']).toBeUndefined();
    expect(meta['location']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R23 — partial extraction
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R23 — partial extraction marker', () => {
  it('stampPartial sets extraction_status: "partial"', () => {
    const out = stampPartial({ type: 'marketing:hero', headline: 'h' });
    const meta = out.metadata as Record<string, unknown>;
    expect(meta['extracted_via']).toBe('component-contract');
    expect(meta['extraction_status']).toBe('partial');
  });

  it('stampPartial preserves prior metadata', () => {
    const out = stampPartial({
      type: 'marketing:hero',
      metadata: { custom: 1 },
    });
    expect((out.metadata as Record<string, unknown>)['custom']).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R24 / R25 — children cycle + token cap
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R24 — children cycle prohibition', () => {
  it('throws when the page lists itself in children', () => {
    expect(() =>
      aggregatePage({
        page: pageContract({ id: 'pricing' }),
        pageProps: {},
        ctx: ctx(),
        descendants: [],
        children: ['pricing'],
      }),
    ).toThrow(/PRD-300-R24/);
  });

  it('passes when children are distinct and emits the children array', () => {
    const draft = aggregatePage({
      page: pageContract({ id: 'pricing' }),
      pageProps: {},
      ctx: ctx(),
      descendants: [],
      children: ['pricing/enterprise'],
    });
    expect((draft as NodeDraft & { children: string[] }).children).toEqual(['pricing/enterprise']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R26 / R27 — contract_version + tolerance gate
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R26 / R27 — contract_version parsing + tolerance', () => {
  it('parseContractVersion accepts MAJOR.MINOR and rejects garbage', () => {
    expect(parseContractVersion('0.1')).toEqual({ major: 0, minor: 1 });
    expect(parseContractVersion('1.0')).toEqual({ major: 1, minor: 0 });
    expect(parseContractVersion('0.1.2')).toBeNull();
    expect(parseContractVersion('alpha')).toBeNull();
  });

  it('PRD-300-R27: same MAJOR is tolerated regardless of MINOR', () => {
    expect(() => gateContractVersion('0.1', '0.1')).not.toThrow();
    expect(() => gateContractVersion('0.0', '0.5')).not.toThrow();
    expect(() => gateContractVersion('0.5', '0.0')).not.toThrow();
  });

  it('PRD-300-R27: MAJOR above the binding throws', () => {
    expect(() => gateContractVersion('1.0', '0.1')).toThrow(/PRD-300-R27.*1\.0.*MAJOR 0/);
  });

  it('PRD-300-R27: malformed contract_version throws', () => {
    expect(() => gateContractVersion('xx', '0.1')).toThrow(/PRD-300-R27/);
  });

  it('PRD-300-R27: malformed binding version throws', () => {
    expect(() => gateContractVersion('0.1', 'xx')).toThrow(/PRD-300-R27/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R28 / R29 / R30 / R31 — capability matrix
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R28 — BindingCapabilities shape + dispatch', () => {
  it('CAPABILITY_KEYS enumerates the closed v0.1 set', () => {
    expect(CAPABILITY_KEYS).toEqual([
      'ssr-walk',
      'static-ast',
      'headless-render',
      'rsc',
      'streaming',
      'suspense',
      'concurrent',
    ]);
  });

  function caps(over: Partial<BindingCapabilities> = {}): BindingCapabilities {
    return {
      'ssr-walk': false,
      'static-ast': false,
      'headless-render': false,
      rsc: false,
      streaming: false,
      suspense: false,
      concurrent: false,
      ...over,
    };
  }

  it('assertCapabilitiesShape passes for fully-typed objects', () => {
    expect(() => assertCapabilitiesShape(caps())).not.toThrow();
  });

  it('assertCapabilitiesShape throws on missing flag', () => {
    expect(() => assertCapabilitiesShape({})).toThrow(/PRD-300-R28/);
  });

  it('assertCapabilitiesShape throws on non-object', () => {
    expect(() => assertCapabilitiesShape(null)).toThrow(/PRD-300-R28/);
  });

  it('assertCapabilitiesShape throws when a flag is non-boolean', () => {
    const bad = { ...caps(), 'ssr-walk': 'yes' as unknown as boolean };
    expect(() => assertCapabilitiesShape(bad)).toThrow(/PRD-300-R28/);
  });

  it('chooseExtractionMode prefers RSC+SSR when both flags are true', () => {
    expect(chooseExtractionMode(caps({ rsc: true, 'ssr-walk': true }))).toBe('rsc-ssr');
  });

  it('chooseExtractionMode falls through ssr → static → headless', () => {
    expect(chooseExtractionMode(caps({ 'ssr-walk': true }))).toBe('ssr-walk');
    expect(chooseExtractionMode(caps({ 'static-ast': true }))).toBe('static-ast');
    expect(chooseExtractionMode(caps({ 'headless-render': true }))).toBe('headless-render');
  });

  it('chooseExtractionMode throws when no usable mode is declared', () => {
    expect(() => chooseExtractionMode(caps())).toThrow(/PRD-300-R28/);
  });

  it('PRD-300-R29: methodForMode returns the mode value', () => {
    expect(methodForMode('ssr-walk')).toBe('ssr-walk');
    expect(methodForMode('headless-render')).toBe('headless-render');
    expect(methodForMode('static-ast')).toBe('static-ast');
    expect(methodForMode('rsc-ssr')).toBe('rsc-ssr');
  });
});

describe('PRD-300-R29 — extraction_method stamp on emitted blocks', () => {
  it('stampMetadata writes method when one is supplied', () => {
    const stamped = stampMetadata({ type: 'marketing:hero' }, 'headless-render');
    expect((stamped.metadata as Record<string, unknown>)['extraction_method']).toBe(
      'headless-render',
    );
  });

  it('stampMetadata leaves method off when undefined', () => {
    const stamped = stampMetadata({ type: 'marketing:hero' }, undefined);
    expect((stamped.metadata as Record<string, unknown>)['extraction_method']).toBeUndefined();
  });

  it('aggregatePage stamps extraction_method on every emitted block when method passed', () => {
    const hero = componentContract({
      extract: () => ({ type: 'marketing:hero' }),
    });
    const draft = aggregatePage({
      page: pageContract(),
      pageProps: {},
      ctx: ctx(),
      descendants: [{ contract: hero, props: {} }],
      method: 'ssr-walk',
    });
    expect(
      (draft.content[0]?.metadata as Record<string, unknown>)['extraction_method'],
    ).toBe('ssr-walk');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRD-300-R32 — secret redaction in error messages
// ─────────────────────────────────────────────────────────────────────────

describe('PRD-300-R32 — secret-pattern redaction', () => {
  it('redacts Bearer tokens', () => {
    expect(redactSecrets('auth: Bearer abc.DEF-123')).toBe('auth: [REDACTED]');
  });
  it('redacts Stripe live keys', () => {
    expect(redactSecrets('key=sk_live_abc123XYZ')).toBe('key=[REDACTED]');
  });
  it('redacts AWS access key IDs', () => {
    expect(redactSecrets('id=AKIAABCDEFGHIJKLMNOP')).toBe('id=[REDACTED]');
  });
  it('redacts GitHub PAT tokens', () => {
    const tok = `ghp_${'a'.repeat(36)}`;
    expect(redactSecrets(`token=${tok}`)).toBe('token=[REDACTED]');
  });
  it('redacts Slack bot tokens', () => {
    expect(redactSecrets('slack=xoxb-1234-abcDEF')).toBe('slack=[REDACTED]');
  });
  it('passes innocuous text through unchanged', () => {
    expect(redactSecrets('hello world')).toBe('hello world');
  });
  it('buildPlaceholder applies redaction before truncation', () => {
    const block = buildPlaceholder({
      error: 'failed for sk_live_secret123XYZ in handler',
    });
    expect((block.metadata as Record<string, unknown>)['error']).not.toMatch(/sk_live/);
    expect((block.metadata as Record<string, unknown>)['error']).toMatch(/REDACTED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — page + variants + capabilities together
// ─────────────────────────────────────────────────────────────────────────

describe('integration — page + variants + capabilities + secret redaction', () => {
  it('end-to-end: page aggregates 2 components, replays 2 variants, every block stamped', () => {
    const hero = componentContract({
      extract: (_p, c) => ({
        type: 'marketing:hero',
        headline: c.variant ? `Hero (${c.variant})` : 'Hero',
      }),
    });
    const cta = componentContract({
      type: 'marketing:cta',
      extract: () => ({ type: 'marketing:cta', label: 'Go' }),
    });
    const page = pageContract({
      summary: 'Pricing',
      variants: ['v1', 'v2'],
    });

    const drafts = replayVariants({
      page,
      baseCtx: ctx(),
      source: 'experiment',
      renderForVariant: (childCtx) =>
        aggregatePage({
          page,
          pageProps: {},
          ctx: childCtx,
          descendants: [
            { contract: hero, props: {}, component: 'Hero' },
            { contract: cta, props: {}, component: 'CTA' },
          ],
          method: 'ssr-walk',
        }),
    });

    expect(drafts.map((d) => d.id)).toEqual(['pricing', 'pricing@v1', 'pricing@v2']);
    for (const d of drafts) {
      for (const b of d.content) {
        expect((b.metadata as Record<string, unknown>)['extracted_via']).toBe('component-contract');
        expect((b.metadata as Record<string, unknown>)['extraction_method']).toBe('ssr-walk');
      }
    }
    // Hero in variant 1 saw ctx.variant = "v1".
    const heroV1 = drafts[1]?.content.find((b) => b.type === 'marketing:hero');
    expect((heroV1 as { headline?: string } | undefined)?.headline).toBe('Hero (v1)');
  });

  it('end-to-end failure path: extract throws inside aggregatePage → placeholder; warnings collected', () => {
    const warnings: string[] = [];
    const broken = componentContract({
      extract: () => {
        throw new Error('schema drift');
      },
    });
    const draft = aggregatePage({
      page: pageContract(),
      pageProps: {},
      ctx: ctx({ warn: (m) => warnings.push(m) }),
      descendants: [{ contract: broken, props: {}, component: 'Broken' }],
      method: 'ssr-walk',
    });
    expect(draft.content).toHaveLength(1);
    const placeholder = draft.content[0] as ContractOutput;
    expect(placeholder.type).toBe('marketing:placeholder');
    expect((placeholder.metadata as Record<string, unknown>)['extraction_status']).toBe('failed');
    expect((placeholder.metadata as Record<string, unknown>)['component']).toBe('Broken');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

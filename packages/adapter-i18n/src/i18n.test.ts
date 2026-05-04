/**
 * PRD-207 i18n adapter tests. Every requirement R1–R20 has at least one
 * citing test; integration scenarios at the bottom run the full adapter
 * pipeline against bundled fixture catalogs and validate emitted shapes.
 *
 * The cross-source composition test composes PRD-207 with PRD-202
 * (`@act-spec/adapter-contentful`) through the framework's `mergeRuns`
 * step and asserts:
 *   1. Scalar fields from PRD-202 survive (precedence: "fallback").
 *   2. metadata.translations entries are deduped by (locale, id) per A1.
 *   3. metadata.source.* records both adapters' contributions.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  mergeRuns,
  runAdapter,
  type AdapterContext,
  type EmittedNode,
  type PartialEmittedNode,
} from '@act-spec/adapter-framework';

import {
  BCP47_SUBSET_RE,
  I18N_ADAPTER_NAME,
  I18N_DEFAULT_CONCURRENCY,
  I18N_ADAPTER_PACKAGE_NAME,
  I18nAdapterError,
  _BCP47_SUBSET_RE_FOR_TEST,
  _inferNodesFromCatalogsForTest,
  _isSupportedLibrary,
  _resetConfigValidatorCacheForTest,
  computeBindingId,
  createI18nAdapter,
  detectLibraryLayout,
  determineNodeStatus,
  flattenObject,
  inferNamespace,
  loadLocaleCatalog,
  normalizeLocale,
  resolveCrossLocaleId,
} from './index.js';
import type {
  FlatCatalog,
  I18nAdapterConfig,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(here, '..', 'test-fixtures');

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
  config: I18nAdapterConfig | Record<string, unknown>,
  over: Partial<AdapterContext> = {},
  logger?: CapturedLogger,
): AdapterContext {
  return {
    config: config as unknown as Record<string, unknown>,
    targetLevel: 'strict',
    actVersion: '0.1',
    logger: logger ?? makeLogger(),
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

function nextIntlConfig(over: Partial<I18nAdapterConfig> = {}): I18nAdapterConfig {
  return {
    library: 'next-intl',
    messagesDir: path.join(fixturesRoot, 'next-intl', 'messages'),
    locales: { default: 'en-US', available: ['en-US', 'es-ES', 'de-DE'] },
    bindToAdapter: 'act-contentful',
    idTransform: { pattern: 1, namespace: 'cms' },
    ...over,
  };
}

function reactIntlConfig(over: Partial<I18nAdapterConfig> = {}): I18nAdapterConfig {
  return {
    library: 'react-intl',
    messagesDir: path.join(fixturesRoot, 'react-intl', 'messages'),
    locales: { default: 'en-US', available: ['en-US', 'de-DE', 'fr-FR'] },
    bindToAdapter: 'act-contentful',
    idTransform: { pattern: 1, namespace: 'cms' },
    library_options: { messageFormat: 'flat' },
    ...over,
  };
}

function i18nextConfig(over: Partial<I18nAdapterConfig> = {}): I18nAdapterConfig {
  return {
    library: 'i18next',
    messagesDir: path.join(fixturesRoot, 'i18next', 'locales'),
    locales: {
      default: 'en-US',
      available: ['en-US', 'de', 'de-AT'],
      fallback_chain: { 'de-AT': ['de', 'en-US'] },
    },
    bindToAdapter: 'act-markdown',
    idTransform: { pattern: 1, namespace: 'md' },
    library_options: { namespaces: ['common', 'home'] },
    ...over,
  };
}

async function runWith(cfg: I18nAdapterConfig, over: Partial<AdapterContext> = {}, logger?: CapturedLogger) {
  const adapter = createI18nAdapter();
  const c = ctx(cfg, over, logger);
  return runAdapter(adapter, c.config, c);
}

// ---------------------------------------------------------------------------
// Module surface — sanity / public API
// ---------------------------------------------------------------------------

describe('public surface', () => {
  it('PRD-207-R1: exports adapter name "act-i18n"', () => {
    expect(I18N_ADAPTER_NAME).toBe('act-i18n');
  });

  it('exports a stable package name constant', () => {
    expect(I18N_ADAPTER_PACKAGE_NAME).toBe('@act-spec/adapter-i18n');
  });

  it('PRD-207-R15: default concurrency is 8', () => {
    expect(I18N_DEFAULT_CONCURRENCY).toBe(8);
  });

  it('PRD-207-R2: closed-enum library detector accepts the three supported libs only', () => {
    expect(_isSupportedLibrary('next-intl')).toBe(true);
    expect(_isSupportedLibrary('react-intl')).toBe(true);
    expect(_isSupportedLibrary('i18next')).toBe(true);
    expect(_isSupportedLibrary('vue-i18n')).toBe(false);
    expect(_isSupportedLibrary('lingui')).toBe(false);
  });

  it('exports BCP-47 subset regex matching PRD-104-R2', () => {
    expect(BCP47_SUBSET_RE).toEqual(_BCP47_SUBSET_RE_FOR_TEST);
    expect(BCP47_SUBSET_RE.test('en')).toBe(true);
    expect(BCP47_SUBSET_RE.test('en-US')).toBe(true);
    expect(BCP47_SUBSET_RE.test('zh-Hant')).toBe(true);
    expect(BCP47_SUBSET_RE.test('zh-Hant-HK')).toBe(true);
    expect(BCP47_SUBSET_RE.test('en_US')).toBe(false);
    expect(BCP47_SUBSET_RE.test('EN-US')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Locale normalization (PRD-207-R13)
// ---------------------------------------------------------------------------

describe('PRD-207-R13: locale normalization', () => {
  it('underscore separator becomes hyphen', () => {
    const warn = vi.fn();
    expect(normalizeLocale('en_US', warn)).toBe('en-US');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('lowercases primary subtag', () => {
    const warn = vi.fn();
    expect(normalizeLocale('EN-US', warn)).toBe('en-US');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('uppercases the region subtag', () => {
    const warn = vi.fn();
    expect(normalizeLocale('pt-br', warn)).toBe('pt-BR');
    expect(warn).toHaveBeenCalled();
  });

  it('title-cases the script subtag', () => {
    const warn = vi.fn();
    expect(normalizeLocale('zh-hant', warn)).toBe('zh-Hant');
    expect(warn).toHaveBeenCalled();
  });

  it('handles script + region together (zh-hant-hk)', () => {
    const warn = vi.fn();
    expect(normalizeLocale('zh-hant-hk', warn)).toBe('zh-Hant-HK');
  });

  it('does not warn when input is already canonical', () => {
    const warn = vi.fn();
    expect(normalizeLocale('en-US', warn)).toBe('en-US');
    expect(warn).not.toHaveBeenCalled();
  });

  it('PRD-207-R14: throws for input that fails BCP-47 subset after normalization', () => {
    const warn = vi.fn();
    expect(() => normalizeLocale('x-private', warn)).toThrow(I18nAdapterError);
  });

  it('PRD-207-R14: rejects numeric region (es-419) — outside subset per PRD-104 risks table', () => {
    const warn = vi.fn();
    expect(() => normalizeLocale('es-419', warn)).toThrow(I18nAdapterError);
  });
});

// ---------------------------------------------------------------------------
// Catalog ingestion (PRD-207-R3)
// ---------------------------------------------------------------------------

describe('PRD-207-R3: catalog ingestion', () => {
  it('flattenObject collapses nested keys into dotted paths', () => {
    const flat = flattenObject({ home: { hero: { headline: 'Hi', subhead: 'Hey' } } });
    expect(flat.get('home.hero.headline')).toBe('Hi');
    expect(flat.get('home.hero.subhead')).toBe('Hey');
  });

  it('flattenObject ignores empty strings and non-string leaves', () => {
    const flat = flattenObject({ a: '', b: 5, c: true, d: null, e: 'real' });
    expect(flat.has('a')).toBe(false);
    expect(flat.has('b')).toBe(false);
    expect(flat.has('c')).toBe(false);
    expect(flat.has('d')).toBe(false);
    expect(flat.get('e')).toBe('real');
  });

  it('PRD-207-R3 next-intl: loads en-US.json and flattens nested namespaces', async () => {
    const cfg = nextIntlConfig();
    const cat = await loadLocaleCatalog(cfg, 'en-US');
    expect(cat).not.toBeNull();
    expect(cat!.get('home.hero.headline')).toBe('Build with ACT');
    expect(cat!.get('pricing.headline')).toBe('Simple, transparent pricing');
  });

  it('PRD-207-R3 next-intl: returns null for missing locale file (recoverable)', async () => {
    const cfg = nextIntlConfig({ locales: { default: 'en-US', available: ['en-US', 'ja-JP'] } });
    const cat = await loadLocaleCatalog(cfg, 'ja-JP');
    expect(cat).toBeNull();
  });

  it('PRD-207-R3 react-intl: parses FormatJS extracted-messages flat shape', async () => {
    const cfg = reactIntlConfig();
    const cat = await loadLocaleCatalog(cfg, 'en-US');
    expect(cat!.get('home.hero.headline')).toBe('Build with ACT');
    expect(cat!.get('pricing.headline')).toBe('Simple, transparent pricing');
  });

  it('PRD-207-R3 react-intl: parses nested string-map shape (no defaultMessage)', async () => {
    const cfg = reactIntlConfig();
    const cat = await loadLocaleCatalog(cfg, 'fr-FR');
    expect(cat!.get('home.hero.headline')).toBe('Construire avec ACT');
    expect(cat!.get('home.hero.subhead')).toBe('Arbre de contenu ouvert');
  });

  it('PRD-207-R3 i18next: loads per-namespace files and prefixes keys with the namespace', async () => {
    const cfg = i18nextConfig();
    const cat = await loadLocaleCatalog(cfg, 'en-US');
    expect(cat!.get('common.save')).toBe('Save');
    expect(cat!.get('home.hero.headline')).toBe('Build with ACT');
  });

  it('PRD-207-R3 i18next: returns null when no namespaces are present', async () => {
    const cfg = i18nextConfig({ locales: { default: 'en-US', available: ['en-US', 'fr-FR'] } });
    const cat = await loadLocaleCatalog(cfg, 'fr-FR');
    expect(cat).toBeNull();
  });

  it('PRD-207-R14: malformed JSON throws I18nAdapterError(catalog_parse)', async () => {
    // Use an in-memory test by writing a synthetic file via Node fs.
    const fs = await import('node:fs/promises');
    const tmp = await fs.mkdtemp(path.join((await fs.realpath('/tmp')), 'i18n-adapter-bad-'));
    await fs.writeFile(path.join(tmp, 'en-US.json'), '{ not valid json', 'utf8');
    const cfg = nextIntlConfig({
      messagesDir: tmp,
      locales: { default: 'en-US', available: ['en-US', 'es-ES'] },
    });
    await expect(loadLocaleCatalog(cfg, 'en-US')).rejects.toThrow(I18nAdapterError);
  });

  it('PRD-207 security: refuses path traversal via locale string with .. segment', async () => {
    const cfg = nextIntlConfig();
    // The literal `../../etc/passwd` would resolve outside messagesDir.
    await expect(loadLocaleCatalog(cfg, '../../etc/passwd')).rejects.toThrow(
      I18nAdapterError,
    );
  });
});

// ---------------------------------------------------------------------------
// Library auto-detection (autonomous helper, doc'd in adapter)
// ---------------------------------------------------------------------------

describe('PRD-207 (autonomous helper): detectLibraryLayout', () => {
  it('detects next-intl when a default-locale .json is present', async () => {
    const det = await detectLibraryLayout(
      path.join(fixturesRoot, 'next-intl', 'messages'),
      'next-intl',
      'en-US',
    );
    expect(det.detected).toBe(true);
  });

  it('detects react-intl FormatJS shape via defaultMessage probe', async () => {
    const det = await detectLibraryLayout(
      path.join(fixturesRoot, 'react-intl', 'messages'),
      'react-intl',
      'en-US',
    );
    expect(det.detected).toBe(true);
    expect(det.reason).toContain('FormatJS');
  });

  it('detects i18next layout and surfaces namespace names', async () => {
    const det = await detectLibraryLayout(
      path.join(fixturesRoot, 'i18next', 'locales'),
      'i18next',
      'en-US',
    );
    expect(det.detected).toBe(true);
    expect(det.namespaces).toContain('common');
    expect(det.namespaces).toContain('home');
  });

  it('returns detected=false when next-intl declared but no <default>.json', async () => {
    const det = await detectLibraryLayout(
      path.join(fixturesRoot, 'i18next', 'locales'),
      'next-intl',
      'en-US',
    );
    expect(det.detected).toBe(false);
  });

  it('returns detected=false when i18next declared but no <default>/ dir', async () => {
    const det = await detectLibraryLayout(
      path.join(fixturesRoot, 'next-intl', 'messages'),
      'i18next',
      'en-US',
    );
    expect(det.detected).toBe(false);
  });

  it('returns detected=false on unreadable messagesDir', async () => {
    const det = await detectLibraryLayout(
      '/tmp/this-path-definitely-does-not-exist-xyz-i18n-adapter',
      'next-intl',
      'en-US',
    );
    expect(det.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-locale ID resolution (PRD-207-R5)
// ---------------------------------------------------------------------------

describe('PRD-207-R5: cross-locale ID resolution', () => {
  const cfg = nextIntlConfig();

  it('Pattern 1: swaps the locale segment in a prefixed ID', () => {
    const warn = vi.fn();
    const out = resolveCrossLocaleId('en-US', 'cms/en-us/landing/pricing', 'es-ES', cfg, { warn });
    expect(out).toBe('cms/es-es/landing/pricing');
    expect(warn).not.toHaveBeenCalled();
  });

  it('Pattern 2: returns the ID unchanged across locales', () => {
    const warn = vi.fn();
    const cfg2: I18nAdapterConfig = { ...cfg, idTransform: { pattern: 2 } };
    expect(resolveCrossLocaleId('en-US', 'landing/pricing', 'es-ES', cfg2, { warn })).toBe(
      'landing/pricing',
    );
  });

  it('falls back to keyMapping when ID prefix does not match', () => {
    const warn = vi.fn();
    const cfg2: I18nAdapterConfig = {
      ...cfg,
      keyMapping: { 'es-ES:custom/page': 'cms/es-es/custom/page' },
    };
    const out = resolveCrossLocaleId('en-US', 'custom/page', 'es-ES', cfg2, { warn });
    expect(out).toBe('cms/es-es/custom/page');
  });

  it('PRD-207-R9: returns null and warns when neither rule applies', () => {
    const warn = vi.fn();
    const out = resolveCrossLocaleId('en-US', 'no/match/here', 'es-ES', cfg, { warn });
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('inferNamespace: explicit namespace wins over bindToAdapter', () => {
    expect(inferNamespace({ ...cfg, idTransform: { namespace: 'custom' } })).toBe('custom');
  });

  it('inferNamespace: strips leading "act-" from bindToAdapter', () => {
    const out = inferNamespace({ ...cfg, idTransform: undefined });
    expect(out).toBe('contentful');
  });

  it('computeBindingId: Pattern 1 prefixes namespace + lowercase locale', () => {
    const id = computeBindingId('home', 'es-ES', cfg);
    expect(id).toBe('cms/es-es/home');
  });

  it('computeBindingId: Pattern 2 returns the bare key', () => {
    const id = computeBindingId('home', 'es-ES', { ...cfg, idTransform: { pattern: 2 } });
    expect(id).toBe('home');
  });

  it('computeBindingId: keyMapping override (locale-keyed) wins', () => {
    const id = computeBindingId('home', 'es-ES', {
      ...cfg,
      keyMapping: { 'es-ES:home': 'cms/es-es/landing/home' },
    });
    expect(id).toBe('cms/es-es/landing/home');
  });

  it('computeBindingId: keyMapping bare key, Pattern 1, prefixes locale', () => {
    const id = computeBindingId('home', 'es-ES', {
      ...cfg,
      keyMapping: { home: 'cms/landing/home' },
    });
    expect(id).toBe('cms/es-es/landing/home');
  });
});

// ---------------------------------------------------------------------------
// Translation status + fallback chain (PRD-207-R7, R8)
// ---------------------------------------------------------------------------

describe('PRD-207-R7 / R8: node-level status + fallback chain', () => {
  const catalogs = new Map<string, FlatCatalog>([
    ['en-US', new Map([['home.headline', 'Hi'], ['home.subhead', 'Hey']])],
    ['es-ES', new Map([['home.headline', 'Hola']])],
    ['de-DE', new Map<string, string>()],
    ['fr-FR', new Map([['home.headline', 'Salut']])],
  ]);

  const nodeKeys = ['home.headline', 'home.subhead'];

  it('R7: "complete" when every key is in the requested locale', () => {
    const s = determineNodeStatus('en-US', nodeKeys, catalogs, ['en-US', 'en-US']);
    expect(s.status).toBe('complete');
  });

  it('R7: "partial" when some keys are present', () => {
    const s = determineNodeStatus('es-ES', nodeKeys, catalogs, ['es-ES', 'en-US']);
    expect(s.status).toBe('partial');
  });

  it('R7/R8: "fallback" when no keys present in requested locale; fallback_from is first chain hit', () => {
    const s = determineNodeStatus('de-DE', nodeKeys, catalogs, ['de-DE', 'fr-FR', 'en-US']);
    expect(s.status).toBe('fallback');
    expect(s.fallback_from).toBe('fr-FR');
  });

  it('R8: walks past locales whose catalog lacks the keys', () => {
    const empties = new Map<string, FlatCatalog>([
      ...catalogs,
      ['it-IT', new Map<string, string>()],
    ]);
    const s = determineNodeStatus('de-DE', nodeKeys, empties, ['de-DE', 'it-IT', 'fr-FR']);
    expect(s.status).toBe('fallback');
    expect(s.fallback_from).toBe('fr-FR');
  });

  it('R7: "missing" when no chain entry has the keys', () => {
    const noOne = new Map<string, FlatCatalog>([
      ['en-US', new Map<string, string>()],
      ['es-ES', new Map<string, string>()],
    ]);
    const s = determineNodeStatus('es-ES', nodeKeys, noOne, ['es-ES', 'en-US']);
    expect(s.status).toBe('missing');
  });

  it('R7: degenerate empty key set → "complete"', () => {
    const s = determineNodeStatus('en-US', [], catalogs, ['en-US']);
    expect(s.status).toBe('complete');
  });

  it('R8: skips the requested locale itself when scanning for fallback', () => {
    // The requested locale has no keys; chain leads with itself; fallback should land on next.
    const s = determineNodeStatus('de-DE', nodeKeys, catalogs, ['de-DE', 'en-US']);
    expect(s.status).toBe('fallback');
    expect(s.fallback_from).toBe('en-US');
  });
});

// ---------------------------------------------------------------------------
// Adapter init / config (R1, R2, R6, R12, R14, R15, R16)
// ---------------------------------------------------------------------------

describe('init / config / capabilities', () => {
  it('PRD-207-R1: adapter satisfies the PRD-200 lifecycle interface', () => {
    const a = createI18nAdapter();
    expect(a.name).toBe('act-i18n');
    expect(typeof a.init).toBe('function');
    expect(typeof a.enumerate).toBe('function');
    expect(typeof a.transform).toBe('function');
    expect(typeof a.dispose).toBe('function');
    expect(typeof a.precheck).toBe('function');
  });

  it('PRD-207-R2/R14: rejects an empty config (missing required fields)', async () => {
    _resetConfigValidatorCacheForTest();
    const a = createI18nAdapter();
    await expect(a.init({}, ctx({} as I18nAdapterConfig))).rejects.toThrow(I18nAdapterError);
  });

  it('PRD-207-R2: rejects an invalid library enum', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig() as Record<string, unknown>;
    cfg['library'] = 'vue-i18n';
    await expect(a.init(cfg, ctx(cfg))).rejects.toThrow(I18nAdapterError);
  });

  it('PRD-207-R14: rejects single-locale build (Plus-only, multi-locale by definition)', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig({ locales: { default: 'en-US', available: ['en-US'] } });
    await expect(a.init(cfg as unknown as Record<string, unknown>, ctx(cfg))).rejects.toThrow(
      /at least 2 locales/,
    );
  });

  it('PRD-207-R16: refuses non-Plus targetLevel', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig();
    await expect(
      a.init(cfg as unknown as Record<string, unknown>, ctx(cfg, { targetLevel: 'standard' })),
    ).rejects.toThrow(/targetLevel "strict"/);
  });

  it('PRD-207-R14: rejects missing messagesDir', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig({ messagesDir: '/tmp/nonexistent-i18n-fixture-xyz' });
    await expect(
      a.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toThrow(/messagesDir/);
  });

  it('PRD-207-R14: rejects fallback_chain referencing locale not in available', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig({
      locales: {
        default: 'en-US',
        available: ['en-US', 'es-ES'],
        fallback_chain: { 'es-ES': ['fr-FR'] },
      },
    });
    await expect(
      a.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toThrow(/fallback_chain/);
  });

  it('PRD-207-R14: rejects fallback_chain key (target locale) not in available', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig({
      locales: {
        default: 'en-US',
        available: ['en-US', 'es-ES'],
        fallback_chain: { 'fr-FR': ['en-US'] },
      },
    });
    await expect(
      a.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toThrow(/fallback_chain/);
  });

  it('PRD-104-R3: rejects locales.default not in locales.available', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig({
      locales: { default: 'fr-FR', available: ['en-US', 'es-ES'] },
    });
    await expect(
      a.init(cfg as unknown as Record<string, unknown>, ctx(cfg)),
    ).rejects.toThrow(/must be present/);
  });

  it('PRD-207-R15: init returns level=plus, precedence=fallback, namespace_ids=false, manifestCapabilities={}', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig();
    const caps = await a.init(cfg as unknown as Record<string, unknown>, ctx(cfg));
    expect(caps.level).toBe('strict');
    expect(caps.precedence).toBe('fallback');
    expect(caps.namespace_ids).toBe(false);
    expect(caps.manifestCapabilities).toEqual({});
    expect(caps.delta).toBe(false);
    await a.dispose(ctx(cfg));
  });

  it('PRD-207-R13: normalize helper is exposed for consumers (filenames / library config) and warns on input change', () => {
    // Note: the config schema (PRD-207-R2) enforces the BCP-47 subset
    // STRICTLY at the boundary, so user-supplied `en_us` in the config
    // hash is rejected pre-normalization. The normalization helper exists
    // for filenames (e.g., react-intl `en_us.json`) and for library
    // config the adapter discovers post-schema (e.g., i18next namespace
    // probe under a `de_at/` directory). Direct test of the helper.
    const warn = vi.fn();
    expect(normalizeLocale('en_us', warn)).toBe('en-US');
    expect(warn).toHaveBeenCalledOnce();
    const warn2 = vi.fn();
    expect(normalizeLocale('DE-at', warn2)).toBe('de-AT');
    expect(warn2).toHaveBeenCalledOnce();
  });

  it('PRD-207 (autonomous): autoDetect surfaces a logger warning when layout mismatches', async () => {
    const a = createI18nAdapter();
    const logger = makeLogger();
    // Declare i18next but point at a next-intl-shaped fixture dir.
    const cfg = i18nextConfig({
      messagesDir: path.join(fixturesRoot, 'next-intl', 'messages'),
      locales: { default: 'en-US', available: ['en-US', 'es-ES', 'de-DE'] },
      autoDetect: true,
    });
    await expect(
      a.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger)),
    ).resolves.toBeTruthy();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('PRD-207 (autonomous): autoDetect populates i18next namespaces when none configured', async () => {
    const a = createI18nAdapter();
    const logger = makeLogger();
    const cfg = i18nextConfig({
      autoDetect: true,
      library_options: {},
    });
    await a.init(cfg as unknown as Record<string, unknown>, ctx(cfg, {}, logger));
    // Logger should have surfaced the detection result with a count.
    const infoCalls = logger.info.mock.calls.map((c) => c[0] as string);
    expect(infoCalls.some((m) => m.includes('namespace'))).toBe(true);
    await a.dispose(ctx(cfg));
  });
});

// ---------------------------------------------------------------------------
// Partial-node emission shape (PRD-207-R4, R6, R17)
// ---------------------------------------------------------------------------

describe('PRD-207-R4 / R6 / R17: partial node emission', () => {
  it('PRD-207-R4: emits {id, _actPartial: true, metadata}', async () => {
    const result = await runWith(nextIntlConfig());
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const n of result.nodes) {
      expect(n.id).toMatch(/^cms\//);
      expect((n as PartialEmittedNode)._actPartial).toBe(true);
      expect(n.metadata).toBeTypeOf('object');
    }
  });

  it('PRD-207-R6: emits NO scalar fields outside metadata', async () => {
    const result = await runWith(nextIntlConfig());
    for (const n of result.nodes) {
      const allowed = new Set(['id', '_actPartial', 'metadata']);
      for (const k of Object.keys(n)) {
        expect(allowed.has(k)).toBe(true);
      }
    }
  });

  it('PRD-207-R17: every emitted node carries metadata.source.adapter = "act-i18n"', async () => {
    const result = await runWith(nextIntlConfig());
    for (const n of result.nodes) {
      const meta = n.metadata as Record<string, unknown>;
      const src = meta['source'] as Record<string, unknown>;
      expect(src['adapter']).toBe('act-i18n');
      expect(src['source_id']).toMatch(/^[a-z]{2}/);
    }
  });

  it('PRD-207-R4: metadata.locale is set under Pattern 1', async () => {
    const result = await runWith(nextIntlConfig());
    const sample = result.nodes[0]!;
    const meta = sample.metadata as Record<string, unknown>;
    expect(typeof meta['locale']).toBe('string');
  });

  it('PRD-207-R4: metadata.locale is OMITTED under Pattern 2', async () => {
    const cfg = nextIntlConfig({ idTransform: { pattern: 2 } });
    const result = await runWith(cfg);
    for (const n of result.nodes) {
      const meta = n.metadata as Record<string, unknown>;
      expect(meta['locale']).toBeUndefined();
      expect(meta['translations']).toBeUndefined();
    }
  });

  it('PRD-207-R5: metadata.translations enumerates only locales that actually have a translation', async () => {
    const result = await runWith(nextIntlConfig());
    // The "faq" node only exists in en-US per fixtures. Locales es-ES and
    // de-DE have NO faq keys, so en-US's faq node should have an EMPTY
    // translations array (no other locale has the keys).
    const enFaq = result.nodes.find(
      (n) => n.id === 'cms/en-us/faq',
    ) as PartialEmittedNode | undefined;
    expect(enFaq).toBeDefined();
    const meta = enFaq!.metadata as Record<string, unknown>;
    expect(meta['translations']).toBeUndefined();
  });

  it('PRD-207-R7: pricing in es-ES is "partial" (headline only, subhead missing)', async () => {
    const result = await runWith(nextIntlConfig());
    const node = result.nodes.find((n) => n.id === 'cms/es-es/pricing') as
      | PartialEmittedNode
      | undefined;
    expect(node).toBeDefined();
    const meta = node!.metadata as Record<string, unknown>;
    expect(meta['translation_status']).toBe('partial');
  });

  it('PRD-207-R7: home.hero in de-DE is "complete" (both keys present)', async () => {
    const result = await runWith(nextIntlConfig());
    const node = result.nodes.find((n) => n.id === 'cms/de-de/home') as
      | PartialEmittedNode
      | undefined;
    expect(node).toBeDefined();
    const meta = node!.metadata as Record<string, unknown>;
    expect(meta['translation_status']).toBe('complete');
  });

  it('PRD-207-R7/R8: faq in de-DE is "fallback" with fallback_from = en-US', async () => {
    const result = await runWith(nextIntlConfig());
    const node = result.nodes.find((n) => n.id === 'cms/de-de/faq') as
      | PartialEmittedNode
      | undefined;
    expect(node).toBeDefined();
    const meta = node!.metadata as Record<string, unknown>;
    expect(meta['translation_status']).toBe('fallback');
    expect(meta['fallback_from']).toBe('en-US');
  });
});

// ---------------------------------------------------------------------------
// Recoverable / unrecoverable failure modes (R9, R10, R14)
// ---------------------------------------------------------------------------

describe('PRD-207-R10: orphan partial (no primary contributor)', () => {
  it('emits the partial speculatively; framework merge step elevates it without primary', () => {
    // Simulate PRD-207 emitting for an ID no primary adapter ever reaches.
    const i18nRun = {
      adapter: 'act-i18n',
      capabilities: { level: 'strict' as const, precedence: 'fallback' as const },
      nodes: [
        {
          id: 'cms/es-es/orphaned',
          _actPartial: true as const,
          metadata: {
            locale: 'es-ES',
            translation_status: 'complete',
            source: { adapter: 'act-i18n', source_id: 'es-ES:orphaned' },
          },
        } as unknown as PartialEmittedNode,
      ],
      warnings: [],
    };
    const merged = mergeRuns([i18nRun]);
    const node = merged.get('cms/es-es/orphaned') as Record<string, unknown>;
    expect(node).toBeDefined();
    // Partial-only result has no act_version / title; downstream validator
    // would reject. PRD-207-R10's contract is that the partial is
    // surfaced, not that it's automatically suppressed.
    expect((node as { metadata?: Record<string, unknown> }).metadata?.['translation_status']).toBe('complete');
    expect('act_version' in node).toBe(false);
  });
});

describe('PRD-207-R11: single instance per locale', () => {
  it('framework merge step deep-merges two PRD-207 contributions for the same ID', () => {
    // Simulate two PRD-207 instances bound to the same locale; the framework
    // does NOT raise an error (partial+partial deep-merges per PRD-200-R12),
    // BUT the result reflects the operator misconfiguration: both adapters
    // contribute under the same source_id, surfacing in metadata.source.
    const inst1 = {
      adapter: 'act-i18n',
      capabilities: { level: 'strict' as const, precedence: 'fallback' as const },
      nodes: [
        {
          id: 'cms/es-es/x',
          _actPartial: true as const,
          metadata: {
            translation_status: 'complete',
            source: { adapter: 'act-i18n', source_id: 'es-ES:x' },
          },
        } as unknown as PartialEmittedNode,
      ],
      warnings: [],
    };
    const inst2 = {
      adapter: 'act-i18n',
      capabilities: { level: 'strict' as const, precedence: 'fallback' as const },
      nodes: [
        {
          id: 'cms/es-es/x',
          _actPartial: true as const,
          metadata: {
            translation_status: 'partial',
            source: { adapter: 'act-i18n', source_id: 'es-ES:x' },
          },
        } as unknown as PartialEmittedNode,
      ],
      warnings: [],
    };
    const merged = mergeRuns([inst1, inst2]);
    const node = merged.get('cms/es-es/x') as Record<string, unknown>;
    const meta = node['metadata'] as Record<string, unknown>;
    // Documented behavior: last-writer-wins on the scalar status field,
    // surfacing the latest contribution. Operators are warned in PRD-207-R11
    // to NOT compose two PRD-207 instances for the same locale; the
    // framework's merge step does not raise on this, but the test pins
    // the observable behavior so future framework changes (e.g., a new
    // collision rule for same-adapter contributions) do not silently break
    // PRD-207's documented contract.
    expect(meta['translation_status']).toBe('partial');
  });
});

describe('PRD-207-R12: locale-set arbitration', () => {
  it('binds only locales in the i18n adapter set; primary locales not in set get no PRD-207 contribution', async () => {
    // PRD-207 covers en-US + es-ES; primary CMS is assumed to also serve de-DE,
    // but PRD-207 emits no de-DE partials (so de-DE primary nodes stand alone).
    const cfg = nextIntlConfig({
      locales: { default: 'en-US', available: ['en-US', 'es-ES'] },
    });
    const result = await runWith(cfg);
    const localesEmitted = new Set<string>();
    for (const n of result.nodes) {
      const meta = n.metadata as Record<string, unknown>;
      if (typeof meta['locale'] === 'string') localesEmitted.add(meta['locale'] as string);
    }
    expect(localesEmitted.has('en-US')).toBe(true);
    expect(localesEmitted.has('es-ES')).toBe(true);
    expect(localesEmitted.has('de-DE')).toBe(false);
  });
});

describe('PRD-207-R9: recoverable failures', () => {
  it('missing locale file → warning, no partials for that locale', async () => {
    const fs = await import('node:fs/promises');
    const tmp = await fs.mkdtemp(path.join((await fs.realpath('/tmp')), 'i18n-missing-loc-'));
    await fs.writeFile(path.join(tmp, 'en-US.json'), '{"a":"A"}', 'utf8');
    // de-DE.json deliberately absent.
    const cfg = nextIntlConfig({
      messagesDir: tmp,
      locales: { default: 'en-US', available: ['en-US', 'de-DE'] },
    });
    const logger = makeLogger();
    const a = createI18nAdapter();
    const c = ctx(cfg, {}, logger);
    const result = await runAdapter(a, c.config, c);
    const warnMessages = logger.warn.mock.calls.map((cc) => cc[0] as string);
    expect(warnMessages.some((m) => m.includes("locale 'de-DE' missing"))).toBe(true);
    // Should still emit en-US partials AND de-DE "missing" partials (since
    // we still iterate the locale loop; with no catalog the status walks to
    // missing). Actually, our impl skips loading; de-DE has no catalog so
    // determineNodeStatus → "missing".
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('cms/en-us/a');
  });
});

describe('PRD-207-R14: unrecoverable failures', () => {
  it('malformed catalog JSON throws from enumerate', async () => {
    const fs = await import('node:fs/promises');
    const tmp = await fs.mkdtemp(path.join((await fs.realpath('/tmp')), 'i18n-bad-json-'));
    await fs.writeFile(path.join(tmp, 'en-US.json'), '{ invalid', 'utf8');
    await fs.writeFile(path.join(tmp, 'es-ES.json'), '{}', 'utf8');
    const cfg = nextIntlConfig({
      messagesDir: tmp,
      locales: { default: 'en-US', available: ['en-US', 'es-ES'] },
    });
    const a = createI18nAdapter();
    const c = ctx(cfg);
    await expect(runAdapter(a, c.config, c)).rejects.toThrow(I18nAdapterError);
  });
});

// ---------------------------------------------------------------------------
// Node inference helper
// ---------------------------------------------------------------------------

describe('node inference', () => {
  it('next-intl: groups by leading dotted segment (top-level key)', () => {
    const catalogs = new Map<string, FlatCatalog>([
      ['en-US', new Map([
        ['home.hero.headline', 'A'],
        ['home.hero.subhead', 'B'],
        ['pricing.headline', 'C'],
      ])],
    ]);
    const cfg = nextIntlConfig();
    const nodes = _inferNodesFromCatalogsForTest(catalogs, cfg);
    const home = nodes.find((n) => n.nodeKey === 'home');
    const pricing = nodes.find((n) => n.nodeKey === 'pricing');
    expect(home?.catalogKeys.sort()).toEqual(['home.hero.headline', 'home.hero.subhead']);
    expect(pricing?.catalogKeys).toEqual(['pricing.headline']);
  });

  it('i18next: groups by leading namespace segment', () => {
    const catalogs = new Map<string, FlatCatalog>([
      ['en-US', new Map([
        ['common.save', 'A'],
        ['common.cancel', 'B'],
        ['home.hero.headline', 'C'],
      ])],
    ]);
    const cfg = i18nextConfig();
    const nodes = _inferNodesFromCatalogsForTest(catalogs, cfg);
    const common = nodes.find((n) => n.nodeKey === 'common');
    expect(common?.catalogKeys.sort()).toEqual(['common.cancel', 'common.save']);
  });

  it('returns [] when the default locale catalog is absent', () => {
    const cfg = nextIntlConfig();
    const nodes = _inferNodesFromCatalogsForTest(new Map(), cfg);
    expect(nodes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration: full pipeline (next-intl, react-intl, i18next)
// ---------------------------------------------------------------------------

describe('integration: full pipeline per library', () => {
  it('PRD-207-R19: next-intl → emits partials, all status values from the closed enum', async () => {
    const result = await runWith(nextIntlConfig());
    expect(result.nodes.length).toBeGreaterThan(0);
    const closedEnum = new Set(['complete', 'partial', 'fallback', 'missing']);
    for (const n of result.nodes) {
      const meta = n.metadata as Record<string, unknown>;
      expect(closedEnum.has(meta['translation_status'] as string)).toBe(true);
    }
  });

  it('PRD-207-R19: react-intl → emits partials with FormatJS shape', async () => {
    const result = await runWith(reactIntlConfig());
    expect(result.nodes.length).toBeGreaterThan(0);
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('cms/en-us/home');
    expect(ids).toContain('cms/de-de/home');
    expect(ids).toContain('cms/fr-fr/home');
  });

  it('PRD-207-R19: i18next with fallback chain → de-AT home falls back to de', async () => {
    const result = await runWith(i18nextConfig());
    const node = result.nodes.find((n) => n.id === 'md/de-at/home') as
      | PartialEmittedNode
      | undefined;
    expect(node).toBeDefined();
    const meta = node!.metadata as Record<string, unknown>;
    expect(meta['translation_status']).toBe('fallback');
    expect(meta['fallback_from']).toBe('de');
  });
});

// ---------------------------------------------------------------------------
// Multi-source merge composition (A1 / cross-source dedupe)
// ---------------------------------------------------------------------------

describe('A1 cross-source composition (PRD-207 + primary adapter)', () => {
  /**
   * Construct two adapter "runs" by hand and feed them through the
   * framework's `mergeRuns` to verify:
   *   1. The primary's scalar `title` survives PRD-207's contribution
   *      (precedence: "fallback").
   *   2. metadata.translations entries deduped by (locale, id) per A1.
   *   3. metadata.* deep-merge unions both adapters' contributions.
   */
  it('PRD-207-R6 + A1: scalars preserved; translations deduped by (locale, id)', () => {
    const primaryRun = {
      adapter: 'act-contentful',
      capabilities: {
        level: 'strict' as const,
        precedence: 'primary' as const,
        namespace_ids: false,
      },
      nodes: [
        {
          act_version: '0.1',
          id: 'cms/es-es/pricing',
          type: 'landing',
          title: 'Precios',
          etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
          summary: 'Niveles de precios.',
          metadata: {
            locale: 'es-ES',
            translations: [
              { locale: 'en-US', id: 'cms/en-us/pricing' },
              { locale: 'de-DE', id: 'cms/de-de/pricing' },
            ],
            source: { adapter: 'act-contentful', source_id: 'space/pricing@es-ES' },
          },
        } as unknown as EmittedNode,
      ],
      warnings: [],
    };
    const i18nRun = {
      adapter: 'act-i18n',
      capabilities: {
        level: 'strict' as const,
        precedence: 'fallback' as const,
        namespace_ids: false,
      },
      nodes: [
        {
          id: 'cms/es-es/pricing',
          _actPartial: true as const,
          metadata: {
            locale: 'es-ES',
            translation_status: 'partial',
            translations: [
              // Duplicate of CMS-side entry — must be deduped.
              { locale: 'en-US', id: 'cms/en-us/pricing' },
              // New locale not seen by CMS — must be retained.
              { locale: 'fr-FR', id: 'cms/fr-fr/pricing' },
            ],
            source: { adapter: 'act-i18n', source_id: 'es-ES:pricing' },
          },
        } as unknown as PartialEmittedNode,
      ],
      warnings: [],
    };

    const merged = mergeRuns([primaryRun, i18nRun]);
    const node = merged.get('cms/es-es/pricing') as Record<string, unknown>;
    expect(node).toBeDefined();
    // 1. Primary scalar survives (precedence: fallback).
    expect(node['title']).toBe('Precios');
    expect(node['summary']).toBe('Niveles de precios.');
    // 2. translation_status from PRD-207 is preserved (CMS didn't set one).
    const meta = node['metadata'] as Record<string, unknown>;
    expect(meta['translation_status']).toBe('partial');
    // 3. translations deduped by (locale, id), later-wins per A1.
    const trs = meta['translations'] as Array<{ locale: string; id: string }>;
    const localeCounts = new Map<string, number>();
    for (const t of trs) localeCounts.set(t.locale, (localeCounts.get(t.locale) ?? 0) + 1);
    expect(localeCounts.get('en-US')).toBe(1);
    expect(localeCounts.get('fr-FR')).toBe(1);
    expect(localeCounts.get('de-DE')).toBe(1);
  });

  it('PRD-207-R6: precedence:fallback NEVER overwrites an existing primary scalar even on hostile partial', () => {
    // Pathological case from PRD-207 Example 6.
    const primaryRun = {
      adapter: 'act-contentful',
      capabilities: { level: 'strict' as const, precedence: 'primary' as const },
      nodes: [
        {
          act_version: '0.1',
          id: 'cms/en-us/pricing',
          type: 'landing',
          title: 'Pricing',
          etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
          summary: 'Real summary',
          metadata: { locale: 'en-US', source: { adapter: 'act-contentful', source_id: 'x' } },
        } as unknown as EmittedNode,
      ],
      warnings: [],
    };
    const evilI18n = {
      adapter: 'act-i18n',
      capabilities: { level: 'strict' as const, precedence: 'fallback' as const },
      nodes: [
        {
          id: 'cms/en-us/pricing',
          _actPartial: true as const,
          // Intentional misconfiguration: try to set title.
          title: 'Pricing-i18n-bug',
          metadata: { translation_status: 'complete' },
        } as unknown as PartialEmittedNode,
      ],
      warnings: [],
    };
    const merged = mergeRuns([primaryRun, evilI18n]);
    const node = merged.get('cms/en-us/pricing') as Record<string, unknown>;
    expect(node['title']).toBe('Pricing'); // Primary wins.
    const meta = node['metadata'] as Record<string, unknown>;
    expect(meta['translation_status']).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// PRD-207-R18: spec version + R20 no-null contract
// ---------------------------------------------------------------------------

describe('PRD-207-R18 / R20: spec pinning + no-null', () => {
  it('R18: adapter operates against actVersion 0.1 in ctx', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig();
    const c = ctx(cfg, { actVersion: '0.1' });
    const caps = await a.init(c.config, c);
    expect(caps.level).toBe('strict');
    await a.dispose(c);
  });

  it('R20: NEVER emits null in any field (structurally — no required strings)', async () => {
    const result = await runWith(nextIntlConfig());
    for (const n of result.nodes) {
      for (const v of Object.values(n)) {
        expect(v).not.toBeNull();
      }
      const meta = n.metadata as Record<string, unknown>;
      for (const v of Object.values(meta)) {
        expect(v).not.toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Dispose idempotency
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('idempotent across multiple calls', async () => {
    const a = createI18nAdapter();
    const cfg = nextIntlConfig();
    const c = ctx(cfg);
    await a.init(c.config, c);
    await a.dispose(c);
    await a.dispose(c);
    // No throw.
    expect(true).toBe(true);
  });
});

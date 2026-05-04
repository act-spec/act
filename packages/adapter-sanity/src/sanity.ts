/**
 * PRD-203 Sanity adapter — `@act-spec/adapter-sanity`.
 *
 * Public factory `createSanityAdapter` returns a PRD-200-R1 `Adapter`
 * whose lifecycle satisfies PRD-203-R1..R27. The adapter does NOT depend
 * on the live `@sanity/client` SDK at runtime: a mockable `provider`
 * abstracts the GROQ surface so tests run from recorded fixtures
 * (per the role's "no live Sanity API calls in tests" constraint).
 *
 * Library choices:
 *  - `@portabletext/types` ONLY as a dev-time peer for type alignment;
 *    runtime walker reads minimal structural shape, so no peer-dep at
 *    runtime. Consumers wiring the live SDK install `@sanity/client` and
 *    `@portabletext/types` themselves.
 *  - `ajv` (8.x, 2020-12) for config schema validation; same major as
 *    `@act-spec/validator` and sibling adapters.
 *  - In-tree Portable Text → markdown serializer (no `@portabletext/to-html`)
 *    — PRD-102 blocks are markdown-shaped, not HTML, so the dependency would
 *    be a poor fit (anti-pattern hedge: framework-fit over dependency reuse).
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { Ajv as AjvType } from 'ajv';
import { deriveEtag, stripEtag } from '@act-spec/validator';
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  EmittedNode,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';

import { SanityAdapterError } from './errors.js';
import { walkPortableText } from './portable-text.js';
import type { ContentBlock } from './portable-text.js';
import { resolveReferences } from './references.js';
import type {
  PortableTextNode,
  SanityAdapterConfig,
  SanityDocument,
  SanityItem,
  SanitySlug,
  SanitySourceCorpus,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants & schema loading
// ---------------------------------------------------------------------------

/** PRD-203-R1 — adapter identity. */
export const SANITY_ADAPTER_NAME = 'act-sanity' as const;

/** PRD-203-R16 — concurrency default. */
export const SANITY_DEFAULT_CONCURRENCY = 4 as const;

/** PRD-203-R8 — reserved metadata keys we refuse to overwrite. */
export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'source',
  'extraction_status',
  'extraction_error',
  'locale',
  'translations',
  'reference_cycles',
  'preview',
]);

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locate the adapter package root so we can read `schema/config.schema.json`. */
function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === '@act-spec/adapter-sanity') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`sanity-adapter: could not locate package root from ${start}`);
}

const PACKAGE_ROOT = findPackageRoot(here);
const CONFIG_SCHEMA_PATH = path.join(PACKAGE_ROOT, 'schema', 'config.schema.json');

type Ajv2020Ctor = new (opts?: Record<string, unknown>) => AjvType;
type AddFormats = (ajv: AjvType) => unknown;
const Ajv2020 = Ajv2020Module as unknown as Ajv2020Ctor;
const addFormats = addFormatsModule as unknown as AddFormats;

let cachedConfigValidator: ValidateFunction | undefined;

function loadConfigValidator(): ValidateFunction {
  if (cachedConfigValidator) return cachedConfigValidator;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
  cachedConfigValidator = ajv.compile(schema);
  return cachedConfigValidator;
}

/** @internal — exposed for tests only. */
export function _resetConfigValidatorCacheForTest(): void {
  cachedConfigValidator = undefined;
}

function ajvErrorsToString(errors: readonly ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return '<no detail>';
  return errors
    .map((e) => `${e.instancePath || '/'} ${e.message ?? '<no message>'}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Source provider — abstracts over live Sanity client.
// ---------------------------------------------------------------------------

/**
 * PRD-203 implementation note 1 — the live `@sanity/client` surface
 * (auth probe, paginated GROQ fetch, single-document fetch, delta query)
 * projected as a single interface. The default factory wires a corpus-backed
 * provider; production code can wire a real Sanity-backed one.
 */
export interface SanitySourceProvider {
  /** PRD-203-R20 — auth probe; returns 'ok' | 'unauthorized' | 'project_not_found'. */
  probeAuth(): Promise<'ok' | 'unauthorized' | 'project_not_found'>;
  /** PRD-203-R4 — fetch matching documents via the configured GROQ filter. */
  fetchDocuments(opts: { groqFilter: string }): Promise<SanityDocument[]>;
  /** PRD-203-R10 — single-document lookup by `_id`. */
  getDocument(id: string): SanityDocument | undefined;
  /** PRD-203-R14 — incremental delta given a transaction-ID marker. */
  syncDelta(since: string): Promise<{ documents: SanityDocument[]; nextMarker: string }>;
  /** Idempotent. */
  dispose(): Promise<void> | void;
}

/**
 * Build a SanitySourceProvider from a recorded corpus. Production-grade for
 * tests AND for any caller that has captured Sanity API responses (the
 * canonical pattern documented in PRD-203 §"Test fixtures").
 */
export function corpusProvider(corpus: SanitySourceCorpus): SanitySourceProvider {
  const lookup = new Map<string, SanityDocument>();
  for (const d of corpus.documents) lookup.set(d._id, d);
  for (const [id, d] of Object.entries(corpus.refDocuments ?? {})) lookup.set(id, d);

  return {
    probeAuth: () => Promise.resolve('ok'),
    fetchDocuments({ groqFilter: _gf }) {
      // Default corpus provider returns ALL documents — the test fixture is the
      // GROQ filter result. Tests that need filter behavior wire a custom provider.
      const out = [...corpus.documents];
      out.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
      return Promise.resolve(out);
    },
    getDocument(id: string) {
      return lookup.get(id);
    },
    syncDelta(_since: string) {
      return Promise.resolve({
        documents: corpus.documents,
        nextMarker: corpus.latestTransactionId ?? 'tx-corpus-v1',
      });
    },
    dispose() {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory shape
// ---------------------------------------------------------------------------

export interface CreateSanityAdapterOpts {
  /** Optional provider to back the adapter (default is corpus-backed). */
  provider?: SanitySourceProvider;
  /** When `provider` is omitted, the factory builds a `corpusProvider`. */
  corpus?: SanitySourceCorpus;
}

/**
 * PRD-203-R1 — factory returning a PRD-200-R1 `Adapter`.
 */
export function createSanityAdapter(
  opts: CreateSanityAdapterOpts = {},
): Adapter<SanityItem> {
  if (!opts.provider && !opts.corpus) {
    throw new SanityAdapterError({
      code: 'config_invalid',
      message:
        'PRD-203: createSanityAdapter requires either `provider` or `corpus` (no live Sanity API wiring in v0.1)',
    });
  }
  const provider: SanitySourceProvider =
    opts.provider ?? corpusProvider(opts.corpus as SanitySourceCorpus);

  // Per-build state captured by the lifecycle hooks below.
  let resolvedConfig: SanityAdapterConfig | undefined;
  let declaredLevel: 'core' | 'standard' | 'strict' = 'standard';
  let disposed = false;

  return {
    name: SANITY_ADAPTER_NAME,

    // PRD-200-R8 — optional fast precheck; reuses config schema; no network.
    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new SanityAdapterError({
          code: 'config_invalid',
          message: `PRD-203-R2: precheck — config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      // Numeric depth bound enforced even when AJV passes the integer range
      // (defense in depth for PRD-203-R11).
      const depth = (config as { referenceDepth?: unknown }).referenceDepth;
      if (typeof depth === 'number' && (depth < 0 || depth > 5 || !Number.isInteger(depth))) {
        throw new SanityAdapterError({
          code: 'reference_depth_exceeded',
          message: `PRD-203-R11: referenceDepth must be integer 0–5; got ${String(depth)}`,
        });
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      // PRD-203-R2 — schema validation.
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new SanityAdapterError({
          code: 'config_invalid',
          message: `PRD-203-R2: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as SanityAdapterConfig;

      // PRD-203-R11 — depth bound (defense-in-depth past the schema's max:5).
      if (cfg.referenceDepth !== undefined) {
        const d = cfg.referenceDepth;
        if (!Number.isInteger(d) || d < 0 || d > 5) {
          throw new SanityAdapterError({
            code: 'reference_depth_exceeded',
            message: `PRD-203-R11: referenceDepth must be integer 0–5; got ${String(d)}`,
          });
        }
      }

      // PRD-203-R23 — token resolution (env var or inline). Never log the value.
      const token = resolveApiToken(cfg);
      if (token === undefined) {
        const ref = cfg.apiToken as { from_env: string };
        throw new SanityAdapterError({
          code: 'config_invalid',
          message: `PRD-203-R2/R23: env var '${ref.from_env}' is not set`,
        });
      }
      if (typeof cfg.apiToken === 'string') {
        ctx.logger.warn(
          'PRD-203-R23: apiToken supplied inline; prefer { from_env: "<NAME>" } for credential hygiene',
        );
      }

      // PRD-203-R3 — preview-mode warning + stamp.
      const version = cfg.version ?? 'published';
      if (version !== 'published') {
        ctx.logger.warn(
          `PRD-203-R3: version="${version}" — emitted nodes will carry metadata.preview=true`,
        );
      }

      resolvedConfig = cfg;

      // PRD-203-R20 — auth probe.
      const probe = await provider.probeAuth();
      if (probe === 'unauthorized') {
        throw new SanityAdapterError({
          code: 'auth_failed',
          message:
            'PRD-203-R20: Sanity apiToken rejected (HTTP 401). Set SANITY_API_TOKEN and re-run; do not commit tokens.',
        });
      }
      if (probe === 'project_not_found') {
        throw new SanityAdapterError({
          code: 'project_not_found',
          message: `PRD-203-R20: Sanity project '${cfg.projectId}' not found`,
        });
      }

      // PRD-203-R17 / R18 — declared level.
      const isStrict = !!cfg.componentMapping || !!cfg.locale;
      declaredLevel = isStrict ? 'strict' : 'standard';

      // PRD-200-R24 / PRD-203-R18 — refuse when adapter would declare a higher
      // level than the target (analogous to contentful's R21 path).
      if (rankOf(declaredLevel) > rankOf(ctx.targetLevel)) {
        throw new SanityAdapterError({
          code: 'level_mismatch',
          message: `PRD-203-R18: adapter-declared level '${declaredLevel}' exceeds target '${ctx.targetLevel}' (configure a lower target or remove componentMapping / locale)`,
        });
      }

      // PRD-203-R16 — capability declaration.
      return {
        level: declaredLevel,
        concurrency_max: cfg.concurrency?.transform ?? SANITY_DEFAULT_CONCURRENCY,
        delta: true,
        namespace_ids: false, // Adapter manages its own namespace prefix (PRD-203-R7 / R25).
        precedence: 'primary',
        manifestCapabilities: {
          etag: true,
          subtree: true,
          ndjson_index: false,
          search: { template_advertised: false },
        },
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<SanityItem> {
      const cfg = expectConfig(resolvedConfig);
      const filter = cfg.groqFilter ?? '*';
      const docs = await provider.fetchDocuments({ groqFilter: filter });
      if (docs.length === 0 && cfg.allowEmpty !== true) {
        ctx.logger.warn(
          `PRD-203-R5: GROQ filter "${filter}" returned 0 documents; pass allowEmpty=true to suppress`,
        );
      }

      // PRD-203-R13 — locale fan-out.
      if (cfg.locale && cfg.locale.pattern === 'field') {
        // Field-level translations: emit one item per available locale.
        const locales = cfg.locale.available ?? [cfg.locale.default ?? 'en'];
        for (const doc of docs) {
          if (ctx.signal.aborted) return;
          for (const loc of locales) {
            yield { doc, locale: loc };
          }
        }
        return;
      }
      if (cfg.locale && cfg.locale.pattern === 'document') {
        // Document-level translations: each doc carries its own locale field.
        // Build sibling map keyed by `translationsOf` if present, else by doc.
        const localeField = cfg.locale.field;
        const groups = new Map<string, SanityDocument[]>();
        for (const doc of docs) {
          const key = typeof doc['translationsOf'] === 'string'
            ? (doc['translationsOf'])
            : doc._id;
          const list = groups.get(key) ?? [];
          list.push(doc);
          groups.set(key, list);
        }
        for (const [, group] of groups) {
          for (const doc of group) {
            if (ctx.signal.aborted) return;
            const docLoc = typeof doc[localeField] === 'string'
              ? (doc[localeField])
              : null;
            const siblings = group
              .filter((d) => d._id !== doc._id)
              .map((d) => ({
                locale: typeof d[localeField] === 'string' ? (d[localeField]) : 'unknown',
                id: deriveActId(d, cfg, typeof d[localeField] === 'string' ? (d[localeField]) : null),
              }));
            yield { doc, locale: docLoc, siblings };
          }
        }
        return;
      }
      for (const doc of docs) {
        if (ctx.signal.aborted) return;
        yield { doc, locale: null };
      }
    },

    transform(
      item: SanityItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(transformItem(item, cfg, declaredLevel, provider, ctx));
    },

    async *delta(since: string, ctx: AdapterContext): AsyncIterable<SanityItem> {
      const cfg = expectConfig(resolvedConfig);
      const result = await provider.syncDelta(since);
      ctx.logger.info(
        `PRD-203-R14: sync delta yielded ${String(result.documents.length)} docs; next marker=${result.nextMarker}`,
      );
      const locales = cfg.locale?.available ?? [null];
      for (const doc of result.documents) {
        if (ctx.signal.aborted) return;
        for (const loc of locales) {
          yield { doc, locale: loc };
        }
      }
    },

    async dispose(_ctx: AdapterContext): Promise<void> {
      if (disposed) return;
      disposed = true;
      await provider.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_ORDER: ReadonlyArray<'core' | 'standard' | 'strict'> = ['core', 'standard', 'strict'];
function rankOf(l: 'core' | 'standard' | 'strict'): number {
  return LEVEL_ORDER.indexOf(l);
}

function expectConfig(cfg: SanityAdapterConfig | undefined): SanityAdapterConfig {
  if (!cfg) {
    throw new SanityAdapterError({
      code: 'config_invalid',
      message: 'PRD-203: adapter used before init',
    });
  }
  return cfg;
}

function resolveApiToken(cfg: SanityAdapterConfig): string | undefined {
  if (typeof cfg.apiToken === 'string') return cfg.apiToken;
  return process.env[cfg.apiToken.from_env];
}

/** PRD-203-R7 — derive ACT id from `slug.current`, configured `idField`, or `_id`. */
function deriveActId(
  doc: SanityDocument,
  cfg: SanityAdapterConfig,
  locale: string | null,
): string {
  const namespace = cfg.namespace ?? 'cms';
  const localePrefix = locale !== null ? `${locale.toLowerCase()}/` : '';

  // Explicit override first.
  if (cfg.idField !== undefined) {
    const v = readField(doc, cfg.idField);
    if (typeof v === 'string' && v.length > 0) {
      return `${namespace}/${localePrefix}${normalize(v)}`;
    }
  }

  // Slug-shaped field: { _type: 'slug', current: '…' }.
  const maybeSlug = doc['slug'];
  if (isSanitySlug(maybeSlug) && typeof maybeSlug.current === 'string' && maybeSlug.current.length > 0) {
    return `${namespace}/${localePrefix}${normalize(maybeSlug.current)}`;
  }

  // Fall back to `_id`.
  return `${namespace}/${localePrefix}${normalize(doc._id)}`;
}

function isSanitySlug(v: unknown): v is SanitySlug {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>)['_type'] === 'slug'
  );
}

/** Tiny dot-path reader for `idField`. */
function readField(doc: SanityDocument, path: string): unknown {
  const parts = path.split('.').filter((p) => p.length > 0);
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** PRD-100-R10 grammar — lower-case, allowed chars only, hyphenize the rest. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._\-/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** PRD-203-R6 — content-type → ACT type. */
function resolveActType(doc: SanityDocument, cfg: SanityAdapterConfig): string | undefined {
  const map = cfg.typeMapping ?? {};
  if (Object.prototype.hasOwnProperty.call(map, doc._type)) return map[doc._type];
  return doc._type; // identity default
}

/**
 * PRD-203-R7 — extract title with mapping override; returns null if missing.
 */
function resolveTitle(doc: SanityDocument, cfg: SanityAdapterConfig): string | null {
  const fieldName = cfg.fieldMapping?.title ?? 'title';
  const v = readField(doc, fieldName);
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

/**
 * PRD-203-R7 — extract summary; falls back to first-paragraph extraction
 * (capped at ~50 tokens) when no `summary` field is configured / present.
 * Returns `summarySource` for envelope stamping.
 */
function resolveSummary(
  doc: SanityDocument,
  cfg: SanityAdapterConfig,
  bodyBlocks: ContentBlock[],
): { summary: string; summarySource: 'author' | 'extracted' } {
  const strategy = cfg.summary?.strategy;
  const fieldName = cfg.fieldMapping?.summary ?? 'summary';

  if (strategy === 'field' || strategy === undefined) {
    const v = readField(doc, fieldName);
    if (typeof v === 'string' && v.length > 0) {
      return { summary: v, summarySource: 'author' };
    }
  }
  // Extraction fallback: first prose block, capped at 50 tokens.
  const firstProse = bodyBlocks.find((b) => b.type === 'prose');
  const text = firstProse && typeof (firstProse as { text?: unknown }).text === 'string'
    ? (firstProse as { text: string }).text
    : '';
  if (text.length > 0) {
    const tokens = text.split(/\s+/).filter((t) => t.length > 0).slice(0, 50);
    return { summary: tokens.join(' '), summarySource: 'extracted' };
  }
  // Last-resort placeholder so the envelope satisfies PRD-100-R21.
  return {
    summary: `Summary for ${doc._type} ${doc._id}`,
    summarySource: 'extracted',
  };
}

function tokenize(s: string): number {
  return Math.max(1, s.split(/\s+/).filter((x) => x.length > 0).length);
}

/**
 * PRD-203-R7..R25 — produce a fully-formed PRD-100 envelope (or partial)
 * for a single SanityItem. Pure modulo `provider` calls (reference resolution).
 */
function transformItem(
  item: SanityItem,
  cfg: SanityAdapterConfig,
  level: 'core' | 'standard' | 'strict',
  provider: SanitySourceProvider,
  ctx: AdapterContext,
): EmittedNode | PartialEmittedNode | null {
  const { doc, locale } = item;

  // PRD-203-R6 — type mapping (skip when explicitly mapped to undefined).
  const targetType = resolveActType(doc, cfg);
  if (targetType === undefined) {
    ctx.logger.debug(`PRD-203-R6: skipping doc ${doc._id} (typeMapping omits "${doc._type}")`);
    return null;
  }

  // PRD-203-R8 / R9 — body walk.
  const bodyFieldName = cfg.fieldMapping?.body ?? 'body';
  const body = doc[bodyFieldName];
  let bodyBlocks: ContentBlock[] = [];
  let bodyPartial = false;
  if (Array.isArray(body)) {
    const w = walkPortableText(body as PortableTextNode[], {
      targetLevel: level,
      ...(cfg.componentMapping !== undefined ? { componentMapping: cfg.componentMapping } : {}),
      warn: (m) => ctx.logger.warn(`PRD-203-R8/R9: ${m}`),
    });
    bodyBlocks = w.blocks;
    bodyPartial = w.partial;
  }

  // PRD-203-R7 — title with partial fallback.
  const titleResolved = resolveTitle(doc, cfg);
  const title = titleResolved ?? `Untitled ${doc._type} ${doc._id}`;
  const titlePartial = titleResolved === null;

  // PRD-203-R7 — summary (author / extracted).
  const summary = resolveSummary(doc, cfg, bodyBlocks);

  // PRD-203-R7 — abstract (optional).
  const abstractField = cfg.fieldMapping?.abstract ?? 'abstract';
  const abstractRaw = readField(doc, abstractField);
  const abstractValue =
    typeof abstractRaw === 'string' && abstractRaw.length > 0 ? abstractRaw : undefined;

  // PRD-203-R7 — tags.
  const tagsField = cfg.fieldMapping?.tags;
  let tags: string[] = [];
  if (tagsField !== undefined) {
    const v = readField(doc, tagsField);
    if (Array.isArray(v)) {
      tags = v.filter((x): x is string => typeof x === 'string');
    }
  }

  // PRD-203-R7 — id derivation.
  const id = deriveActId(doc, cfg, locale);

  // PRD-203-R10 / R11 / R12 — references + cycles.
  const refs = resolveReferences(
    doc,
    cfg,
    { getDocument: (rid) => provider.getDocument(rid) },
    (target) => deriveActId(target, cfg, locale),
  );

  // PRD-203-R13 — translations from sibling map.
  const translations = item.siblings && item.siblings.length > 0 ? item.siblings : undefined;

  // PRD-203-R25 — provenance source_id.
  const sourceId = locale !== null
    ? `${doc._id}#${locale}`
    : doc._id;

  // PRD-203-R3 — preview stamp.
  const isPreview = (cfg.version ?? 'published') !== 'published';

  // Compose envelope metadata.
  const metadata: Record<string, unknown> = {
    ...(locale !== null ? { locale } : {}),
    ...(translations !== undefined ? { translations } : {}),
    ...(refs.cycles > 0 ? { reference_cycles: refs.cycles } : {}),
    ...(isPreview ? { preview: true } : {}),
    source: {
      adapter: SANITY_ADAPTER_NAME,
      source_id: sourceId,
    },
  };

  const partialError: string | undefined = titlePartial
    ? `no title field (looked for "${cfg.fieldMapping?.title ?? 'title'}") on ${doc._id}`
    : bodyPartial
    ? `portable-text walk encountered unmapped block types on ${doc._id}`
    : undefined;

  if (partialError !== undefined) {
    metadata['extraction_status'] = 'partial';
    metadata['extraction_error'] = partialError;
  }

  // Tokens (PRD-100-R23).
  const tokens: Record<string, number> = { summary: tokenize(summary.summary) };
  if (abstractValue !== undefined) tokens['abstract'] = tokenize(abstractValue);
  const bodyTokenCount = bodyBlocks.reduce((acc, b) => {
    if (b.type === 'prose' && typeof (b as { text?: unknown }).text === 'string') {
      return acc + tokenize((b as { text: string }).text);
    }
    if (b.type === 'code' && typeof (b as { text?: unknown }).text === 'string') {
      return acc + tokenize((b as { text: string }).text);
    }
    if (b.type === 'callout' && typeof (b as { text?: unknown }).text === 'string') {
      return acc + tokenize((b as { text: string }).text);
    }
    return acc;
  }, 0);
  if (bodyTokenCount > 0) tokens['body'] = bodyTokenCount;

  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: targetType,
    title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA', // placeholder; recomputed below
    summary: summary.summary,
    summary_source: summary.summarySource,
    content: bodyBlocks as unknown as EmittedNode['content'],
    tokens,
    ...(abstractValue !== undefined ? { abstract: abstractValue } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(refs.related.length > 0 ? { related: refs.related } : {}),
    ...(typeof doc._updatedAt === 'string' ? { updated_at: doc._updatedAt } : {}),
    metadata,
  } as unknown as EmittedNode;

  // PRD-103 — derive a real etag now so PRD-600 validates clean.
  const stripped = stripEtag(envelope as unknown as Record<string, unknown>);
  (envelope as unknown as { etag: string }).etag = deriveEtag(stripped);

  if (partialError !== undefined) {
    return { ...envelope, _actPartial: true };
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Re-exports for the package index
// ---------------------------------------------------------------------------

export { SanityAdapterError } from './errors.js';
export type { SanityAdapterErrorCode } from './errors.js';
export type {
  PortableTextBlock,
  PortableTextCustomBlock,
  PortableTextNode,
  PortableTextSpan,
  SanityAdapterConfig,
  SanityDocument,
  SanityItem,
  SanityRef,
  SanitySlug,
  SanitySourceCorpus,
} from './types.js';
export { walkPortableText, type ContentBlock } from './portable-text.js';
export { resolveReferences, clampDepth } from './references.js';

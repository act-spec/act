/**
 * PRD-206 Builder.io adapter — `@act-spec/adapter-builder`.
 *
 * Public factory `createBuilderAdapter` returns a PRD-200-R1 `Adapter`
 * whose lifecycle satisfies PRD-206-R1..R30. The adapter does NOT depend
 * on a live Builder.io API at runtime: a mockable `provider` abstracts the
 * Content API surface so tests run from recorded fixtures (per the role's
 * "no live Builder.io API calls" constraint).
 *
 * Library choices:
 *  - No first-party `@builder.io/sdk` dependency. Builder Content API
 *    envelope shapes are structural per the PRD; the `provider` interface
 *    narrows them to the `BuilderContent` shape downstream of normalization.
 *  - `ajv` (8.x, 2020-12) for config schema validation; same major as
 *    `@act-spec/validator` and sibling adapters.
 *  - In-tree HTML-to-markdown walker (no `turndown`) — the recognized set
 *    per PRD-206-R9 is small (~10 tag cases) and `turndown` pulls JSDOM
 *    plus tens of transitive deps. Anti-pattern hedge: framework-fit over
 *    dependency reuse, mirroring strapi/storyblok in-tree walker policy.
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

import { BuilderAdapterError } from './errors.js';
import { walkBuilderTree } from './extract.js';
import { slugCase, type MappingEntry } from './marketing-mapping.js';
import {
  clampReferenceDepth,
  resolveReferences,
  type ReferenceLookup,
} from './references.js';
import type {
  BuilderAdapterConfig,
  BuilderContent,
  BuilderItem,
  BuilderSourceCorpus,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants & schema loading
// ---------------------------------------------------------------------------

/** PRD-206-R1 — adapter identity. */
export const BUILDER_ADAPTER_NAME = 'act-builderio' as const;

/** PRD-206-R21 — concurrency default per Builder.io's typical capacity. */
export const BUILDER_DEFAULT_CONCURRENCY = 4 as const;

/** PRD-206-R12 — max permitted Symbol recursion depth. */
export const BUILDER_DEFAULT_SYMBOL_RECURSION_MAX = 3 as const;

/** PRD-206-R15 — default reference-resolution depth. */
export const BUILDER_DEFAULT_REFERENCE_DEPTH = 1 as const;

/** PRD-206-R23 — default per-page coverage warning threshold. */
export const BUILDER_DEFAULT_UNMAPPED_THRESHOLD = 0.5 as const;

/** PRD-206 — reserved metadata keys we refuse to overwrite. */
export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
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
      if (pkg.name === '@act-spec/adapter-builder') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`builder-adapter: could not locate package root from ${start}`);
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
// Source provider — abstracts over live Builder.io API.
// ---------------------------------------------------------------------------

/**
 * PRD-206 implementation note 1 — the live Builder.io Content API surface
 * (auth probe, key-kind probe, paginated content fetch, single-content
 * lookup, delta query) projected as a single interface. The default
 * factory wires a corpus-backed provider; production code can wire a
 * real Builder.io-backed one.
 */
export interface BuilderSourceProvider {
  /** PRD-206-R25 — auth probe; returns 'ok' | 'unauthorized'. */
  probeAuth(): Promise<'ok' | 'unauthorized'>;
  /** PRD-206-R2 / R25 — key-kind probe; returns 'public' | 'private' | 'unknown'. */
  probeKeyKind(): Promise<'public' | 'private' | 'unknown'>;
  /** PRD-206-R5 — confirm a model exists; throws unrecoverable on 404. */
  probeModel(model: string): Promise<'ok' | 'not_found'>;
  /** PRD-206-R5 — fetch content entries for a model, optionally locale-filtered. */
  fetchContent(opts: { model: string; locale?: string }): Promise<BuilderContent[]>;
  /** PRD-206-R14 — single-content lookup for reference resolution. */
  getContentByModelAndId(model: string, id: string): BuilderContent | undefined;
  /** PRD-206-R19 — incremental delta given a `lastUpdated` epoch-ms marker. */
  syncDelta(
    since: string,
    models: string[],
  ): Promise<{ entries: BuilderContent[]; nextMarker: string }>;
  /** PRD-206-R24 — true when the provider should simulate a 429 exhausted condition. */
  shouldSimulateRateLimit(id: string): boolean;
  /** Idempotent. */
  dispose(): Promise<void> | void;
}

/**
 * Build a BuilderSourceProvider from a recorded corpus. Production-grade
 * for tests AND for any caller that has captured Builder Content API
 * responses (the canonical pattern documented in PRD-206 §"Test fixtures").
 */
export function corpusProvider(corpus: BuilderSourceCorpus): BuilderSourceProvider {
  const lookup = new Map<string, BuilderContent>();
  const indexByLocale = new Map<string, Map<string, BuilderContent[]>>();

  for (const [model, list] of Object.entries(corpus.contentByModel)) {
    for (const c of list) {
      const norm = normalizeContent(c, model);
      lookup.set(`${model}:${norm.id}`, norm);
    }
  }
  if (corpus.contentByLocale) {
    for (const [locale, perModel] of Object.entries(corpus.contentByLocale)) {
      const ctMap = new Map<string, BuilderContent[]>();
      for (const [model, list] of Object.entries(perModel)) {
        const normed = list.map((c) => {
          const n = normalizeContent(c, model);
          n.__locale = locale;
          return n;
        });
        ctMap.set(model, normed);
        for (const e of normed) {
          lookup.set(`${model}:${e.id}@${locale}`, e);
        }
      }
      indexByLocale.set(locale, ctMap);
    }
  }
  const unknownModels = new Set(corpus.unknownModels ?? []);
  const rateLimited = new Set(corpus.rateLimitedIds ?? []);

  return {
    probeAuth(): Promise<'ok' | 'unauthorized'> {
      return Promise.resolve(corpus.authProbe === 'unauthorized' ? 'unauthorized' : 'ok');
    },
    probeKeyKind(): Promise<'public' | 'private' | 'unknown'> {
      return Promise.resolve(corpus.keyKindProbe ?? 'public');
    },
    probeModel(model: string): Promise<'ok' | 'not_found'> {
      return Promise.resolve(unknownModels.has(model) ? 'not_found' : 'ok');
    },
    fetchContent({ model, locale }): Promise<BuilderContent[]> {
      if (typeof locale === 'string') {
        const bucket = indexByLocale.get(locale)?.get(model);
        if (bucket) return Promise.resolve(bucket);
      }
      const raw = corpus.contentByModel[model] ?? [];
      const normed = raw.map((c) => normalizeContent(c, model));
      return Promise.resolve(normed);
    },
    getContentByModelAndId(model, id) {
      return lookup.get(`${model}:${id}`);
    },
    syncDelta(_since, models): Promise<{ entries: BuilderContent[]; nextMarker: string }> {
      const out: BuilderContent[] = [];
      for (const m of models) {
        const raw = corpus.contentByModel[m] ?? [];
        for (const c of raw) out.push(normalizeContent(c, m));
      }
      return Promise.resolve({
        entries: out,
        nextMarker: corpus.latestUpdatedAt ?? '0',
      });
    },
    shouldSimulateRateLimit(id: string): boolean {
      return rateLimited.has(id);
    },
    dispose(): void {
      // no-op
    },
  };
}

/**
 * Normalize a Builder content envelope into the `BuilderContent` shape
 * with `modelName` synthesized when absent.
 */
export function normalizeContent(raw: BuilderContent, model: string): BuilderContent {
  if (raw === null || typeof raw !== 'object') {
    throw new BuilderAdapterError({
      code: 'config_invalid',
      message: 'PRD-206: content payload is not an object',
    });
  }
  const out: BuilderContent = { ...raw };
  if (typeof out.modelName !== 'string') out.modelName = model;
  return out;
}

// ---------------------------------------------------------------------------
// Public factory shape
// ---------------------------------------------------------------------------

export interface CreateBuilderAdapterOpts {
  provider?: BuilderSourceProvider;
  corpus?: BuilderSourceCorpus;
}

/**
 * PRD-206-R1 — factory returning a PRD-200-R1 `Adapter`.
 */
export function createBuilderAdapter(
  opts: CreateBuilderAdapterOpts = {},
): Adapter<BuilderItem> {
  if (!opts.provider && !opts.corpus) {
    throw new BuilderAdapterError({
      code: 'config_invalid',
      message:
        'PRD-206: createBuilderAdapter requires either `provider` or `corpus` (no live Builder.io API wiring in v0.1)',
    });
  }
  const provider: BuilderSourceProvider =
    opts.provider ?? corpusProvider(opts.corpus as BuilderSourceCorpus);

  let resolvedConfig: BuilderAdapterConfig | undefined;
  let declaredLevel: 'core' | 'standard' | 'strict' = 'standard';
  let declaredMode: 'pass-through' | 'extraction' = 'extraction';
  let disposed = false;

  return {
    name: BUILDER_ADAPTER_NAME,

    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new BuilderAdapterError({
          code: 'config_invalid',
          message: `PRD-206-R2: precheck — config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      // Defense-in-depth checks past the schema's numeric ranges (PRD-206-R12, R15).
      const refDepth = (config as { referenceDepth?: unknown }).referenceDepth;
      if (refDepth !== undefined) {
        if (typeof refDepth !== 'number' || !Number.isInteger(refDepth) || refDepth < 0 || refDepth > 3) {
          throw new BuilderAdapterError({
            code: 'reference_depth_exceeded',
            message: `PRD-206-R15: referenceDepth must be integer 0–3; got ${describeValue(refDepth)}`,
          });
        }
      }
      const sym = (config as { symbolRecursionMax?: unknown }).symbolRecursionMax;
      if (sym !== undefined) {
        if (typeof sym !== 'number' || !Number.isInteger(sym) || sym < 1 || sym > 3) {
          throw new BuilderAdapterError({
            code: 'symbol_recursion_max_invalid',
            message: `PRD-206-R12: symbolRecursionMax must be integer 1–3; got ${describeValue(sym)}`,
          });
        }
      }
      // PRD-206-R4 — mode invariant (the schema enum already covers this; defense-in-depth).
      const mode = (config as { mode?: unknown }).mode;
      if (mode !== undefined && mode !== 'pass-through' && mode !== 'extraction') {
        throw new BuilderAdapterError({
          code: 'mode_invalid',
          message: `PRD-206-R4: mode must be "pass-through" or "extraction"; got ${describeValue(mode)}`,
        });
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new BuilderAdapterError({
          code: 'config_invalid',
          message: `PRD-206-R2: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as BuilderAdapterConfig;

      // PRD-206-R15 / R12 — defense-in-depth past the schema range.
      if (cfg.referenceDepth !== undefined) {
        const d = cfg.referenceDepth;
        if (!Number.isInteger(d) || d < 0 || d > 3) {
          throw new BuilderAdapterError({
            code: 'reference_depth_exceeded',
            message: `PRD-206-R15: referenceDepth must be integer 0–3; got ${String(d)}`,
          });
        }
      }
      if (cfg.symbolRecursionMax !== undefined) {
        const r = cfg.symbolRecursionMax;
        if (!Number.isInteger(r) || r < 1 || r > 3) {
          throw new BuilderAdapterError({
            code: 'symbol_recursion_max_invalid',
            message: `PRD-206-R12: symbolRecursionMax must be integer 1–3; got ${String(r)}`,
          });
        }
      }

      // PRD-206-R4 — mode invariant.
      const mode: 'pass-through' | 'extraction' = cfg.mode ?? 'extraction';
      if (mode !== 'pass-through' && mode !== 'extraction') {
        throw new BuilderAdapterError({
          code: 'mode_invalid',
          message: `PRD-206-R4: mode must be "pass-through" or "extraction"; got "${String(mode)}"`,
        });
      }
      declaredMode = mode;

      // PRD-206-R26 / R27 — token resolution (env var or inline). Never log the value.
      const apiKey = resolveApiKey(cfg);
      if (apiKey === undefined) {
        const ref = cfg.apiKey as { from_env: string };
        throw new BuilderAdapterError({
          code: 'config_invalid',
          message: `PRD-206-R2/R26: env var '${ref.from_env}' is not set`,
        });
      }
      if (typeof cfg.apiKey === 'string') {
        ctx.logger.warn(
          'PRD-206-R26: apiKey supplied inline; prefer { from_env: "<NAME>" } for credential hygiene',
        );
      }
      if (cfg.debugLogging === true) {
        const fp = apiKey.slice(0, 4);
        ctx.logger.debug(
          `PRD-206-R26: builder adapter key fingerprint=${fp}… (debugLogging enabled)`,
        );
      }

      resolvedConfig = cfg;

      // PRD-206-R25 — auth probe (HTTP 401 / 403).
      const probe = await provider.probeAuth();
      if (probe === 'unauthorized') {
        throw new BuilderAdapterError({
          code: 'auth_failed',
          message:
            'PRD-206-R25: Builder.io apiKey rejected (HTTP 401/403). Set BUILDER_PUBLIC_KEY and re-run; do not commit keys.',
        });
      }

      // PRD-206-R2 / R25 — public-key kind probe; reject private keys.
      const keyKind = await provider.probeKeyKind();
      if (keyKind === 'private') {
        throw new BuilderAdapterError({
          code: 'private_key_detected',
          message:
            'PRD-206-R2/R25: a Builder.io PRIVATE (write) key was supplied; configure a PUBLIC (read-only) key. Key value redacted.',
        });
      }
      if (keyKind === 'unknown') {
        ctx.logger.warn(
          'PRD-206-R2/R25: could not determine Builder.io key kind; treating as public — verify the configured key is read-only.',
        );
      }

      // PRD-206-R5 — every configured model must exist (404 → unrecoverable).
      for (const m of cfg.models) {
        const probeModel = await provider.probeModel(m);
        if (probeModel === 'not_found') {
          throw new BuilderAdapterError({
            code: 'model_not_found',
            message: `PRD-206-R5: configured model "${m}" not found on Builder.io server (HTTP 404)`,
          });
        }
      }

      // PRD-206-R11 — declared level computation per matrix.
      declaredLevel = computeLevel(mode, cfg);

      // PRD-200-R24 — refuse when adapter would declare a higher level than the target.
      if (rankOf(declaredLevel) > rankOf(ctx.targetLevel)) {
        throw new BuilderAdapterError({
          code: 'level_mismatch',
          message: `PRD-206-R11: adapter-declared level '${declaredLevel}' exceeds target '${ctx.targetLevel}' (lower the target or simplify the configuration)`,
        });
      }

      // PRD-206-R21 — capability declaration.
      return {
        level: declaredLevel,
        concurrency_max: cfg.concurrency?.transform ?? BUILDER_DEFAULT_CONCURRENCY,
        delta: true,
        namespace_ids: false, // Adapter manages its own namespace prefix (PRD-206-R28).
        precedence: 'primary',
        manifestCapabilities: {
          etag: true,
          subtree: true,
          ndjson_index: false,
          search: { template_advertised: false },
        },
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<BuilderItem> {
      const cfg = expectConfig(resolvedConfig);
      const locales = cfg.locale?.locales ?? [null];
      let totalCount = 0;
      for (const locale of locales) {
        for (const model of cfg.models) {
          if (ctx.signal.aborted) return;
          const fetchOpts: { model: string; locale?: string } = { model };
          if (typeof locale === 'string') fetchOpts.locale = locale;
          const entries = await provider.fetchContent(fetchOpts);
          totalCount += entries.length;
          for (const content of entries) {
            const item: BuilderItem = {
              content,
              locale: typeof locale === 'string' ? locale : null,
            };
            if (typeof locale === 'string' && cfg.locale) {
              const siblings: Array<{ locale: string; id: string }> = [];
              for (const otherLoc of cfg.locale.locales) {
                if (otherLoc === locale) continue;
                const otherFetch: { model: string; locale?: string } = {
                  model,
                  locale: otherLoc,
                };
                const otherEntries = await provider.fetchContent(otherFetch);
                const sibling = findLocaleSibling(content, otherEntries);
                if (sibling) {
                  siblings.push({
                    locale: otherLoc,
                    id: deriveActId(sibling, cfg, otherLoc),
                  });
                }
              }
              if (siblings.length > 0) item.siblings = siblings;
            }
            yield item;

            // PRD-206-R18 — variant emission (Plus, opt-in).
            if (cfg.experiments === 'emit') {
              const variants = collectVariants(content);
              for (const v of variants) {
                const variantKey = slugCase(v.id ?? v.name ?? 'variant');
                const variantContent: BuilderContent = {
                  ...content,
                  ...(v.data !== undefined ? { data: v.data } : {}),
                  ...(v.name !== undefined ? { name: v.name } : {}),
                };
                yield {
                  content: variantContent,
                  locale: typeof locale === 'string' ? locale : null,
                  isVariant: true,
                  variantKey,
                  baseId: deriveActId(content, cfg, locale ?? null),
                };
              }
            }
          }
        }
      }
      // PRD-206-R6 — empty + no allowEmpty → warn but do NOT throw.
      if (totalCount === 0 && cfg.allowEmpty !== true) {
        ctx.logger.warn(
          `PRD-206-R6: configured models [${cfg.models.join(', ')}] returned 0 entries; pass allowEmpty=true to suppress`,
        );
      }
    },

    transform(
      item: BuilderItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(transformItem(item, cfg, declaredMode, declaredLevel, provider, ctx));
    },

    async *delta(since: string, ctx: AdapterContext): AsyncIterable<BuilderItem> {
      const cfg = expectConfig(resolvedConfig);
      const result = await provider.syncDelta(since, cfg.models);
      ctx.logger.info(
        `PRD-206-R19: sync delta yielded ${String(result.entries.length)} entries; next lastUpdated=${result.nextMarker}`,
      );
      for (const content of result.entries) {
        if (ctx.signal.aborted) return;
        yield { content, locale: null };
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

function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return `${v.toString()}n`;
  return `<${typeof v}>`;
}

function expectConfig(cfg: BuilderAdapterConfig | undefined): BuilderAdapterConfig {
  if (!cfg) {
    throw new BuilderAdapterError({
      code: 'config_invalid',
      message: 'PRD-206: adapter used before init',
    });
  }
  return cfg;
}

function resolveApiKey(cfg: BuilderAdapterConfig): string | undefined {
  if (typeof cfg.apiKey === 'string') return cfg.apiKey;
  return process.env[cfg.apiKey.from_env];
}

/**
 * PRD-206-R11 — compute declared level per the matrix:
 *
 *   - extraction + no componentMapping + no locale + experiments=skip → standard
 *   - extraction + (componentMapping | locale | experiments=emit)     → plus
 *   - pass-through                                                     → plus
 */
export function computeLevel(
  mode: 'pass-through' | 'extraction',
  cfg: BuilderAdapterConfig,
): 'standard' | 'strict' {
  if (mode === 'pass-through') return 'strict';
  if (cfg.componentMapping !== undefined && Object.keys(cfg.componentMapping).length > 0) {
    return 'strict';
  }
  if (cfg.locale !== undefined) return 'strict';
  if (cfg.experiments === 'emit') return 'strict';
  return 'standard';
}

function findLocaleSibling(
  content: BuilderContent,
  others: BuilderContent[],
): BuilderContent | undefined {
  // Builder.io doesn't carry an explicit `localizations` array. Sibling
  // detection: same `data.url` (the most stable correlation) or same `id`.
  const url = typeof content.data?.url === 'string' ? content.data.url : undefined;
  for (const o of others) {
    if (url !== undefined && o.data?.url === url) return o;
    if (o.id === content.id) return o;
  }
  return undefined;
}

/**
 * PRD-206-R28 — derive ACT id from configured `idField`, content `data.url`,
 * or the Builder content `id`. The locale suffix `@<locale>` is appended for
 * locale fan-out emission so unique IDs are produced per locale per
 * PRD-100-R10's grammar.
 */
export function deriveActId(
  content: BuilderContent,
  cfg: BuilderAdapterConfig,
  locale: string | null,
  variantKey?: string,
): string {
  const namespace = cfg.namespace ?? 'act-builderio';
  const targetType = resolveActType(content, cfg);

  // Explicit override first.
  if (cfg.idField !== undefined) {
    const v = readField(content, cfg.idField);
    if (typeof v === 'string' && v.length > 0) {
      return finalize(`${namespace}/${targetType}/${normalize(v)}`, locale, variantKey);
    }
  }
  // Default: `data.url` (sanitized).
  const url = typeof content.data?.url === 'string' ? content.data.url : undefined;
  if (url !== undefined && url.length > 0) {
    return finalize(`${namespace}/${targetType}/${normalize(url)}`, locale, variantKey);
  }
  // Fallback: Builder content id.
  return finalize(`${namespace}/${targetType}/${normalize(content.id)}`, locale, variantKey);
}

function finalize(base: string, locale: string | null, variantKey: string | undefined): string {
  if (variantKey !== undefined) return `${base}@${variantKey}`;
  if (locale !== null) return `${base}@${locale.toLowerCase()}`;
  return base;
}

function readField(content: BuilderContent, fieldPath: string): unknown {
  const parts = fieldPath.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  let cur: unknown = content;
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
    // Builder's `data.url` is a URL path beginning with `/` — strip leading
    // and trailing slashes so the produced ID is the sanitized path tail
    // rather than a `landing//x` dangler.
    .replace(/^\/+|\/+$/g, '')
    .replace(/^-|-$/g, '');
}

/** PRD-206-R7 — Builder model → ACT type. */
export function resolveActType(content: BuilderContent, cfg: BuilderAdapterConfig): string {
  const map = cfg.typeMapping ?? {};
  const model = content.modelName ?? 'page';
  if (Object.prototype.hasOwnProperty.call(map, model)) {
    const v = map[model];
    if (typeof v === 'string') return v;
  }
  // Default mapping per PRD-206-R7 table.
  switch (model) {
    case 'page':
    case 'section':
    case 'symbol':
      return 'landing';
    default:
      return model;
  }
}

function resolveTitle(content: BuilderContent, cfg: BuilderAdapterConfig): string | null {
  const fieldName = cfg.fieldMapping?.title ?? 'name';
  const v = readField(content, fieldName);
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function tokenize(s: string): number {
  return Math.max(1, s.split(/\s+/).filter((x) => x.length > 0).length);
}

/**
 * PRD-206-R8 — extract a summary either from `data.description` or from the
 * first Text component (capped at 50 tokens). Returns the source marker so
 * the envelope can stamp `summary_source` per PRD-100-R4.
 */
export function resolveSummary(
  content: BuilderContent,
  cfg: BuilderAdapterConfig,
  bodyBlocks: Array<Record<string, unknown>>,
): { summary: string; summarySource: 'author' | 'extracted' } {
  const strategy = cfg.summary?.strategy;
  const fieldName = cfg.fieldMapping?.summary ?? 'data.description';

  if (strategy === 'field' || strategy === undefined) {
    const v = readField(content, fieldName);
    if (typeof v === 'string' && v.length > 0) {
      return { summary: v, summarySource: 'author' };
    }
  }
  // Extraction fallback: first prose block, capped at 50 tokens.
  const firstProse = bodyBlocks.find(
    (b) => (b as { type?: unknown })['type'] === 'prose'
      && typeof (b as { text?: unknown })['text'] === 'string',
  );
  const text = firstProse !== undefined
    ? ((firstProse as { text: string })['text'])
    : '';
  if (text.length > 0) {
    const tokens = text.split(/\s+/).filter((t) => t.length > 0).slice(0, 50);
    return { summary: tokens.join(' '), summarySource: 'extracted' };
  }
  // Last resort: synthesize a placeholder so the envelope still validates
  // (PRD-100-R4 requires `summary` at every level).
  return {
    summary: `Summary for ${content.modelName ?? 'page'} ${content.id}`,
    summarySource: 'extracted',
  };
}

function collectVariants(
  content: BuilderContent,
): Array<{ id?: string; name?: string; data?: BuilderContent['data'] }> {
  const out: Array<{ id?: string; name?: string; data?: BuilderContent['data'] }> = [];
  if (content.variations) {
    for (const [key, v] of Object.entries(content.variations)) {
      const entry: { id?: string; name?: string; data?: BuilderContent['data'] } = {};
      entry.id = v.id ?? key;
      if (v.name !== undefined) entry.name = v.name;
      if (v.data !== undefined) entry.data = v.data;
      out.push(entry);
    }
  }
  return out;
}

/**
 * PRD-206-R7..R28 — produce a fully-formed PRD-100 envelope (or partial)
 * for a single BuilderItem.
 */
function transformItem(
  item: BuilderItem,
  cfg: BuilderAdapterConfig,
  mode: 'pass-through' | 'extraction',
  level: 'core' | 'standard' | 'strict',
  provider: BuilderSourceProvider,
  ctx: AdapterContext,
): EmittedNode | PartialEmittedNode | null {
  const { content, locale, isVariant, variantKey, baseId } = item;

  // PRD-206-R24 — simulate a 429 exhausted condition.
  let bodyPartial = false;
  let partialError: string | undefined;
  if (provider.shouldSimulateRateLimit(content.id)) {
    bodyPartial = true;
    partialError = `rate-limit retries exhausted for content "${content.id}" (HTTP 429)`;
    ctx.logger.warn(`PRD-206-R24: ${partialError}`);
  }

  // PRD-206-R7 — type mapping.
  const targetType = resolveActType(content, cfg);

  // PRD-206-R9 / R10 — body emission per mode.
  let bodyBlocks: Array<Record<string, unknown>> = [];
  if (mode === 'pass-through') {
    bodyBlocks = [emitPassThrough(content)];
  } else {
    const componentMapping = cfg.componentMapping as
      | Record<string, MappingEntry>
      | undefined;
    const walk = walkBuilderTree(content.data?.blocks, {
      ...(componentMapping !== undefined ? { componentMapping } : {}),
      symbolRecursionMax: cfg.symbolRecursionMax ?? BUILDER_DEFAULT_SYMBOL_RECURSION_MAX,
      warn: (m) => ctx.logger.warn(`PRD-206-R9/R12/R13: ${m}`),
    });
    bodyBlocks = walk.blocks;
    if (walk.partial) bodyPartial = true;

    // PRD-206-R23 — coverage warning when more than threshold are unmapped.
    const threshold = cfg.unmappedComponentWarningThreshold ?? BUILDER_DEFAULT_UNMAPPED_THRESHOLD;
    if (walk.total > 0 && walk.unmapped / walk.total > threshold) {
      ctx.logger.warn(
        `PRD-206-R23: builder extraction page "${content.id}" has ${String(walk.unmapped)}/${String(walk.total)} unmapped components (>${String(threshold)}); consider mode: 'pass-through' for this content set`,
      );
    }
  }

  // PRD-206-R8 — title (with partial fallback).
  const titleResolved = resolveTitle(content, cfg);
  const title = titleResolved ?? `Untitled ${content.modelName ?? 'page'} ${content.id}`;
  const titlePartial = titleResolved === null;

  // PRD-206-R8 — summary.
  const summary = resolveSummary(content, cfg, bodyBlocks);

  // PRD-206-R8 — abstract (optional).
  const abstractField = cfg.fieldMapping?.abstract ?? 'data.abstract';
  const abstractRaw = readField(content, abstractField);
  const abstractValue =
    typeof abstractRaw === 'string' && abstractRaw.length > 0 ? abstractRaw : undefined;

  // PRD-206-R8 — tags (default `data.tags`).
  const tagsField = cfg.fieldMapping?.tags ?? 'data.tags';
  const tagsRaw = readField(content, tagsField);
  const tags: string[] = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === 'string')
    : [];

  // PRD-206-R8 — id derivation (variant-aware per PRD-206-R18 / R28).
  const id = isVariant === true
    ? deriveActId(content, cfg, locale, variantKey)
    : deriveActId(content, cfg, locale);

  // PRD-206-R14 / R15 / R16 — references.
  const refLookup: ReferenceLookup = {
    getContentByModelAndId: (m, refId) => provider.getContentByModelAndId(m, refId),
  };
  const refs = resolveReferences(
    content,
    refLookup,
    {
      defaultRelation: 'see-also',
      depth: clampReferenceDepth(cfg.referenceDepth),
      fieldRelations: cfg.fieldMapping?.related ?? {},
    },
    (target) => deriveActId(target, cfg, locale),
  );

  // PRD-206-R17 — translations from sibling map.
  const translations = item.siblings && item.siblings.length > 0 ? item.siblings : undefined;

  // PRD-206-R28 — provenance source_id.
  let sourceId: string = content.id;
  if (locale !== null) sourceId = `${content.id}#${locale}`;
  else if (isVariant === true && variantKey !== undefined) {
    sourceId = `${content.id}#${variantKey}`;
  }

  // PRD-206-R8 — updated_at.
  const ts = typeof content.lastUpdated === 'number'
    ? new Date(content.lastUpdated).toISOString()
    : undefined;

  const metadata: Record<string, unknown> = {
    ...(locale !== null ? { locale } : {}),
    ...(translations !== undefined ? { translations } : {}),
    ...(refs.cycles > 0 ? { reference_cycles: refs.cycles } : {}),
    ...(cfg.version === 'draft' ? { preview: true } : {}),
    ...(isVariant === true && variantKey !== undefined
      ? {
          variant: {
            base_id: baseId ?? '',
            key: variantKey,
            source: 'experiment' as const,
          },
        }
      : {}),
    source: {
      adapter: BUILDER_ADAPTER_NAME,
      source_id: sourceId,
    },
  };

  if (titlePartial) {
    partialError = `no title field (looked for "${cfg.fieldMapping?.title ?? 'name'}") on ${content.id}`;
  }

  if (partialError !== undefined || bodyPartial) {
    metadata['extraction_status'] = 'partial';
    if (partialError !== undefined) metadata['extraction_error'] = partialError;
    else metadata['extraction_error'] = `extraction encountered unmapped Builder content on ${content.id}`;
  }

  // Tokens (PRD-100-R23).
  const tokens: Record<string, number> = { summary: tokenize(summary.summary) };
  if (abstractValue !== undefined) tokens['abstract'] = tokenize(abstractValue);
  const bodyTokenCount = bodyBlocks.reduce((acc, b) => {
    const t = (b as { type?: unknown })['type'];
    const txt = (b as { text?: unknown })['text'];
    if (
      (t === 'prose' || t === 'code' || t === 'markdown' || t === 'callout')
      && typeof txt === 'string'
    ) {
      return acc + tokenize(txt);
    }
    return acc;
  }, 0);
  if (bodyTokenCount > 0) tokens['body'] = bodyTokenCount;

  // Variant base_id linkage per PRD-206-R18 / PRD-102-R32.
  const baseRelated = isVariant === true && baseId !== undefined && baseId.length > 0
    ? [{ id: baseId, relation: 'variant_of' }]
    : [];
  const allRelated = [...refs.related, ...baseRelated];

  // PRD-206-R18 — variant title decoration.
  const variantTitle = isVariant === true && content.name !== undefined
    ? `${title} (${content.name})`
    : title;

  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: targetType,
    title: variantTitle,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary: summary.summary,
    summary_source: summary.summarySource,
    content: bodyBlocks as unknown as EmittedNode['content'],
    tokens,
    ...(abstractValue !== undefined ? { abstract: abstractValue } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(allRelated.length > 0 ? { related: allRelated } : {}),
    ...(ts !== undefined ? { updated_at: ts } : {}),
    metadata,
  } as unknown as EmittedNode;

  // PRD-103 — derive a real etag now so PRD-600 validates clean.
  const stripped = stripEtag(envelope as unknown as Record<string, unknown>);
  (envelope as unknown as { etag: string }).etag = deriveEtag(stripped);

  if (partialError !== undefined || bodyPartial) {
    return { ...envelope, _actPartial: true };
  }
  return envelope;
}

/** PRD-206-R10 — pass-through mode emits exactly one `marketing:builder-page` block. */
export function emitPassThrough(content: BuilderContent): Record<string, unknown> {
  return {
    type: 'marketing:builder-page',
    model: content.modelName ?? 'page',
    payload: content.data ?? {},
    metadata: {
      builderApiVersion: 'v3',
      builderModelKind: content.modelName ?? 'page',
    },
  };
}

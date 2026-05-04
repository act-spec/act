/**
 * PRD-205 Strapi adapter — `@act-spec/adapter-strapi`.
 *
 * Public factory `createStrapiAdapter` returns a PRD-200-R1 `Adapter`
 * whose lifecycle satisfies PRD-205-R1..R28. The adapter does NOT depend
 * on a live Strapi server at runtime: a mockable `provider` abstracts the
 * REST/GraphQL surface so tests run from recorded fixtures (per the role's
 * "no live Strapi API calls" constraint).
 *
 * Library choices:
 *  - No first-party Strapi SDK dependency. Strapi v4/v5 envelope shapes are
 *    structural per the PRD; the `provider` interface narrows them to a
 *    single `StrapiEntity` shape downstream of normalization.
 *  - `ajv` (8.x, 2020-12) for config schema validation; same major as
 *    `@act-spec/validator` and sibling adapters.
 *  - In-tree CommonMark-subset markdown walker (no `unified`/`mdast`) — the
 *    split-mode walker only needs paragraph / fence / admonition recognition
 *    per PRD-205-R9; pulling `unified` for that surface trades a small
 *    in-tree walker for ~50 transitive deps. Anti-pattern hedge:
 *    framework-fit over dependency reuse.
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

import { StrapiAdapterError } from './errors.js';
import { emitMarkdownBody } from './markdown.js';
import type { ContentBlock } from './markdown.js';
import { walkDynamicZone } from './dynamic-zone.js';
import { resolveRelations, clampPopulateDepth } from './relations.js';
import type {
  StrapiAdapterConfig,
  StrapiEntity,
  StrapiItem,
  StrapiSourceCorpus,
  StrapiV4DataItem,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants & schema loading
// ---------------------------------------------------------------------------

/** PRD-205-R1 — adapter identity. */
export const STRAPI_ADAPTER_NAME = 'act-strapi' as const;

/** PRD-205-R18 — concurrency default per Strapi typical capacity. */
export const STRAPI_DEFAULT_CONCURRENCY = 4 as const;

/** PRD-205-R10 — max permitted dynamic-zone depth bound. */
export const STRAPI_DEFAULT_DYNAMIC_ZONE_MAX = 3 as const;

/** PRD-205-R13 — default populate depth. */
export const STRAPI_DEFAULT_POPULATE_DEPTH = 1 as const;

/** PRD-205 — reserved metadata keys we refuse to overwrite. */
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
      if (pkg.name === '@act-spec/adapter-strapi') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`strapi-adapter: could not locate package root from ${start}`);
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
// Source provider — abstracts over live Strapi server.
// ---------------------------------------------------------------------------

/**
 * PRD-205 implementation note 1 — the live Strapi REST/GraphQL surface (auth
 * probe, paginated content-type fetch, single-entity lookup, delta query)
 * projected as a single interface. The default factory wires a corpus-backed
 * provider; production code can wire a real Strapi-backed one.
 */
export interface StrapiSourceProvider {
  /** PRD-205-R3 — server-version probe. */
  probeServerVersion(): Promise<{ version: 'v4' | 'v5'; reachable: boolean }>;
  /** PRD-205-R22 — auth probe; returns 'ok' | 'unauthorized'. */
  probeAuth(): Promise<'ok' | 'unauthorized'>;
  /** PRD-205-R5 — confirm a content type exists; throws unrecoverable on 404. */
  probeContentType(contentType: string): Promise<'ok' | 'not_found'>;
  /** PRD-205-R4 — fetch entities for a content type, optionally filtered by locale. */
  fetchEntities(opts: { contentType: string; locale?: string }): Promise<StrapiEntity[]>;
  /** PRD-205-R12 — single-entity lookup for relation resolution. */
  getEntityByContentTypeAndId(
    contentType: string,
    id: number | string,
  ): StrapiEntity | undefined;
  /** PRD-205-R16 — incremental delta given an `updatedAt` marker. */
  syncDelta(
    since: string,
    contentTypes: string[],
  ): Promise<{ entities: StrapiEntity[]; nextMarker: string }>;
  /** Idempotent. */
  dispose(): Promise<void> | void;
}

/**
 * Build a StrapiSourceProvider from a recorded corpus. Production-grade for
 * tests AND for any caller that has captured Strapi REST responses (the
 * canonical pattern documented in PRD-205 §"Test fixtures").
 *
 * The corpus accepts both v4 and v5 envelope shapes per content type; this
 * normalizer flattens them into the unified `StrapiEntity` shape used
 * downstream by `transform`.
 */
export function corpusProvider(corpus: StrapiSourceCorpus): StrapiSourceProvider {
  const lookup = new Map<string, StrapiEntity>();
  const indexByLocale = new Map<string, Map<string, StrapiEntity[]>>();

  // Normalize the per-content-type entities into StrapiEntity shape and
  // populate both the locale-keyed index and the cross-type lookup map.
  for (const [contentType, raw] of Object.entries(corpus.entitiesByContentType)) {
    const normalized = raw.map((r) => normalizeEntity(r, contentType));
    for (const e of normalized) {
      lookup.set(`${contentType}:${String(e.id)}`, e);
      if (typeof e.documentId === 'string') {
        lookup.set(`${contentType}:${e.documentId}`, e);
      }
    }
  }
  if (corpus.entitiesByLocale) {
    for (const [locale, perCt] of Object.entries(corpus.entitiesByLocale)) {
      const ctMap = new Map<string, StrapiEntity[]>();
      for (const [contentType, raw] of Object.entries(perCt)) {
        const normalized = raw.map((r) => {
          const e = normalizeEntity(r, contentType);
          e.__locale = locale;
          return e;
        });
        ctMap.set(contentType, normalized);
        for (const e of normalized) {
          lookup.set(`${contentType}:${String(e.id)}@${locale}`, e);
          if (typeof e.documentId === 'string') {
            lookup.set(`${contentType}:${e.documentId}@${locale}`, e);
          }
        }
      }
      indexByLocale.set(locale, ctMap);
    }
  }
  const unknownContentTypes = new Set(corpus.unknownContentTypes ?? []);

  return {
    probeServerVersion(): Promise<{ version: 'v4' | 'v5'; reachable: boolean }> {
      return Promise.resolve({
        version: corpus.serverStrapiVersion ?? 'v5',
        reachable: true,
      });
    },
    probeAuth(): Promise<'ok' | 'unauthorized'> {
      return Promise.resolve(
        corpus.authProbe === 'unauthorized' ? 'unauthorized' : 'ok',
      );
    },
    probeContentType(contentType: string): Promise<'ok' | 'not_found'> {
      return Promise.resolve(unknownContentTypes.has(contentType) ? 'not_found' : 'ok');
    },
    fetchEntities({ contentType, locale }): Promise<StrapiEntity[]> {
      // Locale-specific bucket if available, else fall back to the default.
      if (typeof locale === 'string') {
        const bucket = indexByLocale.get(locale)?.get(contentType);
        if (bucket) return Promise.resolve(bucket);
      }
      const raw = corpus.entitiesByContentType[contentType] ?? [];
      const normalized = raw.map((r) => normalizeEntity(r, contentType));
      return Promise.resolve(normalized);
    },
    getEntityByContentTypeAndId(contentType, id) {
      return lookup.get(`${contentType}:${String(id)}`);
    },
    syncDelta(_since, contentTypes): Promise<{ entities: StrapiEntity[]; nextMarker: string }> {
      const out: StrapiEntity[] = [];
      for (const ct of contentTypes) {
        const raw = corpus.entitiesByContentType[ct] ?? [];
        for (const r of raw) out.push(normalizeEntity(r, ct));
      }
      return Promise.resolve({
        entities: out,
        nextMarker: corpus.latestUpdatedAt ?? new Date(0).toISOString(),
      });
    },
    dispose(): void {
      // no-op
    },
  };
}

/**
 * Normalize a single Strapi entity object accepting EITHER v4 wrap-and-attributes
 * (`{ id, attributes: {...} }`) OR v5 flat (`{ id, documentId, ... }`) shapes.
 * Synthesizes `__contentType` so downstream code can route on type.
 */
export function normalizeEntity(
  raw: StrapiV4DataItem | Record<string, unknown>,
  contentType: string,
): StrapiEntity {
  if (raw === null || typeof raw !== 'object') {
    throw new StrapiAdapterError({
      code: 'config_invalid',
      message: 'PRD-205: entity payload is not an object',
    });
  }
  const obj = raw as Record<string, unknown>;
  // v4 wrap-and-attributes detection.
  if (
    typeof obj['id'] === 'number'
    && typeof obj['attributes'] === 'object'
    && obj['attributes'] !== null
    && !Array.isArray(obj['attributes'])
  ) {
    const attrs = obj['attributes'] as Record<string, unknown>;
    const out: StrapiEntity = {
      id: obj['id'],
      __contentType: contentType,
      ...attrs,
    };
    return out;
  }
  // v5 flat or already-normalized.
  const out: StrapiEntity = {
    id: (obj['id'] as number | string) ?? '',
    __contentType: contentType,
    ...(typeof obj['documentId'] === 'string' ? { documentId: obj['documentId'] } : {}),
  };
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k === 'documentId') continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public factory shape
// ---------------------------------------------------------------------------

export interface CreateStrapiAdapterOpts {
  /** Optional provider to back the adapter (default is corpus-backed). */
  provider?: StrapiSourceProvider;
  /** When `provider` is omitted, the factory builds a `corpusProvider`. */
  corpus?: StrapiSourceCorpus;
}

/**
 * PRD-205-R1 — factory returning a PRD-200-R1 `Adapter`.
 */
export function createStrapiAdapter(
  opts: CreateStrapiAdapterOpts = {},
): Adapter<StrapiItem> {
  if (!opts.provider && !opts.corpus) {
    throw new StrapiAdapterError({
      code: 'config_invalid',
      message:
        'PRD-205: createStrapiAdapter requires either `provider` or `corpus` (no live Strapi API wiring in v0.1)',
    });
  }
  const provider: StrapiSourceProvider =
    opts.provider ?? corpusProvider(opts.corpus as StrapiSourceCorpus);

  // Per-build state captured by the lifecycle hooks below.
  let resolvedConfig: StrapiAdapterConfig | undefined;
  let declaredLevel: 'core' | 'standard' | 'strict' = 'standard';
  let disposed = false;

  return {
    name: STRAPI_ADAPTER_NAME,

    // PRD-200-R8 — optional fast precheck; reuses config schema; no network.
    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new StrapiAdapterError({
          code: 'config_invalid',
          message: `PRD-205-R2: precheck — config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      // Defense-in-depth checks past the schema's numeric ranges (PRD-205-R10, R13).
      const depth = (config as { populateDepth?: unknown }).populateDepth;
      if (depth !== undefined) {
        if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 4) {
          throw new StrapiAdapterError({
            code: 'config_invalid',
            message: `PRD-205-R13: populateDepth must be integer 0–4; got ${describeValue(depth)}`,
          });
        }
      }
      const dzm = (config as { dynamicZoneMax?: unknown }).dynamicZoneMax;
      if (dzm !== undefined) {
        if (
          typeof dzm !== 'number'
          || !Number.isInteger(dzm)
          || dzm < 1
          || dzm > 3
        ) {
          throw new StrapiAdapterError({
            code: 'config_invalid',
            message: `PRD-205-R10: dynamicZoneMax must be integer 1–3; got ${describeValue(dzm)}`,
          });
        }
      }
      // PRD-205-R4 — reject `populate=*` if operator put it in graphqlQuery.
      const gq = (config as { graphqlQuery?: unknown }).graphqlQuery;
      if (typeof gq === 'string' && /populate\s*=\s*\*/.test(gq)) {
        throw new StrapiAdapterError({
          code: 'config_invalid',
          message: 'PRD-205-R4: populate=* is forbidden; the adapter computes a precise populate string',
        });
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      // PRD-205-R2 — schema validation.
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new StrapiAdapterError({
          code: 'config_invalid',
          message: `PRD-205-R2: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as StrapiAdapterConfig;

      // PRD-205-R13 — depth bound (defense-in-depth past the schema's max:4).
      if (cfg.populateDepth !== undefined) {
        const d = cfg.populateDepth;
        if (!Number.isInteger(d) || d < 0 || d > 4) {
          throw new StrapiAdapterError({
            code: 'populate_depth_exceeded',
            message: `PRD-205-R13: populateDepth must be integer 0–4; got ${String(d)}`,
          });
        }
      }
      // PRD-205-R10 — dynamic-zone bound (range 1–3; defense in depth).
      if (cfg.dynamicZoneMax !== undefined) {
        const r = cfg.dynamicZoneMax;
        if (!Number.isInteger(r) || r < 1 || r > 3) {
          throw new StrapiAdapterError({
            code: 'dynamic_zone_max_invalid',
            message: `PRD-205-R10: dynamicZoneMax must be integer 1–3; got ${String(r)}`,
          });
        }
      }
      // PRD-205-R4 — reject `populate=*` if operator put it in graphqlQuery.
      if (typeof cfg.graphqlQuery === 'string' && /populate\s*=\s*\*/.test(cfg.graphqlQuery)) {
        throw new StrapiAdapterError({
          code: 'config_invalid',
          message: 'PRD-205-R4: populate=* is forbidden; the adapter computes a precise populate string',
        });
      }

      // PRD-205-R24 / R25 — token resolution (env var or inline). Never log the value.
      const token = resolveApiToken(cfg);
      if (token === undefined) {
        const ref = cfg.apiToken as { from_env: string };
        throw new StrapiAdapterError({
          code: 'config_invalid',
          message: `PRD-205-R2/R24: env var '${ref.from_env}' is not set`,
        });
      }
      if (typeof cfg.apiToken === 'string') {
        ctx.logger.warn(
          'PRD-205-R24: apiToken supplied inline; prefer { from_env: "<NAME>" } for credential hygiene',
        );
      }
      if (cfg.debugLogging === true) {
        const fp = token.slice(0, 4);
        ctx.logger.debug(
          `PRD-205-R24: strapi adapter token fingerprint=${fp}… (debugLogging enabled)`,
        );
      }

      // PRD-205-R24 — http:// transport warning.
      if (cfg.baseUrl.startsWith('http://')) {
        ctx.logger.warn(
          `PRD-205-R24: baseUrl uses http:// — production deployments SHOULD use https:// (host=${new URL(cfg.baseUrl).host})`,
        );
      }

      resolvedConfig = cfg;

      // PRD-205-R22 — auth probe.
      const probe = await provider.probeAuth();
      if (probe === 'unauthorized') {
        throw new StrapiAdapterError({
          code: 'auth_failed',
          message:
            'PRD-205-R22: Strapi apiToken rejected (HTTP 401/403). Set STRAPI_API_TOKEN and re-run; do not commit tokens.',
        });
      }

      // PRD-205-R5 — every configured content type must exist (404 → unrecoverable).
      for (const ct of cfg.contentTypes) {
        const ctProbe = await provider.probeContentType(ct);
        if (ctProbe === 'not_found') {
          throw new StrapiAdapterError({
            code: 'content_type_not_found',
            message: `PRD-205-R5: configured content type "${ct}" not found on Strapi server (HTTP 404)`,
          });
        }
      }

      // PRD-205-R3 — server-version probe (warn on mismatch; do not error).
      const serverProbe = await provider.probeServerVersion();
      const configured = cfg.strapiVersion ?? 'v5';
      if (serverProbe.reachable && serverProbe.version !== configured) {
        ctx.logger.warn(
          `PRD-205-R3: Strapi server reports version "${serverProbe.version}" but adapter is configured for "${configured}"; mismatch may produce silent parsing bugs`,
        );
      }

      // PRD-205-R19 / R20 — declared level.
      const isStrict = !!cfg.componentMapping || !!cfg.locale;
      declaredLevel = isStrict ? 'strict' : 'standard';

      // PRD-200-R24 — refuse when adapter would declare a higher level than the target.
      if (rankOf(declaredLevel) > rankOf(ctx.targetLevel)) {
        throw new StrapiAdapterError({
          code: 'level_mismatch',
          message: `PRD-205-R20: adapter-declared level '${declaredLevel}' exceeds target '${ctx.targetLevel}' (configure a lower target or remove componentMapping / locale)`,
        });
      }

      // PRD-205-R18 — capability declaration.
      return {
        level: declaredLevel,
        concurrency_max: cfg.concurrency?.transform ?? STRAPI_DEFAULT_CONCURRENCY,
        delta: true,
        namespace_ids: false, // Adapter manages its own namespace prefix (PRD-205-R8 / R26).
        precedence: 'primary',
        manifestCapabilities: {
          etag: true,
          subtree: true,
          ndjson_index: false,
          search: { template_advertised: false },
        },
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<StrapiItem> {
      const cfg = expectConfig(resolvedConfig);

      // PRD-205-R15 — locale fan-out when configured.
      const locales = cfg.locale?.locales ?? [null];

      let totalCount = 0;
      for (const locale of locales) {
        for (const contentType of cfg.contentTypes) {
          if (ctx.signal.aborted) return;
          const fetchOpts: { contentType: string; locale?: string } = { contentType };
          if (typeof locale === 'string') fetchOpts.locale = locale;
          const entities = await provider.fetchEntities(fetchOpts);
          totalCount += entities.length;
          // For locale fan-out, build sibling lists that link locale variants.
          for (const entity of entities) {
            const item: StrapiItem = {
              entity,
              locale: typeof locale === 'string' ? locale : null,
            };
            if (typeof locale === 'string' && cfg.locale) {
              const siblings: Array<{ locale: string; id: string }> = [];
              for (const otherLoc of cfg.locale.locales) {
                if (otherLoc === locale) continue;
                const otherFetch: { contentType: string; locale?: string } = {
                  contentType,
                  locale: otherLoc,
                };
                const otherEntities = await provider.fetchEntities(otherFetch);
                const sibling = findLocaleSibling(entity, otherEntities);
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
          }
        }
      }

      // PRD-205-R6 — empty + no allowEmpty → warn but do NOT throw.
      if (totalCount === 0 && cfg.allowEmpty !== true) {
        ctx.logger.warn(
          `PRD-205-R6: configured contentTypes [${cfg.contentTypes.join(', ')}] returned 0 entities; pass allowEmpty=true to suppress`,
        );
      }
    },

    transform(
      item: StrapiItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(transformItem(item, cfg, declaredLevel, provider, ctx));
    },

    async *delta(since: string, ctx: AdapterContext): AsyncIterable<StrapiItem> {
      const cfg = expectConfig(resolvedConfig);
      const result = await provider.syncDelta(since, cfg.contentTypes);
      ctx.logger.info(
        `PRD-205-R16: sync delta yielded ${String(result.entities.length)} entities; next updatedAt=${result.nextMarker}`,
      );
      for (const entity of result.entities) {
        if (ctx.signal.aborted) return;
        yield { entity, locale: null };
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

function expectConfig(cfg: StrapiAdapterConfig | undefined): StrapiAdapterConfig {
  if (!cfg) {
    throw new StrapiAdapterError({
      code: 'config_invalid',
      message: 'PRD-205: adapter used before init',
    });
  }
  return cfg;
}

function resolveApiToken(cfg: StrapiAdapterConfig): string | undefined {
  if (typeof cfg.apiToken === 'string') return cfg.apiToken;
  return process.env[cfg.apiToken.from_env];
}

/**
 * PRD-205-R15 — find the corresponding locale-sibling entity. Strapi v4's
 * `localizations` and v5's flat `localizations` arrays both expose either
 * `documentId` (v5) or numeric `id` (v4) of sibling entries — we match on
 * either available identifier first and fall back to slug equivalence.
 */
function findLocaleSibling(
  entity: StrapiEntity,
  others: StrapiEntity[],
): StrapiEntity | undefined {
  const localizations = Array.isArray(entity.localizations) ? entity.localizations : [];
  for (const sib of localizations) {
    if (sib === null || typeof sib !== 'object') continue;
    const sibDocId = typeof sib.documentId === 'string' ? sib.documentId : undefined;
    const sibId = typeof sib.id === 'number' ? sib.id : undefined;
    for (const o of others) {
      if (sibDocId !== undefined && o.documentId === sibDocId) return o;
      if (sibId !== undefined && o.id === sibId) return o;
    }
  }
  // Slug-based fallback: find a sibling with the same slug attribute.
  const slug = typeof entity['slug'] === 'string' ? entity['slug'] : undefined;
  if (slug !== undefined) {
    for (const o of others) {
      if (o['slug'] === slug) return o;
    }
  }
  return undefined;
}

/**
 * PRD-205-R8 / R26 — derive ACT id from configured `idField`, entity `slug`,
 * `documentId` (v5), or numeric `id` (v4 with `v4:` prefix).
 */
function deriveActId(
  entity: StrapiEntity,
  cfg: StrapiAdapterConfig,
  locale: string | null,
): string {
  const namespace = cfg.namespace ?? 'act-strapi';
  const localePrefix = locale !== null ? '' : ''; // locale lives in metadata, not id, by default
  const ct = entity.__contentType;

  // Explicit override first.
  if (cfg.idField !== undefined) {
    const v = readField(entity, cfg.idField);
    if (typeof v === 'string' && v.length > 0) {
      const base = `${namespace}/${ct}/${normalize(v)}`;
      return locale !== null ? `${base}@${locale.toLowerCase()}` : base;
    }
  }
  // Default: `slug` attribute.
  const slug = readField(entity, 'slug');
  if (typeof slug === 'string' && slug.length > 0) {
    const base = `${namespace}/${ct}/${normalize(slug)}${localePrefix}`;
    return locale !== null ? `${base}@${locale.toLowerCase()}` : base;
  }
  // PRD-205-R26 — fallback to documentId (v5) or `v4:<id>` (v4).
  if (typeof entity.documentId === 'string' && entity.documentId.length > 0) {
    const base = `${namespace}/${ct}/${normalize(entity.documentId)}`;
    return locale !== null ? `${base}@${locale.toLowerCase()}` : base;
  }
  const base = `${namespace}/${ct}/v4-${normalize(String(entity.id))}`;
  return locale !== null ? `${base}@${locale.toLowerCase()}` : base;
}

/** Tiny dot-path reader for `idField` and field-mapping lookups. */
function readField(entity: StrapiEntity, fieldPath: string): unknown {
  const parts = fieldPath.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  let cur: unknown = entity;
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

/** PRD-205-R7 — content-type plural → ACT type. */
function resolveActType(entity: StrapiEntity, cfg: StrapiAdapterConfig): string {
  const map = cfg.typeMapping ?? {};
  const ct = entity.__contentType;
  // Common Strapi convention: plural `articles` → singular `article`.
  const singular = ct.endsWith('s') ? ct.slice(0, -1) : ct;
  if (Object.prototype.hasOwnProperty.call(map, singular)) {
    const v = map[singular];
    if (typeof v === 'string') return v;
  }
  if (Object.prototype.hasOwnProperty.call(map, ct)) {
    const v = map[ct];
    if (typeof v === 'string') return v;
  }
  return singular;
}

/** PRD-205-R8 — extract title; configurable override. */
function resolveTitle(entity: StrapiEntity, cfg: StrapiAdapterConfig): string | null {
  const fieldName = cfg.fieldMapping?.title ?? 'title';
  const v = readField(entity, fieldName);
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

/**
 * PRD-205-R8 — summary; falls back to first-paragraph extraction (capped at
 * ~50 tokens) when no `summary` field is configured / present. Returns
 * `summarySource` for envelope stamping.
 */
function resolveSummary(
  entity: StrapiEntity,
  cfg: StrapiAdapterConfig,
  bodyBlocks: ContentBlock[],
): { summary: string; summarySource: 'author' | 'extracted' } {
  const strategy = cfg.summary?.strategy;
  const fieldName = cfg.fieldMapping?.summary ?? 'summary';

  if (strategy === 'field' || strategy === undefined) {
    const v = readField(entity, fieldName);
    if (typeof v === 'string' && v.length > 0) {
      return { summary: v, summarySource: 'author' };
    }
  }
  // Extraction fallback: first prose/markdown block, capped at 50 tokens.
  const firstBlock = bodyBlocks.find(
    (b) => b.type === 'prose' || b.type === 'markdown',
  );
  const text = firstBlock && typeof (firstBlock as { text?: unknown }).text === 'string'
    ? (firstBlock as { text: string }).text
    : '';
  if (text.length > 0) {
    const tokens = text.split(/\s+/).filter((t) => t.length > 0).slice(0, 50);
    return { summary: tokens.join(' '), summarySource: 'extracted' };
  }
  return {
    summary: `Summary for ${entity.__contentType} ${String(entity.id)}`,
    summarySource: 'extracted',
  };
}

function tokenize(s: string): number {
  return Math.max(1, s.split(/\s+/).filter((x) => x.length > 0).length);
}

function readBodyField(entity: StrapiEntity, cfg: StrapiAdapterConfig): unknown {
  const fieldName = cfg.fieldMapping?.body ?? 'body';
  return readField(entity, fieldName);
}

/**
 * PRD-205-R7..R26 — produce a fully-formed PRD-100 envelope (or partial)
 * for a single StrapiItem. Pure modulo `provider` calls.
 */
function transformItem(
  item: StrapiItem,
  cfg: StrapiAdapterConfig,
  level: 'core' | 'standard' | 'strict',
  provider: StrapiSourceProvider,
  ctx: AdapterContext,
): EmittedNode | PartialEmittedNode | null {
  const { entity, locale } = item;

  // PRD-205-R7 — type mapping.
  const targetType = resolveActType(entity, cfg);

  // PRD-205-R9 — markdown body emission. Default: single `markdown` block;
  // split: prose/code/callout walk.
  const bodyRaw = readBodyField(entity, cfg);
  let bodyBlocks: ContentBlock[] = [];
  let bodyPartial = false;
  if (typeof bodyRaw === 'string') {
    const w = emitMarkdownBody(bodyRaw, {
      parseMarkdown: cfg.parseMarkdown === true,
      warn: (m) => ctx.logger.warn(`PRD-205-R9: ${m}`),
    });
    bodyBlocks = w.blocks;
    bodyPartial = w.partial;
  } else if (bodyRaw === null || bodyRaw === undefined) {
    // No body: leave content empty (the envelope can still be valid).
    bodyBlocks = [];
  } else {
    // Body exists but isn't a string (e.g., dynamic-zone-only body). Skip
    // markdown emission; dynamic-zone walk below covers it.
    bodyBlocks = [];
  }

  // PRD-205-R10 / R11 — dynamic-zone walk for `marketing:*` (Plus). The
  // adapter only walks dynamic zones when componentMapping is configured.
  if (level === 'strict' && cfg.componentMapping) {
    // Common convention: dynamic-zone fields live under `body` or
    // `dynamicZone`. We probe both common locations + every configured
    // componentMapping key's containing field name.
    const candidateFields = new Set<string>(['body', 'dynamicZone', 'dynamic_zone']);
    if (cfg.fieldMapping?.body) candidateFields.add(cfg.fieldMapping.body);
    for (const fname of candidateFields) {
      const value = (entity as unknown as Record<string, unknown>)[fname];
      if (Array.isArray(value)) {
        const w = walkDynamicZone(value, {
          targetLevel: level,
          ...(cfg.componentMapping !== undefined ? { componentMapping: cfg.componentMapping } : {}),
          dynamicZoneMax: cfg.dynamicZoneMax ?? STRAPI_DEFAULT_DYNAMIC_ZONE_MAX,
          warn: (m) => ctx.logger.warn(`PRD-205-R10/R11: ${m}`),
        });
        for (const b of w.blocks) bodyBlocks.push(b);
        if (w.partial) bodyPartial = true;
      }
    }
  }

  // PRD-205-R8 — title (with partial fallback).
  const titleResolved = resolveTitle(entity, cfg);
  const title = titleResolved ?? `Untitled ${entity.__contentType} ${String(entity.id)}`;
  const titlePartial = titleResolved === null;

  // PRD-205-R8 — summary.
  const summary = resolveSummary(entity, cfg, bodyBlocks);

  // PRD-205-R8 — abstract (optional).
  const abstractField = cfg.fieldMapping?.abstract ?? 'abstract';
  const abstractRaw = readField(entity, abstractField);
  const abstractValue =
    typeof abstractRaw === 'string' && abstractRaw.length > 0 ? abstractRaw : undefined;

  // PRD-205-R8 — tags. Strapi tags relations are typically `tags[].name`.
  const tagsField = cfg.fieldMapping?.tags ?? 'tags';
  const tagsRaw = readField(entity, tagsField);
  let tags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    tags = tagsRaw
      .map((t) => {
        if (typeof t === 'string') return t;
        if (t !== null && typeof t === 'object' && typeof (t as Record<string, unknown>)['name'] === 'string') {
          return (t as Record<string, unknown>)['name'] as string;
        }
        return undefined;
      })
      .filter((x): x is string => typeof x === 'string');
  }

  // PRD-205-R8 — id derivation.
  const id = deriveActId(entity, cfg, locale);

  // PRD-205-R12 / R13 / R14 — relations + cycles.
  const refs = resolveRelations(
    entity,
    cfg,
    {
      getEntityByContentTypeAndId: (ct, eid) =>
        provider.getEntityByContentTypeAndId(ct, eid),
    },
    (target) => deriveActId(target, cfg, locale),
  );

  // PRD-205-R15 — translations from sibling map.
  const translations = item.siblings && item.siblings.length > 0 ? item.siblings : undefined;

  // PRD-205-R26 — provenance source_id (v5 documentId; v4 numeric id with `v4:` prefix).
  const sourceId =
    typeof entity.documentId === 'string' && entity.documentId.length > 0
      ? entity.documentId
      : `v4:${String(entity.id)}`;

  // PRD-205-R8 — updated_at preference.
  const publishedAt = readField(entity, 'publishedAt');
  const updatedAt = readField(entity, 'updatedAt');
  const ts =
    typeof publishedAt === 'string'
      ? publishedAt
      : typeof updatedAt === 'string'
      ? updatedAt
      : undefined;

  // Compose envelope metadata.
  const metadata: Record<string, unknown> = {
    ...(locale !== null ? { locale } : {}),
    ...(translations !== undefined ? { translations } : {}),
    ...(refs.cycles > 0 ? { reference_cycles: refs.cycles } : {}),
    source: {
      adapter: STRAPI_ADAPTER_NAME,
      source_id: sourceId,
    },
  };

  const partialError: string | undefined = titlePartial
    ? `no title field (looked for "${cfg.fieldMapping?.title ?? 'title'}") on ${String(entity.id)}`
    : bodyPartial
    ? `markdown / dynamic-zone walk encountered unmapped content on ${String(entity.id)}`
    : undefined;

  if (partialError !== undefined) {
    metadata['extraction_status'] = 'partial';
    metadata['extraction_error'] = partialError;
  }

  // Tokens (PRD-100-R23).
  const tokens: Record<string, number> = { summary: tokenize(summary.summary) };
  if (abstractValue !== undefined) tokens['abstract'] = tokenize(abstractValue);
  const bodyTokenCount = bodyBlocks.reduce((acc, b) => {
    if (
      (b.type === 'prose' || b.type === 'code' || b.type === 'callout' || b.type === 'markdown')
      && typeof (b as { text?: unknown }).text === 'string'
    ) {
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
    ...(ts !== undefined ? { updated_at: ts } : {}),
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

// Re-export utility from relations module for index barrel.
export { clampPopulateDepth };

/**
 * PRD-202 Contentful adapter — `@act-spec/adapter-contentful`.
 *
 * Public factory `createContentfulAdapter` returns a PRD-200-R1 `Adapter`
 * whose lifecycle satisfies PRD-202-R1..R26. The adapter does NOT depend
 * on the live `contentful` SDK at runtime: a mockable `corpus` provider
 * keeps the implementation testable from recorded fixtures (PRD-202 R5,
 * R10, R12, R14 fixtures all flow through the same code paths).
 *
 * Library choices:
 *  - `@contentful/rich-text-types` for Document / BLOCKS / INLINES enums.
 *  - `ajv` (8.x, 2020-12) for config schema validation; same major as
 *    `@act-spec/validator` and `@act-spec/adapter-programmatic`.
 *  - In-tree markdown serializer (no `rich-text-html-renderer` dep) — PRD-102
 *    blocks are markdown-shaped, not HTML, so the renderer mismatch makes
 *    the dependency a poor fit.
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

import { ContentfulAdapterError } from './errors.js';
import { richTextToBlocks } from './richtext.js';
import type { ContentBlock, RichTextConvertContext } from './richtext.js';
import type {
  ContentTypeMapping,
  ContentfulAdapterConfig,
  ContentfulAsset,
  ContentfulEntry,
  ContentfulItem,
  ContentfulSourceCorpus,
  RichTextDocument,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants & schema loading
// ---------------------------------------------------------------------------

/** PRD-202-R1 — adapter identity. */
export const CONTENTFUL_ADAPTER_NAME = 'act-contentful' as const;

/** PRD-202-R17 — concurrency default. */
export const CONTENTFUL_DEFAULT_CONCURRENCY = 4 as const;

/**
 * PRD-202-R8 — reserved metadata keys (mirrors PRD-201-R6 + PRD-104 fields).
 * Configuration whose `mappings.<ctId>.metadata` targets one of these keys
 * is unrecoverable per PRD-202-R19.
 */
export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'source',
  'extraction_status',
  'extraction_error',
  'extracted_via',
  'locale',
  'translations',
  'translation_status',
  'fallback_from',
  'variant',
  'contributors',
]);

const TITLE_FIELDS = ['title', 'name', 'headline'] as const;
const SUMMARY_FIELDS = ['summary', 'excerpt', 'description', 'subhead'] as const;
const ABSTRACT_FIELDS = ['abstract', 'intro', 'lede'] as const;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locate the adapter package root so we can read `schema/config.schema.json`. */
function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === '@act-spec/adapter-contentful') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`contentful-adapter: could not locate package root from ${start}`);
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
// Source provider — abstracts over live CDA so tests use recorded fixtures.
// ---------------------------------------------------------------------------

/**
 * PRD-202 implementation note 1 — the live Contentful client surface
 * (init probe, contentTypes lookup, locale lookup, paginated entry fetch,
 * sync delta) projected as a single interface. The default factory wires
 * a corpus-backed provider; production code can wire a real CDA-backed one.
 */
export interface ContentfulSourceProvider {
  /** PRD-202-R3 — auth probe; returns 'ok' | 'unauthorized' | 'space_not_found'. */
  probeAuth(): Promise<'ok' | 'unauthorized' | 'space_not_found'>;
  listSpaceLocales(): Promise<Array<{ code: string; default?: boolean }>>;
  listContentTypeIds(): Promise<string[]>;
  /** PRD-202-R5 — yield entries deterministically by `sys.id`, per content type. */
  fetchEntries(opts: { contentTypeId: string; locale: string | null }): Promise<ContentfulEntry[]>;
  getAsset(id: string): ContentfulAsset | undefined;
  getLinkedEntry(id: string): ContentfulEntry | undefined;
  /** PRD-202-R14 — locales an entry has authored variants for. Defaults to all. */
  authoredLocalesForEntry(entryId: string): string[] | undefined;
  /** PRD-202-R16 — sync-token-based delta; returns 'expired' to trigger rebase. */
  syncDelta(since: string): Promise<{ entries: ContentfulEntry[]; nextSyncToken: string } | 'expired'>;
  /** PRD-202-R7 / R6 — release any held resources. Idempotent. */
  dispose(): Promise<void> | void;
}

/**
 * Build a ContentfulSourceProvider from a recorded corpus. This is the
 * production-grade path for tests AND for any caller that has captured
 * Contentful API responses (the canonical pattern documented in PRD-202
 * §"Test fixtures").
 */
export function corpusProvider(corpus: ContentfulSourceCorpus): ContentfulSourceProvider {
  const entriesById = new Map<string, ContentfulEntry>();
  for (const e of corpus.entries) entriesById.set(e.sys.id, e);
  const linkedEntries = corpus.linkedEntries ?? {};
  for (const [id, e] of Object.entries(linkedEntries)) entriesById.set(id, e);
  const assets = corpus.assets ?? {};

  return {
    probeAuth: () => Promise.resolve('ok'),
    listSpaceLocales: () => Promise.resolve(corpus.spaceLocales),
    listContentTypeIds: () => Promise.resolve(corpus.contentTypes.map((c) => c.sys.id)),
    fetchEntries({ contentTypeId, locale }) {
      const out: ContentfulEntry[] = [];
      for (const e of corpus.entries) {
        if (e.sys.contentType.sys.id !== contentTypeId) continue;
        const override =
          locale !== null ? corpus.perLocale?.[e.sys.id]?.[locale] : undefined;
        if (override !== undefined) {
          // Per-locale override — produce a synthetic entry with merged fields.
          out.push({ ...e, fields: { ...e.fields, ...override } });
          continue;
        }
        out.push(e);
      }
      // PRD-202-R5: deterministic order by sys.id.
      out.sort((a, b) => (a.sys.id < b.sys.id ? -1 : a.sys.id > b.sys.id ? 1 : 0));
      return Promise.resolve(out);
    },
    getAsset(id: string) {
      return assets[id];
    },
    getLinkedEntry(id: string) {
      return entriesById.get(id);
    },
    authoredLocalesForEntry(entryId: string) {
      return corpus.authoredLocales?.[entryId];
    },
    syncDelta(_since: string) {
      // Default corpus provider does not ship a sync log — tests build a
      // bespoke provider that overrides this when exercising R16.
      return Promise.resolve({ entries: corpus.entries, nextSyncToken: 'corpus-token-v1' });
    },
    dispose() {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory shape
// ---------------------------------------------------------------------------

export interface CreateContentfulAdapterOpts {
  /** PRD-202 implementation note — provider to back the adapter (default
   *  is corpus-backed; provide a custom provider for live CDA). */
  provider?: ContentfulSourceProvider;
  /** When `provider` is omitted, the factory builds a `corpusProvider` from
   *  this corpus. Either `provider` OR `corpus` MUST be supplied. */
  corpus?: ContentfulSourceCorpus;
}

/**
 * PRD-202-R1 — factory returning a PRD-200-R1 `Adapter`.
 */
export function createContentfulAdapter(
  opts: CreateContentfulAdapterOpts = {},
): Adapter<ContentfulItem> {
  if (!opts.provider && !opts.corpus) {
    throw new ContentfulAdapterError({
      code: 'config_invalid',
      message:
        'PRD-202: createContentfulAdapter requires either `provider` or `corpus` (no live CDA wiring in v0.1)',
    });
  }
  const provider: ContentfulSourceProvider =
    opts.provider ?? corpusProvider(opts.corpus as ContentfulSourceCorpus);

  // Per-build state captured by the lifecycle hooks below.
  let resolvedConfig: ContentfulAdapterConfig | undefined;
  let resolvedLocales: string[] = []; // empty = single-locale; non-empty = N-locale
  let defaultLocale: string | null = null;
  let declaredLevel: 'core' | 'standard' | 'strict' = 'standard';
  let disposed = false;

  return {
    name: CONTENTFUL_ADAPTER_NAME,

    // PRD-202-R4 — optional fast precheck; reuses config schema; no network.
    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new ContentfulAdapterError({
          code: 'config_invalid',
          message: `PRD-202-R4: precheck — config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      // PRD-202-R3 — schema validation.
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new ContentfulAdapterError({
          code: 'config_invalid',
          message: `PRD-202-R3/R19: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as ContentfulAdapterConfig;
      resolvedConfig = cfg;

      // PRD-202-R26 — token resolution + redaction warnings.
      const token = resolveAccessToken(cfg, ctx);
      if (token === undefined) {
        throw new ContentfulAdapterError({
          code: 'config_invalid',
          message: `PRD-202-R3/R19: env var '${(cfg.accessToken as { from_env: string }).from_env}' is not set`,
        });
      }
      if (typeof cfg.accessToken === 'string') {
        ctx.logger.warn(
          'PRD-202-R26: accessToken supplied inline; prefer { from_env: "<NAME>" } for credential hygiene',
        );
      }

      // PRD-202-R2 — preview-mode warning.
      if (cfg.host === 'preview.contentful.com') {
        ctx.logger.warn(
          'PRD-202-R2: host=preview.contentful.com exposes draft content; not the canonical flow',
        );
      }

      // PRD-202-R8 — reject reserved-metadata-key targets.
      for (const [ctId, m] of Object.entries(cfg.mappings ?? {})) {
        for (const key of Object.keys(m.metadata ?? {})) {
          if (RESERVED_METADATA_KEYS.has(key)) {
            throw new ContentfulAdapterError({
              code: 'reserved_metadata_key',
              message: `PRD-202-R8/R19: mappings.${ctId}.metadata.${key} targets reserved framework key`,
            });
          }
        }
      }

      // PRD-202-R3 — auth probe.
      const probe = await provider.probeAuth();
      if (probe === 'unauthorized') {
        throw new ContentfulAdapterError({
          code: 'auth_failed',
          message:
            'PRD-202-R3/R19: CDA token rejected. Set CONTENTFUL_DELIVERY_TOKEN and re-run; do not commit tokens.',
        });
      }
      if (probe === 'space_not_found') {
        throw new ContentfulAdapterError({
          code: 'space_not_found',
          message: `PRD-202-R19: space '${cfg.spaceId}' not found`,
        });
      }

      // PRD-202-R19 — content-type presence.
      const knownTypes = new Set(await provider.listContentTypeIds());
      for (const ctId of cfg.contentTypes) {
        if (!knownTypes.has(ctId)) {
          throw new ContentfulAdapterError({
            code: 'content_type_not_found',
            message: `PRD-202-R19: contentType '${ctId}' not found in space`,
          });
        }
      }

      // PRD-202-R12 / R13 / R19 — locale resolution.
      const spaceLocales = await provider.listSpaceLocales();
      const spaceLocaleCodes = spaceLocales.map((l) => l.code);
      const requestedLocales = cfg.locale?.available ?? spaceLocaleCodes;
      for (const loc of requestedLocales) {
        if (!spaceLocaleCodes.includes(loc)) {
          throw new ContentfulAdapterError({
            code: 'locale_not_in_space',
            message: `PRD-202-R19: locale '${loc}' not advertised by space (advertised: ${spaceLocaleCodes.join(', ')})`,
          });
        }
      }
      const isMultiLocale = requestedLocales.length > 1;
      defaultLocale =
        cfg.locale?.default ??
        spaceLocales.find((l) => l.default === true)?.code ??
        spaceLocaleCodes[0] ??
        null;
      resolvedLocales = isMultiLocale ? requestedLocales : [];

      // PRD-202-R21 — declared level.
      const hasMarketingBlocks = Object.values(cfg.mappings ?? {}).some((m) =>
        (m.blocks ?? []).some((b) => b.type.startsWith('marketing:')),
      );
      declaredLevel = isMultiLocale || hasMarketingBlocks ? 'strict' : 'standard';

      // PRD-202-R21 — refuse when adapter would declare a higher level than the target
      // (e.g., target=standard but multi-locale config implies plus emission).
      if (rankOf(declaredLevel) > rankOf(ctx.targetLevel)) {
        throw new ContentfulAdapterError({
          code: 'level_mismatch',
          message: `PRD-202-R21: adapter-declared level '${declaredLevel}' exceeds target '${ctx.targetLevel}' (configure a lower target or remove multi-locale / marketing mappings)`,
        });
      }

      // PRD-202-R22 — capabilities bubble-up.
      const isPattern2 = cfg.locale?.pattern === 2 && isMultiLocale;
      return {
        level: declaredLevel,
        concurrency_max: cfg.concurrency?.transform ?? CONTENTFUL_DEFAULT_CONCURRENCY,
        delta: true,
        namespace_ids: false, // PRD-202-R15 — adapter manages its own namespace prefix.
        manifestCapabilities: {
          etag: true,
          subtree: true,
          ndjson_index: declaredLevel === 'strict',
          search: { template_advertised: false },
          ...(isPattern2 ? { change_feed: false } : {}),
        },
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<ContentfulItem> {
      const cfg = expectConfig(resolvedConfig);
      // PRD-202-R5 — paginate per content type, then locale fan-out (R12).
      const locales = resolvedLocales.length > 0 ? resolvedLocales : [null];
      for (const ctId of cfg.contentTypes) {
        for (const loc of locales) {
          if (ctx.signal.aborted) return;
          const entries = await provider.fetchEntries({ contentTypeId: ctId, locale: loc });
          for (const entry of entries) {
            if (ctx.signal.aborted) return;
            const authored = provider.authoredLocalesForEntry(entry.sys.id);
            yield {
              entry,
              contentTypeId: ctId,
              locale: loc,
              ...(authored ? { authoredLocales: authored } : {}),
            };
          }
        }
      }
    },

    transform(
      item: ContentfulItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(transformItem(item, cfg, declaredLevel, provider, ctx, resolvedLocales, defaultLocale));
    },

    async *delta(since: string, ctx: AdapterContext): AsyncIterable<ContentfulItem> {
      const cfg = expectConfig(resolvedConfig);
      const result = await provider.syncDelta(since);
      if (result === 'expired') {
        ctx.logger.warn('PRD-202-R16: sync token expired; rebasing to full enumerate');
        // Fall back to full enumerate.
        for await (const item of this.enumerate(ctx)) yield item;
        return;
      }
      const locale = cfg.locale?.default ?? defaultLocale;
      for (const entry of result.entries) {
        if (ctx.signal.aborted) return;
        const ctId = entry.sys.contentType.sys.id;
        if (!cfg.contentTypes.includes(ctId)) continue;
        yield { entry, contentTypeId: ctId, locale };
      }
      ctx.logger.info(
        `PRD-202-R16: sync delta yielded ${String(result.entries.length)} entries; next token=${result.nextSyncToken}`,
      );
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

function expectConfig(cfg: ContentfulAdapterConfig | undefined): ContentfulAdapterConfig {
  if (!cfg) {
    throw new ContentfulAdapterError({
      code: 'config_invalid',
      message: 'PRD-202: adapter used before init',
    });
  }
  return cfg;
}

function resolveAccessToken(
  cfg: ContentfulAdapterConfig,
  _ctx: AdapterContext,
): string | undefined {
  if (typeof cfg.accessToken === 'string') return cfg.accessToken;
  return process.env[cfg.accessToken.from_env];
}

/** PRD-202-R7 — first present field name from a candidate list. */
function firstPresent(
  fields: Record<string, unknown>,
  candidates: ReadonlyArray<string>,
): string | undefined {
  for (const c of candidates) {
    if (typeof fields[c] === 'string' && (fields[c]).length > 0) return c;
  }
  return undefined;
}

/**
 * PRD-202-R7 / R8 — resolve title / summary / abstract per heuristics or
 * the user-supplied mapping. Returns `partialError` when title cannot be
 * resolved (PRD-202-R18 fallback path).
 */
interface CoreFieldsResult {
  title: string;
  summary: string;
  summarySource: 'author' | 'extracted';
  abstract?: string;
  partialError?: string;
}

function resolveCoreFields(
  fields: Record<string, unknown>,
  mapping: ContentTypeMapping | undefined,
  contentTypeId: string,
  entryId: string,
): CoreFieldsResult {
  // Title.
  let titleField: string | undefined;
  if (mapping?.title) {
    titleField = mapping.title;
  } else {
    titleField = firstPresent(fields, TITLE_FIELDS);
  }
  const titleValue =
    titleField !== undefined && typeof fields[titleField] === 'string'
      ? (fields[titleField] as string)
      : null;

  // Summary.
  let summary: string | undefined;
  let summarySource: 'author' | 'extracted' = 'author';
  if (mapping?.summary !== undefined) {
    const from = typeof mapping.summary === 'string' ? mapping.summary : mapping.summary.from;
    const v = fields[from];
    if (typeof v === 'string' && v.length > 0) {
      summary = v;
      summarySource =
        typeof mapping.summary === 'object' && mapping.summary.source !== undefined
          ? mapping.summary.source
          : 'author';
    }
  }
  if (summary === undefined) {
    const sumField = firstPresent(fields, SUMMARY_FIELDS);
    if (sumField !== undefined) {
      summary = fields[sumField] as string;
      summarySource = 'author';
    }
  }
  // Last-resort: extract a placeholder so the envelope satisfies PRD-100-R21.
  if (summary === undefined) {
    summary = `Summary for ${contentTypeId} ${entryId}`;
    summarySource = 'extracted';
  }

  // Abstract.
  let abstractValue: string | undefined;
  if (mapping?.abstract !== undefined) {
    const v = fields[mapping.abstract];
    if (typeof v === 'string' && v.length > 0) abstractValue = v;
  }
  if (abstractValue === undefined) {
    const abField = firstPresent(fields, ABSTRACT_FIELDS);
    if (abField !== undefined) abstractValue = fields[abField] as string;
  }

  if (titleValue === null) {
    return {
      title: `Untitled ${contentTypeId} ${entryId}`,
      summary,
      summarySource,
      ...(abstractValue !== undefined ? { abstract: abstractValue } : {}),
      partialError: 'no title field present',
    };
  }
  return {
    title: titleValue,
    summary,
    summarySource,
    ...(abstractValue !== undefined ? { abstract: abstractValue } : {}),
  };
}

/** PRD-202-R9 — content-type → ACT type. */
function resolveActType(
  contentTypeId: string,
  cfg: ContentfulAdapterConfig,
): string {
  const mapping = cfg.mappings?.[contentTypeId];
  if (mapping?.type !== undefined && mapping.type.length > 0) return mapping.type;
  const def = cfg.defaults?.[contentTypeId];
  if (typeof def === 'string' && def.length > 0) return def;
  return 'article';
}

/**
 * PRD-202-R15 — derive ACT id with optional override field.
 */
function deriveId(
  entry: ContentfulEntry,
  cfg: ContentfulAdapterConfig,
  locale: string | null,
): { id: string; warning?: string } {
  const strategy = cfg.idStrategy ?? {};
  const namespace = strategy.namespace ?? 'cms';
  const overrideField = strategy.overrideField ?? 'actId';
  const override = entry.fields[overrideField];
  const localePrefix = locale !== null ? `${locale.toLowerCase()}/` : '';
  if (typeof override === 'string' && override.length > 0) {
    return { id: `${namespace}/${localePrefix}${normalize(override)}` };
  }
  const from = strategy.from ?? 'id';
  if (from === 'slug') {
    const slugField = strategy.field ?? 'slug';
    const slug = entry.fields[slugField];
    if (typeof slug === 'string' && slug.length > 0) {
      return { id: `${namespace}/${localePrefix}${normalize(slug)}` };
    }
    return {
      id: `${namespace}/${localePrefix}${entry.sys.id.toLowerCase()}`,
      warning: `idStrategy.from='slug' but field '${slugField}' missing on entry ${entry.sys.id}; falling back to sys.id`,
    };
  }
  if (from === 'composite') {
    const ctId = entry.sys.contentType.sys.id.toLowerCase();
    return { id: `${namespace}/${localePrefix}${ctId}/${entry.sys.id.toLowerCase()}` };
  }
  return { id: `${namespace}/${localePrefix}${entry.sys.id.toLowerCase()}` };
}

/** PRD-100-R10 grammar — lower-case, allowed chars only, hyphenize the rest. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._\-/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** PRD-202 — detect "looks like markdown" long-text fields. */
function looksLikeMarkdown(value: string): boolean {
  return /(^|\n)#\s|\n```|\n[*\-+]\s/.test(value);
}

/**
 * PRD-202-R7 — body extraction. Each `body` field is converted; Rich Text
 * Documents go through `richTextToBlocks`; long-text strings become `prose`
 * (with `format: "markdown"` if heuristic matches) or `markdown`.
 */
function extractBodyBlocks(
  fields: Record<string, unknown>,
  mapping: ContentTypeMapping | undefined,
  rtCtx: RichTextConvertContext,
): ContentBlock[] {
  const candidateFields: string[] = [];
  if (mapping?.body !== undefined) {
    if (Array.isArray(mapping.body)) candidateFields.push(...mapping.body);
    else candidateFields.push(mapping.body);
  } else if ('body' in fields) {
    candidateFields.push('body');
  }
  const out: ContentBlock[] = [];
  for (const f of candidateFields) {
    const v = fields[f];
    if (v === undefined) continue;
    if (isRichTextDocument(v)) {
      for (const b of richTextToBlocks(v, rtCtx)) out.push(b);
      continue;
    }
    if (typeof v === 'string') {
      if (looksLikeMarkdown(v)) {
        out.push({ type: 'prose', format: 'markdown', text: v });
      } else {
        out.push({ type: 'prose', format: 'plain', text: v });
      }
    }
  }
  return out;
}

function isRichTextDocument(v: unknown): v is RichTextDocument {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { nodeType?: unknown; content?: unknown };
  return o.nodeType === 'document' && Array.isArray(o.content);
}

/** PRD-202-R7 — tags from Contentful's metadata.tags. */
function extractTags(entry: ContentfulEntry, mapping: ContentTypeMapping | undefined): string[] {
  if (mapping?.tags) {
    const v = entry.fields[mapping.tags];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  }
  const meta = entry.metadata?.tags ?? entry.sys.metadata?.tags;
  if (Array.isArray(meta)) {
    return meta.map((t) => t.sys.id);
  }
  return [];
}

/** PRD-202-R7 — `related` from reference fields. */
function extractRelated(
  entry: ContentfulEntry,
  mapping: ContentTypeMapping | undefined,
  cfg: ContentfulAdapterConfig,
): Array<{ id: string; relation: string }> {
  const out: Array<{ id: string; relation: string }> = [];
  const rules = mapping?.related ?? [];
  for (const rule of rules) {
    const v = entry.fields[rule.from];
    if (v === undefined) continue;
    const relation = rule.relation ?? 'see-also';
    const refs = collectReferenceLinks(v);
    for (const ref of refs) {
      const id = referenceTargetId(ref, cfg, entry);
      if (id) out.push({ id, relation: relation });
    }
  }
  return out;
}

function collectReferenceLinks(v: unknown): Array<{ sys: { id: string } }> {
  if (Array.isArray(v)) {
    return v.flatMap((x) => collectReferenceLinks(x));
  }
  if (
    typeof v === 'object' &&
    v !== null &&
    'sys' in (v as Record<string, unknown>) &&
    typeof (v as { sys?: { id?: unknown } }).sys?.id === 'string'
  ) {
    return [v as { sys: { id: string } }];
  }
  return [];
}

function referenceTargetId(
  ref: { sys: { id: string } },
  cfg: ContentfulAdapterConfig,
  _from: ContentfulEntry,
): string | null {
  const namespace = cfg.idStrategy?.namespace ?? 'cms';
  return `${namespace}/${ref.sys.id.toLowerCase()}`;
}

/**
 * PRD-202-R7..R20 — produce a fully-formed PRD-100 envelope (or partial)
 * for a single ContentfulItem. Pure modulo `provider` calls delegated through
 * `RichTextConvertContext`.
 */
function transformItem(
  item: ContentfulItem,
  cfg: ContentfulAdapterConfig,
  level: 'core' | 'standard' | 'strict',
  provider: ContentfulSourceProvider,
  ctx: AdapterContext,
  allLocales: string[],
  defaultLocaleVal: string | null,
): EmittedNode | PartialEmittedNode {
  const { entry, contentTypeId, locale } = item;
  const mapping = cfg.mappings?.[contentTypeId];

  // PRD-202-R7 / R18 — core fields with partial fallback.
  const core = resolveCoreFields(entry.fields, mapping, contentTypeId, entry.sys.id);

  // PRD-202-R10 / R11 — body blocks.
  const richTextCtx: RichTextConvertContext = {
    targetLevel: level,
    assets: collectAssetsFromProvider(provider, entry),
    linkedEntries: collectLinkedEntries(provider, entry),
    mappings: cfg.mappings ?? {},
    warn: (msg) => {
      ctx.logger.warn(`PRD-202-R10/R11/R18: ${msg}`);
    },
  };
  const bodyBlocks = extractBodyBlocks(entry.fields, mapping, richTextCtx);

  // PRD-202-R7 — tags + related.
  const tags = extractTags(entry, mapping);
  const related = extractRelated(entry, mapping, cfg);

  // PRD-202-R8 — user-mapping metadata fields.
  const mappedMetadata: Record<string, unknown> = {};
  for (const [metaKey, fieldName] of Object.entries(mapping?.metadata ?? {})) {
    if (entry.fields[fieldName] !== undefined) mappedMetadata[metaKey] = entry.fields[fieldName];
  }

  // PRD-202-R15 — id derivation + override + warning.
  const idResult = deriveId(entry, cfg, locale);
  if (idResult.warning) ctx.logger.warn(`PRD-202-R15: ${idResult.warning}`);

  // PRD-202-R14 — translations + fallback.
  const isMultiLocale = allLocales.length > 1 && locale !== null;
  const authoredLocales = item.authoredLocales;
  const isFallback =
    isMultiLocale &&
    authoredLocales !== undefined &&
    !authoredLocales.includes(locale);
  let translations: Array<{ locale: string; id: string }> | undefined;
  if (isMultiLocale) {
    translations = allLocales
      .filter((l) => l !== locale)
      .map((l) => ({ locale: l, id: deriveId(entry, cfg, l).id }));
  }

  // PRD-202-R20 — provenance.
  const sourceId = `${cfg.spaceId}/${cfg.environment ?? 'master'}/${entry.sys.id}${
    isMultiLocale ? `@${locale}` : ''
  }`;

  // Compose envelope.
  const metadata: Record<string, unknown> = {
    ...mappedMetadata,
    ...(locale !== null && allLocales.length > 0 ? { locale } : {}),
    ...(translations !== undefined && translations.length > 0 ? { translations } : {}),
    source: {
      adapter: CONTENTFUL_ADAPTER_NAME,
      source_id: sourceId,
    },
  };
  if (core.partialError !== undefined) {
    metadata['extraction_status'] = 'partial';
    metadata['extraction_error'] = core.partialError;
  }
  if (isFallback) {
    metadata['translation_status'] = 'fallback';
    metadata['fallback_from'] = defaultLocaleVal ?? 'unknown';
  }

  // Tokens (PRD-100-R23: required summary count).
  const tokens: Record<string, number> = { summary: tokenize(core.summary) };
  if (core.abstract !== undefined) tokens['abstract'] = tokenize(core.abstract);
  const bodyTokenCount = bodyBlocks.reduce((acc, b) => {
    if (b.type === 'prose' && typeof (b as { text?: unknown }).text === 'string') {
      return acc + tokenize((b as { text: string }).text);
    }
    if (b.type === 'code' && typeof (b as { text?: unknown }).text === 'string') {
      return acc + tokenize((b as { text: string }).text);
    }
    return acc;
  }, 0);
  if (bodyTokenCount > 0) tokens['body'] = bodyTokenCount;

  const envelope: EmittedNode = {
    act_version: '0.1',
    id: idResult.id,
    type: resolveActType(contentTypeId, cfg),
    title: core.title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA', // placeholder; recomputed below
    summary: core.summary,
    summary_source: core.summarySource,
    content: bodyBlocks as unknown as EmittedNode['content'],
    tokens,
    ...(core.abstract !== undefined ? { abstract: core.abstract } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(related.length > 0 ? { related } : {}),
    metadata,
  } as unknown as EmittedNode;

  // PRD-103 — derive a real etag now so PRD-600 validates clean.
  const stripped = stripEtag(envelope as unknown as Record<string, unknown>);
  (envelope as unknown as { etag: string }).etag = deriveEtag(stripped);

  // PRD-202-R18 — partial flag for downstream visibility.
  if (core.partialError !== undefined) {
    return { ...envelope, _actPartial: true };
  }
  return envelope;
}

function tokenize(s: string): number {
  // Tiny estimator — PRD-100 only requires a non-negative integer.
  return Math.max(1, s.split(/\s+/).filter((x) => x.length > 0).length);
}

function collectAssetsFromProvider(
  provider: ContentfulSourceProvider,
  entry: ContentfulEntry,
): Record<string, ContentfulAsset> {
  const out: Record<string, ContentfulAsset> = {};
  scanForLinks(entry.fields, (id, linkType) => {
    if (linkType === 'Asset') {
      const a = provider.getAsset(id);
      if (a) out[id] = a;
    }
  });
  return out;
}

function collectLinkedEntries(
  provider: ContentfulSourceProvider,
  entry: ContentfulEntry,
): Record<string, ContentfulEntry> {
  const out: Record<string, ContentfulEntry> = {};
  scanForLinks(entry.fields, (id, linkType) => {
    if (linkType === 'Entry') {
      const e = provider.getLinkedEntry(id);
      if (e) out[id] = e;
    }
  });
  return out;
}

function scanForLinks(
  v: unknown,
  visit: (id: string, linkType: 'Entry' | 'Asset') => void,
): void {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) {
    for (const x of v) scanForLinks(x, visit);
    return;
  }
  if (typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  // Rich-text document — recurse content.
  if (o['nodeType'] === 'document' && Array.isArray(o['content'])) {
    for (const node of o['content'] as unknown[]) scanForLinks(node, visit);
    return;
  }
  // Rich-text embed.
  if (typeof o['nodeType'] === 'string' && (o['data'] as { target?: { sys?: { id?: string; linkType?: string } } })?.target?.sys?.id) {
    const data = o['data'] as { target?: { sys?: { id?: string; linkType?: string; type?: string } } };
    const sys = data.target?.sys;
    if (sys?.id) {
      const lt = (sys.linkType ?? sys.type ?? '');
      if (lt === 'Entry' || lt === 'Asset') visit(sys.id, lt);
    }
    if (Array.isArray(o['content'])) {
      for (const node of o['content'] as unknown[]) scanForLinks(node, visit);
    }
    return;
  }
  // Plain link object.
  if (
    typeof (o['sys'] as { type?: string } | undefined)?.type === 'string' &&
    (o['sys'] as { type?: string }).type === 'Link'
  ) {
    const sys = o['sys'] as { id?: string; linkType?: string };
    if (typeof sys.id === 'string' && (sys.linkType === 'Entry' || sys.linkType === 'Asset')) {
      visit(sys.id, sys.linkType);
    }
    return;
  }
  for (const v2 of Object.values(o)) scanForLinks(v2, visit);
}

// Re-export public surface for the package index.
export { ContentfulAdapterError } from './errors.js';
export type { ContentfulAdapterErrorCode } from './errors.js';
export type {
  ContentTypeMapping,
  ContentfulAdapterConfig,
  ContentfulAsset,
  ContentfulEntry,
  ContentfulItem,
  ContentfulSourceCorpus,
} from './types.js';

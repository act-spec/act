/**
 * PRD-204 Storyblok adapter — `@act-spec/adapter-storyblok`.
 *
 * Public factory `createStoryblokAdapter` returns a PRD-200-R1 `Adapter`
 * whose lifecycle satisfies PRD-204-R1..R27. The adapter does NOT depend
 * on the live `storyblok-js-client` SDK at runtime: a mockable `provider`
 * abstracts the Storyblok delivery API surface so tests run from recorded
 * fixtures (per the role's "no live Storyblok API calls in tests"
 * constraint).
 *
 * Library choices:
 *  - `storyblok-js-client` declared as an OPTIONAL peer dependency
 *    (no runtime dep). Consumers wiring the live SDK install it
 *    themselves; tests pass against the corpus provider.
 *  - `ajv` (8.x, 2020-12) for config schema validation; same major as
 *    `@act-spec/validator` and sibling adapters.
 *  - In-tree TipTap-derived rich-text → markdown serializer (no
 *    `@storyblok/richtext`) — PRD-102 blocks are markdown-shaped, not
 *    HTML, so the dependency would be a poor fit (anti-pattern hedge:
 *    framework-fit over dependency reuse).
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

import { StoryblokAdapterError } from './errors.js';
import { walkRichtext } from './richtext.js';
import type { ContentBlock } from './richtext.js';
import { resolveStoryLinks } from './references.js';
import type {
  RichtextDoc,
  RichtextNode,
  StoryblokAdapterConfig,
  StoryblokItem,
  StoryblokSourceCorpus,
  StoryblokStory,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants & schema loading
// ---------------------------------------------------------------------------

/** PRD-204-R1 — adapter identity. */
export const STORYBLOK_ADAPTER_NAME = 'act-storyblok' as const;

/** PRD-204-R17 — concurrency default per Storyblok CDN-tier capacity. */
export const STORYBLOK_DEFAULT_CONCURRENCY = 6 as const;

/** PRD-204-R9 — max permitted recursion bound. */
export const STORYBLOK_DEFAULT_COMPONENT_RECURSION_MAX = 4 as const;

/** PRD-204 — reserved metadata keys we refuse to overwrite. */
export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'source',
  'extraction_status',
  'extraction_error',
  'locale',
  'translations',
  'reference_cycles',
  'preview',
  'block_uid',
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
      if (pkg.name === '@act-spec/adapter-storyblok') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`storyblok-adapter: could not locate package root from ${start}`);
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
// Source provider — abstracts over live Storyblok client.
// ---------------------------------------------------------------------------

/**
 * PRD-204 implementation note 1 — the live `storyblok-js-client` surface
 * (auth probe, paginated story fetch, single-story fetch, delta query)
 * projected as a single interface. The default factory wires a corpus-backed
 * provider; production code can wire a real Storyblok-backed one.
 */
export interface StoryblokSourceProvider {
  /** PRD-204-R21 — auth probe; returns 'ok' | 'unauthorized' | 'space_not_found'. */
  probeAuth(): Promise<'ok' | 'unauthorized' | 'space_not_found'>;
  /** PRD-204-R4 — fetch matching stories via the configured `cdn/stories` query. */
  fetchStories(opts: { storyFilter: Record<string, unknown> }): Promise<StoryblokStory[]>;
  /** PRD-204-R11 — single-story lookup by uuid. */
  getStoryByUuid(uuid: string): StoryblokStory | undefined;
  /** PRD-204-R15 — incremental delta given a `cv` marker. */
  syncDelta(
    since: string,
  ): Promise<{ stories: StoryblokStory[]; nextMarker: string }>;
  /** Idempotent. */
  dispose(): Promise<void> | void;
}

/**
 * Build a StoryblokSourceProvider from a recorded corpus. Production-grade for
 * tests AND for any caller that has captured Storyblok delivery-API responses
 * (the canonical pattern documented in PRD-204 §"Test fixtures").
 */
export function corpusProvider(corpus: StoryblokSourceCorpus): StoryblokSourceProvider {
  const lookup = new Map<string, StoryblokStory>();
  for (const s of corpus.stories) lookup.set(s.uuid, s);
  for (const [uuid, s] of Object.entries(corpus.refStories ?? {})) lookup.set(uuid, s);

  return {
    probeAuth: () => Promise.resolve('ok'),
    fetchStories({ storyFilter: _sf }) {
      // Default corpus provider returns ALL stories — the test fixture is the
      // query result. Tests that need filter behavior wire a custom provider.
      const out = [...corpus.stories];
      out.sort((a, b) =>
        a.full_slug < b.full_slug ? -1 : a.full_slug > b.full_slug ? 1 : 0,
      );
      return Promise.resolve(out);
    },
    getStoryByUuid(uuid: string) {
      return lookup.get(uuid);
    },
    syncDelta(_since: string) {
      return Promise.resolve({
        stories: corpus.stories,
        nextMarker: String(corpus.latestCv ?? 1),
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

export interface CreateStoryblokAdapterOpts {
  /** Optional provider to back the adapter (default is corpus-backed). */
  provider?: StoryblokSourceProvider;
  /** When `provider` is omitted, the factory builds a `corpusProvider`. */
  corpus?: StoryblokSourceCorpus;
}

/**
 * PRD-204-R1 — factory returning a PRD-200-R1 `Adapter`.
 */
export function createStoryblokAdapter(
  opts: CreateStoryblokAdapterOpts = {},
): Adapter<StoryblokItem> {
  if (!opts.provider && !opts.corpus) {
    throw new StoryblokAdapterError({
      code: 'config_invalid',
      message:
        'PRD-204: createStoryblokAdapter requires either `provider` or `corpus` (no live Storyblok API wiring in v0.1)',
    });
  }
  const provider: StoryblokSourceProvider =
    opts.provider ?? corpusProvider(opts.corpus as StoryblokSourceCorpus);

  // Per-build state captured by the lifecycle hooks below.
  let resolvedConfig: StoryblokAdapterConfig | undefined;
  let declaredLevel: 'core' | 'standard' | 'strict' = 'standard';
  let disposed = false;

  return {
    name: STORYBLOK_ADAPTER_NAME,

    // PRD-200-R8 — optional fast precheck; reuses config schema; no network.
    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new StoryblokAdapterError({
          code: 'config_invalid',
          message: `PRD-204-R2: precheck — config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      // Defense-in-depth checks past the schema's numeric ranges (PRD-204-R12, R9).
      const depth = (config as { linkResolutionDepth?: unknown }).linkResolutionDepth;
      if (depth !== undefined) {
        if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 5) {
          throw new StoryblokAdapterError({
            code: 'config_invalid',
            message: `PRD-204-R12: linkResolutionDepth must be integer 0–5; got ${describeValue(depth)}`,
          });
        }
      }
      const recursion = (config as { componentRecursionMax?: unknown }).componentRecursionMax;
      if (recursion !== undefined) {
        if (
          typeof recursion !== 'number'
          || !Number.isInteger(recursion)
          || recursion < 1
          || recursion > 4
        ) {
          throw new StoryblokAdapterError({
            code: 'config_invalid',
            message: `PRD-204-R9: componentRecursionMax must be integer 1–4; got ${describeValue(recursion)}`,
          });
        }
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      // PRD-204-R2 — schema validation.
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new StoryblokAdapterError({
          code: 'config_invalid',
          message: `PRD-204-R2: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as StoryblokAdapterConfig;

      // PRD-204-R12 — depth bound (defense-in-depth past the schema's max:5).
      if (cfg.linkResolutionDepth !== undefined) {
        const d = cfg.linkResolutionDepth;
        if (!Number.isInteger(d) || d < 0 || d > 5) {
          throw new StoryblokAdapterError({
            code: 'link_resolution_depth_exceeded',
            message: `PRD-204-R12: linkResolutionDepth must be integer 0–5; got ${String(d)}`,
          });
        }
      }
      // PRD-204-R9 — recursion bound (range 1–4; defense in depth).
      if (cfg.componentRecursionMax !== undefined) {
        const r = cfg.componentRecursionMax;
        if (!Number.isInteger(r) || r < 1 || r > 4) {
          throw new StoryblokAdapterError({
            code: 'component_recursion_max_invalid',
            message: `PRD-204-R9: componentRecursionMax must be integer 1–4; got ${String(r)}`,
          });
        }
      }

      // PRD-204-R23 / R24 — token resolution (env var or inline). Never log the value.
      const token = resolveAccessToken(cfg);
      if (token === undefined) {
        const ref = cfg.accessToken as { from_env: string };
        throw new StoryblokAdapterError({
          code: 'config_invalid',
          message: `PRD-204-R2/R23: env var '${ref.from_env}' is not set`,
        });
      }
      if (typeof cfg.accessToken === 'string') {
        ctx.logger.warn(
          'PRD-204-R23: accessToken supplied inline; prefer { from_env: "<NAME>" } for credential hygiene',
        );
      }
      if (cfg.debugLogging === true) {
        const fp = token.slice(0, 4);
        ctx.logger.debug(
          `PRD-204-R23: storyblok adapter token fingerprint=${fp}… (debugLogging enabled)`,
        );
      }

      // PRD-204-R3 — preview-mode warning + stamp.
      const version = cfg.version ?? 'published';
      if (version !== 'published') {
        ctx.logger.warn(
          `PRD-204-R3: version="${version}" — emitted nodes will carry metadata.preview=true`,
        );
      }

      resolvedConfig = cfg;

      // PRD-204-R21 — auth probe.
      const probe = await provider.probeAuth();
      if (probe === 'unauthorized') {
        throw new StoryblokAdapterError({
          code: 'auth_failed',
          message:
            'PRD-204-R21: Storyblok accessToken rejected (HTTP 401/403). Set STORYBLOK_TOKEN and re-run; do not commit tokens.',
        });
      }
      if (probe === 'space_not_found') {
        throw new StoryblokAdapterError({
          code: 'space_not_found',
          message: `PRD-204-R21: Storyblok space '${String(cfg.spaceId)}' not found`,
        });
      }

      // PRD-204-R18 / R19 — declared level.
      const isStrict = !!cfg.componentMapping || !!cfg.locale;
      declaredLevel = isStrict ? 'strict' : 'standard';

      // PRD-200-R24 — refuse when adapter would declare a higher level than the target.
      if (rankOf(declaredLevel) > rankOf(ctx.targetLevel)) {
        throw new StoryblokAdapterError({
          code: 'level_mismatch',
          message: `PRD-204-R19: adapter-declared level '${declaredLevel}' exceeds target '${ctx.targetLevel}' (configure a lower target or remove componentMapping / locale)`,
        });
      }

      // PRD-204-R17 — capability declaration.
      return {
        level: declaredLevel,
        concurrency_max: cfg.concurrency?.transform ?? STORYBLOK_DEFAULT_CONCURRENCY,
        delta: true,
        namespace_ids: false, // Adapter manages its own namespace prefix (PRD-204-R7 / R25).
        precedence: 'primary',
        manifestCapabilities: {
          etag: true,
          subtree: true,
          ndjson_index: false,
          search: { template_advertised: false },
        },
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<StoryblokItem> {
      const cfg = expectConfig(resolvedConfig);
      const filter = (cfg.storyFilter ?? {}) as Record<string, unknown>;
      const stories = await provider.fetchStories({ storyFilter: filter });
      if (stories.length === 0 && cfg.allowEmpty !== true) {
        ctx.logger.warn(
          `PRD-204-R5: storyFilter ${JSON.stringify(filter)} returned 0 stories; pass allowEmpty=true to suppress`,
        );
      }

      // PRD-204-R14 — locale fan-out.
      if (cfg.locale && cfg.locale.pattern === 'field') {
        const locales = cfg.locale.available ?? [cfg.locale.default ?? 'en'];
        for (const story of stories) {
          if (ctx.signal.aborted) return;
          for (const loc of locales) {
            yield { story, locale: loc };
          }
        }
        return;
      }
      if (cfg.locale && cfg.locale.pattern === 'folder') {
        // Folder pattern: each story carries its own `lang`; group by `group_id`
        // (Storyblok's translation-grouping field) or `translatedSlugs`.
        const groups = new Map<string, StoryblokStory[]>();
        for (const story of stories) {
          const key = typeof story.group_id === 'string' ? story.group_id : story.uuid;
          const list = groups.get(key) ?? [];
          list.push(story);
          groups.set(key, list);
        }
        for (const [, group] of groups) {
          for (const story of group) {
            if (ctx.signal.aborted) return;
            const localeField = cfg.locale.field ?? 'lang';
            const docLoc = readStoryLocale(story, localeField);
            const siblings = group
              .filter((s) => s.uuid !== story.uuid)
              .map((s) => ({
                locale: readStoryLocale(s, localeField) ?? 'unknown',
                id: deriveActId(
                  s,
                  cfg,
                  readStoryLocale(s, localeField),
                ),
              }));
            yield { story, locale: docLoc, siblings };
          }
        }
        return;
      }
      for (const story of stories) {
        if (ctx.signal.aborted) return;
        yield { story, locale: null };
      }
    },

    transform(
      item: StoryblokItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(transformItem(item, cfg, declaredLevel, provider, ctx));
    },

    async *delta(since: string, ctx: AdapterContext): AsyncIterable<StoryblokItem> {
      const cfg = expectConfig(resolvedConfig);
      const result = await provider.syncDelta(since);
      ctx.logger.info(
        `PRD-204-R15: sync delta yielded ${String(result.stories.length)} stories; next cv=${result.nextMarker}`,
      );
      const locales = cfg.locale?.available ?? [null];
      for (const story of result.stories) {
        if (ctx.signal.aborted) return;
        for (const loc of locales) {
          yield { story, locale: loc };
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

/** Render an `unknown` value safely for human-readable error messages. */
function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return `${v.toString()}n`;
  return `<${typeof v}>`;
}

function expectConfig(cfg: StoryblokAdapterConfig | undefined): StoryblokAdapterConfig {
  if (!cfg) {
    throw new StoryblokAdapterError({
      code: 'config_invalid',
      message: 'PRD-204: adapter used before init',
    });
  }
  return cfg;
}

function resolveAccessToken(cfg: StoryblokAdapterConfig): string | undefined {
  if (typeof cfg.accessToken === 'string') return cfg.accessToken;
  return process.env[cfg.accessToken.from_env];
}

function readStoryLocale(story: StoryblokStory, field: string): string | null {
  const direct = (story as unknown as Record<string, unknown>)[field];
  if (typeof direct === 'string') return direct;
  if (typeof story.lang === 'string') return story.lang;
  return null;
}

/** PRD-204-R7 — derive ACT id from configured `idField`, story `full_slug`, or `uuid`. */
function deriveActId(
  story: StoryblokStory,
  cfg: StoryblokAdapterConfig,
  locale: string | null,
): string {
  const namespace = cfg.namespace ?? 'act-storyblok';
  // Folder-pattern locales: `full_slug` already encodes the locale path
  // segment (e.g., `en/marketing/pricing`). Field-pattern: full_slug carries
  // no locale, so we prepend it. Single-locale builds: no prefix.
  const includeLocalePrefix =
    locale !== null && cfg.locale?.pattern !== 'folder';
  const localePrefix = includeLocalePrefix
    ? `${locale.toLowerCase()}/`
    : '';

  // Explicit override first.
  if (cfg.idField !== undefined) {
    const v = readField(story, cfg.idField);
    if (typeof v === 'string' && v.length > 0) {
      return `${namespace}/${localePrefix}${normalize(v)}`;
    }
  }
  // Default: `full_slug` (PRD-204-R7 default mapping).
  if (typeof story.full_slug === 'string' && story.full_slug.length > 0) {
    return `${namespace}/${localePrefix}${normalize(story.full_slug)}`;
  }
  // Fallback: `slug`.
  if (typeof story.slug === 'string' && story.slug.length > 0) {
    return `${namespace}/${localePrefix}${normalize(story.slug)}`;
  }
  // Last resort: uuid.
  return `${namespace}/${localePrefix}${normalize(story.uuid)}`;
}

/** Tiny dot-path reader for `idField` and field-mapping lookups. */
function readField(story: StoryblokStory, fieldPath: string): unknown {
  // Convention: top-level story fields (`name`, `tag_list`, …) come first;
  // `content.foo` reads from the story content. Bare keys default to content.
  const parts = fieldPath.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const root = (story as unknown as Record<string, unknown>);
  if (parts[0] !== undefined && parts[0] in root) {
    let cur: unknown = root;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }
  // Otherwise read from content.
  const content = story.content as Record<string, unknown>;
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
    .replace(/^-|-$/g, '');
}

/** PRD-204-R6 — content-component → ACT type. */
function resolveActType(story: StoryblokStory, cfg: StoryblokAdapterConfig): string | undefined {
  const map = cfg.typeMapping ?? {};
  const componentName = story.content.component;
  if (Object.prototype.hasOwnProperty.call(map, componentName)) return map[componentName];
  return componentName; // identity default
}

/**
 * PRD-204-R7 — extract title; story.name by default, configurable override.
 */
function resolveTitle(story: StoryblokStory, cfg: StoryblokAdapterConfig): string | null {
  const fieldName = cfg.fieldMapping?.title;
  if (fieldName) {
    const v = readField(story, fieldName);
    if (typeof v === 'string' && v.length > 0) return v;
  }
  if (typeof story.name === 'string' && story.name.length > 0) return story.name;
  return null;
}

/**
 * PRD-204-R7 — summary; falls back to first-paragraph extraction (capped at
 * ~50 tokens) when no `summary` field is configured / present. Returns
 * `summarySource` for envelope stamping.
 */
function resolveSummary(
  story: StoryblokStory,
  cfg: StoryblokAdapterConfig,
  bodyBlocks: ContentBlock[],
): { summary: string; summarySource: 'author' | 'extracted' } {
  const strategy = cfg.summary?.strategy;
  const fieldName = cfg.fieldMapping?.summary ?? 'content.summary';

  if (strategy === 'field' || strategy === undefined) {
    const v = readField(story, fieldName);
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
    summary: `Summary for ${story.content.component} ${story.uuid}`,
    summarySource: 'extracted',
  };
}

function tokenize(s: string): number {
  return Math.max(1, s.split(/\s+/).filter((x) => x.length > 0).length);
}

function readBodyField(story: StoryblokStory, cfg: StoryblokAdapterConfig): RichtextNode[] | RichtextDoc | null {
  const fieldName = cfg.fieldMapping?.body ?? 'body';
  const raw = (story.content as Record<string, unknown>)[fieldName];
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw as RichtextNode[];
  if (typeof raw === 'object') return raw as RichtextDoc;
  return null;
}

/**
 * PRD-204-R7..R25 — produce a fully-formed PRD-100 envelope (or partial)
 * for a single StoryblokItem. Pure modulo `provider` calls.
 */
function transformItem(
  item: StoryblokItem,
  cfg: StoryblokAdapterConfig,
  level: 'core' | 'standard' | 'strict',
  provider: StoryblokSourceProvider,
  ctx: AdapterContext,
): EmittedNode | PartialEmittedNode | null {
  const { story, locale } = item;

  // PRD-204-R6 — type mapping (skip when explicitly mapped to undefined).
  const targetType = resolveActType(story, cfg);
  if (targetType === undefined) {
    ctx.logger.debug(
      `PRD-204-R6: skipping story ${story.uuid} (typeMapping omits "${story.content.component}")`,
    );
    return null;
  }

  // PRD-204-R8 / R9 — body walk.
  const body = readBodyField(story, cfg);
  let bodyBlocks: ContentBlock[] = [];
  let bodyPartial = false;
  if (body !== null) {
    const w = walkRichtext(body, {
      targetLevel: level,
      ...(cfg.componentMapping !== undefined ? { componentMapping: cfg.componentMapping } : {}),
      componentRecursionMax: cfg.componentRecursionMax ?? STORYBLOK_DEFAULT_COMPONENT_RECURSION_MAX,
      ...(cfg.fieldMapping?.calloutLevel !== undefined
        ? { calloutLevel: cfg.fieldMapping.calloutLevel }
        : {}),
      warn: (m) => ctx.logger.warn(`PRD-204-R8/R9: ${m}`),
    });
    bodyBlocks = w.blocks;
    bodyPartial = w.partial;
  }

  // PRD-204-R7 — title with partial fallback.
  const titleResolved = resolveTitle(story, cfg);
  const title = titleResolved ?? `Untitled ${story.content.component} ${story.uuid}`;
  const titlePartial = titleResolved === null;

  // PRD-204-R7 — summary (author / extracted).
  const summary = resolveSummary(story, cfg, bodyBlocks);

  // PRD-204-R7 — abstract (optional).
  const abstractField = cfg.fieldMapping?.abstract ?? 'content.abstract';
  const abstractRaw = readField(story, abstractField);
  const abstractValue =
    typeof abstractRaw === 'string' && abstractRaw.length > 0 ? abstractRaw : undefined;

  // PRD-204-R7 — tags from `tag_list` by default.
  const tagsField = cfg.fieldMapping?.tags;
  let tags: string[] = [];
  if (tagsField !== undefined) {
    const v = readField(story, tagsField);
    if (Array.isArray(v)) {
      tags = v.filter((x): x is string => typeof x === 'string');
    }
  } else if (Array.isArray(story.tag_list)) {
    tags = story.tag_list.filter((x): x is string => typeof x === 'string');
  }

  // PRD-204-R7 — id derivation.
  const id = deriveActId(story, cfg, locale);

  // PRD-204-R11 / R12 / R13 — references + cycles.
  const refs = resolveStoryLinks(
    story,
    cfg,
    { getStoryByUuid: (uuid) => provider.getStoryByUuid(uuid) },
    (target) => deriveActId(target, cfg, locale),
  );

  // PRD-204-R14 — translations from sibling map.
  const translations = item.siblings && item.siblings.length > 0 ? item.siblings : undefined;

  // PRD-204-R25 — provenance source_id (uuid; or `{uuid}#{locale}` for field-level locale variants).
  const sourceId = locale !== null && cfg.locale?.pattern === 'field'
    ? `${story.uuid}#${locale}`
    : story.uuid;

  // PRD-204-R3 — preview stamp.
  const isPreview = (cfg.version ?? 'published') !== 'published';

  // PRD-204-R7 — updated_at: published_at when published, else updated_at.
  const updatedAt =
    (cfg.version ?? 'published') === 'published' && typeof story.published_at === 'string'
      ? story.published_at
      : typeof story.updated_at === 'string'
      ? story.updated_at
      : undefined;

  // Compose envelope metadata.
  const metadata: Record<string, unknown> = {
    ...(locale !== null ? { locale } : {}),
    ...(translations !== undefined ? { translations } : {}),
    ...(refs.cycles > 0 ? { reference_cycles: refs.cycles } : {}),
    ...(isPreview ? { preview: true } : {}),
    source: {
      adapter: STORYBLOK_ADAPTER_NAME,
      source_id: sourceId,
    },
  };

  const partialError: string | undefined = titlePartial
    ? `no title field (looked for "${cfg.fieldMapping?.title ?? 'name'}") on ${story.uuid}`
    : bodyPartial
    ? `richtext walk encountered unmapped node types on ${story.uuid}`
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
      (b.type === 'prose' || b.type === 'code' || b.type === 'callout')
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
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
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

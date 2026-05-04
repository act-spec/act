/**
 * WordPress adapter — `@act-spec/adapter-wordpress`.
 *
 * Public factory `createWordPressAdapter` returns an `Adapter` whose lifecycle
 * fans out across the requested REST collections and emits ACT envelopes.
 * The adapter is testable offline through `corpusProvider`; production
 * callers either pass a custom `provider` or supply `config.baseUrl` and let
 * the factory wire the default HTTP provider.
 *
 * Library choices:
 *  - `ajv` (8.x, 2020-12) for config-schema validation; same major as
 *    `@act-spec/validator` and sibling adapters.
 *  - No first-party WordPress SDK dependency; the REST surface the adapter
 *    consumes is small enough that a `fetch`-based client (see `client.ts`)
 *    is the right size.
 *  - In-tree HTML walker (see `html.ts`); WordPress's rendered HTML is well-
 *    formed in practice, and pulling `parse5` for our paragraph-stream needs
 *    would dwarf the rest of the package.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { Ajv as AjvType } from 'ajv';

import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  EmittedNode,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';

import { fetchCollection, type FetchLike } from './client.js';
import {
  ADAPTER_NAME,
  DEFAULT_CONCURRENCY,
  DEFAULT_NAMESPACE,
  DEFAULT_PER_PAGE,
  RESERVED_METADATA_KEYS,
} from './constants.js';
import { WordPressAdapterError } from './errors.js';
import { detectI18nMode, type I18nMode } from './i18n.js';
import { mapWordPressItem } from './mapper.js';
import type {
  ResolvedAuth,
  Secret,
  WordPressAdapterConfig,
  WordPressAuth,
  WordPressItem,
  WordPressMedia,
  WordPressPage,
  WordPressPost,
  WordPressSourceCorpus,
  WordPressTerm,
  WordPressUser,
} from './types.js';

// Re-export for convenience.
export {
  ADAPTER_NAME as WORDPRESS_ADAPTER_NAME,
  DEFAULT_CONCURRENCY as WORDPRESS_DEFAULT_CONCURRENCY,
  DEFAULT_PER_PAGE as WORDPRESS_DEFAULT_PER_PAGE,
  DEFAULT_NAMESPACE as WORDPRESS_DEFAULT_NAMESPACE,
  RESERVED_METADATA_KEYS,
};

// ---------------------------------------------------------------------------
// Schema loading (mirrors sibling-adapter anchor strategy)
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));

function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === '@act-spec/adapter-wordpress') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`wordpress-adapter: could not locate package root from ${start}`);
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
// Source provider — abstracts the live REST surface so tests run offline.
// ---------------------------------------------------------------------------

/**
 * Provider interface backing the adapter. The default factory wires either
 * `httpProvider` (when `baseUrl` is supplied) or `corpusProvider` (when a
 * recorded `corpus` is supplied).
 */
export interface WordPressSourceProvider {
  listPosts(): AsyncIterable<WordPressPost>;
  listPages(): AsyncIterable<WordPressPage>;
  listCategories(): AsyncIterable<WordPressTerm>;
  listTags(): AsyncIterable<WordPressTerm>;
  listUsers(): AsyncIterable<WordPressUser>;
  /** Optional — used by mappers that resolve featured-image attachments. */
  getMedia?(id: number): Promise<WordPressMedia | undefined>;
  dispose(): Promise<void> | void;
}

/** Build a provider from a recorded corpus. */
export function corpusProvider(corpus: WordPressSourceCorpus): WordPressSourceProvider {
  const mediaIndex = new Map<number, WordPressMedia>();
  for (const m of corpus.media ?? []) mediaIndex.set(m.id, m);
  return {
    async *listPosts(): AsyncIterable<WordPressPost> {
      await Promise.resolve();
      for (const p of corpus.posts ?? []) yield p;
    },
    async *listPages(): AsyncIterable<WordPressPage> {
      await Promise.resolve();
      for (const p of corpus.pages ?? []) yield p;
    },
    async *listCategories(): AsyncIterable<WordPressTerm> {
      await Promise.resolve();
      for (const c of corpus.categories ?? []) yield c;
    },
    async *listTags(): AsyncIterable<WordPressTerm> {
      await Promise.resolve();
      for (const t of corpus.tags ?? []) yield t;
    },
    async *listUsers(): AsyncIterable<WordPressUser> {
      await Promise.resolve();
      for (const u of corpus.users ?? []) yield u;
    },
    getMedia(id: number) {
      return Promise.resolve(mediaIndex.get(id));
    },
    dispose() {
      // no-op
    },
  };
}

/**
 * Build a provider that talks to a live WordPress site over HTTP. Requires a
 * resolved auth (use `resolveAuth(cfg.auth)` to derive one from config).
 */
export interface HttpProviderOptions {
  baseUrl: string;
  auth: ResolvedAuth;
  fetch?: FetchLike;
  perPage?: number;
  signal?: AbortSignal;
}

export function httpProvider(opts: HttpProviderOptions): WordPressSourceProvider {
  const clientOpts = {
    baseUrl: opts.baseUrl,
    auth: opts.auth,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.perPage !== undefined ? { perPage: opts.perPage } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  return {
    listPosts: () => fetchCollection<WordPressPost>(clientOpts, 'posts'),
    listPages: () => fetchCollection<WordPressPage>(clientOpts, 'pages'),
    listCategories: () => fetchCollection<WordPressTerm>(clientOpts, 'categories'),
    listTags: () => fetchCollection<WordPressTerm>(clientOpts, 'tags'),
    listUsers: () => fetchCollection<WordPressUser>(clientOpts, 'users'),
    dispose() {
      // no-op — fetch holds no state.
    },
  };
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

function resolveSecret(s: Secret): string | undefined {
  if (typeof s === 'string') return s;
  return process.env[s.from_env];
}

/**
 * Resolve a config-shaped `WordPressAuth` into concrete credentials.
 * Throws `WordPressAdapterError(env_missing)` when an `from_env` reference
 * has no value. Returns `{ kind: 'none' }` when the operator did not
 * configure auth — callers are expected to gate on that for endpoints that
 * require credentials.
 */
export function resolveAuth(auth: WordPressAuth | undefined): ResolvedAuth {
  if (auth === undefined) return { kind: 'none' };
  if (typeof auth === 'string') return { kind: 'bearer', token: auth };
  if ('from_env' in auth) {
    const v = process.env[auth.from_env];
    if (v === undefined || v.length === 0) {
      throw new WordPressAdapterError({
        code: 'env_missing',
        message: `WordPress adapter: env var '${auth.from_env}' is not set (referenced by config.auth.from_env)`,
      });
    }
    return { kind: 'bearer', token: v };
  }
  // Application password
  const user = resolveSecret(auth.user);
  const password = resolveSecret(auth.appPassword);
  if (user === undefined || user.length === 0) {
    throw new WordPressAdapterError({
      code: 'env_missing',
      message:
        typeof auth.user === 'string'
          ? 'WordPress adapter: config.auth.user is empty'
          : `WordPress adapter: env var '${auth.user.from_env}' is not set (config.auth.user.from_env)`,
    });
  }
  if (password === undefined || password.length === 0) {
    throw new WordPressAdapterError({
      code: 'env_missing',
      message:
        typeof auth.appPassword === 'string'
          ? 'WordPress adapter: config.auth.appPassword is empty'
          : `WordPress adapter: env var '${auth.appPassword.from_env}' is not set (config.auth.appPassword.from_env)`,
    });
  }
  return { kind: 'basic', user, password };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface CreateWordPressAdapterOpts {
  /** Custom provider — used by tests and by callers wrapping the live API. */
  provider?: WordPressSourceProvider;
  /** Recorded corpus — convenience shortcut for `provider: corpusProvider(...)`. */
  corpus?: WordPressSourceCorpus;
  /** Custom fetch implementation forwarded to the default HTTP provider. */
  fetch?: FetchLike;
}

/**
 * Build an `Adapter` for a WordPress site. Either `provider`, `corpus`, or
 * a config with `baseUrl` (resolved at `init`) is required for the adapter to
 * have anything to enumerate.
 */
export function createWordPressAdapter(
  opts: CreateWordPressAdapterOpts = {},
): Adapter<WordPressItem> {
  // Per-build state captured by the lifecycle hooks.
  let resolvedConfig: WordPressAdapterConfig | undefined;
  let resolvedProvider: WordPressSourceProvider | undefined;
  let resolvedI18n: I18nMode = 'none';
  let disposed = false;

  return {
    name: ADAPTER_NAME,

    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new WordPressAdapterError({
          code: 'config_invalid',
          message: `WordPress adapter: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new WordPressAdapterError({
          code: 'config_invalid',
          message: `WordPress adapter: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as WordPressAdapterConfig;
      resolvedConfig = cfg;

      // Pick the provider: explicit > corpus > HTTP from baseUrl.
      if (opts.provider !== undefined) {
        resolvedProvider = opts.provider;
      } else if (opts.corpus !== undefined) {
        resolvedProvider = corpusProvider(opts.corpus);
        if (opts.corpus.i18nMode !== undefined) resolvedI18n = opts.corpus.i18nMode;
      } else {
        // Resolve auth (may throw env_missing) and wire the HTTP provider.
        const auth = resolveAuth(cfg.auth);
        if (auth.kind === 'bearer' && typeof cfg.auth === 'string') {
          ctx.logger.warn(
            'WordPress adapter: config.auth supplied inline as a string; prefer { from_env: "<NAME>" } for credential hygiene.',
          );
        }
        resolvedProvider = httpProvider({
          baseUrl: cfg.baseUrl,
          auth,
          ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
          ...(cfg.perPage !== undefined ? { perPage: cfg.perPage } : {}),
          signal: ctx.signal,
        });
      }

      // i18n mode: explicit config beats auto-detection.
      const requestedMode = cfg.i18n?.mode ?? 'auto';
      if (requestedMode !== 'auto') {
        resolvedI18n = requestedMode;
      }

      // Capabilities. WordPress sites range from "tiny blog" to "WP-as-CMS";
      // the adapter targets `standard` per the runbook (no marketing blocks
      // emitted, locale fan-out happens via translations metadata, not via
      // strict-tier features).
      const caps: AdapterCapabilities = {
        level: 'standard',
        concurrency_max: cfg.concurrency ?? DEFAULT_CONCURRENCY,
        delta: false,
        namespace_ids: false, // adapter manages its own `wp/...` prefix
        manifestCapabilities: {
          etag: true,
          subtree: true,
        },
      };
      if (ctx.targetLevel === 'core') {
        // Caller asked for core; emit core. The mapper currently emits prose
        // blocks (which are core-tier), so this is just a level downgrade.
        caps.level = 'core';
      }
      return caps;
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<WordPressItem> {
      const cfg = expectConfig(resolvedConfig);
      const provider = expectProvider(resolvedProvider);
      const include = cfg.include ?? {
        posts: true,
        pages: true,
        categories: true,
        tags: false,
        users: false,
      };

      // Pages first (parents typically root-level), then categories, then posts.
      // The framework preserves this order in emission.
      let detected = false;
      const detect = (post: WordPressPost): void => {
        if (detected) return;
        if (cfg.i18n?.mode === undefined || cfg.i18n.mode === 'auto') {
          resolvedI18n = detectI18nMode(post);
        }
        detected = true;
      };

      if (include.pages !== false) {
        for await (const page of provider.listPages()) {
          if (ctx.signal.aborted) return;
          detect(page);
          yield { kind: 'page', page };
        }
      }
      if (include.categories !== false) {
        for await (const term of provider.listCategories()) {
          if (ctx.signal.aborted) return;
          yield { kind: 'category', term };
        }
      }
      if (include.tags === true) {
        for await (const term of provider.listTags()) {
          if (ctx.signal.aborted) return;
          yield { kind: 'tag', term };
        }
      }
      if (include.users === true) {
        for await (const user of provider.listUsers()) {
          if (ctx.signal.aborted) return;
          yield { kind: 'user', user };
        }
      }
      if (include.posts !== false) {
        for await (const post of provider.listPosts()) {
          if (ctx.signal.aborted) return;
          detect(post);
          yield { kind: 'post', post };
        }
      }
    },

    transform(
      item: WordPressItem,
      _ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(mapWordPressItem(item, cfg, resolvedI18n));
    },

    async dispose(_ctx: AdapterContext): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (resolvedProvider !== undefined) await resolvedProvider.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectConfig(cfg: WordPressAdapterConfig | undefined): WordPressAdapterConfig {
  if (!cfg) {
    throw new WordPressAdapterError({
      code: 'used_before_init',
      message: 'WordPress adapter: lifecycle method called before `init`',
    });
  }
  return cfg;
}

function expectProvider(p: WordPressSourceProvider | undefined): WordPressSourceProvider {
  if (!p) {
    throw new WordPressAdapterError({
      code: 'used_before_init',
      message: 'WordPress adapter: provider not resolved (init not called)',
    });
  }
  return p;
}

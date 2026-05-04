/**
 * Notion adapter — `@act-spec/adapter-notion`.
 *
 * Public factory `notionAdapter()` returns an `Adapter` whose lifecycle
 * (`init -> enumerate -> transform -> dispose`) maps a Notion database
 * into one branch ACT node plus one leaf ACT node per page.
 *
 * The adapter does not import any Notion SDK at runtime: HTTP traffic is
 * handled by `httpProvider()` (uses the global `fetch`); tests pass
 * `corpusProvider()` instead, which replays a recorded bundle of API
 * responses through the same provider interface.
 */
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  EmittedNode,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';

import { NotionAdapterError } from './errors.js';
import {
  corpusProvider,
  httpProvider,
  NOTION_API_BASE_URL,
  NOTION_API_VERSION,
} from './client.js';
import type { NotionSourceCorpus, NotionSourceProvider } from './client.js';
import { extractLocale } from './locale.js';
import {
  NOTION_ADAPTER_NAME,
  NOTION_DEFAULT_CONCURRENCY,
  transformDatabase,
  transformPage,
} from './mapper.js';
import type {
  NotionAdapterConfig,
  NotionDatabase,
  NotionItem,
  NotionPage,
} from './types.js';

export interface CreateNotionAdapterOpts {
  /** Optional provider (HTTP or corpus). Default: built from `corpus` if supplied, otherwise `httpProvider`. */
  provider?: NotionSourceProvider;
  /** Recorded corpus (for tests / fixture-driven callers). */
  corpus?: NotionSourceCorpus;
}

/**
 * Public factory. Returns an `Adapter<NotionItem>` ready to be wired into
 * a generator (Astro, Next.js, etc.) or run directly via `runAdapter()`.
 *
 * @example
 *   const adapter = notionAdapter();
 *   await runAdapter(adapter, {
 *     accessToken: { from_env: 'NOTION_TOKEN' },
 *     databaseId: 'abcd1234abcd1234abcd1234abcd1234',
 *   }, ctx);
 */
export function notionAdapter(opts: CreateNotionAdapterOpts = {}): Adapter<NotionItem> {
  // Per-build state captured by the lifecycle hooks below.
  let resolvedConfig: NotionAdapterConfig | undefined;
  let provider: NotionSourceProvider | undefined = opts.provider;
  let cachedDatabase: NotionDatabase | undefined;
  let cachedPages: NotionPage[] | undefined;
  const declaredLevel: 'core' | 'standard' | 'strict' = 'standard';
  let disposed = false;

  if (provider === undefined && opts.corpus !== undefined) {
    provider = corpusProvider(opts.corpus);
  }

  return {
    name: NOTION_ADAPTER_NAME,

    precheck(config: Record<string, unknown>): void {
      validateConfig(config);
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      const cfg = validateConfig(config);
      resolvedConfig = cfg;

      // Resolve the access token lazily — we don't need to read it for the
      // corpus-backed path, but we must error clearly when an env var is
      // referenced but not set for the HTTP path.
      const token = resolveAccessToken(cfg);
      if (token === undefined && provider === undefined) {
        const ref = cfg.accessToken as { from_env: string };
        throw new NotionAdapterError({
          code: 'config_invalid',
          message: `env var '${ref.from_env}' is not set`,
        });
      }
      if (typeof cfg.accessToken === 'string' && provider === undefined) {
        ctx.logger.warn(
          'accessToken supplied inline; prefer { from_env: "NOTION_TOKEN" } for credential hygiene',
        );
      }

      // Wire the default provider lazily so tests can avoid it entirely.
      if (provider === undefined) {
        provider = httpProvider({
          token: token as string,
          baseUrl: cfg.apiBaseUrl ?? NOTION_API_BASE_URL,
          notionApiVersion: cfg.notionApiVersion ?? NOTION_API_VERSION,
        });
      }

      // Auth probe -> typed errors.
      const probe = await provider.probeAuth(cfg.databaseId);
      if (probe === 'unauthorized') {
        throw new NotionAdapterError({
          code: 'auth_failed',
          message:
            'Notion integration token rejected. Set NOTION_TOKEN and re-run; do not commit tokens.',
        });
      }
      if (probe === 'database_not_found') {
        throw new NotionAdapterError({
          code: 'database_not_found',
          message: `database '${cfg.databaseId}' not found or not shared with the integration`,
        });
      }

      // Cache the database object so `enumerate` doesn't re-fetch.
      cachedDatabase = await provider.retrieveDatabase(cfg.databaseId);

      // Refuse if generator target exceeds adapter's declared level.
      const order = ['core', 'standard', 'strict'] as const;
      if (order.indexOf(ctx.targetLevel) > order.indexOf(declaredLevel)) {
        throw new NotionAdapterError({
          code: 'level_mismatch',
          message: `adapter-declared level '${declaredLevel}' is below target '${ctx.targetLevel}'`,
        });
      }

      return {
        level: declaredLevel,
        concurrency_max: cfg.concurrency?.transform ?? NOTION_DEFAULT_CONCURRENCY,
        delta: false,
        namespace_ids: false, // adapter manages its own namespace prefix
        manifestCapabilities: {
          etag: true,
          subtree: true,
          ndjson_index: false,
          search: { template_advertised: false },
        },
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<NotionItem> {
      const cfg = expectConfig(resolvedConfig);
      const db = expectDatabase(cachedDatabase);
      const prov = expectProvider(provider);

      // Collect every page first so we can stamp the branch envelope's `children`.
      const pages: NotionPage[] = [];
      for await (const page of prov.queryDatabasePages(cfg.databaseId)) {
        if (ctx.signal.aborted) return;
        pages.push(page);
      }
      cachedPages = pages;

      // 1) Branch (database) item.
      yield { kind: 'database', database: db };

      // 2) One leaf item per page, with its block tree pre-loaded.
      for (const page of pages) {
        if (ctx.signal.aborted) return;
        const blocks = await prov.listPageBlocks(page.id);
        const locale = extractLocale(page, cfg.locale);
        yield { kind: 'page', database: db, page, blocks, locale };
      }
    },

    transform(
      item: NotionItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);

      if (item.kind === 'database') {
        const pages = cachedPages ?? [];
        const branch = transformDatabase(item.database, pages, cfg, (p) =>
          extractLocale(p, cfg.locale),
        );
        return Promise.resolve(branch);
      }
      if (item.page === undefined) {
        return Promise.resolve(null);
      }
      const node = transformPage(
        item.page,
        item.database,
        item.blocks ?? [],
        cfg,
        item.locale ?? null,
        (msg) => ctx.logger.warn(msg),
      );
      return Promise.resolve(node);
    },

    async dispose(_ctx: AdapterContext): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (provider !== undefined) {
        await provider.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Config validation (lightweight; intentionally avoids ajv to keep deps zero)
// ---------------------------------------------------------------------------

function validateConfig(config: Record<string, unknown>): NotionAdapterConfig {
  if (typeof config !== 'object' || config === null) {
    throw new NotionAdapterError({ code: 'config_invalid', message: 'config must be an object' });
  }
  const c = config as Record<string, unknown>;

  // accessToken
  const at = c['accessToken'];
  if (typeof at !== 'string' && !isFromEnvRef(at)) {
    throw new NotionAdapterError({
      code: 'config_invalid',
      message: 'config.accessToken must be a string OR { from_env: string }',
    });
  }

  // databaseId
  const did = c['databaseId'];
  if (typeof did !== 'string' || did.length === 0) {
    throw new NotionAdapterError({
      code: 'config_invalid',
      message: 'config.databaseId must be a non-empty string',
    });
  }

  // optional shape checks (we narrow into the typed config below).
  ensureOptionalString(c, 'databaseType');
  ensureOptionalString(c, 'pageType');
  ensureOptionalString(c, 'databaseTitle');
  ensureOptionalString(c, 'databaseSummary');
  ensureOptionalString(c, 'apiBaseUrl');
  ensureOptionalString(c, 'notionApiVersion');

  if (c['properties'] !== undefined) {
    if (typeof c['properties'] !== 'object' || c['properties'] === null) {
      throw new NotionAdapterError({
        code: 'config_invalid',
        message: 'config.properties must be an object',
      });
    }
  }
  if (c['locale'] !== undefined) {
    if (typeof c['locale'] !== 'object' || c['locale'] === null) {
      throw new NotionAdapterError({
        code: 'config_invalid',
        message: 'config.locale must be an object',
      });
    }
  }
  if (c['idStrategy'] !== undefined) {
    if (typeof c['idStrategy'] !== 'object' || c['idStrategy'] === null) {
      throw new NotionAdapterError({
        code: 'config_invalid',
        message: 'config.idStrategy must be an object',
      });
    }
  }
  if (c['concurrency'] !== undefined) {
    if (typeof c['concurrency'] !== 'object' || c['concurrency'] === null) {
      throw new NotionAdapterError({
        code: 'config_invalid',
        message: 'config.concurrency must be an object',
      });
    }
  }

  return c as unknown as NotionAdapterConfig;
}

function ensureOptionalString(c: Record<string, unknown>, key: string): void {
  const v = c[key];
  if (v !== undefined && typeof v !== 'string') {
    throw new NotionAdapterError({
      code: 'config_invalid',
      message: `config.${key} must be a string when supplied`,
    });
  }
}

function isFromEnvRef(v: unknown): v is { from_env: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { from_env?: unknown }).from_env === 'string'
  );
}

function resolveAccessToken(cfg: NotionAdapterConfig): string | undefined {
  if (typeof cfg.accessToken === 'string') return cfg.accessToken;
  return process.env[cfg.accessToken.from_env];
}

function expectConfig(cfg: NotionAdapterConfig | undefined): NotionAdapterConfig {
  if (!cfg) {
    throw new NotionAdapterError({
      code: 'config_invalid',
      message: 'adapter used before init',
    });
  }
  return cfg;
}

function expectDatabase(db: NotionDatabase | undefined): NotionDatabase {
  if (!db) {
    throw new NotionAdapterError({
      code: 'upstream_unavailable',
      message: 'database not loaded; init() did not complete',
    });
  }
  return db;
}

function expectProvider(p: NotionSourceProvider | undefined): NotionSourceProvider {
  if (!p) {
    throw new NotionAdapterError({
      code: 'config_invalid',
      message: 'no provider configured',
    });
  }
  return p;
}

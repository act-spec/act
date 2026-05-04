/**
 * PRD-207 i18n adapter — `@act-spec/adapter-i18n`.
 *
 * Public factory `createI18nAdapter` returns a PRD-200-R1 `Adapter` whose
 * lifecycle satisfies PRD-207-R1..R20. The adapter is build-time only and
 * never opens network connections; it reads message-catalog JSON files
 * from `messagesDir` per the configured `library`.
 *
 * Library choices:
 *  - No first-party `next-intl` / `react-intl` / `i18next` dependency. The
 *    catalog file shapes are JSON-structural and stable; pulling the SDKs
 *    in would buy nothing the adapter consumes (the SDKs are runtime-side).
 *  - `ajv` (8.x, 2020-12) for config schema validation; same major as
 *    `@act-spec/validator` and sibling adapters.
 *  - In-tree path-traversal guard mirroring PRD-201-R8 / PRD-206 catalog
 *    directory walk (no `realpath-native` etc.).
 *
 * A1 cross-source composition (docs/amendments-queue.md, CLOSED): when
 * PRD-207 composes with PRD-202 both contribute `metadata.translations`
 * arrays. The framework's `mergeContributions` dedupes those entries by
 * `(locale, id)` later-wins per A1's "Proposed fix"; this adapter relies
 * on that behavior and the cross-source composition test exercises it.
 */
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
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

import { loadLocaleCatalog } from './catalog.js';
import { computeBindingId, resolveCrossLocaleId } from './cross-locale.js';
import { detectLibraryLayout } from './detect.js';
import { I18nAdapterError } from './errors.js';
import { determineNodeStatus } from './fallback.js';
import { BCP47_SUBSET_RE, normalizeLocale } from './locale.js';
import type {
  FlatCatalog,
  I18nAdapterConfig,
  I18nItem,
  I18nLibrary,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants & schema loading
// ---------------------------------------------------------------------------

/** PRD-207-R1 — adapter identity. */
export const I18N_ADAPTER_NAME = 'act-i18n' as const;

/** PRD-207-R15 — concurrency default. Catalog read is cheap; bound at 8. */
export const I18N_DEFAULT_CONCURRENCY = 8 as const;

const here = path.dirname(fileURLToPath(import.meta.url));

function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === '@act-spec/adapter-i18n') return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`i18n-adapter: could not locate package root from ${start}`);
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
// Public factory shape
// ---------------------------------------------------------------------------

export interface CreateI18nAdapterOpts {
  /**
   * PRD-207 (autonomous) — when supplied, overrides the catalogs the
   * adapter would otherwise read from disk. Used by tests that want
   * pure in-memory fixtures.
   */
  catalogsOverride?: Map<string, FlatCatalog>;
  /**
   * PRD-207 (autonomous) — when supplied, overrides the inferred set
   * of (catalogKey → nodeKeys) mappings. Default: each catalog key is
   * its own node (node-level == key-level for v0.1's coverage logic).
   */
  nodeKeysOverride?: Array<{ nodeKey: string; catalogKeys: string[] }>;
}

/** PRD-207-R1 — factory returning a PRD-200-R1 `Adapter`. */
export function createI18nAdapter(
  opts: CreateI18nAdapterOpts = {},
): Adapter<I18nItem> {
  let resolvedConfig: I18nAdapterConfig | undefined;
  let inferredNodes: Array<{ nodeKey: string; catalogKeys: string[] }> = [];
  let disposed = false;

  return {
    name: I18N_ADAPTER_NAME,

    async precheck(config: Record<string, unknown>): Promise<void> {
      await Promise.resolve();
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new I18nAdapterError({
          code: 'config_invalid',
          message: `PRD-207-R2: precheck — config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
    },

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      const validator = loadConfigValidator();
      if (!validator(config)) {
        throw new I18nAdapterError({
          code: 'config_invalid',
          message: `PRD-207-R2/R14: config schema invalid: ${ajvErrorsToString(validator.errors)}`,
        });
      }
      const cfg = config as unknown as I18nAdapterConfig;

      // PRD-207-R16 — Plus-only refusal at non-Plus targets.
      if (ctx.targetLevel !== 'strict') {
        throw new I18nAdapterError({
          code: 'level_mismatch',
          message: `PRD-207-R16: act-i18n requires targetLevel "strict" (PRD-107-R10); got "${ctx.targetLevel}"`,
        });
      }

      // PRD-207-R13 — locale normalization.
      cfg.locales.default = normalizeLocale(cfg.locales.default, (m) =>
        ctx.logger.warn(m),
      );
      cfg.locales.available = cfg.locales.available.map((l) =>
        normalizeLocale(l, (m) => ctx.logger.warn(m)),
      );
      // dedupe-by-identity post-normalization (e.g., en_US + en-US collapse).
      const seen = new Set<string>();
      cfg.locales.available = cfg.locales.available.filter((l) => {
        if (seen.has(l)) return false;
        seen.add(l);
        return true;
      });

      // PRD-104-R3 — default MUST appear in available.
      if (!cfg.locales.available.includes(cfg.locales.default)) {
        throw new I18nAdapterError({
          code: 'config_invalid',
          message: `PRD-207-R2/PRD-104-R3: locales.default '${cfg.locales.default}' must be present in locales.available [${cfg.locales.available.join(', ')}]`,
        });
      }

      // PRD-207-R14 — single-locale build is degenerate for Plus i18n.
      if (cfg.locales.available.length < 2) {
        throw new I18nAdapterError({
          code: 'config_invalid',
          message: `PRD-207-R14: act-i18n requires at least 2 locales in locales.available (PRD-107-R10); got ${String(cfg.locales.available.length)}`,
        });
      }

      // PRD-207-R14 — fallback chain validation post-normalization.
      if (cfg.locales.fallback_chain) {
        const normChain: Record<string, string[]> = {};
        for (const [target, chain] of Object.entries(cfg.locales.fallback_chain)) {
          const normTarget = normalizeLocale(target, (m) => ctx.logger.warn(m));
          if (!cfg.locales.available.includes(normTarget)) {
            throw new I18nAdapterError({
              code: 'config_invalid',
              message: `PRD-207-R14: fallback_chain key '${target}' (normalized '${normTarget}') is not in locales.available`,
            });
          }
          const normEntries: string[] = [];
          for (const c of chain) {
            const norm = normalizeLocale(c, (m) => ctx.logger.warn(m));
            if (!cfg.locales.available.includes(norm)) {
              throw new I18nAdapterError({
                code: 'config_invalid',
                message: `PRD-207-R14: fallback_chain.${target} references locale '${c}' not in locales.available`,
              });
            }
            normEntries.push(norm);
          }
          normChain[normTarget] = normEntries;
        }
        cfg.locales.fallback_chain = normChain;
      }

      // PRD-207-R14 — messagesDir must exist (skipped when caller supplies
      // an in-memory override; tests use that escape hatch).
      if (!opts.catalogsOverride) {
        const stat = await fs.stat(cfg.messagesDir).catch(() => null);
        if (!stat?.isDirectory()) {
          throw new I18nAdapterError({
            code: 'config_invalid',
            message: `PRD-207-R14: messagesDir '${cfg.messagesDir}' does not exist or is not a directory`,
          });
        }
      }

      // PRD-207 (autonomous) — auto-detect.
      if (cfg.autoDetect === true && !opts.catalogsOverride) {
        const det = await detectLibraryLayout(
          cfg.messagesDir,
          cfg.library,
          cfg.locales.default,
        );
        if (!det.detected) {
          ctx.logger.warn(`PRD-207 autoDetect: ${det.reason}`);
        } else {
          ctx.logger.info(`PRD-207 autoDetect: ${det.reason}`);
          // Surface namespaces for i18next when not explicitly configured.
          if (
            cfg.library === 'i18next'
            && det.namespaces
            && det.namespaces.length > 0
            && (cfg.library_options?.namespaces === undefined
              || cfg.library_options.namespaces.length === 0)
          ) {
            cfg.library_options = {
              ...(cfg.library_options ?? {}),
              namespaces: det.namespaces,
            };
          }
        }
      }

      resolvedConfig = cfg;

      // PRD-207-R15 — capability declaration.
      return {
        level: 'strict',
        concurrency_max: I18N_DEFAULT_CONCURRENCY,
        delta: false,
        // PRD-207-R15: critical — bind to primary adapter's IDs verbatim.
        namespace_ids: false,
        // PRD-207-R6/R15: never override primary scalars.
        precedence: 'fallback',
        manifestCapabilities: {},
      };
    },

    async *enumerate(ctx: AdapterContext): AsyncIterable<I18nItem> {
      const cfg = expectConfig(resolvedConfig);

      // Load catalogs once per build (PRD-207-R3 / R9).
      const catalogs: Map<string, FlatCatalog> =
        opts.catalogsOverride ?? new Map<string, FlatCatalog>();
      if (!opts.catalogsOverride) {
        for (const locale of cfg.locales.available) {
          if (ctx.signal.aborted) return;
          const cat = await loadLocaleCatalog(cfg, locale);
          if (cat === null) {
            ctx.logger.warn(
              `PRD-207-R9: catalog file for locale '${locale}' missing; no partials emitted for this locale`,
            );
            continue;
          }
          catalogs.set(locale, cat);
        }
      }

      // Infer node identities. v0.1 default: each catalog key in the
      // *default* locale's catalog is one node (i.e., node-level == key-level
      // for coverage purposes). Callers can supply explicit node groupings
      // via `nodeKeysOverride`; for i18next the natural unit is a namespace,
      // so when `library === 'i18next'` and no override is set, the adapter
      // groups keys by their leading namespace segment.
      const explicit = opts.nodeKeysOverride ?? [];
      if (explicit.length > 0) {
        inferredNodes = explicit;
      } else {
        inferredNodes = inferNodesFromCatalogs(catalogs, cfg);
      }

      for (const locale of cfg.locales.available) {
        if (ctx.signal.aborted) return;
        // Compute the chain once per locale.
        const chain = cfg.locales.fallback_chain?.[locale]
          ?? [locale, cfg.locales.default];
        for (const node of inferredNodes) {
          const status = determineNodeStatus(locale, node.catalogKeys, catalogs, chain);
          // Cross-locale translations: dense form per PRD-207-R5.
          const bindingId = computeBindingId(node.nodeKey, locale, cfg);
          const translations: Array<{ locale: string; id: string }> = [];
          for (const otherLocale of cfg.locales.available) {
            if (otherLocale === locale) continue;
            // Only enumerate locales that actually have a translation
            // for this node (PRD-207-R5 per Open Question 4).
            const otherCat = catalogs.get(otherLocale);
            if (!otherCat) continue;
            const hasAny = node.catalogKeys.some((k) => otherCat.has(k));
            if (!hasAny) continue;
            const xId = resolveCrossLocaleId(locale, bindingId, otherLocale, cfg, {
              warn: (m) => ctx.logger.warn(m),
            });
            if (xId !== null) translations.push({ locale: otherLocale, id: xId });
          }
          const item: I18nItem = {
            locale,
            bindingId,
            status: status.status,
            translations,
            catalogKey: node.nodeKey,
          };
          if (status.fallback_from) item.fallback_from = status.fallback_from;
          yield item;
        }
      }
    },

    transform(
      item: I18nItem,
      _ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const cfg = expectConfig(resolvedConfig);
      return Promise.resolve(transformItem(item, cfg));
    },

    dispose(_ctx: AdapterContext): void {
      if (disposed) return;
      disposed = true;
      // No file handles held open across enumerate boundaries; nothing to release.
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectConfig(cfg: I18nAdapterConfig | undefined): I18nAdapterConfig {
  if (!cfg) {
    throw new I18nAdapterError({
      code: 'config_invalid',
      message: 'PRD-207: adapter used before init',
    });
  }
  return cfg;
}

/**
 * Infer node identities from the loaded catalogs.
 *
 *  - i18next: group keys by their leading namespace segment. Each
 *    namespace becomes one node; the node's catalogKeys are every key
 *    under that namespace seen in the *default* catalog.
 *  - next-intl / react-intl: each top-level key in the *default* catalog
 *    is one node. (Authors group by ID-shaped keys; sub-keys stay in the
 *    same node.)
 *
 * The default-locale catalog is the source of truth for what nodes exist;
 * other locales are evaluated against the same node set.
 */
function inferNodesFromCatalogs(
  catalogs: Map<string, FlatCatalog>,
  cfg: I18nAdapterConfig,
): Array<{ nodeKey: string; catalogKeys: string[] }> {
  const def = catalogs.get(cfg.locales.default);
  if (!def) return [];
  const groups = new Map<string, string[]>();
  for (const key of def.keys()) {
    let nodeKey: string;
    if (cfg.library === 'i18next') {
      // First dotted segment is the namespace.
      const idx = key.indexOf('.');
      nodeKey = idx === -1 ? key : key.slice(0, idx);
    } else {
      // First dotted segment groups sibling sub-keys into one node.
      const idx = key.indexOf('.');
      nodeKey = idx === -1 ? key : key.slice(0, idx);
    }
    const list = groups.get(nodeKey) ?? [];
    list.push(key);
    groups.set(nodeKey, list);
  }
  const out: Array<{ nodeKey: string; catalogKeys: string[] }> = [];
  for (const [nodeKey, catalogKeys] of groups) out.push({ nodeKey, catalogKeys });
  // Deterministic emit order (PRD-200-R6 spirit; aids fixture diffing).
  out.sort((a, b) => (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0));
  return out;
}

/**
 * PRD-207-R4 — produce a partial node strictly under `metadata.*`.
 *
 *  - `metadata.locale` only when Pattern 1 (Pattern 2's per-locale manifest
 *    carries the locale).
 *  - `metadata.translations` only when Pattern 1 AND non-empty.
 *  - `metadata.fallback_from` only when status === "fallback".
 *  - `metadata.source` always (PRD-207-R17 provenance).
 */
function transformItem(
  item: I18nItem,
  cfg: I18nAdapterConfig,
): PartialEmittedNode {
  const isPattern2 = cfg.idTransform?.pattern === 2;
  const metadata: Record<string, unknown> = {};
  if (!isPattern2) metadata['locale'] = item.locale;
  metadata['translation_status'] = item.status;
  if (item.fallback_from !== undefined) metadata['fallback_from'] = item.fallback_from;
  if (!isPattern2 && item.translations.length > 0) {
    metadata['translations'] = item.translations;
  }
  metadata['source'] = {
    adapter: I18N_ADAPTER_NAME,
    source_id: `${item.locale}:${item.catalogKey}`,
  };
  return {
    id: item.bindingId,
    _actPartial: true,
    metadata,
  };
}

/** @internal — exposed for tests asserting BCP-47 pattern parity. */
export const _BCP47_SUBSET_RE_FOR_TEST = BCP47_SUBSET_RE;

/** @internal — exposed for tests covering the inference helper. */
export function _inferNodesFromCatalogsForTest(
  catalogs: Map<string, FlatCatalog>,
  cfg: I18nAdapterConfig,
): Array<{ nodeKey: string; catalogKeys: string[] }> {
  return inferNodesFromCatalogs(catalogs, cfg);
}

/** @internal — exposed for tests that want to assert library detection. */
export function _isSupportedLibrary(name: string): name is I18nLibrary {
  return name === 'next-intl' || name === 'react-intl' || name === 'i18next';
}

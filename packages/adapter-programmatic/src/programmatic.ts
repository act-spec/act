/**
 * PRD-208 programmatic adapter — escape-hatch factory.
 *
 * Wraps user-supplied lifecycle functions (`enumerate`, `transform`, optional
 * `precheck` / `init` / `delta` / `dispose`) into a fully
 * `@act-spec/adapter-framework` `Adapter`. Every PRD-208-R{n} requirement is
 * either implemented here or in a function it calls. The factory is
 * intentionally small — most of the behavior is the user's. The factory's job
 * is the wrapper invariants: pre-emit schema validation (PRD-208-R3),
 * mutation/re-entry guards (PRD-208-R4), lifecycle wrappers (PRD-208-R5),
 * source attribution (PRD-208-R9), capability sampling (PRD-208-R8), and the
 * recoverable / unrecoverable failure surfaces (PRD-208-R10/R11/R12).
 *
 * Library choices:
 *  - `ajv` (8.x, 2020-12) for JSON-Schema validation. Same major as
 *    `@act-spec/validator`'s ajv (PRD-600); kept as a direct dep so the
 *    factory can compile both the node envelope and every PRD-102 block
 *    schema without reaching into validator internals (constraint: do not
 *    reshape `@act-spec/validator`).
 *  - Schema files loaded from the repo root's `schemas/` tree at module load
 *    via `findRepoRoot` — same anchor strategy as `@act-spec/validator`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** PRD-208-R1 — default `spec.name` when caller omits it. */
export const PROGRAMMATIC_ADAPTER_DEFAULT_NAME = 'programmatic' as const;

/** PRD-208-R8 — default sampling cadence. */
export const PROGRAMMATIC_ADAPTER_DEFAULT_SAMPLE_EVERY = 20 as const;

/**
 * PRD-100-R21 / PRD-100-R23 — extractive `summary` helper for programmatic
 * adapters whose source rows ship with body text but no author-written
 * summary. Strips HTML comments and inline markdown emphasis, picks the
 * first non-empty sentence (`.!?` boundary), and clamps to `maxTokens`
 * whitespace tokens (default 50, matching the SHOULD ceiling on index
 * summaries). Returns the original text trimmed when no sentence boundary
 * is found.
 *
 * The helper is **opt-in**: programmatic adapters that own their summary
 * field (most catalogs, most CMS feeds with a `subtitle` column) should
 * use it; adapters whose bodies are markup-heavy (HTML, MDX) should
 * sanitize first.
 *
 * Usage:
 * ```ts
 * import { extractFirstSentence } from '@act-spec/adapter-programmatic';
 *
 * const summary = row.summary ?? extractFirstSentence(row.body);
 * ```
 */
export function extractFirstSentence(text: string, maxTokens = 50): string {
  const collapsed = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Strip inline markdown emphasis markers (bold/italic, inline code,
    // links). Heading hashes are kept as-is — the first paragraph rarely
    // starts with `#` and stripping them would also eat `#hashtag` text.
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/__?([^_]+)__?/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length === 0) return '';
  // Pick the first sentence (greedy through ., !, ? followed by space or
  // end-of-string). Falls through to the whole collapsed text when no
  // boundary matches.
  const match = /^.*?[.!?](?:\s|$)/.exec(collapsed);
  const candidate = match !== null ? match[0].trim() : collapsed;
  return clampWords(candidate, maxTokens);
}

function clampWords(text: string, maxTokens: number): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '';
  if (words.length <= maxTokens) return words.join(' ');
  // Ellipsis costs one token; budget = maxTokens - 1 words + ellipsis.
  return `${words.slice(0, Math.max(0, maxTokens - 1)).join(' ')} …`;
}

/** PRD-208-R12 / R11 — closed set of error codes the factory throws. */
export type ProgrammaticAdapterErrorCode =
  | 'enumerate_threw'
  | 'init_threw'
  | 'precheck_threw'
  | 'transform_threw_strict'
  | 'transform_invalid_return'
  | 'transform_malformed_node'
  | 'transform_malformed_block'
  | 'transform_id_grammar'
  | 'config_mutation'
  | 'validator_internal_error';

/**
 * PRD-208-R12 — typed error thrown by the factory for every unrecoverable
 * failure. `code` is one of the documented values; `message` cites the
 * relevant requirement and (when available) the offending node `id` and
 * block index.
 */
export class ProgrammaticAdapterError extends Error {
  public readonly code: ProgrammaticAdapterErrorCode;
  constructor(opts: { code: ProgrammaticAdapterErrorCode; message: string }) {
    super(opts.message);
    this.name = 'ProgrammaticAdapterError';
    this.code = opts.code;
  }
}

// --------------------------------------------------------------------------
// Spec shape
// --------------------------------------------------------------------------

/**
 * PRD-208-R2 — the user-supplied factory spec. `TItem` flows from
 * `enumerate` → `transform` so the user keeps full type safety on their
 * source items. `TConfig` is a documentary generic on the spec; the
 * underlying `AdapterContext.config` is `Record<string, unknown>` per
 * PRD-200's framework.
 */
export interface ProgrammaticAdapterSpec<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TItem = unknown,
> {
  /** PRD-208-R1 — adapter identity; default `"programmatic"`. */
  name?: string;
  /** PRD-208-R5 — optional fast preflight. */
  precheck?: (config: TConfig) => void | Promise<void>;
  /** PRD-208-R5 / R13 — when present, return value is the declared capabilities. */
  init?: (config: TConfig, ctx: AdapterContext) => AdapterCapabilities | Promise<AdapterCapabilities>;
  /** PRD-208-R5 — yields opaque source items. Sync iterable, array, and async iterable all accepted. */
  enumerate: (ctx: AdapterContext) => AsyncIterable<TItem> | Iterable<TItem> | TItem[];
  /** PRD-208-R5 — per-item transform. `null` is a deliberate skip per PRD-200-R5. */
  transform: (
    item: TItem,
    ctx: AdapterContext,
  ) => EmittedNode | PartialEmittedNode | null | Promise<EmittedNode | PartialEmittedNode | null>;
  /** PRD-208-R5 — optional incremental enumeration. */
  delta?: (since: string, ctx: AdapterContext) => AsyncIterable<TItem> | Iterable<TItem> | TItem[];
  /** PRD-208-R5 — optional resource cleanup. Wrapped to be idempotent (PRD-200-R7). */
  dispose?: (ctx: AdapterContext) => void | Promise<void>;
  /** PRD-208-R13 — declared capabilities; `init` overrides if supplied. */
  capabilities?: AdapterCapabilities;
  /** PRD-208-R10 — promote `transform` throws to unrecoverable. Default `false`. */
  strict?: boolean;
  /** PRD-208-R7 — namespace ids by default; `false` opts out. */
  namespaceIds?: boolean;
  /** PRD-208-R3 — `"before-emit"` (default) runs full validation; `"off"` opts out with a warning. */
  validate?: 'before-emit' | 'off';
  /** PRD-208-R8 — sample-every-Nth-emission cadence. Default 20. */
  capabilitySampleEvery?: number;
}

/**
 * PRD-208 implementation note 6 — convenience wrapper for the static-array
 * case. Open question 1 (resolved 2026-05-01): documented convenience, not
 * a separate normative API.
 */
export interface SimpleAdapterSpec<TItem> {
  name?: string;
  items: TItem[];
  transform: (
    item: TItem,
    ctx: AdapterContext,
  ) => EmittedNode | PartialEmittedNode | null | Promise<EmittedNode | PartialEmittedNode | null>;
  capabilities?: AdapterCapabilities;
  strict?: boolean;
  namespaceIds?: boolean;
  validate?: 'before-emit' | 'off';
}

// --------------------------------------------------------------------------
// Schema loading (mirrors @act-spec/validator's anchor strategy)
// --------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));

/** @internal — exported only so the unhappy path is unit-testable. */
export function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    const cand = path.join(dir, 'schemas');
    try {
      if (statSync(cand).isDirectory()) return dir;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `programmatic-adapter: could not locate repo root with a 'schemas/' directory starting from ${start}`,
  );
}

const REPO_ROOT = findRepoRoot(here);
const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas');

interface RawSchema {
  $id?: string;
  [k: string]: unknown;
}

function readAllSchemas(): RawSchema[] {
  const out: RawSchema[] = [];
  for (const series of readdirSync(SCHEMAS_DIR)) {
    if (!/^\d{3}$/.test(series)) continue;
    const seriesDir = path.join(SCHEMAS_DIR, series);
    for (const file of readdirSync(seriesDir).filter((f) => f.endsWith('.schema.json'))) {
      out.push(JSON.parse(readFileSync(path.join(seriesDir, file), 'utf8')) as RawSchema);
    }
  }
  return out;
}

type Ajv2020Ctor = new (opts?: Record<string, unknown>) => AjvType;
type AddFormats = (ajv: AjvType) => unknown;
const Ajv2020 = Ajv2020Module as unknown as Ajv2020Ctor;
const addFormats = addFormatsModule as unknown as AddFormats;

/**
 * PRD-208-R3 — compiled validator bundle. Lazily initialized; the
 * compilation is non-trivial and the validators are hot inside a fixture
 * sweep.
 */
interface CompiledFactoryValidators {
  node: ValidateFunction;
  blockMarkdown: ValidateFunction;
  blockProse: ValidateFunction;
  blockCode: ValidateFunction;
  blockData: ValidateFunction;
  blockCallout: ValidateFunction;
  blockMarketing: ValidateFunction;
}

let cached: CompiledFactoryValidators | undefined;

/**
 * @internal — exposed for tests that want to reset the lazy singleton
 * (e.g., to assert the unhappy-init path).
 */
export function _resetValidatorCacheForTest(): void {
  cached = undefined;
}

function loadFactoryValidators(): CompiledFactoryValidators {
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const schema of readAllSchemas()) {
    if (typeof schema.$id === 'string') ajv.addSchema(schema);
  }
  const ID = (name: string): string => `https://act-spec.org/schemas/0.1/${name}.schema.json`;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const get = (id: string): ValidateFunction => ajv.getSchema(id)!;
  cached = {
    node: get(ID('node')),
    blockMarkdown: get(ID('block-markdown')),
    blockProse: get(ID('block-prose')),
    blockCode: get(ID('block-code')),
    blockData: get(ID('block-data')),
    blockCallout: get(ID('block-callout')),
    blockMarketing: get(ID('block-marketing-namespace')),
  };
  return cached;
}

/** PRD-100-R10 — node id grammar (mirrors `schemas/100/node.schema.json`). */
const ID_GRAMMAR = /^[a-z0-9]([a-z0-9._\-/])*[a-z0-9](@[a-z0-9-]+)?$/;

function ajvErrorsToString(errors: readonly ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return '<no detail>';
  return errors
    .map((e) => `${e.instancePath || '/'} ${e.message ?? '<no message>'}`)
    .join('; ');
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * PRD-208-R1 — turn a user-supplied spec into a PRD-200-R1 `Adapter`.
 */
export function defineProgrammaticAdapter<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TItem = unknown,
>(spec: ProgrammaticAdapterSpec<TConfig, TItem>): Adapter<TItem> {
  if (typeof spec.enumerate !== 'function' || typeof spec.transform !== 'function') {
    throw new ProgrammaticAdapterError({
      code: 'transform_invalid_return',
      message:
        'PRD-208-R2: spec must supply both `enumerate` and `transform` functions',
    });
  }

  const name = spec.name ?? PROGRAMMATIC_ADAPTER_DEFAULT_NAME;
  const sampleEvery = spec.capabilitySampleEvery ?? PROGRAMMATIC_ADAPTER_DEFAULT_SAMPLE_EVERY;
  const validateMode: 'before-emit' | 'off' = spec.validate ?? 'before-emit';
  const namespaceIdsValue: boolean = spec.namespaceIds ?? true;

  let disposed = false;
  let itemIndex = 0;
  let declaredLevel: 'core' | 'standard' | 'strict' = 'core';

  // Capture spec callbacks in narrowed locals so the methods below avoid
  // non-null assertions and `unbound-method` warnings.
  const userPrecheck = spec.precheck;
  const userDelta = spec.delta;

  const adapter: Adapter<TItem> = {
    name,

    // PRD-208-R5 — precheck wrapper. Only present when user supplied one.
    ...(userPrecheck
      ? {
          precheck: async (config: Record<string, unknown>): Promise<void> => {
            try {
              await userPrecheck(config as TConfig);
            } catch (err) {
              throw new ProgrammaticAdapterError({
                code: 'precheck_threw',
                message: `PRD-208-R12: programmatic precheck threw: ${(err as Error).message}`,
              });
            }
          },
        }
      : {}),

    async init(
      config: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<AdapterCapabilities> {
      // PRD-208-R3 / "off" surface — emit init-time warning when the
      // operator opts out of pre-emit schema validation.
      if (validateMode === 'off') {
        ctx.logger.warn(
          'PRD-208-R3: `validate: "off"` opts out of pre-emit PRD-100 + PRD-102 schema validation; the operator accepts the risk of malformed envelopes',
        );
      }

      let caps: AdapterCapabilities;
      if (spec.init) {
        try {
          caps = await spec.init(config as TConfig, ctx);
        } catch (err) {
          throw new ProgrammaticAdapterError({
            code: 'init_threw',
            message: `PRD-208-R12: programmatic init threw: ${(err as Error).message}`,
          });
        }
      } else if (spec.capabilities) {
        caps = spec.capabilities;
      } else {
        // PRD-208-R13 — default factory capabilities.
        caps = {
          level: 'core',
          concurrency_max: 8,
          namespace_ids: namespaceIdsValue,
        };
      }

      declaredLevel = caps.level;

      // PRD-208-R7 — operator-passed `namespaceIds` overrides the caps
      // value if the spec explicitly set it; otherwise honor caps (default
      // true). The framework reads `namespace_ids` off the returned caps.
      const finalCaps: AdapterCapabilities = {
        ...caps,
        namespace_ids: spec.namespaceIds ?? caps.namespace_ids ?? true,
      };
      return finalCaps;
    },

    // PRD-208-R5 — enumerate wrapper. Tolerates AsyncIterable, Iterable,
    // and Array; normalizes to AsyncIterable. Errors are unrecoverable per
    // PRD-208-R12.
    async *enumerate(ctx: AdapterContext): AsyncIterable<TItem> {
      let out: AsyncIterable<TItem> | Iterable<TItem> | TItem[];
      try {
        out = spec.enumerate(ctx);
      } catch (err) {
        throw new ProgrammaticAdapterError({
          code: 'enumerate_threw',
          message: `PRD-208-R12: programmatic enumerate threw synchronously: ${(err as Error).message}`,
        });
      }
      try {
        if (Array.isArray(out)) {
          for (const item of out) yield item;
        } else if (typeof (out as AsyncIterable<TItem>)[Symbol.asyncIterator] === 'function') {
          yield* out as AsyncIterable<TItem>;
        } else if (typeof (out as Iterable<TItem>)[Symbol.iterator] === 'function') {
          yield* out as Iterable<TItem>;
        } else {
          throw new Error(
            `PRD-208-R5: programmatic enumerate returned a value that is neither an array nor an iterable (got ${typeof out})`,
          );
        }
      } catch (err) {
        if (err instanceof ProgrammaticAdapterError) throw err;
        throw new ProgrammaticAdapterError({
          code: 'enumerate_threw',
          message: `PRD-208-R12: programmatic enumerate iterator threw: ${(err as Error).message}`,
        });
      }
    },

    async transform(
      item: TItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      const i = itemIndex++;

      // PRD-208-R4 — freeze ctx.config before passing to user code. This
      // is a defense-in-depth control (per security § "Frozen ctx.config");
      // operators who mutate via the proxy get a TypeError they can fix.
      const frozenConfig = Object.freeze({ ...ctx.config });
      const frozenCtx: AdapterContext = { ...ctx, config: frozenConfig };

      let result: EmittedNode | PartialEmittedNode | null;
      try {
        result = await spec.transform(item, frozenCtx);
      } catch (err) {
        // PRD-208-R4 — surface a config-mutation attempt as its own code.
        if (err instanceof TypeError && /read[- ]?only|cannot assign|object is not extensible/i.test(String(err.message))) {
          throw new ProgrammaticAdapterError({
            code: 'config_mutation',
            message: `PRD-208-R4: programmatic transform attempted to mutate ctx.config (frozen): ${err.message}`,
          });
        }
        if (spec.strict === true) {
          throw new ProgrammaticAdapterError({
            code: 'transform_threw_strict',
            message: `PRD-208-R10/R12: programmatic transform threw under strict mode at item ${i}: ${(err as Error).message}`,
          });
        }
        // PRD-208-R11 — recoverable: emit placeholder.
        return placeholder(name, i, err as Error, ctx);
      }

      // PRD-200-R5 — null is a deliberate skip; framework records.
      if (result === null) return null;

      // PRD-208-R12 — non-object / non-null return is unrecoverable.
      if (typeof result !== 'object') {
        throw new ProgrammaticAdapterError({
          code: 'transform_invalid_return',
          message: `PRD-208-R12: programmatic transform returned ${typeof result} at item ${i}; expected EmittedNode | PartialEmittedNode | null`,
        });
      }

      // PRD-208-R7 / R12 — id grammar. Applies to both full and partial
      // emissions; the framework will namespace later, but the grammar of
      // the user-supplied id MUST already pass PRD-100-R10. Run BEFORE
      // envelope validation so PRD-208-R7's specific error code surfaces
      // (the envelope schema's id regex would otherwise route to
      // transform_malformed_node, masking the more specific cause).
      const id = (result as { id?: unknown }).id;
      if (typeof id !== 'string' || !ID_GRAMMAR.test(id)) {
        throw new ProgrammaticAdapterError({
          code: 'transform_id_grammar',
          message: `PRD-208-R7/R12: programmatic transform emitted id ${JSON.stringify(id)} that fails PRD-100-R10 grammar`,
        });
      }

      // PRD-208-R3 — pre-emit validation (envelope + per-block).
      if (validateMode !== 'off') validateBeforeEmit(result, i);

      // PRD-208-R9 — source attribution.
      stampProgrammaticSource(result, name, i, ctx);

      // PRD-208-R8 — capability sampling probe (sample at index 0 then
      // every Nth emission). Skip on partials (they don't carry full
      // content yet).
      const isPartial = (result as PartialEmittedNode)._actPartial === true;
      if (!isPartial && i % sampleEvery === 0) {
        probeLevel(result as EmittedNode, declaredLevel, ctx);
      }

      return result;
    },

    // PRD-208-R5 — delta wrapper (only present when user supplied one).
    ...(userDelta
      ? {
          delta: async function* (since: string, ctx: AdapterContext): AsyncGenerator<TItem> {
            const out = userDelta(since, ctx);
            try {
              if (Array.isArray(out)) {
                for (const item of out) yield item;
              } else if (typeof (out as AsyncIterable<TItem>)[Symbol.asyncIterator] === 'function') {
                yield* out as AsyncIterable<TItem>;
              } else {
                yield* out as Iterable<TItem>;
              }
            } catch (err) {
              throw new ProgrammaticAdapterError({
                code: 'enumerate_threw',
                message: `PRD-208-R12: programmatic delta threw: ${(err as Error).message}`,
              });
            }
          },
        }
      : {}),

    async dispose(ctx: AdapterContext): Promise<void> {
      // PRD-208-R5 / PRD-200-R7 — idempotent. Call user's dispose at most once.
      if (disposed) return;
      disposed = true;
      if (spec.dispose) await spec.dispose(ctx);
    },
  };

  return adapter;
}

/**
 * PRD-208 implementation note 6 — `defineSimpleAdapter` convenience for the
 * static-array case. Same factory invariants apply.
 */
export function defineSimpleAdapter<TItem>(spec: SimpleAdapterSpec<TItem>): Adapter<TItem> {
  return defineProgrammaticAdapter<Record<string, unknown>, TItem>({
    ...(spec.name !== undefined ? { name: spec.name } : {}),
    enumerate: () => spec.items,
    transform: spec.transform,
    ...(spec.capabilities !== undefined ? { capabilities: spec.capabilities } : {}),
    ...(spec.strict !== undefined ? { strict: spec.strict } : {}),
    ...(spec.namespaceIds !== undefined ? { namespaceIds: spec.namespaceIds } : {}),
    ...(spec.validate !== undefined ? { validate: spec.validate } : {}),
  });
}

// --------------------------------------------------------------------------
// Helpers (exported for tests; not part of the documented surface)
// --------------------------------------------------------------------------

/**
 * PRD-208-R3 — validate the emitted node envelope and every content block
 * against its PRD-102 schema. Throws `ProgrammaticAdapterError` on the
 * first failure with a message citing the node id and (for blocks) the
 * block index. For partial emissions, validate only the id grammar (done
 * by the caller) plus per-block schemas when `content` is supplied.
 */
function validateBeforeEmit(
  node: EmittedNode | PartialEmittedNode,
  itemIndex: number,
): void {
  let validators: CompiledFactoryValidators;
  try {
    validators = loadFactoryValidators();
  } catch (err) {
    throw new ProgrammaticAdapterError({
      code: 'validator_internal_error',
      message: `PRD-208-R12: programmatic factory validator failed to initialize at item ${itemIndex}: ${(err as Error).message}`,
    });
  }

  const id = (node as { id?: unknown }).id;
  const idForLog = typeof id === 'string' ? id : `<item:${itemIndex}>`;
  const isPartial = (node as PartialEmittedNode)._actPartial === true;

  // PRD-208-R3 — full envelope validation only on full nodes; partials
  // skip envelope validation (other PRD-100-R21 fields fill in at merge).
  if (!isPartial) {
    const ok = validators.node(node);
    if (!ok) {
      throw new ProgrammaticAdapterError({
        code: 'transform_malformed_node',
        message: `PRD-208-R3/R12: programmatic transform returned malformed node id='${idForLog}': ${ajvErrorsToString(validators.node.errors)}`,
      });
    }
  }

  // PRD-208-R3 — per-block validation (full + partial when `content` present).
  const content = (node as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (let bi = 0; bi < content.length; bi += 1) {
      const block = content[bi] as { type?: unknown };
      const blockType = block?.type;
      const blockValidator = pickBlockValidator(validators, blockType);
      if (!blockValidator) {
        // PRD-102's discriminator is exhaustive at v0.1 — unknown type is
        // a closed-set rejection.
        throw new ProgrammaticAdapterError({
          code: 'transform_malformed_block',
          message: `PRD-208-R3/R12: programmatic transform emitted unknown block type ${JSON.stringify(blockType)} at node id='${idForLog}', block_index=${bi} (PRD-102 discriminator is exhaustive at v0.1)`,
        });
      }
      const ok = blockValidator(block);
      if (!ok) {
        throw new ProgrammaticAdapterError({
          code: 'transform_malformed_block',
          message: `PRD-208-R3/R12: programmatic transform emitted malformed block at node id='${idForLog}', block_index=${bi}, type=${JSON.stringify(blockType)}: ${ajvErrorsToString(blockValidator.errors)}`,
        });
      }
    }
  }
}

function pickBlockValidator(
  v: CompiledFactoryValidators,
  blockType: unknown,
): ValidateFunction | undefined {
  if (typeof blockType !== 'string') return undefined;
  if (blockType === 'markdown') return v.blockMarkdown;
  if (blockType === 'prose') return v.blockProse;
  if (blockType === 'code') return v.blockCode;
  if (blockType === 'data') return v.blockData;
  if (blockType === 'callout') return v.blockCallout;
  if (blockType.startsWith('marketing:')) return v.blockMarketing;
  return undefined;
}

/**
 * PRD-208-R9 — stamp `metadata.source.adapter` on the emitted node when the
 * user did not supply one. When the user supplied an `adapter` value that
 * differs from `spec.name`, log a warning but do NOT overwrite (per
 * PRD-208-R9: user wins; warning surfaces the smell).
 */
function stampProgrammaticSource(
  node: EmittedNode | PartialEmittedNode,
  name: string,
  itemIndex: number,
  ctx: AdapterContext,
): void {
  const meta =
    (node as { metadata?: unknown }).metadata && typeof (node as { metadata?: unknown }).metadata === 'object'
      ? ((node as { metadata: Record<string, unknown> }).metadata)
      : ({} as Record<string, unknown>);
  const source =
    meta['source'] && typeof meta['source'] === 'object'
      ? (meta['source'] as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  if (typeof source['adapter'] !== 'string') {
    source['adapter'] = name;
    const id = (node as { id?: unknown }).id;
    source['source_id'] = `${itemIndex}-${typeof id === 'string' ? id : 'item'}`;
  } else if (source['adapter'] !== name) {
    ctx.logger.warn(
      `PRD-208-R9: programmatic adapter '${name}' emitted a node whose metadata.source.adapter='${String(source['adapter'])}' differs from spec.name; the framework's metadata.source.contributors audit trail will reflect '${String(source['adapter'])}'`,
    );
  }
  meta['source'] = source;
  (node as { metadata: Record<string, unknown> }).metadata = meta;
}

/**
 * PRD-208-R11 — placeholder for recoverable `transform` throws. Carries
 * `extraction_status: "failed"` and a truncated error message so consumers
 * can spot the gap; the framework's `runAdapter` lifts it into the
 * warnings list per PRD-200-R16.
 */
function placeholder(
  name: string,
  itemIndex: number,
  err: Error,
  ctx: AdapterContext,
): EmittedNode {
  ctx.logger.warn(
    `PRD-208-R11: programmatic transform threw at item ${itemIndex}: ${err.message} (recoverable; emitting placeholder)`,
  );
  const msg = err.message;
  return {
    act_version: typeof ctx.actVersion === 'string' ? ctx.actVersion : '0.1',
    id: `${name}/__placeholder__/${itemIndex}`,
    type: 'article',
    title: `(extraction failed at item ${itemIndex})`,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary: '(extraction failed; placeholder)',
    content: [],
    tokens: { summary: 4 },
    metadata: {
      extraction_status: 'failed',
      extraction_error: msg.length > 500 ? `${msg.slice(0, 497)}...` : msg,
      source: { adapter: name, source_id: `${itemIndex}-failed` },
    },
  };
}

/**
 * PRD-208-R8 — sample-probe: warn when the declared level is inconsistent
 * with the emitted block types. Sample only; PRD-600 owns the exhaustive
 * probe across the corpus.
 */
function probeLevel(
  node: EmittedNode,
  declared: 'core' | 'standard' | 'strict',
  ctx: AdapterContext,
): void {
  const blocks = Array.isArray(node.content) ? node.content : [];
  let firstMarketing: string | undefined;
  let firstNonMarkdown: string | undefined;
  for (const b of blocks) {
    const t = (b as { type?: unknown }).type;
    if (typeof t !== 'string') continue;
    if (t.startsWith('marketing:')) {
      if (firstMarketing === undefined) firstMarketing = t;
    } else if (t !== 'markdown') {
      if (firstNonMarkdown === undefined) firstNonMarkdown = t;
    }
  }

  if (declared === 'core' && (firstMarketing !== undefined || firstNonMarkdown !== undefined)) {
    const offending = firstMarketing ?? firstNonMarkdown ?? '<unknown>';
    ctx.logger.warn(
      `PRD-208-R8 / PRD-107-R14: programmatic capability sampling — declared level 'core' but emitted '${offending}' block at node id='${node.id}'`,
    );
  } else if (declared === 'standard' && firstMarketing !== undefined) {
    ctx.logger.warn(
      `PRD-208-R8 / PRD-107-R14: programmatic capability sampling — declared level 'standard' but emitted '${firstMarketing}' block at node id='${node.id}'`,
    );
  }
}

/**
 * PRD-206 Builder.io adapter — public + internal type surface.
 *
 * Every exported type cites a PRD-206-R{n} requirement. Mirrors PRD-206's
 * §"Wire format / interface definition" so user-facing config is stable
 * across the implementation file split.
 */

/**
 * PRD-206-R2 — config schema (TypeScript projection).
 */
export interface BuilderAdapterConfig {
  /** Builder.io PUBLIC read key (string OR `{ from_env: "<NAME>" }` reference). */
  apiKey: string | { from_env: string };
  /** Builder.io models to include (e.g. `["page", "section", "symbol"]`). */
  models: string[];
  /** Default `"extraction"`. */
  mode?: 'pass-through' | 'extraction';
  /** Default `"published"`. */
  version?: 'published' | 'draft';
  /** Builder query parameters (`urlPath`, `userAttributes`, etc.). */
  query?: Record<string, unknown>;
  /** Builder model name → ACT type. */
  typeMapping?: Record<string, string>;
  /** Field-level mapping. Defaults documented in PRD-206-R8 table. */
  fieldMapping?: {
    title?: string;
    summary?: string;
    abstract?: string;
    body?: string;
    tags?: string;
    related?: Record<string, string /* relation */>;
    [actField: string]: unknown;
  };
  /** Override default ID derivation; default looks up `data.url` then content `id`. */
  idField?: string;
  /** Range 0–3. Default 1. */
  referenceDepth?: number;
  /** Builder component name → marketing:* mapping (extraction mode only, Plus). */
  componentMapping?: Record<
    string,
    { type: string; fields: Record<string, unknown> }
  >;
  /** Range 1–3. Default 3. */
  symbolRecursionMax?: number;
  /** Locale config (Plus); enables Builder targeting fan-out. */
  locale?: { locales: string[]; defaultLocale: string };
  /** `"skip"` (default) or `"emit"` for variant nodes per PRD-206-R18. */
  experiments?: 'skip' | 'emit';
  /** Webhook secret (used by external receiver via `verifyWebhookSignature`). */
  webhookSecret?: string;
  /** Summary strategy. */
  summary?: { strategy: 'field' | 'extract' | 'needs-llm' };
  /** Concurrency cap. */
  concurrency?: { transform?: number };
  /** ID namespace prefix (default `"act-builderio"`). */
  namespace?: string;
  /** When the configured filter returns 0 entries, suppress the warning. */
  allowEmpty?: boolean;
  /** Threshold above which the per-page coverage warning fires. Default 0.5. */
  unmappedComponentWarningThreshold?: number;
  /** Debug log key fingerprint (PRD-206-R26). */
  debugLogging?: boolean;
}

// ---------------------------------------------------------------------------
// Builder.io content shapes (loose / structural — no SDK dep)
// ---------------------------------------------------------------------------

/**
 * PRD-206-R10 / R8 — A normalized Builder content entry. The Builder Content
 * API returns entries with stable top-level fields (`id`, `name`, `data`,
 * `lastUpdated`, `published`, `variations`/`variants`) plus arbitrary user
 * data nested under `data`. The adapter consumes this shape directly without
 * an SDK dependency: the Builder Content API JSON is structural.
 */
export interface BuilderContent {
  /** Builder content stable identifier (used for `source_id`). */
  id: string;
  /** Builder content human-readable name (used as default `title`). */
  name?: string;
  /** Builder model name (e.g., `"page"`, `"section"`, `"symbol"`). */
  modelName?: string;
  /** Last-modified timestamp in Builder's native shape (epoch ms). */
  lastUpdated?: number;
  /** Publication state; `"published"` or `"draft"`. */
  published?: 'published' | 'draft';
  /** Per-variant content arms (Builder A/B test surface). */
  variations?: Record<string, BuilderVariation>;
  /** Locale targeting selectors (Builder targeting key/value tuples). */
  query?: Array<{ property: string; operator: string; value: unknown }>;
  /** The user-defined content data (blocks, references, metadata). */
  data?: BuilderContentData;
  /** Locale this content was fetched as (synthesized by the adapter). */
  __locale?: string;
}

/** A Builder.io variation (a/b test arm). */
export interface BuilderVariation {
  id?: string;
  name?: string;
  data?: BuilderContentData;
}

/**
 * The user-defined content `data` field. Builder pages carry an array of
 * `blocks` (the component tree) plus arbitrary user metadata fields
 * (`url`, `description`, `tags`, `references`, etc.).
 */
export interface BuilderContentData {
  blocks?: BuilderBlock[];
  url?: string;
  description?: string;
  abstract?: string;
  tags?: string[];
  references?: BuilderReference[];
  locale?: string;
  [field: string]: unknown;
}

/**
 * One node in the Builder component tree. Builder represents components as
 * `{ '@type': '@builder.io/sdk:Element', component: { name, options }, children?: [...] }`.
 * Symbol blocks additionally carry `symbol: { entry, model, data: { blocks } }`.
 */
export interface BuilderBlock {
  '@type'?: string;
  id?: string;
  component?: {
    name?: string;
    options?: Record<string, unknown>;
  };
  children?: BuilderBlock[];
  responsiveStyles?: Record<string, unknown>;
  /** Symbol payload (only present for `Symbol` components). */
  symbol?: {
    entry?: string;
    model?: string;
    data?: { blocks?: BuilderBlock[]; [k: string]: unknown };
  };
  [other: string]: unknown;
}

/**
 * A Builder.io reference. Builder's `references` field is an array of
 * `{ '@type': '@builder.io/core:Reference', model, id }` (or, in some
 * envelope variants, simply `{ model, id }`).
 */
export interface BuilderReference {
  '@type'?: string;
  model?: string;
  id?: string;
}

/** Recorded Builder.io Content-API corpus — the test/fixture path. */
export interface BuilderSourceCorpus {
  /** Per Builder model name → list of Builder content entries. */
  contentByModel: Record<string, BuilderContent[]>;
  /** Per locale → per model → list of Builder content entries (locale fan-out). */
  contentByLocale?: Record<string, Record<string, BuilderContent[]>>;
  /** Probe response for `init` (default `'ok'`). */
  authProbe?: 'ok' | 'unauthorized';
  /** Per-key kind probe (default `'public'`). */
  keyKindProbe?: 'public' | 'private' | 'unknown';
  /** Per-model 404 list (used to test PRD-206-R5 unrecoverable failure). */
  unknownModels?: string[];
  /** Optional precomputed delta cursor (Builder `lastUpdated` epoch ms). */
  latestUpdatedAt?: string;
  /** Force HTTP 429 exhausted on a specific content id (R24 negative path). */
  rateLimitedIds?: string[];
}

/** PRD-206 — opaque source item flowing enumerate → transform. */
export interface BuilderItem {
  content: BuilderContent;
  /** Resolved locale per PRD-206-R17; null when locale config absent. */
  locale: string | null;
  /** Sibling locales (other-language counterparts) per R17. */
  siblings?: Array<{ locale: string; id: string }>;
  /** True when this item is a synthetic variant arm per PRD-206-R18. */
  isVariant?: boolean;
  /** Variant key (slug-cased) when `isVariant: true`. */
  variantKey?: string;
  /** Base ID this variant was forked from (when `isVariant: true`). */
  baseId?: string;
}

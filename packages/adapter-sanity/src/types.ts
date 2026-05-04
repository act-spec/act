/**
 * PRD-203 Sanity adapter — public + internal type surface.
 *
 * Every type cites a PRD-203-R{n} requirement. Mirrors PRD-203's
 * §"Wire format / interface definition" so user-facing config is
 * stable across the implementation file split.
 */

/**
 * PRD-203-R2 — config schema (TypeScript projection).
 */
export interface SanityAdapterConfig {
  /** Sanity project ID (required). */
  projectId: string;
  /** Sanity dataset (required, e.g., "production"). */
  dataset: string;
  /** API token. SHOULD reference an env var; never inline in committed config. */
  apiToken: string | { from_env: string };
  /** Sanity API version pin (default "2024-10-01"). */
  apiVersion?: string;
  /** Which dataset perspective to query (default "published"). */
  version?: 'published' | 'draft' | 'previewDraft';
  /** GROQ filter expression (default "*"). */
  groqFilter?: string;
  /** Whether an empty result set is permitted without warning. */
  allowEmpty?: boolean;
  /** Sanity _type → ACT type mapping. Identity by default. */
  typeMapping?: Record<string, string>;
  /** Sanity field → ACT envelope field mapping. */
  fieldMapping?: {
    title?: string;
    summary?: string;
    abstract?: string;
    body?: string;
    tags?: string;
    related?: Record<string, string /* relation */>;
  };
  /** ID field override (default `slug.current` then `_id`). */
  idField?: string;
  /** Reference resolution depth. 0–5; default 1. */
  referenceDepth?: number;
  /** Custom-block-type → marketing:* block mapping (Plus). */
  componentMapping?: Record<
    string,
    { type: string; fields: Record<string, unknown> }
  >;
  /** Locale config (Plus). */
  locale?: {
    field: string;
    pattern: 'field' | 'document';
    available?: string[];
    default?: string;
  };
  /** Summary strategy. */
  summary?: { strategy: 'field' | 'extract' | 'needs-llm' };
  /** Concurrency cap. */
  concurrency?: { transform?: number };
  /** ID namespace prefix (default "cms"). */
  namespace?: string;
}

/**
 * Minimal Portable Text block shape we accept. Keeps the package free of
 * runtime peer-dep on `@portabletext/types` while still being type-safe.
 * Aligned with the @portabletext/types public spec for `_type: "block"` and
 * Sanity custom block objects (any `_type`).
 */
export interface PortableTextSpan {
  _type: 'span';
  _key?: string;
  text: string;
  marks?: string[];
}

export interface PortableTextMarkDef {
  _type: string;
  _key: string;
  href?: string;
  [k: string]: unknown;
}

export interface PortableTextBlock {
  _type: 'block';
  _key?: string;
  style?: string; // 'normal' | 'h1'..'h6' | 'blockquote' | …
  listItem?: 'bullet' | 'number';
  level?: number;
  children: PortableTextSpan[];
  markDefs?: PortableTextMarkDef[];
}

export interface PortableTextCustomBlock {
  _type: string; // anything not 'block'
  _key?: string;
  [field: string]: unknown;
}

export type PortableTextNode = PortableTextBlock | PortableTextCustomBlock;

/** Sanity reference. */
export interface SanityRef {
  _type?: 'reference';
  _ref: string;
  _key?: string;
  _weak?: boolean;
}

/** Sanity slug. */
export interface SanitySlug {
  _type: 'slug';
  current: string;
}

/** Sanity document — opaque to the framework. */
export interface SanityDocument {
  _id: string;
  _type: string;
  _rev?: string;
  _createdAt?: string;
  _updatedAt?: string;
  [field: string]: unknown;
}

/** PRD-203-R5 — opaque source item that flows enumerate → transform. */
export interface SanityItem {
  doc: SanityDocument;
  /** PRD-203-R13 — null when single-locale build. */
  locale: string | null;
  /** PRD-203-R13 — siblings in the document-level pattern. */
  siblings?: Array<{ locale: string; id: string }>;
}

/** Recorded Sanity GROQ corpus — the test/fixture path. */
export interface SanitySourceCorpus {
  /** Documents returned by the configured GROQ filter. */
  documents: SanityDocument[];
  /** Documents reachable by reference (keyed by `_id`). */
  refDocuments?: Record<string, SanityDocument>;
  /** Optional precomputed delta cursor (for incremental fixtures). */
  latestTransactionId?: string;
}

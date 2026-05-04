/**
 * PRD-204 Storyblok adapter — public + internal type surface.
 *
 * Every type cites a PRD-204-R{n} requirement. Mirrors PRD-204's
 * §"Wire format / interface definition" so user-facing config is
 * stable across the implementation file split.
 */

/**
 * PRD-204-R2 — config schema (TypeScript projection).
 */
export interface StoryblokAdapterConfig {
  /** Storyblok space ID (required). */
  spaceId: number | string;
  /** Storyblok access token (preview or public). MAY reference an env var. */
  accessToken: string | { from_env: string };
  /** Storyblok region — default "eu". */
  region?: 'eu' | 'us' | 'cn' | 'ap';
  /** Default `published`; `draft` stamps `metadata.preview: true`. */
  version?: 'published' | 'draft';
  /** Cache version marker (Storyblok `cv`). */
  cv?: number;
  /** Storyblok query parameters (e.g., `starts_with`, `by_uuids`, `filter_query`). */
  storyFilter?: {
    starts_with?: string;
    by_uuids?: string;
    filter_query?: Record<string, unknown>;
    [param: string]: unknown;
  };
  /** When the filter returns 0 stories, suppress the warning. */
  allowEmpty?: boolean;
  /** Storyblok component name → ACT type mapping. Identity by default. */
  typeMapping?: Record<string, string>;
  /** Field-level mapping; defaults documented in PRD-204-R7 table. */
  fieldMapping?: {
    title?: string;
    summary?: string;
    abstract?: string;
    body?: string;
    tags?: string;
    /** Default callout level when blockquote → callout. */
    calloutLevel?: 'info' | 'warning' | 'error' | 'tip';
    related?: Record<string, string /* relation */>;
  };
  /** Override default ID derivation. */
  idField?: string;
  /** Story-link resolution depth (0–5; default 1). */
  linkResolutionDepth?: number;
  /** Component-name → marketing:* mapping (Plus). */
  componentMapping?: Record<
    string,
    { type: string; fields: Record<string, unknown> }
  >;
  /** Cap on `blok` recursion depth. Range 1–4. Default 4. */
  componentRecursionMax?: number;
  /** Locale config (Plus). */
  locale?: {
    pattern: 'folder' | 'field';
    field?: string;
    available?: string[];
    default?: string;
  };
  /** Summary strategy. */
  summary?: { strategy: 'field' | 'extract' | 'needs-llm' };
  /** Concurrency cap. */
  concurrency?: { transform?: number };
  /** ID namespace prefix (default "act-storyblok"). */
  namespace?: string;
  /** Webhook secret for signature verification helper (optional). */
  webhookSecret?: string;
  /** Enable token-fingerprint debug logs (PRD-204-R23). */
  debugLogging?: boolean;
}

// ---------------------------------------------------------------------------
// TipTap-derived rich text shapes Storyblok ships
// ---------------------------------------------------------------------------

/** PRD-204-R8 — TipTap text node (leaf in a paragraph/heading/code/etc.). */
export interface RichtextTextNode {
  type: 'text';
  text: string;
  marks?: RichtextMark[];
}

export interface RichtextMark {
  type: string; // 'bold' | 'italic' | 'code' | 'link' | 'strike' | …
  attrs?: Record<string, unknown>;
}

/** PRD-204-R8 — generic block-level rich-text node. */
export interface RichtextBlockNode {
  type: string; // 'paragraph' | 'heading' | 'bullet_list' | 'ordered_list' | 'list_item' | 'code_block' | 'blockquote' | 'horizontal_rule' | 'image' | 'blok' | …
  attrs?: Record<string, unknown>;
  content?: RichtextNode[];
  marks?: RichtextMark[];
  text?: string;
}

export type RichtextNode = RichtextBlockNode | RichtextTextNode;

/** PRD-204-R8 — root rich-text document Storyblok stores in a field. */
export interface RichtextDoc {
  type: 'doc';
  content?: RichtextNode[];
}

// ---------------------------------------------------------------------------
// Storyblok component blok shapes
// ---------------------------------------------------------------------------

/** Storyblok `blok` payload — at minimum carries `component` and `_uid`. */
export interface StoryblokBlokPayload {
  component: string;
  _uid?: string;
  [field: string]: unknown;
}

// ---------------------------------------------------------------------------
// Storyblok Story shapes (delivery API)
// ---------------------------------------------------------------------------

/** Storyblok story-link field shape. */
export interface StoryblokLink {
  linktype: 'story' | 'url' | 'asset' | 'email';
  id?: number;
  uuid?: string;
  slug?: string;
  url?: string;
  cached_url?: string;
  story?: { uuid?: string; full_slug?: string; id?: number };
}

/** PRD-204-R7 — Storyblok story content envelope. */
export interface StoryblokContent {
  /** The component name pinning the story's content type. */
  component: string;
  _uid?: string;
  body?: unknown;
  [field: string]: unknown;
}

/** Storyblok story (delivery-API shape). */
export interface StoryblokStory {
  id?: number;
  uuid: string;
  name: string;
  slug: string;
  full_slug: string;
  lang?: string;
  default_full_slug?: string;
  translated_slugs?: Array<{ lang: string; name?: string; path?: string }>;
  published_at?: string | null;
  updated_at?: string;
  created_at?: string;
  tag_list?: string[];
  content: StoryblokContent;
  /** Storyblok groups translated stories via `group_id`. */
  group_id?: string;
  /** Folder pattern: optional explicit translations of this story. */
  alternates?: Array<{ id?: number; full_slug: string; lang: string; uuid?: string }>;
  [field: string]: unknown;
}

/** PRD-204 — opaque source item flowing enumerate → transform. */
export interface StoryblokItem {
  story: StoryblokStory;
  /** Resolved locale per PRD-204-R14; null when locale config absent. */
  locale: string | null;
  /** Sibling locales (other-language counterparts) per R14. */
  siblings?: Array<{ locale: string; id: string }>;
}

/** Recorded Storyblok delivery-API corpus — the test/fixture path. */
export interface StoryblokSourceCorpus {
  /** Stories returned by the configured `cdn/stories` query. */
  stories: StoryblokStory[];
  /** Stories reachable by story link (keyed by `uuid`). */
  refStories?: Record<string, StoryblokStory>;
  /** Optional precomputed delta cursor (`cv` value) for incremental fixtures. */
  latestCv?: number;
}

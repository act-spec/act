/**
 * Public types for the WordPress adapter — config shape, raw WP REST entity
 * shapes (narrowed to fields the adapter actually consumes), and the
 * `WordPressItem` envelope that flows from `enumerate` to `transform`.
 *
 * The "raw" shapes intentionally use loose `unknown`/`Record` types where
 * WordPress's REST envelope is open-ended (custom fields, plugin extensions);
 * the adapter narrows them defensively at the access site.
 */

/** A reference to an env var to be resolved at adapter `init`. */
export interface FromEnv {
  from_env: string;
}

/** Inline string or env-resolved string. */
export type Secret = string | FromEnv;

/**
 * Authentication configuration. WordPress supports several auth schemes; the
 * adapter understands two:
 *  - JWT-style bearer (string or `{ from_env }`).
 *  - Application passwords (`{ user, appPassword }`) — sent as HTTP Basic Auth
 *    per the official WordPress 5.6+ recommendation.
 */
export type WordPressAuth =
  | string
  | FromEnv
  | { user: Secret; appPassword: Secret };

/** Which WordPress collections to enumerate. */
export interface IncludeFilter {
  posts?: boolean;
  pages?: boolean;
  categories?: boolean;
  tags?: boolean;
  users?: boolean;
}

/** i18n options. Default mode is `'auto'` (probe for Polylang then WPML). */
export interface I18nOptions {
  mode?: 'auto' | 'polylang' | 'wpml' | 'none';
  defaultLocale?: string;
}

/** Complete adapter configuration. */
export interface WordPressAdapterConfig {
  baseUrl: string;
  auth?: WordPressAuth;
  include?: IncludeFilter;
  perPage?: number;
  concurrency?: number;
  namespace?: string;
  i18n?: I18nOptions;
  typeMap?: Partial<Record<WordPressEntityKind, string>>;
}

/** Resolved auth — credentials replaced with concrete strings. */
export type ResolvedAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'basic'; user: string; password: string };

/** WordPress collection kinds the adapter understands. */
export type WordPressEntityKind = 'post' | 'page' | 'category' | 'tag' | 'user' | 'media';

// ---------------------------------------------------------------------------
// Narrowed WP REST shapes — only fields the adapter touches.
// ---------------------------------------------------------------------------

/** WordPress's `{ rendered, raw? }` text shape used for title, content, etc. */
export interface RenderedText {
  rendered: string;
  raw?: string;
  protected?: boolean;
}

/** A WordPress post row (`/wp/v2/posts/<id>`). */
export interface WordPressPost {
  id: number;
  date?: string;
  date_gmt?: string;
  modified?: string;
  modified_gmt?: string;
  slug: string;
  status?: string;
  link?: string;
  title: RenderedText;
  content?: RenderedText;
  excerpt?: RenderedText;
  author?: number;
  featured_media?: number;
  categories?: number[];
  tags?: number[];
  /** Polylang surfaces a per-locale code on this field. */
  lang?: string;
  /** Polylang's translation map: { localeCode: postId }. */
  translations?: Record<string, number>;
  /** WPML attaches `wpml_current_locale` and `wpml_translations` similarly. */
  wpml_current_locale?: string;
  wpml_translations?: Record<string, { id: number }>;
  /** Plugin extensions live here. */
  meta?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A WordPress page row (`/wp/v2/pages/<id>`). Pages may nest via `parent`. */
export interface WordPressPage extends WordPressPost {
  parent?: number;
  menu_order?: number;
}

/** A WordPress taxonomy term (`/wp/v2/categories/<id>`, `/wp/v2/tags/<id>`). */
export interface WordPressTerm {
  id: number;
  count?: number;
  description?: string;
  link?: string;
  name: string;
  slug: string;
  taxonomy: string;
  parent?: number;
  meta?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A WordPress user (`/wp/v2/users/<id>`). */
export interface WordPressUser {
  id: number;
  name: string;
  url?: string;
  description?: string;
  link?: string;
  slug: string;
  avatar_urls?: Record<string, string>;
  [k: string]: unknown;
}

/** A WordPress media item (`/wp/v2/media/<id>`). Used for featured-image lookups. */
export interface WordPressMedia {
  id: number;
  source_url: string;
  alt_text?: string;
  mime_type?: string;
  media_details?: { width?: number; height?: number };
  [k: string]: unknown;
}

/** Item flowing from `enumerate` to `transform`. The kind selects the mapper. */
export type WordPressItem =
  | { kind: 'post'; post: WordPressPost; locale?: string | null }
  | { kind: 'page'; page: WordPressPage; locale?: string | null }
  | { kind: 'category'; term: WordPressTerm }
  | { kind: 'tag'; term: WordPressTerm }
  | { kind: 'user'; user: WordPressUser };

/**
 * Recorded corpus shape used by `corpusProvider`. Mirrors the REST collections
 * the adapter consumes; production callers either supply this directly (offline
 * tests) or wire the live HTTP provider.
 */
export interface WordPressSourceCorpus {
  posts?: WordPressPost[];
  pages?: WordPressPage[];
  categories?: WordPressTerm[];
  tags?: WordPressTerm[];
  users?: WordPressUser[];
  media?: WordPressMedia[];
  /** Auto-detected i18n mode; tests may set this directly. */
  i18nMode?: 'polylang' | 'wpml' | 'none';
}

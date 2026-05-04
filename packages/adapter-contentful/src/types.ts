/**
 * PRD-202 Contentful adapter — public + internal type surface.
 *
 * Every type cites a PRD-202-R{n} requirement. The shapes mirror PRD-202's
 * §"Wire format / interface definition" so user-facing config is
 * stable across the implementation file split.
 */
import type { Document } from '@contentful/rich-text-types';

/**
 * PRD-202-R2 — config schema (TypeScript projection).
 */
export interface ContentfulAdapterConfig {
  spaceId: string;
  environment?: string;
  accessToken: string | { from_env: string };
  contentTypes: string[];
  defaults?: Record<string, string>;
  mappings?: Record<string, ContentTypeMapping>;
  resolveLinks?: { depth?: 0 | 1 | 2 | 3 | 4; scope?: 'all' | 'whitelist-only' };
  locale?: { available?: string[]; default?: string; pattern?: 1 | 2 };
  host?: 'cdn.contentful.com' | 'preview.contentful.com';
  idStrategy?: {
    from?: 'id' | 'slug' | 'composite';
    field?: string;
    namespace?: string;
    overrideField?: string;
  };
  concurrency?: { transform?: number };
}

/**
 * PRD-202-R8 — per-content-type mapping shape (Contentful-specific bespoke
 * DSL, deferred unification across CMS adapters per E6 / R25).
 */
export interface ContentTypeMapping {
  type?: string;
  title?: string;
  summary?: string | { from: string; source?: 'author' | 'extracted' };
  abstract?: string;
  body?: string | string[];
  tags?: string;
  parent?: string;
  related?: Array<{ from: string; relation?: string }>;
  blocks?: Array<{
    when: { field: string; equals?: unknown; ofType?: string };
    type: string;
    fields: Record<string, string>;
  }>;
  metadata?: Record<string, string>;
}

/**
 * PRD-202-R5 — opaque source item that flows enumerate → transform.
 *
 * `entry` is a recorded Contentful Delivery API entry shape (we do not
 * depend on contentful's runtime SDK; tests load JSON fixtures directly).
 */
export interface ContentfulItem {
  entry: ContentfulEntry;
  contentTypeId: string;
  /** PRD-202-R12 — null when single-locale build. */
  locale: string | null;
  /** PRD-202-R14 — locales the entry HAS authored variants for. */
  authoredLocales?: string[];
}

export interface ContentfulSysRef {
  type: 'Link' | 'Entry' | 'Asset' | 'Space' | 'Environment' | 'ContentType';
  linkType?: 'Entry' | 'Asset';
  id: string;
}

export interface ContentfulEntrySys {
  id: string;
  type: 'Entry';
  contentType: { sys: ContentfulSysRef };
  /** PRD-202-R7 — Contentful exposes per-entry tag metadata under `metadata.tags`. */
  metadata?: { tags?: Array<{ sys: ContentfulSysRef }> };
}

export interface ContentfulEntry {
  sys: ContentfulEntrySys;
  /** Per Contentful, fields are always an object; values may be Rich Text Documents,
   *  primitives, arrays of links, or links. */
  fields: Record<string, unknown>;
  /** Top-level `metadata.tags` (Contentful-modern). */
  metadata?: { tags?: Array<{ sys: ContentfulSysRef }> };
}

/** PRD-202-R11 — embedded asset shape (extracted from rich-text data). */
export interface ContentfulAsset {
  sys: ContentfulSysRef;
  fields: {
    title?: string;
    description?: string;
    file: {
      url: string;
      contentType: string;
      fileName?: string;
      details?: { size?: number; image?: { width?: number; height?: number } };
    };
  };
}

/** PRD-202-R5 — the source corpus we operate over. Replaces "live CDA" in tests. */
export interface ContentfulSourceCorpus {
  /** Available locales advertised by the space. */
  spaceLocales: Array<{ code: string; default?: boolean }>;
  /** Configured content types in the space. */
  contentTypes: Array<{ sys: { id: string } }>;
  /** Fully-resolved entries; the adapter does not perform link resolution. */
  entries: ContentfulEntry[];
  /** Per-entry/per-locale field overrides (when an entry varies across locales). */
  perLocale?: Record<string, Record<string, Record<string, unknown>>>;
  /** PRD-202-R14 — list of locales each entry was authored in (defaults to all if absent). */
  authoredLocales?: Record<string, string[]>;
  /** PRD-202-R11 — assets keyed by sys.id; resolved when the embed appears in Rich Text. */
  assets?: Record<string, ContentfulAsset>;
  /** PRD-202-R6 — linked entries keyed by sys.id; used for whitelist scope handling. */
  linkedEntries?: Record<string, ContentfulEntry>;
}

/** Re-export the rich-text Document type alias for the adapter signature. */
export type RichTextDocument = Document;

/**
 * Type declarations for the Notion adapter.
 *
 * These mirror the structural shapes returned by the Notion API
 * (https://developers.notion.com) at API version `2022-06-28`. Only the
 * fields the adapter consumes are typed; the long tail of unused fields is
 * preserved through index signatures so downstream code that wants to
 * inspect them can do so without losing type safety.
 */

/** Notion integration token. Inline string OR `{ from_env: 'NAME' }`. */
export type NotionAccessToken = string | { from_env: string };

/**
 * Adapter configuration. The factory accepts this shape directly via
 * `init`. See README for an annotated example.
 */
export interface NotionAdapterConfig {
  /** Notion integration token (Bearer). Prefer `{ from_env: 'NOTION_TOKEN' }`. */
  accessToken: NotionAccessToken;
  /**
   * Notion database id (UUID with or without dashes). The database becomes a
   * branch node; every row becomes a leaf.
   */
  databaseId: string;
  /**
   * Optional ACT type for the branch (database) node. Defaults to
   * `'collection'`.
   */
  databaseType?: string;
  /**
   * Optional ACT type for leaf (page) nodes. Defaults to `'article'`.
   */
  pageType?: string;
  /** Optional title override for the branch node. */
  databaseTitle?: string;
  /** Optional summary override for the branch node. */
  databaseSummary?: string;
  /**
   * Notion property names to read from each page row.
   *
   * `title` defaults to whichever Notion property has `type: 'title'`;
   * `summary` is optional and is read as rich-text.
   */
  properties?: {
    title?: string;
    summary?: string;
    tags?: string;
  };
  /**
   * Per-page locale extraction. Notion has no native locale field; the
   * adapter reads a configurable property (default property name `Locale`,
   * type `select`).
   */
  locale?: {
    /** Notion property name (default: `Locale`). */
    property?: string;
    /** Default locale to stamp when the property is empty. */
    default?: string;
  };
  /**
   * ID-namespacing strategy. Defaults to `{ namespace: 'cms' }` so emitted
   * IDs look like `cms/<page-uuid>` (or `cms/<locale>/<page-uuid>` for
   * multi-locale).
   */
  idStrategy?: {
    namespace?: string;
  };
  /** Override the Notion API host (defaults to `https://api.notion.com`). */
  apiBaseUrl?: string;
  /** Override the Notion API version header (defaults to `2022-06-28`). */
  notionApiVersion?: string;
  /** Bounded transform concurrency (default 4). */
  concurrency?: { transform?: number };
}

// ---------------------------------------------------------------------------
// Notion API response shapes (subset)
// ---------------------------------------------------------------------------

/** Notion rich-text item — covers text, mention, equation. */
export interface NotionRichText {
  type: 'text' | 'mention' | 'equation';
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
  href?: string | null;
  text?: { content: string; link?: { url: string } | null };
  [k: string]: unknown;
}

/** Single Notion property value (the union we read). */
export interface NotionPropertyValue {
  id?: string;
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  select?: { id?: string; name: string; color?: string } | null;
  multi_select?: Array<{ id?: string; name: string; color?: string }>;
  [k: string]: unknown;
}

/** Notion page object (subset). */
export interface NotionPage {
  object: 'page';
  id: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  properties: Record<string, NotionPropertyValue>;
  parent?: { type: string; database_id?: string };
  url?: string;
  [k: string]: unknown;
}

/** Notion database object (subset). */
export interface NotionDatabase {
  object: 'database';
  id: string;
  title?: NotionRichText[];
  description?: NotionRichText[];
  last_edited_time?: string;
  url?: string;
  [k: string]: unknown;
}

/** Notion block object (subset of supported block types). */
export interface NotionBlock {
  object: 'block';
  id: string;
  type: string;
  has_children?: boolean;
  archived?: boolean;
  paragraph?: { rich_text: NotionRichText[]; color?: string };
  heading_1?: { rich_text: NotionRichText[] };
  heading_2?: { rich_text: NotionRichText[] };
  heading_3?: { rich_text: NotionRichText[] };
  bulleted_list_item?: { rich_text: NotionRichText[] };
  numbered_list_item?: { rich_text: NotionRichText[] };
  code?: { rich_text: NotionRichText[]; language?: string };
  quote?: { rich_text: NotionRichText[] };
  divider?: Record<string, unknown>;
  to_do?: { rich_text: NotionRichText[]; checked?: boolean };
  /** Children populated by the adapter when `has_children` is true. */
  children?: NotionBlock[];
  [k: string]: unknown;
}

/** Item produced by `enumerate` for the Notion adapter. */
export interface NotionItem {
  /** Either the database (one item) or a page row. */
  kind: 'database' | 'page';
  database: NotionDatabase;
  page?: NotionPage;
  /** Block tree, fetched on demand for pages. */
  blocks?: NotionBlock[];
  /** Extracted locale (per-page, optional). */
  locale?: string | null;
}

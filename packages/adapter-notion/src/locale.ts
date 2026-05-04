/**
 * Per-page locale extraction for the Notion adapter.
 *
 * Notion has no native locale field. The adapter reads a configurable
 * Notion property — by default a `select` named `Locale` — to stamp
 * `metadata.locale` on each emitted node. Pages with no locale property
 * (or an empty one) fall back to the configured default, or to no locale
 * at all when no default is configured.
 */
import type { NotionPage, NotionPropertyValue } from './types.js';

export interface LocaleExtractOpts {
  /** Notion property name (default: `Locale`). */
  property?: string;
  /** Default to stamp when the property is absent / empty. */
  default?: string;
}

/**
 * Read the locale string for a single Notion page.
 *
 * Returns `null` when no locale is available. Supports `select`,
 * `multi_select` (first entry), and `rich_text` property types — these
 * cover the common patterns Notion users adopt for locale tagging.
 */
export function extractLocale(
  page: NotionPage,
  opts: LocaleExtractOpts = {},
): string | null {
  const propertyName = opts.property ?? 'Locale';
  const prop = page.properties[propertyName];
  const value = readPropertyAsString(prop);
  if (value !== null && value.length > 0) return value;
  return opts.default ?? null;
}

/** Read a Notion property as a single string, regardless of its underlying type. */
function readPropertyAsString(prop: NotionPropertyValue | undefined): string | null {
  if (!prop) return null;
  if (prop.type === 'select') {
    return prop.select?.name ?? null;
  }
  if (prop.type === 'multi_select') {
    const first = prop.multi_select?.[0];
    return first ? first.name : null;
  }
  if (prop.type === 'rich_text') {
    const parts = prop.rich_text ?? [];
    if (parts.length === 0) return null;
    return parts.map((p) => p.plain_text).join('').trim() || null;
  }
  if (prop.type === 'title') {
    const parts = prop.title ?? [];
    if (parts.length === 0) return null;
    return parts.map((p) => p.plain_text).join('').trim() || null;
  }
  return null;
}

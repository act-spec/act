/**
 * Notion -> ACT envelope mapping. Pure functions; no I/O.
 *
 * The shapes:
 *   - Database -> branch node with `children: [<page-ids…>]`.
 *   - Page    -> leaf node with prose blocks derived from the page's
 *                block tree.
 */
import { deriveEtag, stripEtag } from '@act-spec/validator';
import type { EmittedNode, PartialEmittedNode } from '@act-spec/adapter-framework';

import type {
  NotionAdapterConfig,
  NotionBlock,
  NotionDatabase,
  NotionPage,
  NotionPropertyValue,
  NotionRichText,
} from './types.js';
import { blocksToContent, richTextPlain, type ContentBlock } from './blocks.js';

/** Adapter identity. */
export const NOTION_ADAPTER_NAME = 'act-notion' as const;

/** Default transform concurrency. */
export const NOTION_DEFAULT_CONCURRENCY = 4 as const;

/** Compose the ACT id for the database (branch) node. */
export function deriveDatabaseId(
  database: NotionDatabase,
  cfg: NotionAdapterConfig,
): string {
  const namespace = cfg.idStrategy?.namespace ?? 'cms';
  return `${namespace}/${normalize(database.id)}`;
}

/** Compose the ACT id for a single page (leaf) node. */
export function derivePageId(
  page: NotionPage,
  cfg: NotionAdapterConfig,
  locale: string | null,
): string {
  const namespace = cfg.idStrategy?.namespace ?? 'cms';
  const localePrefix = locale !== null ? `${locale.toLowerCase()}/` : '';
  return `${namespace}/${localePrefix}${normalize(page.id)}`;
}

/** Lowercase ACT-id grammar: strip non-conforming chars, hyphenize. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._\-/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Build the branch envelope for a Notion database. */
export function transformDatabase(
  database: NotionDatabase,
  pages: NotionPage[],
  cfg: NotionAdapterConfig,
  perPageLocale: (page: NotionPage) => string | null,
): EmittedNode {
  const id = deriveDatabaseId(database, cfg);
  const titleFromNotion = richTextPlain(database.title);
  const title = cfg.databaseTitle ?? (titleFromNotion.length > 0 ? titleFromNotion : `Notion database ${database.id}`);
  const summaryFromNotion = richTextPlain(database.description);
  const summarySource: 'author' | 'extracted' = cfg.databaseSummary !== undefined || summaryFromNotion.length > 0 ? 'author' : 'extracted';
  const summary =
    cfg.databaseSummary ?? (summaryFromNotion.length > 0 ? summaryFromNotion : `Index of ${String(pages.length)} Notion page(s).`);

  const children = pages.map((p) => derivePageId(p, cfg, perPageLocale(p)));

  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: cfg.databaseType ?? 'collection',
    title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA', // placeholder; recomputed below
    summary,
    summary_source: summarySource,
    content: [],
    tokens: { summary: tokenize(summary) },
    children,
    metadata: {
      source: {
        adapter: NOTION_ADAPTER_NAME,
        source_id: database.id,
      },
    },
    ...(typeof database.last_edited_time === 'string'
      ? { updated_at: database.last_edited_time }
      : {}),
  } as unknown as EmittedNode;

  return finalizeEtag(envelope);
}

/** Build the leaf envelope for a single Notion page. */
export function transformPage(
  page: NotionPage,
  database: NotionDatabase,
  blocks: NotionBlock[],
  cfg: NotionAdapterConfig,
  locale: string | null,
  warn: (msg: string) => void,
): EmittedNode | PartialEmittedNode {
  const id = derivePageId(page, cfg, locale);
  const parentId = deriveDatabaseId(database, cfg);

  const titleResolved = readTitle(page, cfg);
  const title = titleResolved ?? `Untitled Notion page ${page.id}`;
  const titlePartial = titleResolved === null;

  const summaryProperty = cfg.properties?.summary;
  const summaryFromProp = summaryProperty !== undefined ? readRichText(page, summaryProperty) : null;

  const walked = blocksToContent(blocks);
  const contentBlocks: ContentBlock[] = walked.blocks;
  if (walked.unmapped.length > 0) {
    const unique = Array.from(new Set(walked.unmapped));
    warn(
      `page ${page.id}: ${String(walked.unmapped.length)} unmapped block(s) (${unique.join(', ')}); preserved as type:'text' fallback`,
    );
  }

  const summary =
    summaryFromProp !== null && summaryFromProp.length > 0
      ? summaryFromProp
      : extractFirstProseSummary(contentBlocks) ?? `Page ${title}`;
  const summarySource: 'author' | 'extracted' =
    summaryFromProp !== null && summaryFromProp.length > 0 ? 'author' : 'extracted';

  const tags = readTags(page, cfg);

  // metadata.source.human_url defaults to Notion's `url` if present.
  const source: Record<string, unknown> = {
    adapter: NOTION_ADAPTER_NAME,
    source_id: page.id,
  };
  if (typeof page.url === 'string' && page.url.length > 0) {
    source['human_url'] = page.url;
  }

  const metadata: Record<string, unknown> = {
    ...(locale !== null ? { locale } : {}),
    source,
  };
  if (titlePartial) {
    metadata['extraction_status'] = 'partial';
    metadata['extraction_error'] = `no title property (looked for "${cfg.properties?.title ?? '<title type>'}")`;
  }

  // Token estimates.
  const tokens: Record<string, number> = { summary: tokenize(summary) };
  const bodyTokens = contentBlocks.reduce((acc, b) => {
    const t = (b as Record<string, unknown>)['text'];
    if (typeof t === 'string') return acc + tokenize(t);
    return acc;
  }, 0);
  if (bodyTokens > 0) tokens['body'] = bodyTokens;

  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: cfg.pageType ?? 'article',
    title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA', // placeholder; recomputed below
    summary,
    summary_source: summarySource,
    content: contentBlocks as unknown as EmittedNode['content'],
    tokens,
    parent: parentId,
    ...(tags.length > 0 ? { tags } : {}),
    ...(typeof page.last_edited_time === 'string' ? { updated_at: page.last_edited_time } : {}),
    metadata,
  } as unknown as EmittedNode;

  const finalized = finalizeEtag(envelope);
  if (titlePartial) {
    return { ...finalized, _actPartial: true } as PartialEmittedNode;
  }
  return finalized;
}

// ---------------------------------------------------------------------------
// Property readers
// ---------------------------------------------------------------------------

/**
 * Read the page's title property.
 *
 * If `cfg.properties.title` is set, that property is read literally;
 * otherwise the adapter looks for the first property with `type: 'title'`
 * (Notion's convention is to have exactly one such property per database).
 */
function readTitle(page: NotionPage, cfg: NotionAdapterConfig): string | null {
  const explicit = cfg.properties?.title;
  if (explicit !== undefined) {
    const value = page.properties[explicit];
    return readRichTextOrTitle(value);
  }
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title') {
      const v = readRichTextOrTitle(prop);
      if (v !== null) return v;
    }
  }
  return null;
}

function readRichTextOrTitle(prop: NotionPropertyValue | undefined): string | null {
  if (!prop) return null;
  if (prop.type === 'title') {
    const text = (prop.title ?? []).map((p) => p.plain_text).join('').trim();
    return text.length > 0 ? text : null;
  }
  if (prop.type === 'rich_text') {
    const text = (prop.rich_text ?? []).map((p) => p.plain_text).join('').trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

function readRichText(page: NotionPage, propertyName: string): string | null {
  const prop = page.properties[propertyName];
  if (!prop) return null;
  return readRichTextOrTitle(prop);
}

function readTags(page: NotionPage, cfg: NotionAdapterConfig): string[] {
  const propertyName = cfg.properties?.tags;
  if (propertyName === undefined) return [];
  const prop = page.properties[propertyName];
  if (!prop) return [];
  if (prop.type === 'multi_select') {
    return (prop.multi_select ?? []).map((m) => m.name).filter((n) => n.length > 0);
  }
  if (prop.type === 'select') {
    return prop.select?.name ? [prop.select.name] : [];
  }
  return [];
}

function extractFirstProseSummary(blocks: ContentBlock[]): string | null {
  for (const b of blocks) {
    if (b.type !== 'prose') continue;
    const text = (b as Record<string, unknown>)['text'];
    if (typeof text !== 'string') continue;
    const tokens = text.split(/\s+/).filter((t) => t.length > 0).slice(0, 50);
    const joined = tokens.join(' ');
    if (joined.length > 0) return joined;
  }
  return null;
}

function tokenize(s: string): number {
  return Math.max(1, s.split(/\s+/).filter((x) => x.length > 0).length);
}

function finalizeEtag<T extends EmittedNode>(envelope: T): T {
  const stripped = stripEtag(envelope as unknown as Record<string, unknown>);
  (envelope as unknown as { etag: string }).etag = deriveEtag(stripped);
  return envelope;
}

// Re-exports for the package index.
export { richTextPlain };
export type { ContentBlock, NotionRichText };

/**
 * Map WordPress REST entities to ACT envelopes.
 *
 *  - `post` → leaf node (`type: 'article'` by default).
 *  - `page` → branch node (`type: 'section'`); pages with `parent` declare the
 *    `parent` field; the framework's enumerate order ensures parents land first.
 *  - `category` → branch node (`type: 'section'`).
 *  - `tag` → leaf node (`type: 'tag'`); tags are flat by design.
 *  - `user` → leaf node (`type: 'profile'`).
 */
import { deriveEtag, stripEtag } from '@act-spec/validator';
import type {
  EmittedNode,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';

import { htmlToParagraphs, tokenize } from './html.js';
import { extractLocale, extractTranslations, type I18nMode } from './i18n.js';
import { ADAPTER_NAME } from './constants.js';
import type {
  WordPressAdapterConfig,
  WordPressEntityKind,
  WordPressItem,
  WordPressPage,
  WordPressPost,
  WordPressTerm,
  WordPressUser,
} from './types.js';

/** Default `type` value for each WP collection. */
const DEFAULT_TYPE_MAP: Readonly<Record<WordPressEntityKind, string>> = {
  post: 'article',
  page: 'section',
  category: 'section',
  tag: 'tag',
  user: 'profile',
  media: 'asset',
};

/** Resolve the ACT `type` for a kind, honoring `config.typeMap`. */
function actType(kind: WordPressEntityKind, cfg: WordPressAdapterConfig): string {
  const override = cfg.typeMap?.[kind];
  if (typeof override === 'string' && override.length > 0) return override;
  return DEFAULT_TYPE_MAP[kind];
}

/**
 * PRD-100-R10 grammar — lower-case, allowed chars only, hyphenize the rest.
 * Mirrors the grammar enforced by `schemas/100/node.schema.json`.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._\-/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Build an ACT id of the form `${namespace}/${kind}/${slugOrId}[@locale]`. */
function buildId(
  cfg: WordPressAdapterConfig,
  kind: WordPressEntityKind,
  slugOrId: string,
  locale?: string,
): string {
  const namespace = cfg.namespace ?? 'wp';
  const id = `${namespace}/${kind}/${normalize(slugOrId)}`;
  if (typeof locale === 'string' && locale.length > 0) return `${id}@${normalize(locale)}`;
  return id;
}

/** Compute a placeholder etag and let `deriveEtag` swap it post-build. */
function withDerivedEtag(envelope: EmittedNode): EmittedNode {
  const stripped = stripEtag(envelope as unknown as Record<string, unknown>);
  (envelope as unknown as { etag: string }).etag = deriveEtag(stripped);
  return envelope;
}

/** Map a post → leaf node envelope. */
function mapPost(
  post: WordPressPost,
  cfg: WordPressAdapterConfig,
  i18nMode: I18nMode,
): EmittedNode {
  const titleText = decodeBasic(post.title.rendered);
  const excerptParas = htmlToParagraphs(post.excerpt?.rendered ?? '');
  const excerpt = excerptParas.join(' ').trim();
  const summary = excerpt.length > 0 ? excerpt : `Article: ${titleText}`;
  const summarySource: 'author' | 'extracted' = excerpt.length > 0 ? 'author' : 'extracted';
  const bodyParas = htmlToParagraphs(post.content?.rendered ?? '');

  const locale = extractLocale(post, i18nMode);
  const translationsMap = extractTranslations(post, i18nMode);
  const translationEntries = Object.entries(translationsMap)
    .filter(([loc]) => loc !== locale)
    .map(([loc, id]) => ({
      locale: loc,
      id: buildId(cfg, 'post', String(id), loc),
    }));

  const id = buildId(cfg, 'post', post.slug || String(post.id), locale);

  const tags: string[] = [];
  // WP `categories` and `tags` are id arrays; surface them as tag strings
  // prefixed for readability. Real category nodes are emitted separately.
  for (const c of post.categories ?? []) tags.push(`category:${String(c)}`);
  for (const t of post.tags ?? []) tags.push(`tag:${String(t)}`);

  const metadata: Record<string, unknown> = {
    source: {
      adapter: ADAPTER_NAME,
      source_id: `${cfg.baseUrl}#post:${String(post.id)}`,
      ...(typeof post.link === 'string' ? { source_path: post.link } : {}),
    },
  };
  if (locale !== undefined) metadata['locale'] = locale;
  if (translationEntries.length > 0) metadata['translations'] = translationEntries;
  if (typeof post.modified_gmt === 'string') metadata['modified_at'] = post.modified_gmt;
  else if (typeof post.modified === 'string') metadata['modified_at'] = post.modified;
  if (typeof post.author === 'number') metadata['wp_author_id'] = post.author;
  if (typeof post.featured_media === 'number' && post.featured_media > 0) {
    metadata['wp_featured_media_id'] = post.featured_media;
  }

  const tokens: Record<string, number> = { summary: tokenize(summary) };
  const bodyTokenCount = bodyParas.reduce((acc, p) => acc + tokenize(p), 0);
  if (bodyTokenCount > 0) tokens['body'] = bodyTokenCount;

  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: actType('post', cfg),
    title: titleText,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary,
    summary_source: summarySource,
    content: bodyParas.map((p) => ({ type: 'prose', format: 'plain', text: p })) as unknown as EmittedNode['content'],
    tokens,
    ...(tags.length > 0 ? { tags } : {}),
    metadata,
  } as unknown as EmittedNode;

  return withDerivedEtag(envelope);
}

/** Map a page → branch (section) envelope; honors WP's `parent` chaining. */
function mapPage(
  page: WordPressPage,
  cfg: WordPressAdapterConfig,
  i18nMode: I18nMode,
): EmittedNode {
  const titleText = decodeBasic(page.title.rendered);
  const excerptParas = htmlToParagraphs(page.excerpt?.rendered ?? '');
  const excerpt = excerptParas.join(' ').trim();
  const summary = excerpt.length > 0 ? excerpt : `Page: ${titleText}`;
  const summarySource: 'author' | 'extracted' = excerpt.length > 0 ? 'author' : 'extracted';
  const bodyParas = htmlToParagraphs(page.content?.rendered ?? '');

  const locale = extractLocale(page, i18nMode);
  const id = buildId(cfg, 'page', page.slug || String(page.id), locale);

  const metadata: Record<string, unknown> = {
    source: {
      adapter: ADAPTER_NAME,
      source_id: `${cfg.baseUrl}#page:${String(page.id)}`,
      ...(typeof page.link === 'string' ? { source_path: page.link } : {}),
    },
  };
  if (locale !== undefined) metadata['locale'] = locale;

  const tokens: Record<string, number> = { summary: tokenize(summary) };
  const bodyTokenCount = bodyParas.reduce((acc, p) => acc + tokenize(p), 0);
  if (bodyTokenCount > 0) tokens['body'] = bodyTokenCount;

  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: actType('page', cfg),
    title: titleText,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary,
    summary_source: summarySource,
    content: bodyParas.map((p) => ({ type: 'prose', format: 'plain', text: p })) as unknown as EmittedNode['content'],
    tokens,
    metadata,
    ...(typeof page.parent === 'number' && page.parent > 0
      ? { parent: buildId(cfg, 'page', String(page.parent), locale) }
      : {}),
  } as unknown as EmittedNode;

  return withDerivedEtag(envelope);
}

/** Map a category term → branch (section) envelope. */
function mapCategory(term: WordPressTerm, cfg: WordPressAdapterConfig): EmittedNode {
  const description = (term.description ?? '').trim();
  const summary = description.length > 0 ? stripTags(description) : `Category: ${term.name}`;
  const summarySource: 'author' | 'extracted' =
    description.length > 0 ? 'author' : 'extracted';

  const id = buildId(cfg, 'category', term.slug || String(term.id));
  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: actType('category', cfg),
    title: term.name,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary,
    summary_source: summarySource,
    content: [],
    tokens: { summary: tokenize(summary) },
    metadata: {
      source: {
        adapter: ADAPTER_NAME,
        source_id: `${cfg.baseUrl}#category:${String(term.id)}`,
        ...(typeof term.link === 'string' ? { source_path: term.link } : {}),
      },
      ...(typeof term.count === 'number' ? { wp_post_count: term.count } : {}),
    },
    ...(typeof term.parent === 'number' && term.parent > 0
      ? { parent: buildId(cfg, 'category', String(term.parent)) }
      : {}),
  };
  return withDerivedEtag(envelope);
}

/** Map a tag term → flat leaf envelope. */
function mapTag(term: WordPressTerm, cfg: WordPressAdapterConfig): EmittedNode {
  const description = (term.description ?? '').trim();
  const summary = description.length > 0 ? stripTags(description) : `Tag: ${term.name}`;
  const summarySource: 'author' | 'extracted' =
    description.length > 0 ? 'author' : 'extracted';
  const id = buildId(cfg, 'tag', term.slug || String(term.id));
  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: actType('tag', cfg),
    title: term.name,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary,
    summary_source: summarySource,
    content: [],
    tokens: { summary: tokenize(summary) },
    metadata: {
      source: {
        adapter: ADAPTER_NAME,
        source_id: `${cfg.baseUrl}#tag:${String(term.id)}`,
        ...(typeof term.link === 'string' ? { source_path: term.link } : {}),
      },
      ...(typeof term.count === 'number' ? { wp_post_count: term.count } : {}),
    },
  };
  return withDerivedEtag(envelope);
}

/** Map a user → leaf envelope. */
function mapUser(user: WordPressUser, cfg: WordPressAdapterConfig): EmittedNode {
  const description = (user.description ?? '').trim();
  const summary = description.length > 0 ? stripTags(description) : `Author: ${user.name}`;
  const summarySource: 'author' | 'extracted' =
    description.length > 0 ? 'author' : 'extracted';
  const id = buildId(cfg, 'user', user.slug || String(user.id));
  const envelope: EmittedNode = {
    act_version: '0.1',
    id,
    type: actType('user', cfg),
    title: user.name,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary,
    summary_source: summarySource,
    content: [],
    tokens: { summary: tokenize(summary) },
    metadata: {
      source: {
        adapter: ADAPTER_NAME,
        source_id: `${cfg.baseUrl}#user:${String(user.id)}`,
        ...(typeof user.link === 'string' ? { source_path: user.link } : {}),
      },
    },
  };
  return withDerivedEtag(envelope);
}

/**
 * Dispatch on item kind. Returns null only when the upstream item is
 * structurally invalid (missing required slug/id) — the caller treats null as
 * a deliberate skip per the framework's transform contract.
 */
export function mapWordPressItem(
  item: WordPressItem,
  cfg: WordPressAdapterConfig,
  i18nMode: I18nMode,
): EmittedNode | PartialEmittedNode | null {
  switch (item.kind) {
    case 'post':
      if (!item.post.title || typeof item.post.title.rendered !== 'string') return null;
      return mapPost(item.post, cfg, i18nMode);
    case 'page':
      if (!item.page.title || typeof item.page.title.rendered !== 'string') return null;
      return mapPage(item.page, cfg, i18nMode);
    case 'category':
      return mapCategory(item.term, cfg);
    case 'tag':
      return mapTag(item.term, cfg);
    case 'user':
      return mapUser(item.user, cfg);
  }
}

/**
 * Decode the small set of HTML entities WordPress hands back in `title.rendered`
 * (apostrophes, em-dashes, etc.) and strip any wrapping tags. Suitable for a
 * plain-text title; not a general HTML decoder (use `htmlToParagraphs` for body
 * content).
 */
function decodeBasic(s: string): string {
  return stripTags(s)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

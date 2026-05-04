/**
 * `/llms.txt` emitter — ACT v0.2 §3.4 / §3.5 / §6.40 (runbook).
 *
 * ACT positions itself as a **strict superset of llms.txt**: every ACT build
 * also emits the canonical llms.txt at the site root for back-compat with
 * agents and tools that already speak that format. See https://llmstxt.org/
 * for the canonical format spec; the structure we emit is:
 *
 *     # <site name>
 *
 *     > <site description / 1-line summary>
 *
 *     ## <Section title (locale or node-type group)>
 *
 *     - [<title>](<url>): <1-line summary>
 *     - [<title>](<url>): <1-line summary>
 *
 *     ## <Next section>
 *     ...
 *
 * Grouping rules:
 *   - When `manifest.locales` (or any per-node `locale` field) shows >1
 *     distinct locale, the top-level H2 sections are locales, with
 *     node-type subsections rolled up into the bullet block under each
 *     locale.
 *   - Otherwise sections are by node type ("Articles", "API endpoints",
 *     "Concepts", "Recipes", …). Type → human-friendly heading is a
 *     small map of well-known types; unknown types fall back to the type
 *     string itself, title-cased.
 *
 * Hidden nodes (`node.hidden === true` or `metadata.hidden === true`) are
 * skipped — those are author-flagged "do not surface" nodes.
 */

import type { IndexSchema, ManifestSchema, NodeSchema } from '@act-spec/core';

/** Options for `emitLlmsTxt`. */
export interface EmitLlmsTxtOptions {
  /**
   * Optional override for the canonical site origin used to build absolute
   * URLs. Defaults to `manifest.site.canonical_url` if set; otherwise
   * relative URLs are emitted.
   */
  siteOrigin?: string;
  /**
   * Optional list of node envelopes. When provided, summaries fall back to
   * `node.summary` (already in IndexEntry) and we look at `node.metadata.hidden`,
   * `node.metadata.locale`, etc. Without it the emitter relies on IndexEntry
   * fields only.
   */
  nodes?: ReadonlyArray<NodeSchema.Node>;
}

const TYPE_HEADINGS: Record<string, string> = {
  article: 'Articles',
  doc: 'Documentation',
  page: 'Pages',
  recipe: 'Recipes',
  concept: 'Concepts',
  api: 'API endpoints',
  endpoint: 'API endpoints',
  reference: 'Reference',
  changelog: 'Changelog',
  guide: 'Guides',
  tutorial: 'Tutorials',
  product: 'Products',
  collection: 'Collections',
  category: 'Categories',
};

function titleCase(s: string): string {
  if (s.length === 0) return s;
  return s
    .split(/[-_:/]/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function headingForType(type: string): string {
  if (TYPE_HEADINGS[type] !== undefined) return TYPE_HEADINGS[type];
  return titleCase(type);
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Trim, then walk back to a word boundary if any whitespace within the
  // last 16 chars; otherwise hard cut.
  const cut = s.slice(0, max).trimEnd();
  const ws = cut.lastIndexOf(' ');
  if (ws > max - 16) return cut.slice(0, ws).trimEnd() + '…';
  return cut + '…';
}

function singleLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** True when a node should be omitted from the public surface. */
function isHidden(
  entry: IndexSchema.IndexEntry,
  node: NodeSchema.Node | undefined,
): boolean {
  const top = (entry as unknown as Record<string, unknown>)['hidden'];
  if (top === true) return true;
  if (node) {
    const nTop = (node as unknown as Record<string, unknown>)['hidden'];
    if (nTop === true) return true;
    const meta = node.metadata as Record<string, unknown> | undefined;
    if (meta && meta['hidden'] === true) return true;
  }
  return false;
}

/** Pull a locale tag off the node (or index entry); empty string if none. */
function localeOf(
  entry: IndexSchema.IndexEntry,
  node: NodeSchema.Node | undefined,
): string {
  // 1) Node metadata.locale (PRD-104).
  if (node) {
    const meta = node.metadata as Record<string, unknown> | undefined;
    const ml = meta?.['locale'];
    if (typeof ml === 'string' && ml.length > 0) return ml;
    const top = (node as unknown as Record<string, unknown>)['locale'];
    if (typeof top === 'string' && top.length > 0) return top;
  }
  // 2) Index entry locale (defensive — schema-open).
  const eLocale = (entry as unknown as Record<string, unknown>)['locale'];
  if (typeof eLocale === 'string' && eLocale.length > 0) return eLocale;
  return '';
}

/** Resolve the canonical URL for a node. */
function urlForNode(
  entry: IndexSchema.IndexEntry,
  node: NodeSchema.Node | undefined,
  manifest: ManifestSchema.Manifest,
  origin: string,
): string {
  // 1) source.human_url (preferred — the human-readable page URL).
  if (node) {
    const src = node.source as Record<string, unknown> | undefined;
    const hu = src?.['human_url'];
    if (typeof hu === 'string' && hu.length > 0) {
      if (/^https?:\/\//i.test(hu)) return hu;
      if (origin.length > 0) return origin + (hu.startsWith('/') ? hu : '/' + hu);
      return hu;
    }
  }
  // 2) Path from node_url_template + id (the structured /act/nodes/<id>.json
  //    URL is for agents — for llms.txt we want a *human* URL when
  //    available; if not, fall back to the structured URL so the agent has
  //    *some* link target).
  const tpl = manifest.node_url_template;
  const path = tpl.includes('{id}')
    ? tpl.replace('{id}', encodeURIComponent(entry.id))
    : tpl;
  if (origin.length > 0) return origin + (path.startsWith('/') ? path : '/' + path);
  return path;
}

/** 1-line summary for a node — `summary` if present, else truncated description. */
function lineSummaryFor(
  entry: IndexSchema.IndexEntry,
  node: NodeSchema.Node | undefined,
): string {
  if (typeof entry.summary === 'string' && entry.summary.length > 0) {
    return truncate(singleLine(entry.summary), 140);
  }
  if (node) {
    const desc = (node as unknown as Record<string, unknown>)['description'];
    if (typeof desc === 'string' && desc.length > 0) {
      return truncate(singleLine(desc), 80);
    }
  }
  return '';
}

interface BulletItem {
  title: string;
  url: string;
  summary: string;
  type: string;
  locale: string;
}

/** Render a bullet line for one entry. */
function renderBullet(item: BulletItem): string {
  const safeTitle = item.title.replace(/[\r\n]/g, ' ').trim() || item.url;
  const head = `- [${safeTitle}](${item.url})`;
  if (item.summary.length === 0) return head;
  return `${head}: ${item.summary}`;
}

/** Group items into Map preserving first-seen order. */
function groupBy<T>(items: ReadonlyArray<T>, key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    let arr = out.get(k);
    if (!arr) {
      arr = [];
      out.set(k, arr);
    }
    arr.push(it);
  }
  return out;
}

/**
 * Emit the canonical `/llms.txt` payload as a string, ready for atomic
 * write at the **site root**.
 */
export function emitLlmsTxt(
  manifest: ManifestSchema.Manifest,
  index: IndexSchema.Index,
  options: EmitLlmsTxtOptions = {},
): string {
  const origin = stripTrailingSlash(options.siteOrigin ?? manifest.site.canonical_url ?? '');
  const nodesById = new Map<string, NodeSchema.Node>();
  for (const n of options.nodes ?? []) nodesById.set(n.id, n);

  // 1) Resolve and filter.
  const items: BulletItem[] = [];
  for (const entry of index.nodes) {
    const node = nodesById.get(entry.id);
    if (isHidden(entry, node)) continue;
    items.push({
      title: entry.title || entry.id,
      url: urlForNode(entry, node, manifest, origin),
      summary: lineSummaryFor(entry, node),
      type: entry.type || 'page',
      locale: localeOf(entry, node),
    });
  }

  // 2) Header — `# <site name>` + `> <site description>`.
  const lines: string[] = [];
  lines.push(`# ${manifest.site.name}`);
  lines.push('');
  const desc =
    typeof manifest.site.description === 'string' && manifest.site.description.length > 0
      ? singleLine(manifest.site.description)
      : `Agent Content Tree for ${manifest.site.name}.`;
  lines.push(`> ${desc}`);
  lines.push('');

  // 3) Group: locales when >1 distinct, otherwise types.
  const distinctLocales = new Set(items.map((i) => i.locale).filter((l) => l.length > 0));
  const useLocaleGrouping = distinctLocales.size > 1;

  if (useLocaleGrouping) {
    const byLocale = groupBy(items, (i) => i.locale || 'default');
    for (const [locale, group] of byLocale) {
      lines.push(`## ${locale}`);
      lines.push('');
      const byType = groupBy(group, (i) => i.type || 'page');
      // Inside a locale, organize bullets by type but flat (no nested H3 —
      // canonical llms.txt is two levels max). Type label inlined as a
      // heading-like pseudo-bullet.
      for (const [type, tItems] of byType) {
        lines.push(`### ${headingForType(type)}`);
        lines.push('');
        for (const it of tItems) lines.push(renderBullet(it));
        lines.push('');
      }
    }
  } else {
    const byType = groupBy(items, (i) => i.type || 'page');
    for (const [type, tItems] of byType) {
      lines.push(`## ${headingForType(type)}`);
      lines.push('');
      for (const it of tItems) lines.push(renderBullet(it));
      lines.push('');
    }
  }

  // Always end with a trailing newline; collapse runs of >2 blank lines.
  let out = lines.join('\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

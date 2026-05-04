/**
 * `/llms-full.txt` emitter — ACT v0.2 §3.4 / §3.5 / §6.40 (runbook).
 *
 * Produces a single-file dump of every leaf node's body content, rendered
 * back to markdown (the inverse of the markdown adapter's parse step) so
 * that agents that only know how to ingest llms-full.txt can consume an
 * ACT site verbatim.
 *
 * Per https://llmstxt.org/ the conventional shape of llms-full.txt is a
 * concatenated dump; ACT's variant prefixes each leaf with a YAML
 * frontmatter block (`title`, `url`, `type`, `locale`) so downstream
 * consumers can re-segment if they want to. Leaves are separated by
 * `\n\n---\n\n`.
 *
 * Iteration order = index order (BFS of the canonical index file). When
 * the running byte count exceeds `maxBytes`, emission stops and a final
 * `<!-- truncated at N bytes -->` marker is appended (so consumers can
 * detect truncation).
 *
 * Block → markdown rendering is best-effort:
 *   - markdown        → text verbatim
 *   - prose           → text verbatim
 *   - heading         → `#` × level + text (or `## ` if level missing)
 *   - code            → fenced ``` with optional language + filename comment
 *   - list            → `- ` prefix per item
 *   - table           → markdown pipe table
 *   - callout         → blockquote with `[type]` prefix line
 *   - data            → fenced ``` with format as language tag
 *   - component / unknown / marketing:* → opaque comment
 *     `<!-- component: <type> -->` (arbitrary components don't render
 *     cleanly to markdown; preserving the type lets a downstream agent
 *     know there was something there).
 */

import type { IndexSchema, ManifestSchema, NodeSchema } from '@act-spec/core';

/** Default size cap (5 MB). */
export const DEFAULT_LLMS_FULL_MAX_BYTES = 5_000_000;

/** Async fetcher for node envelopes by id. */
export type NodeFetcher = (id: string) => Promise<NodeSchema.Node | undefined> | NodeSchema.Node | undefined;

export interface EmitLlmsFullTxtOptions {
  /** Maximum payload size (bytes, UTF-8). Default 5_000_000. */
  maxBytes?: number;
  /** Override for canonical site origin used in frontmatter URLs. */
  siteOrigin?: string;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function singleLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isHidden(node: NodeSchema.Node): boolean {
  const top = (node as unknown as Record<string, unknown>)['hidden'];
  if (top === true) return true;
  const meta = node.metadata as Record<string, unknown> | undefined;
  if (meta && meta['hidden'] === true) return true;
  return false;
}

function isLeaf(node: NodeSchema.Node): boolean {
  // A "leaf" for llms-full.txt purposes = node has no children OR has a
  // non-empty content[]. The intent is "renderable body" — pure-grouping
  // nodes (children only, no body) are skipped.
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const hasBody = Array.isArray(node.content) && node.content.length > 0;
  if (!hasChildren) return true;
  return hasBody;
}

function localeOf(node: NodeSchema.Node): string {
  const meta = node.metadata as Record<string, unknown> | undefined;
  const ml = meta?.['locale'];
  if (typeof ml === 'string' && ml.length > 0) return ml;
  const top = (node as unknown as Record<string, unknown>)['locale'];
  if (typeof top === 'string' && top.length > 0) return top;
  return '';
}

function urlFor(node: NodeSchema.Node, manifest: ManifestSchema.Manifest, origin: string): string {
  const src = node.source as Record<string, unknown> | undefined;
  const hu = src?.['human_url'];
  if (typeof hu === 'string' && hu.length > 0) {
    if (/^https?:\/\//i.test(hu)) return hu;
    if (origin.length > 0) return origin + (hu.startsWith('/') ? hu : '/' + hu);
    return hu;
  }
  const tpl = manifest.node_url_template;
  const path = tpl.includes('{id}') ? tpl.replace('{id}', encodeURIComponent(node.id)) : tpl;
  if (origin.length > 0) return origin + (path.startsWith('/') ? path : '/' + path);
  return path;
}

function escapeFrontmatterValue(s: string): string {
  // YAML 1.2 plain-scalar safety:
  //   - newlines / quotes / brackets force quoting.
  //   - a `:` is only a key/value separator when followed by whitespace,
  //     so `https://...` is a valid plain scalar.
  //   - a `#` *preceded* by whitespace starts a comment; safer to quote
  //     when present.
  if (/[\n"'\\[\]{}]/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  if (/:\s/.test(s)) {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }
  if (/(^|\s)#/.test(s)) {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }
  return s;
}

/** Render a single content block to markdown. */
export function renderBlockToMarkdown(block: NodeSchema.ContentBlock): string {
  const b = block as Record<string, unknown>;
  const type = typeof b['type'] === 'string' ? b['type'] : 'unknown';

  if (type === 'markdown') {
    const text = typeof b['text'] === 'string' ? (b['text']) : '';
    return text;
  }
  if (type === 'prose') {
    const text = typeof b['text'] === 'string' ? (b['text']) : '';
    return text;
  }
  if (type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(b['level'] ?? 2) || 2));
    const text = typeof b['text'] === 'string' ? (b['text']) : '';
    return `${'#'.repeat(level)} ${text}`;
  }
  if (type === 'code') {
    const lang = typeof b['language'] === 'string' ? (b['language']) : '';
    const text = typeof b['text'] === 'string' ? (b['text']) : '';
    const filename = typeof b['filename'] === 'string' ? (b['filename']) : '';
    const head = filename.length > 0 ? `\`\`\`${lang} title="${filename}"` : `\`\`\`${lang}`;
    return `${head}\n${text}\n\`\`\``;
  }
  if (type === 'data') {
    const fmt = typeof b['format'] === 'string' ? (b['format']) : '';
    const text = typeof b['text'] === 'string' ? (b['text']) : '';
    return `\`\`\`${fmt}\n${text}\n\`\`\``;
  }
  if (type === 'callout') {
    const level = typeof b['level'] === 'string' ? (b['level']) : 'info';
    const text = typeof b['text'] === 'string' ? (b['text']) : '';
    const lines = text.split('\n').map((ln) => `> ${ln}`);
    return `> [${level.toUpperCase()}]\n${lines.join('\n')}`;
  }
  if (type === 'list') {
    const items = Array.isArray(b['items']) ? (b['items'] as unknown[]) : [];
    const ordered = b['ordered'] === true;
    return items
      .map((it, i) => {
        const itemText = typeof it === 'string' ? it : typeof (it as { text?: unknown })?.text === 'string' ? String((it as { text: string }).text) : JSON.stringify(it);
        const prefix = ordered ? `${i + 1}. ` : '- ';
        return prefix + itemText;
      })
      .join('\n');
  }
  if (type === 'table') {
    const headers = Array.isArray(b['headers']) ? (b['headers'] as unknown[]).map((h) => String(h)) : [];
    const rows = Array.isArray(b['rows']) ? (b['rows'] as unknown[]) : [];
    if (headers.length === 0) return `<!-- table: missing headers -->`;
    const head = `| ${headers.join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows
      .map((r) => {
        const arr = Array.isArray(r) ? (r as unknown[]).map((c) => String(c)) : headers.map(() => '');
        return `| ${arr.join(' | ')} |`;
      })
      .join('\n');
    return [head, sep, body].filter((s) => s.length > 0).join('\n');
  }

  // Unknown / marketing:* / component → opaque placeholder.
  return `<!-- component: ${type} -->`;
}

/** Render every block in a node's content[] to a single markdown string. */
function renderNodeBody(node: NodeSchema.Node): string {
  if (!Array.isArray(node.content) || node.content.length === 0) return '';
  return node.content
    .map((b) => renderBlockToMarkdown(b))
    .filter((s) => s.length > 0)
    .join('\n\n');
}

/** Build the YAML frontmatter for a leaf. */
function frontmatterFor(node: NodeSchema.Node, manifest: ManifestSchema.Manifest, origin: string): string {
  const url = urlFor(node, manifest, origin);
  const locale = localeOf(node);
  const lines = [
    '---',
    `title: ${escapeFrontmatterValue(singleLine(node.title))}`,
    `url: ${escapeFrontmatterValue(url)}`,
    `type: ${escapeFrontmatterValue(node.type)}`,
  ];
  if (locale.length > 0) lines.push(`locale: ${escapeFrontmatterValue(locale)}`);
  if (typeof node.summary === 'string' && node.summary.length > 0) {
    lines.push(`summary: ${escapeFrontmatterValue(singleLine(node.summary))}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Emit the `/llms-full.txt` payload, walking the index in order. Each
 * leaf's frontmatter + rendered body is concatenated with `\n\n---\n\n`
 * separators. Truncates at `maxBytes` (UTF-8) with a trailing
 * `<!-- truncated at N bytes -->` marker.
 *
 * BFS-by-index-order: the index is already topologically sensible (parents
 * before children for the canonical builders here), so ordering follows
 * `index.nodes` iteration.
 */
export async function emitLlmsFullTxt(
  manifest: ManifestSchema.Manifest,
  index: IndexSchema.Index,
  nodeFetcher: NodeFetcher,
  options: EmitLlmsFullTxtOptions = {},
): Promise<string> {
  const max = typeof options.maxBytes === 'number' && options.maxBytes > 0
    ? options.maxBytes
    : DEFAULT_LLMS_FULL_MAX_BYTES;
  const origin = stripTrailingSlash(options.siteOrigin ?? manifest.site.canonical_url ?? '');

  // Header: site identity + summary so a downstream LLM has context.
  const headerLines: string[] = [];
  headerLines.push(`# ${manifest.site.name}`);
  headerLines.push('');
  if (typeof manifest.site.description === 'string' && manifest.site.description.length > 0) {
    headerLines.push(`> ${singleLine(manifest.site.description)}`);
    headerLines.push('');
  }
  let out = headerLines.join('\n');
  let bytes = Buffer.byteLength(out, 'utf8');
  let truncated = false;
  let leafCount = 0;

  for (const entry of index.nodes) {
    const fetched = await nodeFetcher(entry.id);
    if (!fetched) continue;
    if (isHidden(fetched)) continue;
    if (!isLeaf(fetched)) continue;
    const body = renderNodeBody(fetched);
    if (body.length === 0) continue;

    const fm = frontmatterFor(fetched, manifest, origin);
    // The frontmatter itself starts with `---`, so the leaf already
    // visually demarcates from what came before. Use a simple double-
    // newline gap; consumers split on `^---$` lines if they want
    // per-section parsing.
    const gap = leafCount === 0 ? '\n' : '\n\n';
    const chunk = `${gap}${fm}\n\n${body}\n`;
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    if (bytes + chunkBytes > max) {
      truncated = true;
      break;
    }
    out += chunk;
    bytes += chunkBytes;
    leafCount += 1;
  }

  if (truncated) {
    out += `\n\n<!-- truncated at ${bytes} bytes (max ${max}) -->\n`;
  } else if (!out.endsWith('\n')) {
    out += '\n';
  }
  return out;
}

/**
 * Convenience builder — when the caller has the full nodes[] in memory
 * (the generator-core pipeline does), wrap them in a synchronous fetcher.
 */
export function nodeFetcherFromArray(nodes: ReadonlyArray<NodeSchema.Node>): NodeFetcher {
  const byId = new Map<string, NodeSchema.Node>();
  for (const n of nodes) byId.set(n.id, n);
  return (id: string) => byId.get(id);
}

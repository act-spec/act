/**
 * PRD-204-R8 / R9 / R10 — Storyblok rich text (TipTap-derived) → PRD-102 blocks.
 *
 * Self-contained markdown serializer. Walks Storyblok rich-text JSON, coalesces
 * sequential lists, maps headings/blockquote/code/callout/horizontal_rule/image,
 * and routes embedded `blok` nodes to either configured `componentMapping` →
 * `marketing:*` (Plus) or partial-extraction prose fallback. Anti-pattern hedge:
 * this walker NEVER fabricates `marketing:*` blocks without an explicit
 * `componentMapping` config (Open Question 3 sibling — strict over permissive).
 */
import type {
  RichtextDoc,
  RichtextBlockNode,
  RichtextNode,
  RichtextTextNode,
  RichtextMark,
  StoryblokAdapterConfig,
  StoryblokBlokPayload,
} from './types.js';

/**
 * Subset of PRD-102 block shapes the converter emits.
 */
export type ContentBlock =
  | { type: 'prose'; format: 'plain' | 'markdown'; text: string; metadata?: Record<string, unknown> }
  | { type: 'code'; language?: string; text: string }
  | { type: 'callout'; level: 'info' | 'warning' | 'error' | 'tip'; text: string }
  | { type: string; [k: string]: unknown };

export interface RichtextConvertContext {
  targetLevel: 'core' | 'standard' | 'strict';
  componentMapping?: StoryblokAdapterConfig['componentMapping'];
  /** PRD-204-R9 — recursion bound for `blok`. */
  componentRecursionMax: number;
  /** PRD-204-R8 — default callout level when blockquote → callout. */
  calloutLevel?: 'info' | 'warning' | 'error' | 'tip';
  /** Receives recoverable warnings; framework treats these as build warnings. */
  warn: (msg: string) => void;
}

interface WalkResult {
  blocks: ContentBlock[];
  partial: boolean;
}

/**
 * PRD-204-R8 — top-level walker. Returns a stable-ordered array of blocks.
 */
export function walkRichtext(
  doc: RichtextDoc | RichtextNode[] | undefined | null,
  ctx: RichtextConvertContext,
): WalkResult {
  const nodes = normalizeRoot(doc);
  return walkNodes(nodes, ctx, 0);
}

function normalizeRoot(
  doc: RichtextDoc | RichtextNode[] | undefined | null,
): RichtextNode[] {
  if (doc === null || doc === undefined) return [];
  if (Array.isArray(doc)) return doc;
  if (typeof doc === 'object' && Array.isArray(doc.content)) {
    return doc.content;
  }
  return [];
}

function walkNodes(
  nodes: RichtextNode[],
  ctx: RichtextConvertContext,
  depth: number,
): WalkResult {
  const out: ContentBlock[] = [];
  let partial = false;

  // List coalescing buffer.
  let listBuffer: { kind: 'bullet' | 'number'; items: RichtextBlockNode[] } | null = null;
  const flushList = (): void => {
    if (!listBuffer || listBuffer.items.length === 0) {
      listBuffer = null;
      return;
    }
    out.push(coalesceList(listBuffer.items, listBuffer.kind));
    listBuffer = null;
  };

  for (const node of nodes) {
    if (!isBlockNode(node)) {
      continue;
    }
    const t = node.type;
    if (t === 'bullet_list' || t === 'ordered_list') {
      flushList();
      const kind: 'bullet' | 'number' = t === 'bullet_list' ? 'bullet' : 'number';
      const items = (node.content ?? []).filter(isBlockNode);
      out.push(coalesceList(items, kind));
      continue;
    }
    if (t === 'list_item') {
      // Bare list item (out of a list parent — rare but possible).
      const kind: 'bullet' | 'number' = 'bullet';
      if (!listBuffer) listBuffer = { kind, items: [] };
      listBuffer.items.push(node);
      continue;
    }
    flushList();

    if (t === 'paragraph') {
      out.push({
        type: 'prose',
        format: paragraphFormat(node),
        text: childrenToMarkdown(node.content),
      });
      continue;
    }
    if (t === 'heading') {
      const level = readNumberAttr(node.attrs, 'level', 1);
      const safeLevel = Math.min(6, Math.max(1, level));
      const hashes = '#'.repeat(safeLevel);
      out.push({
        type: 'prose',
        format: 'markdown',
        text: `${hashes} ${childrenToMarkdown(node.content)}`,
      });
      continue;
    }
    if (t === 'code_block') {
      out.push({
        type: 'code',
        language: codeBlockLanguage(node),
        text: codeBlockText(node),
      });
      continue;
    }
    if (t === 'blockquote') {
      const text = childrenToMarkdown(node.content);
      const level = ctx.calloutLevel ?? 'info';
      out.push({ type: 'callout', level, text });
      continue;
    }
    if (t === 'horizontal_rule') {
      out.push({ type: 'prose', format: 'markdown', text: '---' });
      continue;
    }
    if (t === 'image') {
      const alt = readStringAttr(node.attrs, 'alt') ?? '';
      const src = readStringAttr(node.attrs, 'src') ?? '';
      out.push({ type: 'prose', format: 'markdown', text: `![${alt}](${src})` });
      continue;
    }
    if (t === 'blok') {
      const blokResult = walkBlok(node, ctx, depth);
      for (const b of blokResult.blocks) out.push(b);
      if (blokResult.partial) partial = true;
      continue;
    }

    // Unknown node type — partial-extraction warning per PRD-204-R8 / R22.
    partial = true;
    ctx.warn(`storyblok richtext: unmapped node "${t}"`);
    out.push({
      type: 'prose',
      format: 'markdown',
      text: `(unsupported rich-text node: ${t})`,
      metadata: {
        extraction_status: 'partial',
        extraction_error: `unsupported rich-text node: ${t}`,
      },
    });
  }

  flushList();
  return { blocks: out, partial };
}

function isBlockNode(n: RichtextNode | undefined): n is RichtextBlockNode {
  return !!n && typeof n === 'object' && typeof (n as { type?: unknown }).type === 'string'
    && (n as { type: string }).type !== 'text';
}

function isTextNode(n: RichtextNode | undefined): n is RichtextTextNode {
  return !!n && typeof n === 'object' && (n as { type?: unknown }).type === 'text';
}

function readStringAttr(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!attrs) return undefined;
  const v = attrs[key];
  return typeof v === 'string' ? v : undefined;
}

function readNumberAttr(attrs: Record<string, unknown> | undefined, key: string, dflt: number): number {
  if (!attrs) return dflt;
  const v = attrs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function paragraphFormat(node: RichtextBlockNode): 'plain' | 'markdown' {
  const children = node.content ?? [];
  for (const c of children) {
    if (isTextNode(c) && c.marks && c.marks.length > 0) return 'markdown';
  }
  return 'plain';
}

function childrenToMarkdown(children: RichtextNode[] | undefined): string {
  if (!Array.isArray(children)) return '';
  const parts: string[] = [];
  for (const c of children) {
    if (isTextNode(c)) {
      parts.push(applyMarks(c.text, c.marks));
      continue;
    }
    // Inline / nested block within a heading / paragraph — recurse for text.
    if (isBlockNode(c)) {
      parts.push(childrenToMarkdown(c.content));
    }
  }
  return parts.join('');
}

function applyMarks(text: string, marks: RichtextMark[] | undefined): string {
  if (!marks || marks.length === 0) return text;
  let out = text;
  // Decorator marks first (innermost — closest to text).
  for (const m of marks) {
    switch (m.type) {
      case 'code': out = '`' + out + '`'; break;
      case 'bold': out = `**${out}**`; break;
      case 'italic': out = `*${out}*`; break;
      case 'strike': out = `~~${out}~~`; break;
      case 'underline': out = `<u>${out}</u>`; break;
      default: /* annotation — handled below */ break;
    }
  }
  // Annotation marks (e.g., link) — outer wrap.
  for (const m of marks) {
    if (m.type === 'link') {
      const href = m.attrs ? m.attrs['href'] : undefined;
      if (typeof href === 'string') out = `[${out}](${href})`;
    }
  }
  return out;
}

function coalesceList(items: RichtextBlockNode[], kind: 'bullet' | 'number'): ContentBlock {
  const lines: string[] = [];
  for (const it of items) {
    const innerNodes = it.content ?? [];
    // A `list_item` typically wraps a paragraph; flatten to its text.
    const inner = innerNodes
      .map((n) =>
        isBlockNode(n)
          ? childrenToMarkdown(n.content)
          : isTextNode(n)
          ? applyMarks(n.text, n.marks)
          : '',
      )
      .join('');
    const prefix = kind === 'number' ? '1. ' : '- ';
    lines.push(`${prefix}${inner}`);
  }
  return { type: 'prose', format: 'markdown', text: lines.join('\n') };
}

function codeBlockLanguage(node: RichtextBlockNode): string {
  const cls = readStringAttr(node.attrs, 'class');
  if (typeof cls === 'string') {
    const m = /language-([\w+-]+)/.exec(cls);
    if (m && m[1]) return m[1];
  }
  const lang = readStringAttr(node.attrs, 'language');
  if (typeof lang === 'string' && lang.length > 0) return lang;
  return 'text';
}

function codeBlockText(node: RichtextBlockNode): string {
  const c = node.content ?? [];
  const parts: string[] = [];
  for (const n of c) {
    if (isTextNode(n)) parts.push(n.text);
  }
  if (parts.length > 0) return parts.join('');
  // Some Storyblok payloads pin code as `text` directly on the node.
  return typeof node.text === 'string' ? node.text : '';
}

/**
 * PRD-204-R9 / R10 — `blok` walk with recursion bound + componentMapping path.
 */
function walkBlok(
  node: RichtextBlockNode,
  ctx: RichtextConvertContext,
  depth: number,
): WalkResult {
  const max = ctx.componentRecursionMax;
  const body = readBlokBody(node);
  if (depth >= max) {
    const componentNames = body.map((b) => b.component).join(', ') || '<unknown>';
    ctx.warn(
      `component recursion bound exceeded at depth ${String(depth)}: ${componentNames}`,
    );
    return {
      blocks: [
        {
          type: 'prose',
          format: 'markdown',
          text: `(component recursion bound exceeded at depth ${String(depth)}: ${componentNames})`,
          metadata: {
            extraction_status: 'partial',
            extraction_error: `component recursion exceeded depth ${String(max)} in component '${componentNames}'`,
          },
        },
      ],
      partial: true,
    };
  }

  const out: ContentBlock[] = [];
  let partial = false;

  for (const blok of body) {
    const mapping = ctx.componentMapping?.[blok.component];
    if (mapping) {
      out.push(emitMappedBlock(blok, mapping));
      continue;
    }
    // No mapping — partial fallback (PRD-204-R8 / R22).
    partial = true;
    ctx.warn(`storyblok blok: no component mapping for "${blok.component}"`);
    out.push({
      type: 'prose',
      format: 'markdown',
      text: `(unmapped component: ${blok.component})`,
      metadata: {
        extraction_status: 'partial',
        extraction_error: `unmapped component: ${blok.component}`,
        block_uid: typeof blok._uid === 'string' ? blok._uid : undefined,
      },
    });
  }

  return { blocks: out, partial };
}

function readBlokBody(node: RichtextBlockNode): StoryblokBlokPayload[] {
  // Storyblok's TipTap ships `blok` as `{ type: 'blok', attrs: { id, body: [...] } }`.
  const attrs = node.attrs;
  if (attrs && Array.isArray(attrs['body'])) {
    return (attrs['body']).filter(
      (b): b is StoryblokBlokPayload =>
        !!b && typeof b === 'object' && typeof (b as { component?: unknown }).component === 'string',
    );
  }
  return [];
}

/**
 * PRD-204-R10 — emit `marketing:*` block per `componentMapping` projection.
 * Field paths are simple dot/bracket projections evaluated against the source
 * blok payload.
 */
function emitMappedBlock(
  src: StoryblokBlokPayload,
  cm: { type: string; fields: Record<string, unknown> },
): ContentBlock {
  const out: Record<string, unknown> = { type: cm.type };
  for (const [actField, projection] of Object.entries(cm.fields)) {
    out[actField] = project(src, projection);
  }
  // Open Question 2 resolution — `metadata.block_uid` carries the Storyblok _uid.
  if (typeof src._uid === 'string') {
    const meta: Record<string, unknown> = { block_uid: src._uid };
    out['metadata'] = meta;
  }
  return out as ContentBlock;
}

/**
 * Tiny projection helper: a string is a path; an object literal is a structural
 * mapping (each value projected from the source). Per PRD-204 Example 4,
 * `cta: { label: "ctaLabel", href: "ctaHref" }` projects to
 * `{ label: src.ctaLabel, href: src.ctaHref }`.
 */
function project(src: Record<string, unknown>, projection: unknown): unknown {
  if (typeof projection === 'string') {
    return resolvePath(src, projection);
  }
  if (Array.isArray(projection)) {
    return projection.map((p) => project(src, p));
  }
  if (projection !== null && typeof projection === 'object') {
    const obj = projection as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = project(src, v);
    }
    return out;
  }
  return projection;
}

function resolvePath(src: Record<string, unknown>, path: string): unknown {
  // Strip simple GROQ-style `[]` markers; we just descend by dot.
  const cleaned = path.replace(/\[\]/g, '');
  const parts = cleaned.split('.').filter((p) => p.length > 0);
  let cur: unknown = src;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

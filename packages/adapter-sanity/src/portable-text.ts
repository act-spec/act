/**
 * PRD-203-R8 / R9 — Portable Text → PRD-102 block taxonomy.
 *
 * Self-contained markdown serializer. Walks Sanity Portable Text arrays,
 * coalesces sequential list items, maps headings/blockquote/code/callout,
 * and routes custom block types via `componentMapping` (Plus) per
 * PRD-203-R9. Anti-pattern hedge: this walker NEVER fabricates `marketing:*`
 * blocks without an explicit `componentMapping` config (Open Question 3
 * resolution: "Configurable opt-in. Strict over permissive.").
 */
import type {
  PortableTextBlock,
  PortableTextCustomBlock,
  PortableTextMarkDef,
  PortableTextNode,
  PortableTextSpan,
  SanityAdapterConfig,
} from './types.js';

/**
 * Subset of PRD-102 block shapes the converter emits.
 */
export type ContentBlock =
  | { type: 'prose'; format: 'plain' | 'markdown'; text: string; metadata?: Record<string, unknown> }
  | { type: 'code'; language?: string; text: string }
  | { type: 'callout'; level: 'info' | 'warning' | 'error' | 'tip'; text: string }
  | { type: string; [k: string]: unknown };

export interface PortableTextConvertContext {
  targetLevel: 'core' | 'standard' | 'strict';
  componentMapping?: SanityAdapterConfig['componentMapping'];
  /** Receives recoverable warnings; framework treats these as build warnings. */
  warn: (msg: string) => void;
}

/**
 * PRD-203-R8 — top-level walker. Returns a stable-ordered array of blocks.
 */
export function walkPortableText(
  body: PortableTextNode[] | undefined | null,
  ctx: PortableTextConvertContext,
): { blocks: ContentBlock[]; partial: boolean } {
  const out: ContentBlock[] = [];
  let partial = false;
  if (!Array.isArray(body)) return { blocks: out, partial };

  // List coalescing buffer.
  let listBuffer: PortableTextBlock[] = [];
  const flushList = (): void => {
    if (listBuffer.length === 0) return;
    out.push(coalesceList(listBuffer));
    listBuffer = [];
  };

  for (const node of body) {
    if (!node || typeof node !== 'object' || typeof node._type !== 'string') {
      continue;
    }
    if (node._type === 'block') {
      const blk = node as PortableTextBlock;
      if (blk.listItem === 'bullet' || blk.listItem === 'number') {
        listBuffer.push(blk);
        continue;
      }
      flushList();
      out.push(blockToProse(blk));
      continue;
    }
    flushList();
    // Component mapping (PRD-203-R9 — Plus).
    const cm = ctx.componentMapping?.[node._type];
    if (cm !== undefined) {
      out.push(emitMappedBlock(node as PortableTextCustomBlock, cm));
      continue;
    }
    // Built-in custom types.
    if (node._type === 'code') {
      const lang = (node as { language?: unknown }).language;
      const text = (node as { code?: unknown }).code;
      out.push({
        type: 'code',
        ...(typeof lang === 'string' && lang.length > 0 ? { language: lang } : {}),
        text: typeof text === 'string' ? text : '',
      });
      continue;
    }
    if (node._type === 'callout') {
      const tone = (node as { tone?: unknown }).tone;
      const text = (node as { text?: unknown }).text;
      out.push({
        type: 'callout',
        level: mapTone(typeof tone === 'string' ? tone : 'info'),
        text: typeof text === 'string' ? text : '',
      });
      continue;
    }
    // Unmapped custom type — partial-extraction warning per PRD-203-R8 / R21.
    partial = true;
    ctx.warn(`portable-text: unmapped _type "${node._type}"`);
    out.push({
      type: 'prose',
      format: 'markdown',
      text: `(unsupported block type: ${node._type})`,
      metadata: {
        extraction_status: 'partial',
        extraction_error: `unsupported portable-text type: ${node._type}`,
      },
    });
  }

  flushList();
  return { blocks: out, partial };
}

/** PRD-203-R8 — block (style/heading/blockquote) → prose. */
function blockToProse(blk: PortableTextBlock): ContentBlock {
  const text = childrenToMarkdown(blk.children, blk.markDefs);
  const style = blk.style ?? 'normal';
  if (style === 'normal') {
    const hasMarks = childrenHaveFormatting(blk.children, blk.markDefs);
    return { type: 'prose', format: hasMarks ? 'markdown' : 'plain', text };
  }
  if (style === 'blockquote') {
    const lines = text.split('\n').map((l) => `> ${l}`);
    return { type: 'prose', format: 'markdown', text: lines.join('\n') };
  }
  // h1..h6
  const m = /^h([1-6])$/.exec(style);
  if (m) {
    const level = Number(m[1]);
    const hashes = '#'.repeat(level);
    return { type: 'prose', format: 'markdown', text: `${hashes} ${text}` };
  }
  // Unknown style — fall back to plain prose.
  return { type: 'prose', format: 'plain', text };
}

/** Coalesce sequential list items into a single prose block. */
function coalesceList(items: PortableTextBlock[]): ContentBlock {
  const lines: string[] = [];
  for (const it of items) {
    const inner = childrenToMarkdown(it.children, it.markDefs);
    const prefix = it.listItem === 'number' ? '1. ' : '- ';
    lines.push(`${prefix}${inner}`);
  }
  return { type: 'prose', format: 'markdown', text: lines.join('\n') };
}

function childrenToMarkdown(
  spans: PortableTextSpan[] | undefined,
  markDefs: PortableTextMarkDef[] | undefined,
): string {
  if (!Array.isArray(spans)) return '';
  const parts: string[] = [];
  for (const s of spans) {
    if (!s || s._type !== 'span' || typeof s.text !== 'string') continue;
    parts.push(spanWithMarks(s, markDefs));
  }
  return parts.join('');
}

function spanWithMarks(
  s: PortableTextSpan,
  markDefs: PortableTextMarkDef[] | undefined,
): string {
  let text = s.text;
  const marks = s.marks ?? [];
  // Decorator marks first (innermost — applied closest to text).
  for (const m of marks) {
    if (m === 'code') text = '`' + text + '`';
    else if (m === 'strong') text = `**${text}**`;
    else if (m === 'em') text = `*${text}*`;
    else if (m === 'underline') text = `<u>${text}</u>`;
  }
  // Annotation marks (e.g., links) — outer wrap.
  for (const m of marks) {
    if (m === 'code' || m === 'strong' || m === 'em' || m === 'underline') continue;
    const def = markDefs?.find((d) => d._key === m);
    if (def && def._type === 'link' && typeof def.href === 'string') {
      text = `[${text}](${def.href})`;
    }
  }
  return text;
}

function childrenHaveFormatting(
  spans: PortableTextSpan[] | undefined,
  markDefs: PortableTextMarkDef[] | undefined,
): boolean {
  if (!Array.isArray(spans)) return false;
  for (const s of spans) {
    if (!s || s._type !== 'span') continue;
    const marks = s.marks ?? [];
    if (marks.length === 0) continue;
    for (const m of marks) {
      if (m === 'code' || m === 'strong' || m === 'em' || m === 'underline') return true;
      const def = markDefs?.find((d) => d._key === m);
      if (def !== undefined) return true;
    }
  }
  return false;
}

function mapTone(tone: string): 'info' | 'warning' | 'error' | 'tip' {
  if (tone === 'warning' || tone === 'warn') return 'warning';
  if (tone === 'error' || tone === 'danger') return 'error';
  if (tone === 'tip' || tone === 'success') return 'tip';
  return 'info';
}

/**
 * PRD-203-R9 — emit `marketing:*` block per `componentMapping`. Field paths
 * are simple dot/bracket projections evaluated against the source block.
 */
function emitMappedBlock(
  src: PortableTextCustomBlock,
  cm: { type: string; fields: Record<string, unknown> },
): ContentBlock {
  const out: Record<string, unknown> = { type: cm.type };
  for (const [actField, projection] of Object.entries(cm.fields)) {
    out[actField] = project(src, projection);
  }
  return out as ContentBlock;
}

/**
 * Tiny projection helper: a string is a path; an object literal is a
 * structural mapping (each value projected from the source). Per PRD-203
 * Example 4, `cta: { label: "ctaLabel", href: "ctaHref" }` projects to
 * `{ label: src.ctaLabel, href: src.ctaHref }`.
 */
function project(src: Record<string, unknown>, projection: unknown): unknown {
  if (typeof projection === 'string') {
    // Path projection. `a.b.c` walks; `a[]` denotes "this is an array".
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

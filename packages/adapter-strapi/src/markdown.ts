/**
 * PRD-205-R9 — markdown body emission.
 *
 * Default mode: emit a single `markdown` block (PRD-102-R1) with the source
 * markdown verbatim. Split mode: walk the markdown line-by-line and emit a
 * sequence of `prose` (PRD-102-R2), `code` (PRD-102-R3), and `callout`
 * (PRD-102-R5) blocks.
 *
 * The split walker is in-tree: a tiny line-oriented CommonMark-subset
 * recognizer covering the requirements PRD-205-R9 names directly:
 *  - paragraphs and inline-formatted prose → `prose` (`format: "markdown"`)
 *  - fenced code blocks (```lang) → `code` (`language` from the fence)
 *  - admonition / blockquote markers (`> [!info]`, `> [!warning]`, etc.)
 *    → `callout` (`level` from the marker)
 *  - lists are coalesced into single `prose` blocks per list (PRD-205-R9)
 *  - headings are merged into the following `prose` block (PRD-205-R9)
 *
 * Anti-pattern hedge: this walker NEVER fabricates `marketing:*` blocks
 * (component blocks come from dynamic-zone walks per R10/R11, NOT from
 * markdown). It only emits the three concrete block types PRD-205-R9 names.
 */

/** Subset of PRD-102 block shapes the converter emits. */
export type ContentBlock =
  | { type: 'markdown'; text: string }
  | { type: 'prose'; format: 'plain' | 'markdown'; text: string; metadata?: Record<string, unknown> }
  | { type: 'code'; language: string; text: string }
  | { type: 'callout'; level: 'info' | 'warning' | 'error' | 'tip'; text: string }
  | { type: string; [k: string]: unknown };

export interface MarkdownConvertContext {
  /** When `false` → single `markdown` block; when `true` → split walk. */
  parseMarkdown: boolean;
  /** Receives recoverable warnings; framework treats these as build warnings. */
  warn: (msg: string) => void;
}

export interface WalkResult {
  blocks: ContentBlock[];
  /** True when at least one block was emitted with extraction_status="partial". */
  partial: boolean;
}

const ADMONITION_RE = /^>\s*\[!(info|warning|error|tip|note|caution)\]\s*(.*)$/i;

/** Map admonition markers to PRD-102 callout levels. */
function admonitionLevel(marker: string): 'info' | 'warning' | 'error' | 'tip' {
  switch (marker.toLowerCase()) {
    case 'warning':
    case 'caution':
      return 'warning';
    case 'error':
      return 'error';
    case 'tip':
      return 'tip';
    case 'info':
    case 'note':
    default:
      return 'info';
  }
}

/**
 * PRD-205-R9 — top-level emitter.
 *
 * Default mode: a single `markdown` block carrying the source markdown
 * verbatim (lowest-loss strategy). Split mode: a walk that emits prose /
 * code / callout blocks.
 */
export function emitMarkdownBody(
  source: string,
  ctx: MarkdownConvertContext,
): WalkResult {
  if (typeof source !== 'string') {
    // Defensive: a non-string body is a partial extraction signal.
    ctx.warn('markdown body field was not a string; emitting empty markdown block');
    return { blocks: [{ type: 'markdown', text: '' }], partial: true };
  }
  if (!ctx.parseMarkdown) {
    return { blocks: [{ type: 'markdown', text: source }], partial: false };
  }
  return walkMarkdownSplit(source, ctx);
}

/**
 * PRD-205-R9 split mode — walk the markdown source and emit prose/code/callout
 * blocks. Headings are merged into the following prose block; lists are
 * coalesced into single prose blocks per list.
 */
export function walkMarkdownSplit(
  source: string,
  ctx: MarkdownConvertContext,
): WalkResult {
  const out: ContentBlock[] = [];
  let partial = false;

  const lines = source.split(/\r?\n/);
  const proseBuf: string[] = [];
  const flushProse = (): void => {
    if (proseBuf.length === 0) return;
    // Trim leading and trailing blank lines.
    while (proseBuf.length > 0 && (proseBuf[0] ?? '').trim() === '') proseBuf.shift();
    while (proseBuf.length > 0 && (proseBuf[proseBuf.length - 1] ?? '').trim() === '') proseBuf.pop();
    if (proseBuf.length === 0) return;
    out.push({ type: 'prose', format: 'markdown', text: proseBuf.join('\n') });
    proseBuf.length = 0;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trimStart();

    // Fenced code block.
    const fence = /^(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(trimmed);
    if (fence) {
      flushProse();
      const fenceMarker = fence[1] ?? '```';
      const lang = (fence[2] ?? '').trim();
      const collected: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        if (inner.trimStart().startsWith(fenceMarker)) {
          closed = true;
          i += 1;
          break;
        }
        collected.push(inner);
        i += 1;
      }
      if (!closed) {
        // Unterminated fence — emit what we collected as code, partial.
        partial = true;
        ctx.warn('unterminated fenced code block; partial emission');
      }
      out.push({
        type: 'code',
        language: lang.length > 0 ? lang : 'text',
        text: collected.join('\n'),
      });
      continue;
    }

    // Admonition / GFM-style alert (`> [!info] body`). Multi-line: subsequent
    // `> ...` lines are appended.
    const adm = ADMONITION_RE.exec(line.trim());
    if (adm) {
      flushProse();
      const level = admonitionLevel(adm[1] ?? 'info');
      const body: string[] = [];
      const first = (adm[2] ?? '').trim();
      if (first.length > 0) body.push(first);
      i += 1;
      while (i < lines.length) {
        const inner = (lines[i] ?? '').trim();
        if (!inner.startsWith('>')) break;
        const stripped = inner.replace(/^>\s?/, '');
        if (stripped.length > 0) body.push(stripped);
        i += 1;
      }
      out.push({ type: 'callout', level, text: body.join(' ').trim() });
      continue;
    }

    // Plain blockquote (no admonition marker) — coalesce into prose.
    if (trimmed.startsWith('>')) {
      proseBuf.push(line);
      i += 1;
      continue;
    }

    // Heading — fold into the *following* prose block per PRD-205-R9.
    if (/^#{1,6}\s+/.test(trimmed)) {
      proseBuf.push(line);
      i += 1;
      continue;
    }

    // List items — coalesce until a non-list line, then emit as a single prose block.
    if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
      flushProse();
      const listLines: string[] = [line];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        const innerTrim = inner.trimStart();
        if (innerTrim === '') break;
        if (
          /^([-*+]|\d+\.)\s+/.test(innerTrim)
          || /^\s+/.test(inner) // continuation indent
        ) {
          listLines.push(inner);
          i += 1;
          continue;
        }
        break;
      }
      out.push({ type: 'prose', format: 'markdown', text: listLines.join('\n') });
      continue;
    }

    // Blank line = paragraph break in prose buffer.
    if (trimmed === '') {
      if (proseBuf.length > 0) flushProse();
      i += 1;
      continue;
    }

    // Default: paragraph line → prose.
    proseBuf.push(line);
    i += 1;
  }

  flushProse();
  return { blocks: out, partial };
}

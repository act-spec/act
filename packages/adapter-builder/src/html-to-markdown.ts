/**
 * PRD-206-R9 — permissive HTML-to-markdown converter for Builder.io's
 * `Text` component (Builder stores Text as HTML strings).
 *
 * Set covered (per PRD-206-R9):
 *   `<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<em>`, `<strong>`,
 *   `<code>`, `<blockquote>`, `<br>`.
 *
 * HTML constructs outside this set (e.g. `<table>`, `<details>`) are passed
 * through as raw markdown HTML (CommonMark permits inline HTML). When any
 * such pass-through occurs, the result is marked `lossy: true` so the
 * caller can stamp `metadata.extraction_status: "partial"` per R9.
 *
 * In-tree rather than a dependency: `turndown` and similar pull JSDOM and
 * tens of transitive deps for a permissive walker we only need ~10 tag
 * cases for. Mirror of the strapi/storyblok in-tree walker policy.
 */

const RECOGNIZED = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'a', 'em', 'strong', 'i', 'b',
  'code', 'blockquote', 'br',
]);

export interface HtmlConvertResult {
  text: string;
  /** True when at least one HTML construct fell back to plaintext / pass-through. */
  lossy: boolean;
}

/**
 * Convert an HTML string to a markdown string. The converter is line-based
 * and intentionally simple — Builder's Text components produce small,
 * mostly inline HTML; deep structural conversion is out of scope (the
 * caller stamps `extraction_status: "partial"` when `lossy: true`).
 */
export function htmlToMarkdown(html: string): HtmlConvertResult {
  if (typeof html !== 'string' || html.length === 0) {
    return { text: '', lossy: false };
  }
  const state: ConvertState = { lossy: false, listDepth: 0, listOrdered: [] };
  const text = convertInner(html, state).trim();
  return { text, lossy: state.lossy };
}

interface ConvertState {
  lossy: boolean;
  listDepth: number;
  listOrdered: boolean[];
}

/** Convert an HTML fragment, preserving inline runs as markdown. */
function convertInner(html: string, state: ConvertState): string {
  // Simplest workable strategy: match block-level tags, recurse into their
  // children, then handle inline tags via regex on the surrounding text.
  // This is NOT a full HTML parser — Builder's Text content is always small.
  let i = 0;
  const out: string[] = [];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out.push(decodeAndInline(html.slice(i)));
      break;
    }
    if (lt > i) out.push(decodeAndInline(html.slice(i, lt)));

    const tagMatch = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/.exec(html.slice(lt));
    if (!tagMatch) {
      out.push(html[lt] ?? '');
      i = lt + 1;
      continue;
    }
    const isClose = tagMatch[1] === '/';
    const tagName = (tagMatch[2] ?? '').toLowerCase();
    const attrs = tagMatch[3] ?? '';
    const tagEnd = lt + tagMatch[0].length;

    if (isClose) {
      // Stray close tag — preserve verbatim.
      out.push(tagMatch[0]);
      i = tagEnd;
      continue;
    }

    if (tagName === 'br') {
      out.push('\n');
      i = tagEnd;
      continue;
    }

    if (!RECOGNIZED.has(tagName)) {
      // Pass-through path: surface the raw HTML and mark lossy.
      state.lossy = true;
      // Find matching close tag (best effort, no nesting awareness).
      const closeIdx = findMatchingClose(html, tagName, tagEnd);
      if (closeIdx < 0) {
        // Self-closing or malformed — emit verbatim and continue.
        out.push(tagMatch[0]);
        i = tagEnd;
        continue;
      }
      const inner = html.slice(tagEnd, closeIdx);
      const closeMatch = /^<\s*\/\s*[a-zA-Z][a-zA-Z0-9]*\s*>/.exec(html.slice(closeIdx));
      const closeLen = closeMatch ? closeMatch[0].length : tagName.length + 3;
      // Preserve the original tag wrapper so consumers can recover structure.
      out.push(`<${tagName}${attrs}>${inner}</${tagName}>`);
      i = closeIdx + closeLen;
      continue;
    }

    // Recognized tag — find its close and convert inside.
    const closeIdx = findMatchingClose(html, tagName, tagEnd);
    const innerEnd = closeIdx < 0 ? html.length : closeIdx;
    const innerHtml = html.slice(tagEnd, innerEnd);
    const closeAdvance = closeIdx < 0
      ? 0
      : (/^<\s*\/\s*[a-zA-Z][a-zA-Z0-9]*\s*>/.exec(html.slice(closeIdx))?.[0].length ?? 0);
    out.push(renderRecognized(tagName, attrs, innerHtml, state));
    i = closeIdx < 0 ? html.length : closeIdx + closeAdvance;
  }
  return out.join('');
}

/** Render one of the recognized tags as markdown. */
function renderRecognized(
  tag: string,
  attrs: string,
  innerHtml: string,
  state: ConvertState,
): string {
  switch (tag) {
    case 'p': {
      const inner = convertInner(innerHtml, state).trim();
      return inner.length > 0 ? `${inner}\n\n` : '';
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag.slice(1));
      const inner = convertInner(innerHtml, state).trim();
      return `${'#'.repeat(level)} ${inner}\n\n`;
    }
    case 'em':
    case 'i': {
      const inner = convertInner(innerHtml, state).trim();
      return inner.length > 0 ? `*${inner}*` : '';
    }
    case 'strong':
    case 'b': {
      const inner = convertInner(innerHtml, state).trim();
      return inner.length > 0 ? `**${inner}**` : '';
    }
    case 'code': {
      const inner = convertInner(innerHtml, state).trim();
      return inner.length > 0 ? `\`${inner}\`` : '';
    }
    case 'a': {
      const inner = convertInner(innerHtml, state).trim();
      const href = /\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/.exec(attrs);
      const url = (href?.[1] ?? href?.[2] ?? '').trim();
      return url.length > 0 ? `[${inner}](${url})` : inner;
    }
    case 'blockquote': {
      const inner = convertInner(innerHtml, state).trim();
      const quoted = inner.split('\n').map((l) => `> ${l}`).join('\n');
      return `${quoted}\n\n`;
    }
    case 'ul':
    case 'ol': {
      state.listDepth += 1;
      state.listOrdered.push(tag === 'ol');
      const items = extractListItems(innerHtml).map((li, idx) => {
        const liInner = convertInner(li, state).trim();
        const marker = tag === 'ol' ? `${String(idx + 1)}.` : '-';
        const indent = '  '.repeat(state.listDepth - 1);
        return `${indent}${marker} ${liInner}`;
      });
      state.listOrdered.pop();
      state.listDepth -= 1;
      return `${items.join('\n')}\n\n`;
    }
    case 'li':
      return convertInner(innerHtml, state).trim();
    default:
      return convertInner(innerHtml, state);
  }
}

/** Extract direct-child `<li>` blocks from a `<ul>` or `<ol>` body. */
function extractListItems(html: string): string[] {
  const items: string[] = [];
  let i = 0;
  while (i < html.length) {
    const open = /<\s*li\b[^>]*>/i.exec(html.slice(i));
    if (!open) break;
    const startBody = i + open.index + open[0].length;
    const close = /<\s*\/\s*li\s*>/i.exec(html.slice(startBody));
    if (!close) {
      items.push(html.slice(startBody));
      break;
    }
    items.push(html.slice(startBody, startBody + close.index));
    i = startBody + close.index + close[0].length;
  }
  return items;
}

/** Find the closing tag for `tagName` starting at `from`. Returns -1 if absent. */
function findMatchingClose(html: string, tagName: string, from: number): number {
  // Naive: search for the next `</tagName>` (case-insensitive). Builder's
  // Text payloads do not nest the same tag deeply, so this is sufficient
  // for the recognized set per PRD-206-R9.
  const re = new RegExp(`<\\s*/\\s*${tagName}\\s*>`, 'i');
  const rest = html.slice(from);
  const m = re.exec(rest);
  return m ? from + m.index : -1;
}

/** Decode common HTML entities and pass through as-is otherwise. */
function decodeAndInline(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

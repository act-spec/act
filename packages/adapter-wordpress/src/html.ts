/**
 * Minimal HTML → plain-text converter for WordPress's `rendered` strings.
 *
 * WordPress's REST API serves `content.rendered` and `excerpt.rendered` as
 * already-shortcoded, already-themed HTML. The adapter does not aspire to
 * round-trip rich HTML into structured `prose` blocks (that's what
 * `@act-spec/adapter-markdown` is for); it converts to a clean plain-text
 * paragraph stream good enough for an LLM to consume.
 *
 * The walker is deliberately tiny — no `parse5`/`cheerio`/`unified`
 * dependency. WordPress's rendered HTML is well-formed in practice; we strip
 * scripts, decode the small set of named entities WP emits, collapse
 * whitespace, and split on block-level boundaries.
 */

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'td',
  'th',
  'blockquote',
  'pre',
  'br',
  'hr',
]);

const VOID_TAGS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'source',
  'track',
  'wbr',
  'area',
  'base',
  'col',
  'embed',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED_ENTITIES[name] ?? whole);
}

/**
 * Convert WordPress's rendered HTML to a list of plain-text paragraphs.
 * Block-level tags split paragraphs; inline tags are stripped. `<script>` and
 * `<style>` bodies are dropped. Returns at most one entry per paragraph; any
 * paragraph that whitespace-collapses to empty is omitted.
 */
export function htmlToParagraphs(html: string): string[] {
  if (typeof html !== 'string' || html.length === 0) return [];
  // Drop script / style blocks (defensive — REST shouldn't return these).
  const scrubbed = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    // Strip HTML comments (WP block comments leak into rendered output sometimes).
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const out: string[] = [];
  let buffer = '';
  let i = 0;
  while (i < scrubbed.length) {
    const ch = scrubbed[i];
    if (ch === '<') {
      const close = scrubbed.indexOf('>', i + 1);
      if (close === -1) {
        // Truncated tag — treat as literal, give up cleanly.
        buffer += scrubbed.slice(i);
        break;
      }
      const tagSrc = scrubbed.slice(i + 1, close).trim();
      const isClose = tagSrc.startsWith('/');
      const nameMatch = /^\/?([a-zA-Z0-9-]+)/.exec(tagSrc);
      const name = nameMatch && nameMatch[1] !== undefined ? nameMatch[1].toLowerCase() : '';
      const blockBoundary = BLOCK_TAGS.has(name);
      if (blockBoundary) {
        if (buffer.trim().length > 0) {
          out.push(collapseWhitespace(decodeEntities(buffer)));
        }
        buffer = '';
        // For a void block (br, hr) we already flushed; nothing more to do.
        // For an open / close on a non-void block, ignore the tag itself.
      }
      // Self-closing or void — nothing to add inline.
      void isClose;
      void VOID_TAGS;
      i = close + 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  if (buffer.trim().length > 0) {
    out.push(collapseWhitespace(decodeEntities(buffer)));
  }
  return out.filter((p) => p.length > 0);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Whitespace-token count (non-empty `\s+`-split count, min 1 if any text). */
export function tokenize(s: string): number {
  if (typeof s !== 'string' || s.length === 0) return 0;
  const n = s.split(/\s+/).filter((x) => x.length > 0).length;
  return Math.max(1, n);
}

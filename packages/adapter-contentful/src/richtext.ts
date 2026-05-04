/**
 * PRD-202-R10 — Contentful Rich Text JSON AST → PRD-102 block taxonomy.
 *
 * Self-contained markdown serializer. We deliberately do NOT pull in
 * `@contentful/rich-text-html-renderer`: the target surface is markdown
 * blocks (PRD-102-R2), not HTML, so a dedicated renderer is the right
 * shape.
 */
import { BLOCKS, INLINES } from '@contentful/rich-text-types';
import type {
  Block,
  Document,
  Inline,
  Mark,
  Text,
} from '@contentful/rich-text-types';

import type { ContentTypeMapping, ContentfulAsset, ContentfulEntry } from './types.js';

/**
 * Subset of PRD-102 block shapes the rich-text converter emits. Every
 * non-prose / non-code branch is a `marketing:*` open block (PRD-102-R6).
 */
export type ContentBlock =
  | { type: 'prose'; format: 'plain' | 'markdown'; text: string; metadata?: Record<string, unknown> }
  | { type: 'code'; language?: string; text: string }
  | { type: 'marketing:image'; url: string; alt: string; width?: number; height?: number }
  | { type: 'marketing:asset'; url: string; content_type: string; filename?: string; size?: number }
  | { type: 'marketing:placeholder'; text: string; metadata?: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

export interface RichTextConvertContext {
  targetLevel: 'core' | 'standard' | 'strict';
  /** PRD-202-R11 — embed targets resolved by sys.id. */
  assets: Record<string, ContentfulAsset>;
  /** PRD-202-R11 — embedded entries; needed for `mappings.<...>.blocks` rules. */
  linkedEntries: Record<string, ContentfulEntry>;
  /** PRD-202-R11 — per-content-type mapping for embedded-entry promotion. */
  mappings: Record<string, ContentTypeMapping>;
  /** Receives recoverable warnings; framework treats these as build warnings. */
  warn: (msg: string) => void;
}

const HEADING_TYPES: ReadonlySet<string> = new Set([
  BLOCKS.HEADING_1,
  BLOCKS.HEADING_2,
  BLOCKS.HEADING_3,
  BLOCKS.HEADING_4,
  BLOCKS.HEADING_5,
  BLOCKS.HEADING_6,
]);

const HEADING_LEVELS: Record<string, number> = {
  [BLOCKS.HEADING_1]: 1,
  [BLOCKS.HEADING_2]: 2,
  [BLOCKS.HEADING_3]: 3,
  [BLOCKS.HEADING_4]: 4,
  [BLOCKS.HEADING_5]: 5,
  [BLOCKS.HEADING_6]: 6,
};

/**
 * PRD-202-R10 — top-level converter. Walks the Document's `content` array,
 * mapping each top-level block per the table in §"Rich Text conversion".
 * Empty whitespace-only paragraphs MAY be skipped per the same table.
 */
export function richTextToBlocks(
  doc: Document,
  ctx: RichTextConvertContext,
): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const node of doc.content) {
    const blocks = convertTopLevel(node, ctx);
    for (const b of blocks) out.push(b);
  }
  return out;
}

function convertTopLevel(
  node: Block,
  ctx: RichTextConvertContext,
): ContentBlock[] {
  const t = node.nodeType;
  if (t === BLOCKS.PARAGRAPH) {
    const text = inlinesToMarkdown(node.content);
    if (text.trim().length === 0) return []; // PRD-202-R10: MAY skip empty paragraphs.
    const hasMarks = paragraphHasFormatting(node);
    return [{ type: 'prose', format: hasMarks ? 'markdown' : 'plain', text }];
  }
  if (HEADING_TYPES.has(t)) {
    const level = HEADING_LEVELS[t];
    if (level === undefined) {
      // unreachable: enum-controlled
      return [];
    }
    const hashes = '#'.repeat(level);
    const text = inlinesToMarkdown(node.content);
    return [{ type: 'prose', format: 'markdown', text: `${hashes} ${text}` }];
  }
  if (t === BLOCKS.UL_LIST || t === BLOCKS.OL_LIST) {
    const ordered = t === BLOCKS.OL_LIST;
    const lines: string[] = [];
    for (let i = 0; i < node.content.length; i += 1) {
      const item = node.content[i];
      if (!item || (item as Block).nodeType !== BLOCKS.LIST_ITEM) continue;
      const itemText = listItemToMarkdown(item as Block);
      const prefix = ordered ? `${i + 1}. ` : '- ';
      lines.push(`${prefix}${itemText}`);
    }
    return [{ type: 'prose', format: 'markdown', text: lines.join('\n') }];
  }
  if (t === BLOCKS.QUOTE) {
    // Each child paragraph rendered + blockquoted.
    const innerLines: string[] = [];
    for (const child of node.content) {
      const text = inlinesToMarkdown((child as Block).content);
      for (const line of text.split('\n')) innerLines.push(`> ${line}`);
    }
    return [{ type: 'prose', format: 'markdown', text: innerLines.join('\n') }];
  }
  if (t === BLOCKS.HR) {
    return [{ type: 'prose', format: 'markdown', text: '---' }];
  }
  if (t === BLOCKS.EMBEDDED_ASSET) {
    return convertEmbeddedAsset(node, ctx);
  }
  if (t === BLOCKS.EMBEDDED_ENTRY) {
    return convertEmbeddedEntry(node, ctx);
  }
  if (t === BLOCKS.TABLE) {
    return [{ type: 'prose', format: 'markdown', text: tableToMarkdown(node) }];
  }
  // Code block (Contentful 2024+ rich-text extension; not yet in BLOCKS enum at @contentful/rich-text-types 16.x).
  if ((t as string) === 'code-block') {
    const text = collectText(node.content);
    const data = (node.data ?? {}) as { language?: string };
    if (typeof data.language === 'string' && data.language.length > 0) {
      return [{ type: 'code', language: data.language, text }];
    }
    return [{ type: 'code', text }];
  }
  // PRD-202-R18 — unknown node type → recoverable partial.
  ctx.warn(`unknown rich-text node type: ${t}`);
  const fallback = collectText(node.content);
  return [
    {
      type: 'prose',
      format: 'markdown',
      text: fallback,
      metadata: {
        extraction_status: 'partial',
        extraction_error: `unknown rich-text node type: ${t}`,
      },
    },
  ];
}

function paragraphHasFormatting(node: Block): boolean {
  for (const child of node.content) {
    if ((child as Text).nodeType === 'text') {
      const marks = (child as Text).marks ?? [];
      if (marks.length > 0) return true;
      continue;
    }
    // Any inline node (link, embed inline) implies markdown formatting.
    return true;
  }
  return false;
}

/**
 * PRD-202-R10 — inline → markdown text. Preserves bold / italic / code
 * marks and hyperlink targets within the surrounding prose.
 */
function inlinesToMarkdown(content: ReadonlyArray<Inline | Text | Block>): string {
  const parts: string[] = [];
  for (const node of content) {
    if ((node as Text).nodeType === 'text') {
      parts.push(textWithMarks(node as Text));
      continue;
    }
    const inline = node as Inline;
    if (inline.nodeType === INLINES.HYPERLINK) {
      const data = inline.data as { uri?: string };
      const inner = inlinesToMarkdown(inline.content);
      parts.push(`[${inner}](${data.uri ?? ''})`);
      continue;
    }
    if (inline.nodeType === INLINES.ENTRY_HYPERLINK || inline.nodeType === INLINES.ASSET_HYPERLINK) {
      const data = inline.data as { target?: { sys?: { id?: string } } };
      const ref = data.target?.sys?.id ?? '<unknown>';
      const inner = inlinesToMarkdown(inline.content);
      parts.push(`[${inner}](${ref})`);
      continue;
    }
    if (inline.nodeType === INLINES.EMBEDDED_ENTRY) {
      const data = inline.data as { target?: { sys?: { id?: string } } };
      const ref = data.target?.sys?.id ?? '<unknown>';
      parts.push(`[embedded:${ref}](${ref})`);
      continue;
    }
    // Other inline nodes → flatten child text.
    parts.push(collectText(inline.content));
  }
  return parts.join('');
}

function textWithMarks(node: Text): string {
  let out = node.value;
  const marks = (node.marks ?? []).map((m: Mark) => m.type);
  if (marks.includes('code')) out = `\`${out}\``;
  if (marks.includes('bold')) out = `**${out}**`;
  if (marks.includes('italic')) out = `*${out}*`;
  if (marks.includes('underline')) out = `<u>${out}</u>`;
  return out;
}

function listItemToMarkdown(item: Block): string {
  const lines: string[] = [];
  for (const child of item.content) {
    const childBlock = child as Block;
    if (childBlock.nodeType === BLOCKS.PARAGRAPH) {
      lines.push(inlinesToMarkdown(childBlock.content));
    } else {
      lines.push(collectText(childBlock.content));
    }
  }
  return lines.join(' ');
}

function tableToMarkdown(node: Block): string {
  const rows: string[][] = [];
  for (const r of node.content) {
    const rowBlock = r as Block;
    if (rowBlock.nodeType !== BLOCKS.TABLE_ROW) continue;
    const cells: string[] = [];
    for (const c of rowBlock.content) {
      const cellBlock = c as Block;
      cells.push(collectText(cellBlock.content));
    }
    rows.push(cells);
  }
  if (rows.length === 0) return '';
  const header = rows[0];
  if (!header) return '';
  const sep = header.map(() => '---');
  const out = [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    out.push(`| ${row.join(' | ')} |`);
  }
  return out.join('\n');
}

function collectText(content: ReadonlyArray<Block | Inline | Text>): string {
  const parts: string[] = [];
  for (const node of content) {
    if ((node as Text).nodeType === 'text') {
      parts.push((node as Text).value);
    } else if (Array.isArray((node as Block).content)) {
      parts.push(collectText((node as Block).content));
    }
  }
  return parts.join('');
}

/**
 * PRD-202-R11 — embedded asset.
 *  - image MIME + Plus → `marketing:image` block.
 *  - image MIME + Standard/Core → markdown image inside `prose`.
 *  - non-image + Plus → `marketing:asset`.
 *  - non-image + Standard/Core → skip with warning.
 */
function convertEmbeddedAsset(
  node: Block,
  ctx: RichTextConvertContext,
): ContentBlock[] {
  const data = node.data as { target?: { sys?: { id?: string } } };
  const id = data.target?.sys?.id;
  if (!id) {
    ctx.warn('embedded-asset-block has no target.sys.id');
    return [];
  }
  const asset = ctx.assets[id];
  if (!asset) {
    ctx.warn(`embedded-asset-block target ${id} not in corpus assets`);
    return [
      {
        type: 'prose',
        format: 'markdown',
        text: `[asset:${id}](${id})`,
        metadata: { extraction_status: 'partial', extraction_error: `asset ${id} unresolved` },
      },
    ];
  }
  const file = asset.fields.file;
  const url = file.url;
  const contentType = file.contentType;
  const alt = asset.fields.title ?? asset.fields.description ?? id;
  const isImage = contentType.startsWith('image/');
  if (isImage) {
    if (ctx.targetLevel === 'strict') {
      const block: ContentBlock = { type: 'marketing:image', url, alt };
      const img = file.details?.image;
      if (img?.width !== undefined) (block as { width: number }).width = img.width;
      if (img?.height !== undefined) (block as { height: number }).height = img.height;
      return [block];
    }
    return [{ type: 'prose', format: 'markdown', text: `![${alt}](${url})` }];
  }
  if (ctx.targetLevel === 'strict') {
    const out: ContentBlock = { type: 'marketing:asset', url, content_type: contentType };
    if (typeof file.fileName === 'string') (out as { filename: string }).filename = file.fileName;
    if (typeof file.details?.size === 'number') (out as { size: number }).size = file.details.size;
    return [out];
  }
  ctx.warn(`embedded non-image asset ${id} skipped at ${ctx.targetLevel}`);
  return [];
}

/**
 * PRD-202-R11 — embedded entry → block:
 *  - matching `mappings.<...>.blocks[*].when` → emit configured block (Plus subset).
 *  - else + Plus → `marketing:placeholder`.
 *  - else + Standard/Core → skip with warning.
 */
function convertEmbeddedEntry(
  node: Block,
  ctx: RichTextConvertContext,
): ContentBlock[] {
  const data = node.data as { target?: { sys?: { id?: string } } };
  const id = data.target?.sys?.id;
  if (!id) {
    ctx.warn('embedded-entry-block has no target.sys.id');
    return [];
  }
  const entry = ctx.linkedEntries[id];
  if (!entry) {
    ctx.warn(`embedded-entry-block target ${id} not in corpus linkedEntries`);
    return [
      {
        type: 'prose',
        format: 'markdown',
        text: `[entry:${id}](${id})`,
        metadata: { extraction_status: 'partial', extraction_error: `entry ${id} unresolved` },
      },
    ];
  }
  const ctId = entry.sys.contentType.sys.id;
  const mapping = ctx.mappings[ctId];
  const rules = mapping?.blocks ?? [];
  for (const rule of rules) {
    if (matches(entry.fields, rule.when)) {
      const block: Record<string, unknown> = { type: rule.type };
      for (const [actField, ctField] of Object.entries(rule.fields)) {
        if (entry.fields[ctField] !== undefined) block[actField] = entry.fields[ctField];
      }
      return [block as ContentBlock];
    }
  }
  if (ctx.targetLevel === 'strict') {
    return [
      {
        type: 'marketing:placeholder',
        text: `placeholder for ${ctId}/${id}`,
        metadata: {
          extracted_via: 'component-contract',
          extraction_status: 'partial',
        },
      },
    ];
  }
  ctx.warn(`embedded-entry-block ${ctId}/${id} skipped at ${ctx.targetLevel}`);
  return [];
}

function matches(
  fields: Record<string, unknown>,
  when: { field: string; equals?: unknown; ofType?: string },
): boolean {
  const v = fields[when.field];
  if ('equals' in when) return v === when.equals;
  if (when.ofType !== undefined) return typeof v === when.ofType;
  return v !== undefined;
}

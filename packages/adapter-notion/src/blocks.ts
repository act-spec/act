/**
 * Notion block tree -> ACT content block conversion.
 *
 * Supported block types (the conventional minimum for Notion-as-CMS):
 *   - paragraph        -> { type: 'prose', format: 'plain', text }
 *   - heading_1/2/3    -> { type: 'prose', format: 'plain', text } (level kept as `level`)
 *   - bulleted_list_item / numbered_list_item / to_do
 *                      -> grouped into one prose block per consecutive run
 *   - code             -> { type: 'code', language, text }
 *   - quote            -> { type: 'callout', variant: 'quote', text }
 *   - divider          -> { type: 'data', shape: 'divider' }
 *
 * Unknown block types degrade to a `text` block recording the raw Notion
 * type in the `notion_type` field, plus any plain text that could be
 * extracted from a `rich_text` array.
 */
import type { NotionBlock, NotionRichText } from './types.js';

/** Open-ended ACT content block. */
export type ContentBlock = Record<string, unknown> & { type: string };

export interface WalkResult {
  blocks: ContentBlock[];
  /** Block-type discriminators that were seen but not natively mapped. */
  unmapped: string[];
}

/** Convert a (possibly nested) Notion block tree into ACT content blocks. */
export function blocksToContent(blocks: NotionBlock[]): WalkResult {
  const out: ContentBlock[] = [];
  const unmapped: string[] = [];

  // Group consecutive list items so we emit one prose block per list run.
  let listRun: { kind: 'bulleted' | 'numbered' | 'to_do'; items: string[] } | null = null;

  function flushListRun(): void {
    if (!listRun) return;
    const marker = listRun.kind === 'numbered' ? '1.' : listRun.kind === 'to_do' ? '[ ]' : '-';
    const text = listRun.items.map((t) => `${marker} ${t}`).join('\n');
    out.push({ type: 'prose', format: 'markdown', text });
    listRun = null;
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph': {
        flushListRun();
        const text = richTextPlain(block.paragraph?.rich_text);
        if (text.length > 0) out.push({ type: 'prose', format: 'plain', text });
        break;
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        flushListRun();
        const level = Number(block.type.slice(-1));
        const headingProp =
          block.type === 'heading_1'
            ? block.heading_1
            : block.type === 'heading_2'
              ? block.heading_2
              : block.heading_3;
        const text = richTextPlain(headingProp?.rich_text);
        if (text.length > 0) {
          out.push({ type: 'prose', format: 'plain', text, level });
        }
        break;
      }
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'to_do': {
        const kind: 'bulleted' | 'numbered' | 'to_do' =
          block.type === 'numbered_list_item'
            ? 'numbered'
            : block.type === 'to_do'
              ? 'to_do'
              : 'bulleted';
        const itemProp =
          block.type === 'bulleted_list_item'
            ? block.bulleted_list_item
            : block.type === 'numbered_list_item'
              ? block.numbered_list_item
              : block.to_do;
        const text = richTextPlain(itemProp?.rich_text);
        if (listRun && listRun.kind === kind) {
          listRun.items.push(text);
        } else {
          flushListRun();
          listRun = { kind, items: [text] };
        }
        break;
      }
      case 'code': {
        flushListRun();
        const text = richTextPlain(block.code?.rich_text);
        out.push({
          type: 'code',
          language: block.code?.language ?? 'plain text',
          text,
        });
        break;
      }
      case 'quote': {
        flushListRun();
        const text = richTextPlain(block.quote?.rich_text);
        out.push({ type: 'callout', variant: 'quote', text });
        break;
      }
      case 'divider': {
        flushListRun();
        out.push({ type: 'data', shape: 'divider' });
        break;
      }
      default: {
        flushListRun();
        unmapped.push(block.type);
        // Best-effort plain-text recovery for unknown types.
        const fallbackText = recoverPlainText(block);
        out.push({ type: 'text', notion_type: block.type, text: fallbackText });
        break;
      }
    }

    // Recurse into nested children (depth-first; same flat block list).
    if (block.children && block.children.length > 0) {
      flushListRun();
      const nested = blocksToContent(block.children);
      out.push(...nested.blocks);
      unmapped.push(...nested.unmapped);
    }
  }
  flushListRun();
  return { blocks: out, unmapped };
}

/** Concatenate the `plain_text` of a Notion rich-text array. */
export function richTextPlain(parts: NotionRichText[] | undefined): string {
  if (!parts || parts.length === 0) return '';
  return parts.map((p) => p.plain_text).join('');
}

/** Try every known rich_text-bearing field on an unknown block. */
function recoverPlainText(block: NotionBlock): string {
  const candidates: NotionRichText[] | undefined = [
    block.paragraph?.rich_text,
    block.heading_1?.rich_text,
    block.heading_2?.rich_text,
    block.heading_3?.rich_text,
    block.bulleted_list_item?.rich_text,
    block.numbered_list_item?.rich_text,
    block.code?.rich_text,
    block.quote?.rich_text,
    block.to_do?.rich_text,
  ].find((arr) => Array.isArray(arr) && arr.length > 0);
  return richTextPlain(candidates);
}

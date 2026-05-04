/**
 * PRD-206-R9 — extraction-mode primitive walker.
 *
 * Walks a Builder.io component tree (`data.blocks`) and emits ACT content
 * blocks per the PRD-206-R9 mapping:
 *
 *   - `Text`        → `prose` (markdown via `htmlToMarkdown`)
 *   - `Image`       → `prose` markdown image syntax (`![alt](src)`)
 *   - `Button`      → `prose` markdown link (`[label](href)`) (or
 *                     `marketing:hero.cta` lift via `componentMapping`)
 *   - `CustomCode`  → `code` block (PRD-102-R3) with `language` from options
 *   - `Section`     → flatten children as siblings of the Section's parent
 *   - `Symbol`      → recursively walked, depth ≤ `symbolRecursionMax`
 *   - custom        → `componentMapping` lookup (PRD-206-R13) or partial
 *
 * Source order is preserved. The walker tracks unmapped/total counts so the
 * caller can apply the per-page coverage warning per PRD-206-R23.
 */
import type { BuilderBlock } from './types.js';
import { htmlToMarkdown } from './html-to-markdown.js';
import { emitMappedBlock, type MappingEntry } from './marketing-mapping.js';

export interface WalkContext {
  /** PRD-206-R13 — custom-component → marketing:* mapping (Plus only). */
  componentMapping?: Record<string, MappingEntry>;
  /** PRD-206-R12 — Symbol recursion cap (default 3). */
  symbolRecursionMax: number;
  /** Receives recoverable warnings; framework treats these as build warnings. */
  warn: (msg: string) => void;
}

export interface WalkResult {
  blocks: Array<Record<string, unknown>>;
  /** Number of unmapped (custom) components encountered at this level. */
  unmapped: number;
  /** Total components encountered at this level (excluding flattened Sections). */
  total: number;
  /** True when at least one block surfaced as `partial` extraction. */
  partial: boolean;
}

/** PRD-206-R9 — top-level walker for an extracted Builder component tree. */
export function walkBuilderTree(
  blocks: BuilderBlock[] | undefined,
  ctx: WalkContext,
): WalkResult {
  return walkInner(blocks ?? [], ctx, 0, new Set<string>());
}

function walkInner(
  blocks: BuilderBlock[],
  ctx: WalkContext,
  symbolDepth: number,
  visitedSymbols: Set<string>,
): WalkResult {
  const out: Array<Record<string, unknown>> = [];
  let unmapped = 0;
  let total = 0;
  let partial = false;

  for (const blk of blocks) {
    if (blk === null || typeof blk !== 'object') continue;
    const compName = blk.component?.name;
    const opts = (blk.component?.options ?? {});

    // PRD-206-R13 — custom-component mapping wins over the built-in switch
    // EXCEPT for the structural primitives (Text/Image/Button/CustomCode/
    // Section/Symbol) which the PRD names directly. Operators wishing to
    // override a primitive add an explicit mapping for it.
    if (compName !== undefined && ctx.componentMapping?.[compName]) {
      total += 1;
      const projected = emitMappedBlock(blk, ctx.componentMapping[compName]);
      if (projected.partial) partial = true;
      out.push(projected.block);
      continue;
    }

    switch (compName) {
      case 'Text': {
        total += 1;
        const raw = typeof opts['text'] === 'string' ? (opts['text']) : '';
        const md = htmlToMarkdown(raw);
        if (md.lossy) partial = true;
        out.push({ type: 'prose', format: 'markdown', text: md.text });
        break;
      }
      case 'Image': {
        total += 1;
        const alt = typeof opts['altText'] === 'string'
          ? (opts['altText'])
          : (typeof opts['alt'] === 'string' ? (opts['alt']) : '');
        const src = typeof opts['image'] === 'string'
          ? (opts['image'])
          : (typeof opts['src'] === 'string' ? (opts['src']) : '');
        out.push({
          type: 'prose',
          format: 'markdown',
          text: `![${alt}](${src})`,
        });
        break;
      }
      case 'Button': {
        total += 1;
        const label = typeof opts['text'] === 'string'
          ? (opts['text'])
          : (typeof opts['label'] === 'string' ? (opts['label']) : '');
        const href = typeof opts['link'] === 'string'
          ? (opts['link'])
          : (typeof opts['href'] === 'string' ? (opts['href']) : '#');
        out.push({
          type: 'prose',
          format: 'markdown',
          text: `[${label}](${href})`,
        });
        break;
      }
      case 'CustomCode': {
        total += 1;
        const lang = typeof opts['language'] === 'string'
          ? (opts['language'])
          : 'text';
        const code = typeof opts['code'] === 'string'
          ? (opts['code'])
          : '';
        out.push({
          type: 'code',
          language: lang.length > 0 ? lang : 'text',
          text: code,
        });
        break;
      }
      case 'Section': {
        // Section flattens — children are walked as siblings of the parent.
        const child = walkInner(blk.children ?? [], ctx, symbolDepth, visitedSymbols);
        for (const b of child.blocks) out.push(b);
        unmapped += child.unmapped;
        total += child.total;
        partial = partial || child.partial;
        break;
      }
      case 'Symbol': {
        total += 1;
        const max = ctx.symbolRecursionMax;
        const symId = typeof blk.symbol?.entry === 'string' ? blk.symbol.entry : undefined;
        if (symbolDepth + 1 > max || (symId !== undefined && visitedSymbols.has(symId))) {
          ctx.warn(
            `Symbol recursion bound exceeded at depth ${String(symbolDepth + 1)} (max=${String(max)}${symId !== undefined ? `, entry=${symId}` : ''})`,
          );
          out.push({
            type: 'prose',
            format: 'markdown',
            text: `(symbol recursion bound exceeded at depth ${String(symbolDepth + 1)})`,
          });
          partial = true;
          break;
        }
        const nextVisited = new Set(visitedSymbols);
        if (symId !== undefined) nextVisited.add(symId);
        const symBlocks = blk.symbol?.data?.blocks ?? [];
        const child = walkInner(symBlocks, ctx, symbolDepth + 1, nextVisited);
        for (const b of child.blocks) out.push(b);
        unmapped += child.unmapped;
        total += child.total;
        partial = partial || child.partial;
        break;
      }
      default: {
        total += 1;
        const cname = typeof compName === 'string' && compName.length > 0
          ? compName
          : '<unknown>';
        ctx.warn(`unmapped Builder component: ${cname}`);
        out.push({
          type: 'prose',
          format: 'markdown',
          text: `(unmapped Builder component: ${cname})`,
        });
        unmapped += 1;
        partial = true;
      }
    }
  }
  return { blocks: out, unmapped, total, partial };
}

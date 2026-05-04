/**
 * PRD-201 markdown adapter — leaf adapter for `.md` / `.mdx` files on disk.
 *
 * Library choices (ADR-003):
 *  - `unified` + `remark-parse` + `remark-frontmatter` + `remark-gfm` for
 *    AST traversal. Pinned to v11/5/4 per ADR-003.
 *  - `yaml@2` for YAML 1.2 frontmatter; a tiny TOML 1.0 subset parser
 *    handled inline (no production TOML dep — the subset PRD-201-R3
 *    requires is small enough to bundle here, ADR-003).
 *  - MDX strategy (PRD-201-R15 / ADR-003): regex-detect uppercase JSX tags
 *    in `.mdx` source. We do NOT load `@mdx-js/mdx` because v0.1's
 *    placeholder-only behavior does not require an MDX AST. Listed as
 *    rejected in ADR-003.
 *
 * Every public symbol cites a PRD-201 requirement and is exercised by at
 * least one test in `markdown.test.ts`.
 */
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import * as YAML from 'yaml';

import type { NodeSchema } from '@act-spec/core';
type ActNode = NodeSchema.Node;
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  EmittedNode,
} from '@act-spec/adapter-framework';

const ACT_VERSION = '0.1' as const;

/** PRD-201-R2 — config shape. */
export interface MarkdownAdapterConfig {
  /** Source root (absolute or relative to cwd). REQUIRED. */
  sourceDir: string;
  /** Glob include patterns; default `['**\/*.md', '**\/*.mdx']`. */
  include?: string[];
  /** Glob exclude patterns; default `[]`. */
  exclude?: string[];
  /** PRD-201-R8 / R10. ID derivation rules. */
  idStrategy?: {
    stripPrefix?: string;
    namespace?: string;
  };
  /** PRD-201-R12. `coarse` (default) or `fine`. */
  mode?: 'coarse' | 'fine';
  /** Default `auto`; or pin to a specific frontmatter format. */
  frontmatter?: { format?: 'auto' | 'yaml' | 'toml' };
  /** Follow symlinks. Default true. */
  followSymlinks?: boolean;
  /** PRD-201-R23 — caller-declared target level. */
  targetLevel?: 'core' | 'standard' | 'strict';
  /**
   * Optional override for the per-node `source.human_url`. When omitted and
   * `ctx.siteOrigin` is set, the adapter defaults to
   * `${siteOrigin}/${id}/`. Plugins (Eleventy, Astro, Docusaurus) wire this
   * to the framework's permalink resolver so node URLs match what gets
   * served. Return `undefined` to skip emission for a given item.
   */
  humanUrlFor?: (item: MarkdownItem, ctx: { siteOrigin?: string; id: string }) => string | undefined;
}

/** PRD-201 — opaque source item handed from `enumerate` to `transform`. */
export interface MarkdownItem {
  absPath: string;
  relPath: string;
  ext: 'md' | 'mdx';
}

/** PRD-201-R6 — framework-reserved metadata keys (forbidden in frontmatter). */
const RESERVED_METADATA_KEYS: readonly string[] = [
  'source',
  'extraction_status',
  'extraction_error',
  'locale',
  'translations',
  'extracted_via',
  'props',
  'component',
];

/** PRD-201-R4 — top-level frontmatter keys the adapter recognizes. */
const RECOGNIZED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'title',
  'summary',
  'summary_source',
  'tags',
  'related',
  'updated_at',
  'parent',
  'children',
  'metadata',
]);

/** PRD-201-R14 — recognized callout triggers → callout level. */
const CALLOUT_TRIGGERS: Record<string, string> = {
  NOTE: 'info',
  TIP: 'info',
  IMPORTANT: 'warning',
  WARNING: 'warning',
  CAUTION: 'warning',
  DANGER: 'critical',
};

/** Public default export — see PRD-201-R1. */
export function createMarkdownAdapter(): Adapter<MarkdownItem> {
  let resolvedConfig: Required<
    Omit<MarkdownAdapterConfig, 'idStrategy' | 'frontmatter' | 'humanUrlFor'>
  > & {
    idStrategy: NonNullable<MarkdownAdapterConfig['idStrategy']>;
    frontmatter: { format: 'auto' | 'yaml' | 'toml' };
    humanUrlFor?: MarkdownAdapterConfig['humanUrlFor'];
  };

  return {
    name: 'act-markdown', // PRD-201-R1

    // PRD-201-R2 — fast preflight; checks sourceDir is a string.
    precheck(config: Record<string, unknown>): void {
      if (typeof config['sourceDir'] !== 'string' || config['sourceDir'].length === 0) {
        throw new Error('PRD-201-R2: precheck failed — config.sourceDir must be a non-empty string');
      }
    },

    async init(config: Record<string, unknown>, ctx: AdapterContext): Promise<AdapterCapabilities> {
      await Promise.resolve();
      const cfg = validateConfig(config); // PRD-201-R2 / PRD-200-R3
      resolvedConfig = {
        sourceDir: path.resolve(cfg.sourceDir),
        include: cfg.include ?? ['**/*.md', '**/*.mdx'],
        exclude: cfg.exclude ?? [],
        idStrategy: cfg.idStrategy ?? {},
        mode: cfg.mode ?? 'coarse',
        frontmatter: { format: cfg.frontmatter?.format ?? 'auto' },
        followSymlinks: cfg.followSymlinks ?? true,
        targetLevel: cfg.targetLevel ?? ctx.targetLevel,
        humanUrlFor: cfg.humanUrlFor,
      };
      // PRD-201-R23 — declared level is determined by mode + targetLevel.
      const level = resolvedConfig.mode === 'fine' ? 'standard' : 'core';
      const declaredLevel: 'core' | 'standard' | 'strict' =
        resolvedConfig.targetLevel === 'strict'
          ? 'strict'
          : resolvedConfig.targetLevel === 'standard'
            ? level === 'core' ? 'core' : 'standard'
            : 'core';
      return {
        // PRD-201-R22.
        level: declaredLevel,
        delta: true,
        namespace_ids: true,
        manifestCapabilities: { etag: true },
      };
    },

    // PRD-201-R11 — deterministic file enumeration.
    async *enumerate(_ctx: AdapterContext): AsyncIterable<MarkdownItem> {
      const items = await listFiles(
        resolvedConfig.sourceDir,
        resolvedConfig.include,
        resolvedConfig.exclude,
      );
      for (const it of items) yield it;
    },

    async transform(
      item: MarkdownItem,
      ctx: AdapterContext,
    ): Promise<EmittedNode | null> {
      return transformOne(item, ctx, resolvedConfig);
    },

    async *delta(since: string, ctx: AdapterContext): AsyncIterable<MarkdownItem> {
      const all = await listFiles(
        resolvedConfig.sourceDir,
        resolvedConfig.include,
        resolvedConfig.exclude,
      );
      const sinceMs = Date.parse(since);
      if (Number.isNaN(sinceMs)) {
        throw new Error(`PRD-201-R21: delta marker is not RFC 3339: ${since}`);
      }
      for (const it of all) {
        const stat = await fs.stat(it.absPath);
        if (stat.mtimeMs > sinceMs) yield it;
      }
      void ctx;
    },

    async dispose(_ctx: AdapterContext): Promise<void> {
      // No long-lived resources. PRD-200-R7 idempotency comes for free.
    },
  };
}

function validateConfig(config: Record<string, unknown>): MarkdownAdapterConfig {
  if (typeof config['sourceDir'] !== 'string') {
    throw new Error('PRD-201-R2: config.sourceDir must be a string');
  }
  return config as unknown as MarkdownAdapterConfig;
}

/** PRD-201-R11 — deterministic, locale-stable file walk. */
export async function listFiles(
  root: string,
  include: string[],
  exclude: string[],
): Promise<MarkdownItem[]> {
  const collator = new Intl.Collator(undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  const out: MarkdownItem[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => collator.compare(a.name, b.name));
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!ent.isFile() && !ent.isSymbolicLink()) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (ext !== 'md' && ext !== 'mdx') continue;
      if (!matchesAny(rel, include)) continue;
      if (matchesAny(rel, exclude)) continue;
      out.push({ absPath: full, relPath: rel, ext: ext });
    }
  }
  await walk(root);
  return out;
}

/** Tiny glob matcher: supports `**`, `*`, suffix matching. */
function matchesAny(rel: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((p) => globMatch(rel, p));
}

function globMatch(input: string, pattern: string): boolean {
  // Build a regex from the glob: `**/` → `(.*\/)?` (zero or more dirs),
  // `**` → `.*`, `*` → `[^/]*`, escape regex metas.
  let re = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      // `**/` consumes zero or more path segments.
      if (pattern[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '.' || c === '+' || c === '?' || c === '(' || c === ')' || c === '|' || c === '[' || c === ']' || c === '{' || c === '}' || c === '^' || c === '$' || c === '\\') {
      re += '\\' + c;
    } else if (c === '/') {
      re += '/';
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re).test(input);
}

/** PRD-201-R8 — path-derived default ID. */
export function deriveDefaultId(
  relPath: string,
  ext: 'md' | 'mdx',
  stripPrefix?: string,
): string {
  // Step 0 — strip ext (case-insensitively to match `Index.md`).
  let id = relPath.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  // Step 1 — strip configured prefix.
  if (stripPrefix && id.startsWith(stripPrefix)) {
    id = id.slice(stripPrefix.length);
    if (id.startsWith('/')) id = id.slice(1);
  }
  // Step 2 — lowercase before the index-collapse so `Index.md` → `''`.
  id = id.toLowerCase();
  // Step 3 — collapse trailing `/index` per Open Question 2 resolution.
  if (id.endsWith('/index')) id = id.slice(0, -'/index'.length);
  if (id === 'index') id = '';
  // Step 4 — collapse runs of `/`, trim leading/trailing slashes.
  id = id.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  return id;
}

/** PRD-100-R10 ID grammar (with PRD-102-R29 / amendment A6 variant extension). */
export const ID_GRAMMAR = /^[a-z0-9](?:[a-z0-9._\-/])*[a-z0-9](?:@[a-z0-9-]+)?$|^[a-z0-9](?:@[a-z0-9-]+)?$/;

export function validateId(id: string): boolean {
  if (id.length === 0 || id.length > 256) return false;
  if (Buffer.byteLength(id, 'utf8') > 256) return false;
  return ID_GRAMMAR.test(id);
}

/** PRD-201-R3 — frontmatter detection + parse. */
export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  format: 'yaml' | 'toml' | 'none';
}

export function parseFrontmatter(
  source: string,
  expected: 'auto' | 'yaml' | 'toml',
): ParsedFrontmatter {
  const yamlMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  const tomlMatch = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/.exec(source);
  if (yamlMatch) {
    if (expected === 'toml') {
      throw new Error(`PRD-201-R3: expected TOML (+++) frontmatter, found YAML (---)`);
    }
    const data = (YAML.parse(yamlMatch[1]!) as Record<string, unknown> | null) ?? {};
    return { data, body: source.slice(yamlMatch[0].length), format: 'yaml' };
  }
  if (tomlMatch) {
    if (expected === 'yaml') {
      throw new Error(`PRD-201-R3: expected YAML (---) frontmatter, found TOML (+++)`);
    }
    const data = parseTomlSubset(tomlMatch[1]!);
    return { data, body: source.slice(tomlMatch[0].length), format: 'toml' };
  }
  return { data: {}, body: source, format: 'none' };
}

/**
 * Tiny TOML 1.0 subset — covers `key = "string"`, `key = number`,
 * `key = true|false`, and bracketed arrays of strings/numbers/bools. PRD-201's
 * frontmatter usage is small; ADR-003 documents the rejected alternative
 * (full TOML lib `@iarna/toml`).
 */
export function parseTomlSubset(input: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const valStr = line.slice(eq + 1).trim();
    out[key] = parseTomlValue(valStr);
  }
  return out;
}

function parseTomlValue(s: string): unknown {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitTomlArray(inner).map(parseTomlValue);
  }
  return s;
}

function splitTomlArray(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let buf = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i]!;
    if (inStr) {
      buf += c;
      if (c === '"' && inner[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      buf += c;
      continue;
    }
    if (c === '[') depth += 1;
    if (c === ']') depth -= 1;
    if (c === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) parts.push(buf.trim());
  return parts;
}

/** PRD-201-R18 — summary extraction. */
export function extractSummary(body: string): string {
  // 1. skip frontmatter (already stripped).
  // 2. skip HTML comments.
  // 3. skip headings.
  // 4. take the first contiguous paragraph.
  // 5. trim, strip inline markdown emphasis markers.
  const lines = body.split(/\r?\n/);
  const paragraph: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (line.startsWith('<!--')) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('```')) continue;
    if (line.startsWith('---')) continue;
    paragraph.push(line);
  }
  let text = paragraph.join(' ').trim();
  // Strip simple inline markdown emphasis.
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return text;
}

/** PRD-201-R19 — token-budget truncation (50 tokens, naive whitespace tokenizer). */
export function truncateSummary(text: string, maxTokens = 50): { text: string; tokens: number } {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return { text: '', tokens: 0 };
  if (words.length <= maxTokens) return { text: words.join(' '), tokens: words.length };
  // ellipsis costs one token; budget = maxTokens - 1 words + ellipsis.
  const kept = words.slice(0, maxTokens - 1);
  return { text: `${kept.join(' ')} …`, tokens: maxTokens };
}

/** PRD-201-R12-R16: body → content blocks. */
export interface BlockEmission {
  blocks: Array<Record<string, unknown>>;
  warnings: string[];
}

export function bodyToBlocks(
  body: string,
  ext: 'md' | 'mdx',
  mode: 'coarse' | 'fine',
  targetLevel: 'core' | 'standard' | 'strict',
): BlockEmission {
  const warnings: string[] = [];
  // PRD-201-R15 / R23: MDX inputs at non-Plus targets are unrecoverable.
  const mdxComponents = ext === 'mdx' ? findMdxComponents(body) : [];
  if (mdxComponents.length > 0 && targetLevel !== 'strict') {
    throw new Error(
      `PRD-201-R23: MDX components require target level "strict"; got "${targetLevel}"`,
    );
  }

  if (mode === 'coarse') {
    // PRD-201-R12 coarse: one markdown block, MDX components substituted with placeholders.
    let text = body;
    for (const comp of mdxComponents) {
      text = text.replace(comp.raw, `[ACT_MDX_PLACEHOLDER:${comp.tag}]`);
    }
    // PRD-201-R16 — single block carrying the whole body. The `prose`
    // type with `format: "markdown"` is the canonical shape (PRD-100 §
    // ContentBlock); it preserves heading hashes, inline emphasis, list
    // bullets, table pipes — everything an LLM is trained on.
    const blocks: Array<Record<string, unknown>> = [
      { type: 'prose', format: 'markdown', text },
    ];
    if (mdxComponents.length > 0) {
      // Plus-only path: emit marketing:placeholder blocks alongside coarse markdown.
      for (const comp of mdxComponents) {
        blocks.push({
          type: 'marketing:placeholder',
          metadata: {
            component: comp.tag,
            extraction_status: 'partial',
            ...(comp.props ? { props: comp.props } : {}),
          },
        });
      }
    }
    return { blocks, warnings };
  }

  // PRD-201-R12 fine mode — split by source-order constructs.
  return fineSplit(body, ext, mdxComponents);
}

interface MdxComponent {
  raw: string;
  tag: string;
  props?: Record<string, unknown>;
}

function findMdxComponents(body: string): MdxComponent[] {
  const out: MdxComponent[] = [];
  // Self-closing or paired uppercase JSX tags. Naive — sufficient for v0.1
  // placeholder emission per ADR-003.
  const re = /<([A-Z][A-Za-z0-9]*)([^>]*?)\/>|<([A-Z][A-Za-z0-9]*)([^>]*)>([\s\S]*?)<\/\3>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tag = (m[1] ?? m[3])!;
    const propStr = (m[2] ?? m[4]) ?? '';
    const props = parseJsxProps(propStr);
    out.push({ raw: m[0], tag, ...(props ? { props } : {}) });
  }
  return out;
}

function parseJsxProps(s: string): Record<string, unknown> | undefined {
  const trimmed = s.trim();
  if (trimmed.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|\{([^}]*)\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    const key = m[1]!;
    if (typeof m[2] === 'string') {
      out[key] = m[2];
    } else if (typeof m[3] === 'string') {
      const v = m[3].trim();
      if (v === 'true') out[key] = true;
      else if (v === 'false') out[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) out[key] = Number(v);
      else out[key] = v;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * PRD-201-R12-R14 fine-mode split.
 *
 * Design (post-A24): emit ONE `prose/markdown` block carrying the original
 * markdown source (headings, paragraphs, lists, tables, inline emphasis
 * and links, all preserved verbatim) plus separately-extracted typed
 * blocks for **high-signal constructs** an agent might want to skip or
 * parse independently:
 *
 *  - `code`            — fenced code blocks (other than json/yaml)
 *  - `data`            — fenced json / yaml (PRD-102-R4)
 *  - `callout`         — GFM `> [!NOTE]` and Docusaurus `:::note` (PRD-201-R14)
 *  - `image`           — top-level image-only paragraphs (PRD-102 image block)
 *  - `marketing:placeholder` — MDX components in Plus mode
 *
 * Blocks are emitted in source order. Prose blocks are slices of the
 * original body string between extracted events; this preserves the exact
 * markdown an LLM is trained on (heading hashes, bold/italic markers,
 * link syntax, list bullets) instead of re-rendering the AST to flat
 * text. It also keeps byte counts honest — the sum of block bodies
 * approximates the source body within trim/whitespace.
 */
function fineSplit(body: string, ext: 'md' | 'mdx', mdxComponents: MdxComponent[]): BlockEmission {
  const warnings: string[] = [];
  let working = body;
  const placeholderMap = new Map<string, MdxComponent>();
  for (let i = 0; i < mdxComponents.length; i += 1) {
    const marker = `\n\n<!--ACT_MDX_${i}-->\n\n`;
    working = working.replace(mdxComponents[i]!.raw, marker);
    placeholderMap.set(`ACT_MDX_${i}`, mdxComponents[i]!);
  }

  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .parse(working);

  type ExtractedEvent = { start: number; end: number; block: Record<string, unknown> };
  const events: ExtractedEvent[] = [];
  const positionOf = (n: unknown): { start: number; end: number } | null => {
    const p = (n as { position?: { start?: { offset?: number }; end?: { offset?: number } } }).position;
    if (!p?.start || !p?.end || typeof p.start.offset !== 'number' || typeof p.end.offset !== 'number') return null;
    return { start: p.start.offset, end: p.end.offset };
  };

  if (tree.type === 'root' && Array.isArray((tree as { children?: unknown[] }).children)) {
    const children = (tree as { children: unknown[] }).children;
    for (const child of children) {
      const n = child as { type?: string };
      if (!n || typeof n.type !== 'string') continue;
      const pos = positionOf(child);
      if (!pos) continue;

      // PRD-201-R13 — fenced code → code or data block.
      if (n.type === 'code') {
        const c = n as { lang?: string; value: string };
        const lang = c.lang ?? 'text';
        if (lang === 'json' || lang === 'yaml') {
          events.push({ ...pos, block: { type: 'data', format: lang, text: c.value } });
        } else {
          events.push({ ...pos, block: { type: 'code', language: lang, text: c.value } });
        }
        continue;
      }

      // PRD-201-R14 — GFM-alert blockquote `> [!WARNING]` → callout.
      if (n.type === 'blockquote') {
        const text = renderMdast(n);
        const alert = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]/i.exec(text);
        if (alert !== null) {
          const trigger = alert[1]!.toUpperCase();
          const level = CALLOUT_TRIGGERS[trigger] ?? 'info';
          const stripped = text.replace(/^\s*\[![A-Z]+\]\s*/i, '').trim();
          events.push({ ...pos, block: { type: 'callout', level, text: stripped } });
        }
        // Non-alert blockquotes stay inline in the surrounding prose slice.
        continue;
      }

      // MDX placeholder → marketing:placeholder block. The substitution
      // injected the placeholder as a top-level HTML node.
      if (n.type === 'html') {
        const v = (n as { value: string }).value;
        const m = /^<!--ACT_MDX_(\d+)-->$/.exec(v);
        if (m !== null) {
          const comp = placeholderMap.get(`ACT_MDX_${m[1]}`);
          if (comp) {
            events.push({
              ...pos,
              block: {
                type: 'marketing:placeholder',
                metadata: {
                  component: comp.tag,
                  extraction_status: 'partial',
                  ...(comp.props ? { props: comp.props } : {}),
                },
              },
            });
          }
        }
        continue;
      }

      if (n.type === 'paragraph') {
        // PRD-201-R14 — Docusaurus `:::note` admonition (remark-gfm doesn't
        // parse these). Approximate by matching at paragraph level.
        const flat = renderMdast(n).trim();
        const adm = /^:::\s*(note|tip|important|warning|caution|danger)\b\s*([\s\S]*?)\s*:::$/im.exec(flat);
        if (adm !== null) {
          const trigger = adm[1]!.toUpperCase();
          const level = CALLOUT_TRIGGERS[trigger] ?? 'info';
          events.push({ ...pos, block: { type: 'callout', level, text: adm[2]!.trim() } });
          continue;
        }
        // Image-only paragraph → image block (PRD-102 image type).
        const imgChild = imageOnlyParagraphImage(n);
        if (imgChild !== null) {
          const block: Record<string, unknown> = { type: 'image', src: imgChild.url };
          if (typeof imgChild.alt === 'string' && imgChild.alt.length > 0) block.alt = imgChild.alt;
          if (typeof imgChild.title === 'string' && imgChild.title.length > 0) block.title = imgChild.title;
          events.push({ ...pos, block });
          continue;
        }
        // Otherwise: paragraph stays inline in the surrounding prose slice.
        continue;
      }

      // Headings, lists, tables, thematic-breaks, plain blockquotes, etc.
      // all stay inline in the surrounding prose slice. The source markdown
      // (including `#` heading prefixes, `**bold**`, `[link](url)`, list
      // bullets, table pipes) is preserved verbatim.
    }
  }

  // Sort events by source position so we can interleave prose slices.
  events.sort((a, b) => a.start - b.start);

  const blocks: Array<Record<string, unknown>> = [];
  const pushProse = (start: number, end: number): void => {
    if (start >= end) return;
    const slice = working.slice(start, end).trim();
    if (slice.length === 0) return;
    blocks.push({ type: 'prose', format: 'markdown', text: slice });
  };

  let cursor = 0;
  for (const ev of events) {
    pushProse(cursor, ev.start);
    blocks.push(ev.block);
    cursor = ev.end;
  }
  pushProse(cursor, working.length);

  // No extractions at all → one prose block with the whole body.
  if (events.length === 0 && blocks.length === 0) {
    const trimmed = working.trim();
    if (trimmed.length > 0) {
      blocks.push({ type: 'prose', format: 'markdown', text: trimmed });
    }
  }

  void ext;
  return { blocks, warnings };
}

/**
 * Returns the single `image` mdast child of a paragraph when the paragraph
 * contains nothing else but the image (and optional whitespace text nodes).
 * Inline images embedded in mixed-content paragraphs return null — those
 * stay in the surrounding prose slice with their `![alt](url)` markdown
 * intact. */
function imageOnlyParagraphImage(
  paragraph: unknown,
): { url: string; alt?: string; title?: string } | null {
  const p = paragraph as { children?: unknown[] };
  if (!Array.isArray(p.children)) return null;
  let img: { url: string; alt?: string; title?: string } | null = null;
  for (const c of p.children) {
    const n = c as { type?: string; value?: unknown; url?: unknown; alt?: unknown; title?: unknown };
    if (n.type === 'image' && typeof n.url === 'string') {
      if (img !== null) return null; // multiple images → keep inline
      img = {
        url: n.url,
        ...(typeof n.alt === 'string' ? { alt: n.alt } : {}),
        ...(typeof n.title === 'string' ? { title: n.title } : {}),
      };
      continue;
    }
    if (n.type === 'text' && typeof n.value === 'string' && n.value.trim().length === 0) {
      continue;
    }
    return null;
  }
  return img;
}

/** Cheap MDAST → text renderer (for fine mode block bodies). */
function renderMdast(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const n = node as { type?: string; value?: unknown; children?: unknown[] };
  if (typeof n.value === 'string') return n.value;
  if (Array.isArray(n.children)) return n.children.map(renderMdast).join('');
  return '';
}

/** PRD-103-R6/R8 — derive ETag from canonical envelope bytes (s256, base64url, 22 chars). */
import { deriveEtag, stripEtag } from '@act-spec/validator';
export { deriveEtag, stripEtag };

/** PRD-201-R5 / R26 — transform one source item into a node envelope. */
export async function transformOne(
  item: MarkdownItem,
  ctx: AdapterContext,
  cfg: {
    sourceDir: string;
    idStrategy: { stripPrefix?: string | undefined; namespace?: string | undefined };
    mode: 'coarse' | 'fine';
    frontmatter: { format: 'auto' | 'yaml' | 'toml' };
    targetLevel: 'core' | 'standard' | 'strict';
    humanUrlFor?: MarkdownAdapterConfig['humanUrlFor'];
  },
): Promise<EmittedNode> {
  const raw = await fs.readFile(item.absPath, 'utf8');
  const fm = parseFrontmatter(raw, cfg.frontmatter.format);

  // PRD-201-R6 — reserved keys must not appear as top-level frontmatter keys
  // intended for metadata, AND `metadata.*` mustn't set them either.
  if (fm.data['metadata'] && typeof fm.data['metadata'] === 'object') {
    for (const key of Object.keys(fm.data['metadata'])) {
      if (RESERVED_METADATA_KEYS.includes(key)) {
        throw new Error(
          `PRD-201-R6: frontmatter sets reserved metadata key "metadata.${key}" in ${item.relPath}`,
        );
      }
    }
  }

  // PRD-201-R8 / R9 / R10 — ID resolution.
  let baseDefault = deriveDefaultId(item.relPath, item.ext, cfg.idStrategy.stripPrefix);
  if (cfg.idStrategy.namespace) {
    baseDefault =
      baseDefault.length === 0
        ? cfg.idStrategy.namespace
        : `${cfg.idStrategy.namespace}/${baseDefault}`;
  }
  if (baseDefault.length === 0) baseDefault = 'index';
  const id = typeof fm.data['id'] === 'string' ? fm.data['id'] : baseDefault;
  if (!validateId(id)) {
    throw new Error(`PRD-201-R8/R9: derived id "${id}" fails grammar in ${item.relPath}`);
  }

  // PRD-201-R20 — summary_source rules.
  const fmSummary = typeof fm.data['summary'] === 'string' ? fm.data['summary'].trim() : undefined;
  const fmSummarySource = typeof fm.data['summary_source'] === 'string' ? fm.data['summary_source'] : undefined;
  if (fmSummarySource && !fmSummary) {
    throw new Error(`PRD-201-R20: frontmatter set summary_source without summary in ${item.relPath}`);
  }

  // Body → blocks (PRD-201-R12).
  const { blocks, warnings } = bodyToBlocks(fm.body, item.ext, cfg.mode, cfg.targetLevel);
  for (const w of warnings) ctx.logger.warn(w);

  // Summary derivation (PRD-201-R17).
  let summary: string;
  let summarySource: string;
  if (fmSummary) {
    summary = fmSummary;
    summarySource = fmSummarySource ?? 'author';
  } else {
    const extracted = extractSummary(fm.body);
    const fallback = extracted.length > 0 ? extracted : path.basename(item.relPath, `.${item.ext}`);
    summary = fallback;
    summarySource = 'extracted';
  }
  const trunc = truncateSummary(summary);

  const title =
    typeof fm.data['title'] === 'string' && fm.data['title'].trim().length > 0
      ? fm.data['title']
      : path.basename(item.relPath, `.${item.ext}`);

  const type = typeof fm.data['type'] === 'string' ? fm.data['type'] : 'doc';

  // PRD-201-R4 — `related` upgrade: string → {id, relation: "see-also"}.
  const related = (() => {
    const rel = fm.data['related'];
    if (!Array.isArray(rel)) return undefined;
    return rel.map((entry) => {
      if (typeof entry === 'string') return { id: entry, relation: 'see-also' };
      return entry as { id: string; relation: string };
    });
  })();

  // Frontmatter metadata + non-recognized top-level frontmatter (PRD-201-R5).
  const metadata: Record<string, unknown> = {};
  if (fm.data['metadata'] && typeof fm.data['metadata'] === 'object') {
    Object.assign(metadata, fm.data['metadata'] as Record<string, unknown>);
  }
  for (const [k, v] of Object.entries(fm.data)) {
    if (RECOGNIZED_FRONTMATTER_KEYS.has(k)) continue;
    metadata[k] = v;
  }
  // PRD-201-R26 / PRD-200-R13 — source stamp.
  metadata['source'] = {
    adapter: 'act-markdown',
    source_id: item.relPath,
    source_path: item.absPath,
  };
  // PRD-201-R24 — extraction_status partial when body is empty.
  if (fm.body.trim().length === 0) {
    metadata['extraction_status'] = 'partial';
  }

  const tokens = {
    summary: trunc.tokens,
    body: roughTokenCount(fm.body),
  };

  // PRD-100 source.human_url — when caller supplies a permalink resolver use
  // it; otherwise default to `${siteOrigin}/${id}/` when origin is known.
  // Returning `undefined` opts the node out of human_url emission.
  const humanUrl = ((): string | undefined => {
    if (typeof cfg.humanUrlFor === 'function') {
      return cfg.humanUrlFor(item, {
        ...(typeof ctx.siteOrigin === 'string' ? { siteOrigin: ctx.siteOrigin } : {}),
        id,
      });
    }
    if (typeof ctx.siteOrigin === 'string' && ctx.siteOrigin.length > 0) {
      return `${ctx.siteOrigin}/${id}/`;
    }
    return undefined;
  })();

  const envelope: ActNode = {
    act_version: ACT_VERSION,
    id,
    type,
    title,
    summary: trunc.text || title,
    summary_source: summarySource,
    content: blocks as ActNode['content'],
    tokens,
    metadata,
    etag: 'placeholder', // overwritten by generator per PRD-400-R8 / PRD-103-R6
    ...(related ? { related } : {}),
    ...(typeof fm.data['parent'] === 'string' ? { parent: fm.data['parent'] } : {}),
    ...(Array.isArray(fm.data['children']) ? { children: fm.data['children'] as string[] } : {}),
    ...(Array.isArray(fm.data['tags']) ? { tags: fm.data['tags'] as string[] } : {}),
    ...(typeof fm.data['updated_at'] === 'string' ? { updated_at: fm.data['updated_at'] } : {}),
    ...(humanUrl !== undefined ? { source: { human_url: humanUrl } } : {}),
  };

  // PRD-103-R6/R8 — compute ETag deterministically over canonical bytes
  // (the generator overwrites this at write time per PRD-400-R8, but the
  // adapter MAY pre-compute for caching per PRD-200 Snippet 4).
  envelope.etag = deriveEtag(stripEtag(envelope as unknown as Record<string, unknown>));
  return envelope;
}

function roughTokenCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

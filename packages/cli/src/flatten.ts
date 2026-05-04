/**
 * `actree flatten <url>` — walk an ACT-emitting site and print an
 * llms-full.txt-style render to stdout (or `--out`).
 *
 * Use cases (per docs/.ephemeral/00-overview.md §5.2.6 / §6.40):
 *   - Generate a single-file dump of a remote site for AI ingestion.
 *   - Debug an end-to-end ACT site (manifest + index + nodes) without
 *     pulling chrome.
 *   - Smoke-validate that a deployed site renders a coherent prose tree.
 *
 * Implementation:
 *   - Discover the manifest via `<url>/.well-known/act.json` (PRD-101-R8).
 *   - Fetch the index advertised by `manifest.index_url` (PRD-100-R20).
 *   - For each entry, fetch the node envelope via `node_url_template`
 *     (PRD-100-R21) and render it through the llms-full.txt formatter.
 *   - Reuse the formatter from `@act-spec/generator-core` once it lands
 *     (parallel task §5.2.5). Until then, this module ships a local
 *     minimal renderer so the subcommand is usable end-to-end. See
 *     `formatLlmsFull` below — the shape mirrors what the generator-core
 *     emitter is expected to expose.
 *
 * TODO(integration): wire to generator-core llms-full-txt emitter once
 * exported. The local renderer is deliberately small and conformant
 * with §6.40's "walk the tree (locale-aware fallback), render each leaf
 * as markdown with frontmatter, concat" contract; swap the call site to
 * `import { renderLlmsFull } from '@act-spec/generator-core'` (or the
 * agreed export name) when available.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';

import type { LoggerSink } from './logger.js';

const DEFAULT_MAX_BYTES = 5_000_000;

/** Public option surface for {@link runFlatten}. */
export interface FlattenOptions {
  /** Working directory used to resolve `--out`. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Optional fetch override (mirrors @act-spec/inspector). Tests inject
   * an in-memory fetch via this hook so they don't touch the network.
   */
  fetch?: typeof globalThis.fetch;
}

/** Shape we hand to the formatter — independent of the on-the-wire schema. */
interface LeafNode {
  id: string;
  type: string;
  title?: string | undefined;
  summary?: string | undefined;
  abstract?: string | undefined;
  content?: Array<{ type?: string | undefined; text?: string | undefined }> | undefined;
  /** Index-derived fallback when the node body lacks the field. */
  parent?: string | null | undefined;
}

/**
 * argv-driven entry point. Parses `<url>` + `--locale` / `--max-bytes` /
 * `--out` and writes the flattened render. Matches `runBuild` / `runInit`
 * in module shape (see {@link import('./run-build.js').runBuild}).
 */
const FLATTEN_OPTIONS = {
  locale: { type: 'string' },
  'max-bytes': { type: 'string' },
  out: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

export async function runFlatten(
  argv: readonly string[],
  sink: LoggerSink,
  opts: FlattenOptions = {},
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      options: FLATTEN_OPTIONS,
      strict: true,
      allowPositionals: true,
      args: [...argv],
    });
  } catch (err) {
    sink.stderr(`actree flatten: ${(err as Error).message}\n`);
    return 2;
  }
  if (parsed.values.help === true) {
    sink.stdout(FLATTEN_HELP);
    return 0;
  }
  const url = parsed.positionals[0];
  if (typeof url !== 'string' || url.length === 0) {
    sink.stderr(`actree flatten: missing required <url> positional. Run 'actree flatten --help'.\n`);
    return 2;
  }
  if (parsed.positionals.length > 1) {
    sink.stderr(`actree flatten: unexpected extra positional argument(s): ${parsed.positionals.slice(1).join(', ')}.\n`);
    return 2;
  }

  let maxBytes = DEFAULT_MAX_BYTES;
  const rawMax = parsed.values['max-bytes'];
  if (typeof rawMax === 'string') {
    const n = Number.parseInt(rawMax, 10);
    if (!Number.isFinite(n) || n <= 0) {
      sink.stderr(`actree flatten: --max-bytes must be a positive integer (got "${rawMax}").\n`);
      return 2;
    }
    maxBytes = n;
  }

  const cwd = opts.cwd ?? process.cwd();
  const localeOverride = typeof parsed.values.locale === 'string' ? parsed.values.locale : undefined;

  let output: string;
  try {
    output = await flattenSite(url, {
      maxBytes,
      ...(localeOverride !== undefined ? { locale: localeOverride } : {}),
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });
  } catch (err) {
    sink.stderr(`actree flatten: ${(err as Error).message}\n`);
    return 1;
  }

  const outPath = parsed.values.out;
  if (typeof outPath === 'string' && outPath.length > 0) {
    const abs = path.resolve(cwd, outPath);
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, output, 'utf8');
      sink.stderr(`actree flatten: wrote ${abs} (${Buffer.byteLength(output, 'utf8')} bytes)\n`);
    } catch (err) {
      sink.stderr(`actree flatten: failed to write ${abs}: ${(err as Error).message}\n`);
      return 1;
    }
  } else {
    sink.stdout(output);
  }
  return 0;
}

export const FLATTEN_HELP = `actree flatten — walk an ACT-emitting site and print an llms-full.txt-style render.

USAGE
  actree flatten <url> [--locale <code>] [--max-bytes <n>] [--out <path>]

ARGUMENTS
  <url>                Origin or manifest URL of an ACT-emitting site.

FLAGS
  --locale <code>      Locale to render (defaults to manifest.defaultLocale).
  --max-bytes <n>      Truncate render at <n> bytes (default ${DEFAULT_MAX_BYTES}).
  --out <path>         Write to <path> instead of stdout.
  --help, -h           Show this message.
`;

// --------------------------------------------------------------------------
// Programmatic API
// --------------------------------------------------------------------------

export interface FlattenSiteOptions {
  locale?: string;
  maxBytes?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * Library-friendly entry: resolve manifest, walk the tree, format. The
 * argv-driven {@link runFlatten} delegates here.
 */
export async function flattenSite(url: string, opts: FlattenSiteOptions = {}): Promise<string> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const manifestUrl = resolveManifestUrl(url);
  const manifest = await fetchManifest(manifestUrl, f);

  const indexUrlRaw = readString(manifest, 'index_url');
  if (indexUrlRaw === null) {
    throw new Error(`manifest at ${manifestUrl} does not advertise index_url.`);
  }
  const indexUrl = resolveAgainst(manifestUrl, indexUrlRaw);
  const nodeTemplate = readString(manifest, 'node_url_template');
  if (nodeTemplate === null) {
    throw new Error(`manifest at ${manifestUrl} does not advertise node_url_template.`);
  }
  const defaultLocale = readDefaultLocale(manifest);
  const locale = opts.locale ?? defaultLocale ?? 'en';

  const indexEntries = await fetchIndex(indexUrl, f);
  const filtered = filterByLocale(indexEntries, locale, defaultLocale);

  const leaves: LeafNode[] = [];
  for (const entry of filtered) {
    const nodeUrl = resolveAgainst(manifestUrl, substituteId(nodeTemplate, entry.id));
    let body: Record<string, unknown>;
    try {
      body = await fetchJson(nodeUrl, f);
    } catch {
      // Skip node-level failures so a single 404 doesn't poison the whole render.
      continue;
    }
    leaves.push(toLeaf(entry, body));
  }

  // TODO(integration): swap to generator-core's renderLlmsFull once exported.
  return formatLlmsFull({
    site: readSite(manifest),
    locale,
    leaves,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
  });
}

// --------------------------------------------------------------------------
// llms-full.txt formatter (local stand-in until generator-core lands its)
// --------------------------------------------------------------------------

interface FormatLlmsFullInput {
  site: { name: string; description?: string };
  locale: string;
  leaves: LeafNode[];
  maxBytes: number;
}

const TRUNCATION_MARKER = '\n\n<!-- truncated by actree flatten --max-bytes -->\n';

/**
 * Concatenate per-leaf markdown sections with frontmatter. Mirrors the
 * shape the generator-core emitter is expected to publish (§5.2.5);
 * the integration TODO above is to drop this in favor of the shared
 * formatter so renderings stay consistent across surfaces.
 */
export function formatLlmsFull(input: FormatLlmsFullInput): string {
  const { site, locale, leaves, maxBytes } = input;
  const header = `# ${site.name}\n\n` + (site.description ? `> ${site.description}\n\n` : '') + `_locale: ${locale}_\n`;
  const sections: string[] = [header];
  for (const leaf of leaves) {
    sections.push(renderLeaf(leaf));
  }
  const out = sections.join('\n---\n\n');
  if (Buffer.byteLength(out, 'utf8') <= maxBytes) return out;
  // Truncate at the last whole leaf that fits within the budget so the
  // tail is readable, then append a marker. We measure in bytes (not
  // characters) because that's the budget the operator passed.
  const budget = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARKER, 'utf8'));
  const buf = Buffer.from(out, 'utf8');
  const slice = buf.subarray(0, budget).toString('utf8');
  // Trim back to the last '---' separator so we don't cut a section in half.
  const lastSep = slice.lastIndexOf('\n---\n');
  const truncated = lastSep > 0 ? slice.slice(0, lastSep) : slice;
  return truncated + TRUNCATION_MARKER;
}

function renderLeaf(leaf: LeafNode): string {
  const fm = ['---', `id: ${leaf.id}`, `type: ${leaf.type}`];
  if (leaf.title !== undefined) fm.push(`title: ${jsonEscape(leaf.title)}`);
  if (leaf.parent !== undefined && leaf.parent !== null) fm.push(`parent: ${leaf.parent}`);
  fm.push('---', '');
  const parts: string[] = [fm.join('\n')];
  if (leaf.title !== undefined && leaf.title.length > 0) parts.push(`# ${leaf.title}\n`);
  if (leaf.summary !== undefined && leaf.summary.length > 0) parts.push(`${leaf.summary}\n`);
  if (leaf.abstract !== undefined && leaf.abstract.length > 0) parts.push(`${leaf.abstract}\n`);
  if (Array.isArray(leaf.content)) {
    for (const block of leaf.content) {
      if (typeof block.text === 'string' && block.text.length > 0) {
        parts.push(`${block.text}\n`);
      }
    }
  }
  return parts.join('\n');
}

function jsonEscape(s: string): string {
  return JSON.stringify(s);
}

// --------------------------------------------------------------------------
// HTTP helpers (minimal walker — does NOT pull in @act-spec/inspector to
// keep the cli's peer surface small; see runbook §5.2.6 "or inline a
// minimal walker")
// --------------------------------------------------------------------------

const WELL_KNOWN_PATH = '/.well-known/act.json' as const;

function resolveManifestUrl(input: string): string {
  // Accept either an origin or a fully-qualified manifest URL.
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error(`invalid URL: ${input}`);
  }
  if (u.pathname.endsWith('act.json')) return u.toString();
  // Strip trailing slash from the origin path so the well-known path joins cleanly.
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  return `${base}${WELL_KNOWN_PATH}`;
}

function resolveAgainst(base: string, ref: string): string {
  return new URL(ref, base).toString();
}

function substituteId(template: string, id: string): string {
  return template.replace(/\{id\}/g, encodeURIComponent(id));
}

async function fetchManifest(
  url: string,
  f: typeof globalThis.fetch,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url);
  } catch (err) {
    throw new Error(`failed to fetch manifest at ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`manifest at ${url} returned HTTP ${res.status}.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`manifest at ${url} is not JSON: ${(err as Error).message}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`manifest at ${url} is not a JSON object.`);
  }
  const m = body as Record<string, unknown>;
  if (m['act_version'] !== '0.1') {
    throw new Error(
      `manifest at ${url} declares act_version "${String(m['act_version'])}"; only 0.1 is supported.`,
    );
  }
  return m;
}

async function fetchIndex(
  url: string,
  f: typeof globalThis.fetch,
): Promise<IndexEntry[]> {
  const body = await fetchJson(url, f);
  const nodes = body['nodes'];
  if (!Array.isArray(nodes)) {
    throw new Error(`index at ${url} has no "nodes" array.`);
  }
  const out: IndexEntry[] = [];
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const id = e['id'];
    if (typeof id !== 'string') continue;
    out.push({
      id,
      type: typeof e['type'] === 'string' ? (e['type']) : undefined,
      parent: typeof e['parent'] === 'string' ? (e['parent']) : null,
      locale: typeof e['locale'] === 'string' ? (e['locale']) : undefined,
    });
  }
  return out;
}

async function fetchJson(url: string, f: typeof globalThis.fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url);
  } catch (err) {
    throw new Error(`failed to fetch ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`${url} is not JSON: ${(err as Error).message}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${url} is not a JSON object.`);
  }
  return body as Record<string, unknown>;
}

interface IndexEntry {
  id: string;
  type?: string | undefined;
  parent?: string | null | undefined;
  locale?: string | undefined;
}

function filterByLocale(
  entries: IndexEntry[],
  locale: string,
  defaultLocale: string | null,
): IndexEntry[] {
  const matches = entries.filter((e) => e.locale === locale);
  if (matches.length > 0) return matches;
  // Locale-aware fallback (§6.40): when no entry exists for the requested
  // locale, fall back to entries whose locale matches the manifest default,
  // or — if the index doesn't carry locale tags at all — return everything
  // so single-locale sites still flatten.
  if (defaultLocale !== null) {
    const def = entries.filter((e) => e.locale === defaultLocale);
    if (def.length > 0) return def;
  }
  if (entries.every((e) => e.locale === undefined)) return entries;
  return entries;
}

function toLeaf(entry: IndexEntry, body: Record<string, unknown>): LeafNode {
  const leaf: LeafNode = {
    id: entry.id,
    type: typeof body['type'] === 'string' ? (body['type']) : entry.type ?? '',
  };
  if (typeof body['title'] === 'string') leaf.title = body['title'];
  if (typeof body['summary'] === 'string') leaf.summary = body['summary'];
  if (typeof body['abstract'] === 'string') leaf.abstract = body['abstract'];
  if (Array.isArray(body['content'])) {
    leaf.content = (body['content'] as Array<Record<string, unknown>>).map((b) => ({
      type: typeof b['type'] === 'string' ? (b['type']) : undefined,
      text: typeof b['text'] === 'string' ? (b['text']) : undefined,
    }));
  }
  if (entry.parent !== undefined) leaf.parent = entry.parent;
  return leaf;
}

function readString(m: Record<string, unknown>, key: string): string | null {
  const v = m[key];
  return typeof v === 'string' ? v : null;
}

function readDefaultLocale(m: Record<string, unknown>): string | null {
  // PRD-100 — manifest may carry `defaultLocale` (camelCase per the TS
  // generator config) or `default_locale` (legacy snake_case). Honor both.
  const a = m['defaultLocale'];
  if (typeof a === 'string') return a;
  const b = m['default_locale'];
  if (typeof b === 'string') return b;
  return null;
}

function readSite(m: Record<string, unknown>): { name: string; description?: string } {
  const site = m['site'];
  if (!site || typeof site !== 'object') return { name: 'ACT site' };
  const s = site as Record<string, unknown>;
  const out: { name: string; description?: string } = {
    name: typeof s['name'] === 'string' ? (s['name']) : 'ACT site',
  };
  if (typeof s['description'] === 'string') out.description = s['description'];
  return out;
}

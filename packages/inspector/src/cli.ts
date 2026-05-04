/**
 * `act-inspect` CLI argv parsing and dispatch (PRD-601-R4 / R16 / R17 / R22).
 *
 * Library-friendly: {@link runCli} takes argv and an output sink,
 * returning the exit code. The package's `bin` shim invokes it with
 * `process.argv.slice(2)`.
 *
 * Subcommands (per task brief; programmatic API exposes the full
 * PRD-601-R15 surface):
 *
 *   - `act-inspect fetch <url> [<id>]` — fetch and pretty-print a
 *     single ACT envelope. With no `<id>`, fetches the manifest;
 *     with an `<id>`, fetches the corresponding node envelope.
 *   - `act-inspect walk <url>` — walk manifest → index → nodes.
 *   - `act-inspect diff <url-a> <url-b>` — diff two ACT trees.
 *   - `act-inspect token-budget <url> --max-tokens N` — what-if for
 *     a token budget. Per PRD-601-R12.
 *
 * Exit codes (PRD-601-R22):
 *
 *   0 — success.
 *   1 — invocation succeeded but produced findings.
 *   2 — invocation error (bad argv, network failure for the manifest).
 *   3 — subcommand requires a higher-level producer than declared.
 *   4 — `act_version` MAJOR mismatch (PRD-601-R3).
 */
// Namespace import for the Node-only `parseArgs` so browser bundlers
// (Vite/Rollup) can resolve `node:util` to a no-op stub without choking
// on a named-import binding against the stub. Browser SPAs never reach
// this code path, but the bundler's tree-shaker visits this file anyway
// because `runCli` is re-exported from `@act-spec/inspector`. Mirrors the
// pattern already used in `@act-spec/validator`'s cli.ts.
import * as nodeUtil from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { ACT_VERSION, INSPECTOR_VERSION } from './version.js';
import { walk } from './walk.js';
import { diff } from './diff.js';
import { node, subtree } from './fetch.js';
import { budget } from './budget.js';
import { discoverManifest } from './discovery.js';
import { RequestBudget, InvocationCache } from './http.js';
import type {
  BudgetOptions,
  BudgetResult,
  DiffOptions,
  DiffResult,
  Finding,
  NodeOptions,
  WalkOptions,
  WalkResult,
} from './types.js';

export interface CliSink {
  stdout(s: string): void;
  stderr(s: string): void;
}

const SHARED_OPTIONS = {
  header: { type: 'string', multiple: true },
  'max-requests': { type: 'string' },
  'rate-limit': { type: 'string' },
  'no-cache': { type: 'boolean' },
  'no-follow-cross-origin': { type: 'boolean' },
  json: { type: 'boolean' },
  tsv: { type: 'boolean' },
  verbose: { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

const HELP_TEXT = `act-inspect ${INSPECTOR_VERSION} (act_version ${ACT_VERSION})

USAGE
  act-inspect fetch <url> [<id>] [--subtree] [--depth N] [--json|--tsv]
  act-inspect walk <url> [--sample N|all] [--depth N] [--use-ndjson] [--json|--tsv]
  act-inspect diff <url-a> <url-b> [--include-content] [--ignore-fields a,b] [--no-fail-on-diff] [--json|--tsv]
  act-inspect token-budget <url> --max-tokens N [--strategy breadth-first|deepest-first] [--start-id ID] [--json|--tsv]
  act-inspect --version
  act-inspect --help

SHARED FLAGS (every subcommand that fetches network content)
  --header "Name: value"       Inject a request header (repeatable). NOT logged.
  --max-requests N             HTTP request budget per invocation (default 256; 32 for fetch).
  --rate-limit N               Per-origin requests per second (default 1; advisory in v0.1).
  --no-cache                   Disable If-None-Match emission (PRD-601-R9).
  --no-follow-cross-origin     Suppress cross-origin mount fetches (PRD-601-R8).
  --json                       Emit JSON to stdout (mutually exclusive with --tsv).
  --tsv                        Emit TSV to stdout (mutually exclusive with --json).
  --verbose                    Emit human-readable debug to stderr.

NOTES
  - The inspector NEVER authenticates on its own. Inject credentials via --header
    'Authorization: Bearer ...' (PRD-601-R18). Credential bytes are NEVER logged.
  - Findings (developer-facing) are not the same as PRD-600 'gaps' (conformance-
    facing). Run \`act-validate\` for a full PRD-107 verdict.
`;

type Parsed = Record<string, unknown>;

interface ParsedOk {
  ok: true;
  values: Parsed;
  positionals: string[];
}
interface ParsedErr {
  ok: false;
  error: string;
}
type ParsedResult = ParsedOk | ParsedErr;

/**
 * Parse argv with the given option config. Common error mapping:
 * unknown options → exit 2; mutually exclusive `--json` / `--tsv`
 * also → exit 2 (PRD-601-R16).
 */
export function parseCliArgs(
  argv: readonly string[],
  config: ParseArgsConfig['options'],
): ParsedResult {
  let raw;
  try {
    raw = nodeUtil.parseArgs({
      options: { ...SHARED_OPTIONS, ...(config ?? {}) },
      strict: true,
      allowPositionals: true,
      args: [...argv],
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const v = raw.values;
  if (v['json'] === true && v['tsv'] === true) {
    return { ok: false, error: '--json and --tsv are mutually exclusive (PRD-601-R16).' };
  }
  return { ok: true, values: v, positionals: raw.positionals };
}

/**
 * Top-level dispatch. Returns an exit code suitable for `process.exit`.
 */
export async function runCli(
  argv: readonly string[],
  sink: CliSink,
  inject?: { fetch?: typeof globalThis.fetch },
): Promise<number> {
  // Top-level --help / --version short-circuits.
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    sink.stdout(`${INSPECTOR_VERSION} (act_version ${ACT_VERSION})\n`);
    return 0;
  }

  const sub = argv[0]!;
  const rest = argv.slice(1);
  switch (sub) {
    case 'fetch':
      return runFetch(rest, sink, inject);
    case 'walk':
      return runWalk(rest, sink, inject);
    case 'diff':
      return runDiff(rest, sink, inject);
    case 'token-budget':
    case 'budget':
      return runBudget(rest, sink, inject);
    default:
      sink.stderr(`act-inspect: unknown subcommand ${JSON.stringify(sub)}. Run 'act-inspect --help'.\n`);
      return 2;
  }
}

// --------------------------------- fetch ---------------------------------

async function runFetch(
  argv: readonly string[],
  sink: CliSink,
  inject?: { fetch?: typeof globalThis.fetch },
): Promise<number> {
  const parsed = parseCliArgs(argv, {
    subtree: { type: 'boolean' },
    depth: { type: 'string' },
  });
  if (!parsed.ok) {
    sink.stderr(`act-inspect fetch: ${parsed.error}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values['help'] === true) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  const url = positionals[0];
  if (typeof url !== 'string') {
    sink.stderr('Usage: act-inspect fetch <url> [<id>] [--subtree] [--depth N]\n');
    return 2;
  }
  const id = positionals[1];
  const opts = baseOpts(values, inject);

  // No id → fetch and pretty-print the manifest.
  if (id === undefined) {
    const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const budget = new RequestBudget(opts.maxRequests ?? 32, fetcher);
    const cache = new InvocationCache();
    const disc = await discoverManifest(url, budget, cache, opts.noCache ?? false, opts.headers);
    const exitForFindings = mapFindings(disc.findings);
    if (values['json'] === true) {
      sink.stdout(JSON.stringify({ url: disc.manifestUrl, manifest: disc.manifest, findings: disc.findings }, null, 2) + '\n');
    } else if (values['tsv'] === true) {
      sink.stdout(`field\tvalue\nurl\t${disc.manifestUrl}\nfindings\t${disc.findings.length}\n`);
    } else {
      sink.stdout(renderManifestHuman(disc.manifestUrl, disc.manifest, disc.findings));
    }
    return exitForFindings;
  }

  if (values['subtree'] === true) {
    const depthRaw = values['depth'];
    const sOpts = {
      ...opts,
      ...(typeof depthRaw === 'string' ? { depth: parseInt(depthRaw, 10) } : {}),
    };
    const r = await subtree(url, id, sOpts);
    const exitForFindings = mapFindings(r.findings);
    if (values['json'] === true) {
      sink.stdout(JSON.stringify(r, null, 2) + '\n');
    } else if (values['tsv'] === true) {
      sink.stdout(`field\tvalue\nurl\t${r.url}\nfindings\t${r.findings.length}\n`);
    } else {
      sink.stdout(renderEnvelopeHuman('subtree', r.url, r.subtree, r.findings));
    }
    return exitForFindings;
  }

  const r = await node(url, id, opts);
  const exitForFindings = mapFindings(r.findings);
  if (values['json'] === true) {
    sink.stdout(JSON.stringify(r, null, 2) + '\n');
  } else if (values['tsv'] === true) {
    sink.stdout(`field\tvalue\nurl\t${r.url}\nfindings\t${r.findings.length}\n`);
  } else {
    sink.stdout(renderEnvelopeHuman('node', r.url, r.node, r.findings));
  }
  return exitForFindings;
}

// --------------------------------- walk ----------------------------------

async function runWalk(
  argv: readonly string[],
  sink: CliSink,
  inject?: { fetch?: typeof globalThis.fetch },
): Promise<number> {
  const parsed = parseCliArgs(argv, {
    sample: { type: 'string' },
    depth: { type: 'string' },
    'use-ndjson': { type: 'boolean' },
  });
  if (!parsed.ok) {
    sink.stderr(`act-inspect walk: ${parsed.error}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values['help'] === true) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  const url = positionals[0];
  if (typeof url !== 'string') {
    sink.stderr('Usage: act-inspect walk <url>\n');
    return 2;
  }
  let opts: WalkOptions;
  try {
    opts = baseOpts(values, inject);
    if (typeof values['sample'] === 'string') {
      opts.sample = values['sample'] === 'all' ? 'all' : parseIntStrict(String(values['sample']));
    }
    if (typeof values['depth'] === 'string') opts.depth = parseIntStrict(String(values['depth']));
  } catch (err) {
    sink.stderr(`act-inspect walk: ${(err as Error).message}\n`);
    return 2;
  }
  if (values['use-ndjson'] === true) opts.useNdjson = true;

  const r = await walk(url, opts);
  if (values['json'] === true) {
    sink.stdout(JSON.stringify(r, null, 2) + '\n');
  } else if (values['tsv'] === true) {
    sink.stdout(renderWalkTsv(r));
  } else {
    sink.stdout(renderWalkHuman(r));
  }
  return mapWalkExit(r.findings);
}

// --------------------------------- diff ----------------------------------

async function runDiff(
  argv: readonly string[],
  sink: CliSink,
  inject?: { fetch?: typeof globalThis.fetch },
): Promise<number> {
  const parsed = parseCliArgs(argv, {
    'include-content': { type: 'boolean' },
    'ignore-fields': { type: 'string' },
    'no-fail-on-diff': { type: 'boolean' },
  });
  if (!parsed.ok) {
    sink.stderr(`act-inspect diff: ${parsed.error}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values['help'] === true) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  const urlA = positionals[0];
  const urlB = positionals[1];
  if (typeof urlA !== 'string' || typeof urlB !== 'string') {
    sink.stderr('Usage: act-inspect diff <url-a> <url-b>\n');
    return 2;
  }
  const opts: DiffOptions = baseOpts(values, inject);
  if (values['include-content'] === true) opts.includeContent = true;
  if (typeof values['ignore-fields'] === 'string') {
    opts.ignoreFields = String(values['ignore-fields']).split(',').map((s) => s.trim()).filter(Boolean);
  }
  const r = await diff(urlA, urlB, opts);

  if (values['json'] === true) {
    sink.stdout(JSON.stringify(r, null, 2) + '\n');
  } else if (values['tsv'] === true) {
    sink.stdout(renderDiffTsv(r));
  } else {
    sink.stdout(renderDiffHuman(r));
  }
  const hasDiffs =
    r.added.length + r.removed.length + r.etag_changed.length + r.structural_change.length > 0;
  const exitForFindings = mapWalkExit(r.findings);
  if (exitForFindings >= 3) return exitForFindings;
  if (hasDiffs && values['no-fail-on-diff'] !== true) return 1;
  return exitForFindings;
}

// ------------------------------- token-budget -----------------------------

async function runBudget(
  argv: readonly string[],
  sink: CliSink,
  inject?: { fetch?: typeof globalThis.fetch },
): Promise<number> {
  const parsed = parseCliArgs(argv, {
    'max-tokens': { type: 'string' },
    strategy: { type: 'string' },
    'start-id': { type: 'string' },
  });
  if (!parsed.ok) {
    sink.stderr(`act-inspect token-budget: ${parsed.error}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values['help'] === true) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  const url = positionals[0];
  if (typeof url !== 'string') {
    sink.stderr('Usage: act-inspect token-budget <url> --max-tokens N\n');
    return 2;
  }
  if (typeof values['max-tokens'] !== 'string') {
    sink.stderr('act-inspect token-budget: --max-tokens is required (PRD-601-R17).\n');
    return 2;
  }
  let maxTokens: number;
  try {
    maxTokens = parseIntStrict(String(values['max-tokens']));
  } catch (err) {
    sink.stderr(`act-inspect token-budget: ${(err as Error).message}\n`);
    return 2;
  }
  const opts: BudgetOptions = baseOpts(values, inject);
  const strat = values['strategy'];
  if (strat !== undefined) {
    if (strat !== 'breadth-first' && strat !== 'deepest-first') {
      sink.stderr(`act-inspect token-budget: unknown --strategy ${JSON.stringify(strat)}.\n`);
      return 2;
    }
    opts.strategy = strat;
  }
  if (typeof values['start-id'] === 'string') opts.startId = String(values['start-id']);

  const r = await budget(url, maxTokens, opts);
  if (values['json'] === true) {
    sink.stdout(JSON.stringify(r, null, 2) + '\n');
  } else if (values['tsv'] === true) {
    sink.stdout(renderBudgetTsv(r));
  } else {
    sink.stdout(renderBudgetHuman(r));
  }
  return mapWalkExit(r.findings);
}

// ----------------------------- shared helpers -----------------------------

function baseOpts(
  values: Parsed,
  inject?: { fetch?: typeof globalThis.fetch },
): WalkOptions & DiffOptions & NodeOptions & BudgetOptions {
  const out: WalkOptions & DiffOptions & NodeOptions & BudgetOptions = {};
  if (typeof values['max-requests'] === 'string') {
    const n = Number.parseInt(String(values['max-requests']), 10);
    if (Number.isFinite(n)) out.maxRequests = n;
  }
  if (typeof values['rate-limit'] === 'string') {
    const f = parseFloat(String(values['rate-limit']));
    if (Number.isFinite(f)) out.rateLimit = f;
  }
  if (values['no-cache'] === true) out.noCache = true;
  if (values['no-follow-cross-origin'] === true) out.noFollowCrossOrigin = true;
  const headerFlags = values['header'];
  if (Array.isArray(headerFlags) && headerFlags.length > 0) {
    out.headers = parseHeaders(headerFlags as string[]);
  }
  if (inject?.fetch) out.fetch = inject.fetch;
  return out;
}

function parseHeaders(flags: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of flags) {
    const idx = f.indexOf(':');
    if (idx <= 0) continue;
    const k = f.slice(0, idx).trim();
    const v = f.slice(idx + 1).trim();
    if (k.length > 0) out[k] = v;
  }
  return out;
}

function parseIntStrict(s: string): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || String(n) !== s) {
    throw new Error(`expected integer, got ${JSON.stringify(s)}`);
  }
  return n;
}

/**
 * Map findings → CLI exit code per PRD-601-R22.
 *  - act-version-major-mismatch → 4
 *  - subtree-requires-standard / ndjson-requires-strict → 3
 *  - any other finding → 1
 *  - no findings → 0
 */
function mapFindings(findings: Finding[]): number {
  if (findings.some((f) => f.code === 'act-version-major-mismatch')) return 4;
  if (findings.some((f) => f.code === 'subtree-requires-standard' || f.code === 'ndjson-requires-strict')) return 3;
  if (findings.some((f) => f.severity === 'error')) return 1;
  return 0;
}

function mapWalkExit(findings: Finding[]): number {
  return mapFindings(findings);
}

// --------------------------- human / tsv renderers ------------------------

function renderManifestHuman(url: string, manifest: unknown, findings: Finding[]): string {
  const lines: string[] = [];
  lines.push(`act-inspect ${INSPECTOR_VERSION} (act_version ${ACT_VERSION})`);
  lines.push(`Target: ${url}`);
  lines.push('');
  if (manifest === null) {
    lines.push('Manifest: (unparsed; see findings)');
  } else {
    lines.push('Manifest:');
    lines.push(JSON.stringify(manifest, null, 2));
  }
  lines.push('');
  lines.push(`Findings: ${findings.length === 0 ? '(none)' : ''}`);
  for (const f of findings) lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
  return lines.join('\n') + '\n';
}

function renderEnvelopeHuman(kind: string, url: string, body: unknown, findings: Finding[]): string {
  const lines: string[] = [];
  lines.push(`act-inspect ${INSPECTOR_VERSION} (act_version ${ACT_VERSION})`);
  lines.push(`Kind:   ${kind}`);
  lines.push(`Target: ${url}`);
  lines.push('');
  if (body === null) {
    lines.push(`${kind}: (unparsed; see findings)`);
  } else {
    lines.push(`${kind}:`);
    lines.push(JSON.stringify(body, null, 2));
  }
  lines.push('');
  lines.push(`Findings: ${findings.length === 0 ? '(none)' : ''}`);
  for (const f of findings) lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
  return lines.join('\n') + '\n';
}

function renderWalkHuman(r: WalkResult): string {
  const lines: string[] = [];
  lines.push(`act-inspect ${INSPECTOR_VERSION} (act_version ${ACT_VERSION})`);
  lines.push(`Target: ${r.url}`);
  lines.push('');
  lines.push('Tree summary:');
  lines.push(`  Total nodes:    ${r.tree_summary.total_nodes}`);
  const types = Object.entries(r.tree_summary.types).map(([k, v]) => `${k} (${v})`).join(', ');
  lines.push(`  Types:          ${types || '(none)'}`);
  lines.push(
    `  Fanout:         min ${r.tree_summary.fanout.min}, max ${r.tree_summary.fanout.max}, mean ${r.tree_summary.fanout.mean.toFixed(1)}, median ${r.tree_summary.fanout.median}`,
  );
  lines.push(`  Max depth:      ${r.tree_summary.max_depth_observed} (observed)`);
  lines.push('');
  lines.push(`Walked (${r.nodes.length} of ${r.tree_summary.total_nodes}):`);
  for (const n of r.nodes) {
    const tok = `${n.tokens.summary ?? 0}/${n.tokens.body ?? 0} tokens`;
    lines.push(`  ${n.id}\t${n.type}\t${tok}\t${n.etag}\t[${n.status}]`);
  }
  lines.push('');
  lines.push(`Findings: ${r.findings.length === 0 ? '(none)' : ''}`);
  for (const f of r.findings) lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
  lines.push('');
  lines.push(`Walk: ${r.walk_summary.requests_made} requests, ${r.walk_summary.elapsed_ms}ms.`);
  return lines.join('\n') + '\n';
}

function renderWalkTsv(r: WalkResult): string {
  const lines: string[] = [];
  lines.push('id\ttype\ttokens_summary\ttokens_body\tetag\tparent\tstatus');
  for (const n of r.nodes) {
    lines.push(
      `${n.id}\t${n.type}\t${n.tokens.summary ?? 0}\t${n.tokens.body ?? 0}\t${n.etag}\t${n.parent ?? ''}\t${n.status}`,
    );
  }
  return lines.join('\n') + '\n';
}

function renderDiffHuman(r: DiffResult): string {
  const lines: string[] = [];
  lines.push(`act-inspect ${INSPECTOR_VERSION} (act_version ${ACT_VERSION})`);
  lines.push(`A: ${r.url_a}`);
  lines.push(`B: ${r.url_b}`);
  lines.push('');
  lines.push(`Added:           ${r.added.length}`);
  for (const e of r.added) lines.push(`  + ${e.id}`);
  lines.push(`Removed:         ${r.removed.length}`);
  for (const e of r.removed) lines.push(`  - ${e.id}`);
  lines.push(`Etag changed:    ${r.etag_changed.length}`);
  for (const e of r.etag_changed) {
    lines.push(`  ~ ${e.id} (Δ summary=${e.token_delta.summary}, body=${e.token_delta.body})`);
  }
  lines.push(`Structural:      ${r.structural_change.length}`);
  for (const e of r.structural_change) lines.push(`  ! ${e.id}`);
  lines.push(`Unchanged:       ${r.etag_unchanged.length}`);
  lines.push('');
  lines.push(`Findings: ${r.findings.length === 0 ? '(none)' : ''}`);
  for (const f of r.findings) lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
  return lines.join('\n') + '\n';
}

function renderDiffTsv(r: DiffResult): string {
  const lines: string[] = ['id\tclassification\ttokens_summary_delta\ttokens_body_delta'];
  for (const e of r.added) lines.push(`${e.id}\tadded\t\t`);
  for (const e of r.removed) lines.push(`${e.id}\tremoved\t\t`);
  for (const e of r.etag_changed) {
    lines.push(`${e.id}\tetag_changed\t${e.token_delta.summary}\t${e.token_delta.body}`);
  }
  for (const e of r.structural_change) lines.push(`${e.id}\tstructural_change\t\t`);
  return lines.join('\n') + '\n';
}

function renderBudgetHuman(r: BudgetResult): string {
  const lines: string[] = [];
  lines.push(`act-inspect ${INSPECTOR_VERSION} (act_version ${ACT_VERSION})`);
  lines.push(`Strategy:    ${r.strategy}`);
  lines.push(`Max tokens:  ${r.max_tokens}`);
  lines.push(`Start id:    ${r.start_id}`);
  lines.push('');
  lines.push(`Included (${r.summary.nodes_included} nodes, ${r.summary.tokens_used} tokens):`);
  for (let i = 0; i < r.inclusion_order.length; i += 1) {
    const e = r.inclusion_order[i]!;
    lines.push(`  ${String(i + 1).padStart(3, ' ')}. ${e.id}\t${e.tokens} tokens (cumulative ${e.cumulative_tokens})`);
  }
  lines.push('');
  lines.push(`Excluded:        ${r.summary.nodes_excluded}`);
  lines.push(`Tokens used:     ${r.summary.tokens_used} / ${r.max_tokens}`);
  lines.push(`Tokens remaining: ${r.summary.tokens_remaining}`);
  lines.push('');
  lines.push(`Findings: ${r.findings.length === 0 ? '(none)' : ''}`);
  for (const f of r.findings) lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
  return lines.join('\n') + '\n';
}

function renderBudgetTsv(r: BudgetResult): string {
  const lines: string[] = ['order\tid\ttokens\tcumulative_tokens'];
  for (let i = 0; i < r.inclusion_order.length; i += 1) {
    const e = r.inclusion_order[i]!;
    lines.push(`${i + 1}\t${e.id}\t${e.tokens}\t${e.cumulative_tokens}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * `act-validate` CLI argv parsing and dispatch (PRD-600-R26 / R27).
 *
 * Library-friendly: the {@link runCli} entry point takes argv and an output
 * sink, returning the exit code. The package's `bin` shim invokes it with
 * `process.argv.slice(2)`.
 */
// Namespace imports for the Node-only modules so the browser bundler
// (Vite/Rollup) can resolve `node:*` to a no-op stub without choking on a
// named-import destructuring against the stub. Browser hosts never reach
// the cli.ts code path (the SPA wraps the per-envelope validators
// directly), but `runCli` is still re-exported from `@act-spec/validator`
// for advanced testing — and the bundler's tree-shaker visits this file
// regardless.
import * as fs from 'node:fs';
import * as nodeUtil from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { ACT_VERSION, VALIDATOR_VERSION } from './version.js';
import {
  validateError,
  validateIndex,
  validateManifest,
  validateNdjsonIndex,
  validateNode,
  validateSubtree,
} from './envelopes.js';
import { validateSite, type ValidateSiteOptions } from './walk.js';
import type { ConformanceReport, ValidationResult } from '@act-spec/core';

export interface CliSink {
  stdout(s: string): void;
  stderr(s: string): void;
}

const HELP_TEXT = `act-validate ${VALIDATOR_VERSION} (act_version ${ACT_VERSION})

USAGE
  act-validate --url <url> [--conformance] [--probe-auth] [--level core|standard|strict]
  act-validate --file <path> [--kind manifest|node|index|subtree|error|ndjson]
  act-validate --version
  act-validate --help

LIMITATIONS (v0.1)
  - CORS: the hosted SPA cannot fetch from origins that block CORS. The CLI
    is not subject to CORS; prefer it for live audits. (PRD-600-R23)
  - Search body: v0.1 validates that search_url_template is present and the
    endpoint returns 200 JSON. The response body envelope is deferred to v0.2
    per Q13. Strict producers will see a search-body-deferred warning. (PRD-600-R24)
`;

const ARG_CONFIG: ParseArgsConfig = {
  options: {
    url: { type: 'string' },
    file: { type: 'string' },
    kind: { type: 'string' },
    conformance: { type: 'boolean' },
    level: { type: 'string' },
    profile: { type: 'string' },
    'probe-auth': { type: 'boolean' },
    'ignore-warning': { type: 'string', multiple: true },
    'strict-warnings': { type: 'boolean' },
    'max-requests': { type: 'string' },
    'rate-limit': { type: 'string' },
    sample: { type: 'string' },
    json: { type: 'boolean' },
    verbose: { type: 'boolean' },
    version: { type: 'boolean' },
    help: { type: 'boolean' },
  },
  strict: true,
  allowPositionals: false,
};

/** @internal exported for tests. */
export interface Parsed {
  url?: string;
  file?: string;
  kind?: string;
  conformance?: boolean;
  level?: string;
  profile?: string;
  probeAuth?: boolean;
  ignoreWarning?: readonly string[];
  strictWarnings?: boolean;
  maxRequests?: string;
  rateLimit?: string;
  sample?: string;
  json?: boolean;
  verbose?: boolean;
  version?: boolean;
  help?: boolean;
}

/**
 * Parse argv per PRD-600-R26. Returns either the typed flag bag or an
 * `error: string` payload describing an argv problem (CLI exits 2 on those).
 */
export function parseCliArgs(argv: readonly string[]): { ok: true; values: Parsed } | { ok: false; error: string } {
  let raw;
  try {
    raw = nodeUtil.parseArgs({ ...ARG_CONFIG, args: [...argv] });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const v = raw.values as Record<string, unknown>;
  const out: Parsed = {};
  if (typeof v['url'] === 'string') out.url = v['url'];
  if (typeof v['file'] === 'string') out.file = v['file'];
  if (typeof v['kind'] === 'string') out.kind = v['kind'];
  if (typeof v['conformance'] === 'boolean') out.conformance = v['conformance'];
  if (typeof v['level'] === 'string') out.level = v['level'];
  if (typeof v['profile'] === 'string') out.profile = v['profile'];
  if (typeof v['probe-auth'] === 'boolean') out.probeAuth = v['probe-auth'];
  if (Array.isArray(v['ignore-warning'])) out.ignoreWarning = v['ignore-warning'] as string[];
  if (typeof v['strict-warnings'] === 'boolean') out.strictWarnings = v['strict-warnings'];
  if (typeof v['max-requests'] === 'string') out.maxRequests = v['max-requests'];
  if (typeof v['rate-limit'] === 'string') out.rateLimit = v['rate-limit'];
  if (typeof v['sample'] === 'string') out.sample = v['sample'];
  if (typeof v['json'] === 'boolean') out.json = v['json'];
  if (typeof v['verbose'] === 'boolean') out.verbose = v['verbose'];
  if (typeof v['version'] === 'boolean') out.version = v['version'];
  if (typeof v['help'] === 'boolean') out.help = v['help'];
  if (out.url !== undefined && out.file !== undefined) {
    return { ok: false, error: '--url and --file are mutually exclusive' };
  }
  return { ok: true, values: out };
}

/** Mapping from --kind to the per-envelope validator, for `--file` mode. */
function dispatchFile(kind: string, content: string): ValidationResult {
  switch (kind) {
    case 'manifest':
      return validateManifest(content);
    case 'node':
      return validateNode(content);
    case 'index':
      return validateIndex(content);
    case 'ndjson':
      return validateNdjsonIndex(content);
    case 'subtree':
      return validateSubtree(content);
    case 'error':
      return validateError(content);
    default:
      throw new Error(`unknown --kind ${JSON.stringify(kind)}`);
  }
}

/**
 * Dispatch to the appropriate validator based on argv. Returns the exit
 * code per PRD-600-R27.
 */
export async function runCli(
  argv: readonly string[],
  sink: CliSink,
  inject?: { fetch?: typeof globalThis.fetch; now?: () => string },
): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    sink.stderr(`act-validate: ${parsed.error}\n`);
    return 2;
  }
  const v = parsed.values;
  if (v.help) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  if (v.version) {
    sink.stdout(`${VALIDATOR_VERSION} (act_version ${ACT_VERSION})\n`);
    return 0;
  }

  if (v.file !== undefined) {
    let content: string;
    try {
      content = fs.readFileSync(v.file, 'utf8');
    } catch (err) {
      sink.stderr(`act-validate: cannot read ${v.file}: ${(err as Error).message}\n`);
      return 2;
    }
    const kind = v.kind ?? guessKindFromFilename(v.file);
    let result: ValidationResult;
    try {
      result = dispatchFile(kind, content);
    } catch (err) {
      sink.stderr(`act-validate: ${(err as Error).message}\n`);
      return 2;
    }
    if (v.json) {
      sink.stdout(JSON.stringify(result, null, 2) + '\n');
    } else {
      sink.stdout(formatResult(result));
    }
    return result.gaps.length > 0 ? 1 : 0;
  }

  if (v.url !== undefined) {
    const opts: ValidateSiteOptions = buildSiteOpts(v, inject);

    const report = await validateSite(v.url, opts);
    if (v.json || v.conformance) {
      sink.stdout(JSON.stringify(report, null, 2) + '\n');
    } else {
      sink.stdout(formatReport(report));
    }
    return decideExitCode(report, v);
  }

  sink.stderr('act-validate: must supply --url or --file (see --help)\n');
  return 2;
}

function buildSiteOpts(
  v: Parsed,
  inject: { fetch?: typeof globalThis.fetch; now?: () => string } | undefined,
): ValidateSiteOptions {
  const opts: ValidateSiteOptions = {};
  if (v.maxRequests !== undefined) opts.maxRequests = parseIntStrict(v.maxRequests);
  if (v.rateLimit !== undefined) opts.rateLimit = parseFloat(v.rateLimit);
  if (v.sample !== undefined) {
    opts.sample = v.sample === 'all' ? 'all' : parseIntStrict(v.sample);
  }
  if (v.probeAuth !== undefined) opts.probeAuth = v.probeAuth;
  if (v.strictWarnings !== undefined) opts.strictWarnings = v.strictWarnings;
  if (v.ignoreWarning !== undefined) opts.ignoreWarnings = v.ignoreWarning;
  if (inject?.fetch) opts.fetch = inject.fetch;
  if (inject?.now) opts.passedAt = inject.now();
  return opts;
}

/** @internal exported for tests covering rank/ profile mismatch branches. */
export function decideExitCode(report: ConformanceReport, v: Parsed): number {
  if (v.level !== undefined) {
    if (!isLevel(v.level)) return 2;
    if (report.achieved.level === null) return 3;
    if (rank(report.achieved.level) < rank(v.level)) return 3;
  }
  if (v.profile !== undefined) {
    if (v.profile !== 'static' && v.profile !== 'runtime') return 2;
    if (report.achieved.delivery !== v.profile) return 3;
  }
  if (report.gaps.length > 0) return 1;
  if (v.strictWarnings && report.warnings.length > 0) return 1;
  return 0;
}

function isLevel(s: string): s is 'core' | 'standard' | 'strict' {
  return s === 'core' || s === 'standard' || s === 'strict';
}

function rank(l: 'core' | 'standard' | 'strict'): number {
  return l === 'core' ? 0 : l === 'standard' ? 1 : 2;
}

function parseIntStrict(s: string): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || String(n) !== s) {
    throw new Error(`expected integer, got ${JSON.stringify(s)}`);
  }
  return n;
}

function guessKindFromFilename(file: string): string {
  if (file.endsWith('.ndjson')) return 'ndjson';
  if (/\bmanifest\b/i.test(file) || /act\.json$/.test(file)) return 'manifest';
  if (/\bsubtree\b/i.test(file)) return 'subtree';
  if (/\bindex\b/i.test(file)) return 'index';
  if (/\berror\b/i.test(file)) return 'error';
  return 'node';
}

function formatResult(r: ValidationResult): string {
  const lines: string[] = [];
  if (r.gaps.length === 0 && r.warnings.length === 0) {
    lines.push('OK — no findings.');
  }
  for (const g of r.gaps) {
    lines.push(`[gap/${g.level}] ${g.requirement}: ${g.missing}`);
  }
  for (const w of r.warnings) {
    lines.push(`[warn/${w.level}] ${w.code}: ${w.message}`);
  }
  return lines.join('\n') + '\n';
}

function formatReport(r: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`ACT Validator ${VALIDATOR_VERSION}  (act_version ${r.act_version})`);
  lines.push(`Target: ${r.url}`);
  lines.push(`Declared:  ${r.declared.level ?? '<unknown>'} / ${r.declared.delivery ?? '<unknown>'}`);
  lines.push(`Achieved:  ${r.achieved.level ?? '<none>'} / ${r.achieved.delivery ?? '<unknown>'}`);
  if (r.gaps.length === 0) {
    lines.push('Gaps: (none)');
  } else {
    lines.push('Gaps:');
    for (const g of r.gaps) lines.push(`  [${g.level}] ${g.requirement}: ${g.missing}`);
  }
  if (r.warnings.length === 0) {
    lines.push('Warnings: (none)');
  } else {
    lines.push('Warnings:');
    for (const w of r.warnings) lines.push(`  [${w.level}] ${w.code}: ${w.message}`);
  }
  lines.push(`PASSED AT: ${r.passed_at}`);
  return lines.join('\n') + '\n';
}

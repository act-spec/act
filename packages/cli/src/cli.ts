/**
 * `actree` CLI argv parsing + dispatch (PRD-409-R1 / R2 / R15 / R17).
 *
 * Library-friendly: {@link runCli} takes argv + an output sink and returns the
 * process exit code. The package's `bin` shim invokes it with
 * `process.argv.slice(2)`. The bin name is `actree` (renamed from `act` to
 * avoid colliding with nektos/act on PATH); the package name `@act-spec/cli`
 * is unchanged.
 *
 * Subcommands per PRD-409-R2:
 *   - `actree build` (with `--watch`, `--config`, `--profile`, `--timeout`, …).
 *   - `actree init [template]`.
 *   - `actree validate <target>` (delegated to @act-spec/validator per PRD-409-R15).
 *   - `actree --help` / `actree --version`.
 *
 * Exit codes:
 *   0 — success.
 *   1 — build error / non-zero validate findings.
 *   2 — usage error (bad argv, mutually-exclusive flags).
 *   124 — build timeout (PRD-409-R10).
 */
import { parseArgs, type ParseArgsConfig } from 'node:util';
import * as path from 'node:path';

import {
  applyProfileOverride,
  detectHostFrameworkFields,
  loadConfig,
  type ProfileShorthand,
} from './config.js';
import { detectOutputConflicts, formatConflict } from './conflicts.js';
import { parseDuration } from './duration.js';
import { runFlatten } from './flatten.js';
import { initProject } from './init.js';
import { createLogger, selectLoggerMode, type CliLogger, type LoggerSink } from './logger.js';
import { BuildTimeoutError, runBuild } from './run-build.js';
import { isInitTemplate } from './templates.js';
import { ACT_VERSION, CLI_VERSION } from './version.js';
import { watchBuild } from './watch.js';

export type { LoggerSink } from './logger.js';

const HELP_TEXT = `actree ${CLI_VERSION} (act_version ${ACT_VERSION})  framework-free

USAGE
  actree build [--config <path>] [--profile <core|standard|strict>] [--watch]
            [--watch-paths <a,b,c>] [--watch-debounce <ms>]
            [--timeout <duration>] [--build-report <path>]
            [--allow-output-conflict] [--fail-on-warning]
            [--silent | --verbose | --json]
  actree init [template]                    template ∈ markdown|programmatic|cms-contentful
            [--target <dir>] [--force]
  actree validate <target> [...]            delegates to @act-spec/validator
  actree flatten <url> [--locale <code>] [--max-bytes <n>] [--out <path>]
                                            walk an ACT site and print an
                                            llms-full.txt-style render.
  actree --help
  actree --version

FLAGS
  --config <path>           explicit config path; overrides CWD search.
  --profile <level>         shorthand for conformanceTarget (PRD-409-R17).
  --watch                   rebuild on filesystem change (PRD-409-R6).
  --watch-paths <list>      extra comma-separated paths to watch.
  --watch-debounce <ms>     debounce delay for filesystem events (default 200).
  --timeout <duration>      build timeout, e.g. 5m, 30s (PRD-409-R10; default 5m).
  --build-report <path>     override build-report sidecar path (PRD-409-R13).
  --allow-output-conflict   bypass PRD-409-R11 outputDir conflict check.
  --fail-on-warning         exit 1 when warnings are present.
  --silent | --verbose | --json   logger mode (PRD-409-R9).
`;

export interface CliOptions {
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
}

export async function runCli(
  argv: readonly string[],
  sink: LoggerSink,
  opts: CliOptions = {},
): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    sink.stdout(`${CLI_VERSION} (act_version ${ACT_VERSION})\n`);
    return 0;
  }
  // The CLI's first log line on every build per PRD-409-R3.
  if (argv[0] === 'build') {
    sink.stderr(`actree CLI v${CLI_VERSION} (framework-free)\n`);
    return runBuildCommand(argv.slice(1), sink, cwd);
  }
  if (argv[0] === 'init') {
    return runInitCommand(argv.slice(1), sink, cwd);
  }
  if (argv[0] === 'validate') {
    return runValidateCommand(argv.slice(1), sink);
  }
  if (argv[0] === 'flatten') {
    return runFlatten(argv.slice(1), sink, { cwd });
  }
  sink.stderr(`actree: unknown subcommand "${String(argv[0])}". Run 'actree --help'.\n`);
  return 2;
}

// ----------------------------- build --------------------------------------

const BUILD_OPTIONS = {
  config: { type: 'string', short: 'c' },
  profile: { type: 'string' },
  watch: { type: 'boolean' },
  'watch-paths': { type: 'string' },
  'watch-debounce': { type: 'string' },
  timeout: { type: 'string' },
  'build-report': { type: 'string' },
  'allow-output-conflict': { type: 'boolean' },
  'fail-on-warning': { type: 'boolean' },
  silent: { type: 'boolean', short: 's' },
  verbose: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

async function runBuildCommand(
  argv: readonly string[],
  sink: LoggerSink,
  cwd: string,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      options: BUILD_OPTIONS,
      strict: true,
      allowPositionals: true,
      args: [...argv],
    });
  } catch (err) {
    sink.stderr(`actree build: ${(err as Error).message}\n`);
    return 2;
  }
  const v = parsed.values;
  if (v.help === true) {
    sink.stdout(HELP_TEXT);
    return 0;
  }

  const modeChoice = selectLoggerMode({
    ...(v.silent !== undefined ? { silent: v.silent } : {}),
    ...(v.verbose !== undefined ? { verbose: v.verbose } : {}),
    ...(v.json !== undefined ? { json: v.json } : {}),
  });
  if ('error' in modeChoice) {
    sink.stderr(`actree build: ${modeChoice.error}\n`);
    return 2;
  }
  const logger = createLogger(modeChoice.mode, sink);

  // PRD-409-R10 — parse timeout.
  let timeoutMs = 5 * 60_000;
  if (typeof v.timeout === 'string' && v.timeout.length > 0) {
    try {
      timeoutMs = parseDuration(v.timeout);
    } catch (err) {
      sink.stderr(`actree build: ${(err as Error).message}\n`);
      return 2;
    }
  }

  // PRD-409-R17 — validate profile shorthand.
  let profile: ProfileShorthand | undefined;
  if (typeof v.profile === 'string') {
    if (v.profile !== 'core' && v.profile !== 'standard' && v.profile !== 'strict') {
      sink.stderr(`actree build: --profile must be core|standard|strict (got "${v.profile}")\n`);
      return 2;
    }
    profile = v.profile;
  }

  // PRD-409-R5 — load config.
  let loaded;
  try {
    loaded = await loadConfig(cwd, typeof v.config === 'string' ? v.config : undefined);
  } catch (err) {
    sink.stderr(`actree build: ${(err as Error).message}\n`);
    return 1;
  }
  const config = loaded.config;

  // PRD-409-R3 — refuse host-framework fields.
  const hf = detectHostFrameworkFields(config as unknown as Record<string, unknown>);
  if (hf.length > 0) {
    for (const f of hf) {
      sink.stderr(
        `actree build: PRD-409-R3 — config field "${f.field}" belongs to host-framework plugin ${f.prd}, not the framework-free CLI.\n`,
      );
    }
    return 1;
  }

  // PRD-409-R17 — apply profile.
  const profileResult = applyProfileOverride(config, profile);
  if (profileResult.conflicted) {
    logger.warn(
      `PRD-409-R17: --profile ${String(profile)} overrides config conformanceTarget "${profileResult.previous}".`,
    );
  }

  // PRD-409-R11 — output-dir conflict detection (unless overridden).
  if (v['allow-output-conflict'] !== true) {
    const conflicts = detectOutputConflicts({ cwd, outputDir: config.outputDir });
    if (conflicts.length > 0) {
      for (const c of conflicts) sink.stderr(`actree build: ${formatConflict(c)}\n`);
      return 1;
    }
  } else {
    const conflicts = detectOutputConflicts({ cwd, outputDir: config.outputDir });
    for (const c of conflicts) {
      logger.warn(`PRD-409-R11 (suppressed): ${formatConflict(c)}`);
    }
  }

  // PRD-409-R6 — watch mode.
  if (v.watch === true) {
    const extras =
      typeof v['watch-paths'] === 'string'
        ? v['watch-paths'].split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
    const debounce =
      typeof v['watch-debounce'] === 'string'
        ? Number.parseInt(v['watch-debounce'], 10)
        : undefined;
    const handle = await watchBuild(config, {
      cwd,
      logger,
      ...(typeof v['build-report'] === 'string' ? { buildReportPath: path.resolve(cwd, v['build-report']) } : {}),
      ...(extras !== undefined ? { paths: extras } : {}),
      ...(debounce !== undefined && Number.isFinite(debounce) ? { debounceMs: debounce } : {}),
    });
    // SIGINT / SIGTERM handlers per PRD-409-R6.
    let closed = false;
    const onSignal = (): void => {
      if (closed) return;
      closed = true;
      void handle.close().then(() => {
        process.exit(0);
      });
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    // Wait forever (until signal). Tests close via the returned handle.
    return await new Promise<number>(() => {
      /* never resolve */
    });
  }

  // Single build.
  try {
    const report = await runBuild(config, {
      cwd,
      logger,
      timeoutMs,
      ...(typeof v['build-report'] === 'string' ? { buildReportPath: path.resolve(cwd, v['build-report']) } : {}),
    });
    if (v['fail-on-warning'] === true && report.warnings.length > 0) {
      logger.error(`build produced ${report.warnings.length} warning(s); --fail-on-warning set.`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof BuildTimeoutError) {
      logger.error(err.message);
      return 124;
    }
    logger.error(`actree build: ${(err as Error).message}`);
    return 1;
  }
}

// ----------------------------- init ---------------------------------------

const INIT_OPTIONS = {
  target: { type: 'string' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

async function runInitCommand(
  argv: readonly string[],
  sink: LoggerSink,
  cwd: string,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      options: INIT_OPTIONS,
      strict: true,
      allowPositionals: true,
      args: [...argv],
    });
  } catch (err) {
    sink.stderr(`actree init: ${(err as Error).message}\n`);
    return 2;
  }
  const v = parsed.values;
  if (v.help === true) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  const templateRaw = parsed.positionals[0] ?? 'markdown';
  if (!isInitTemplate(templateRaw)) {
    sink.stderr(`actree init: unknown template "${templateRaw}". Choose: markdown, programmatic, cms-contentful.\n`);
    return 2;
  }
  const target = typeof v.target === 'string' ? path.resolve(cwd, v.target) : cwd;
  try {
    const result = await initProject(templateRaw, target, { force: v.force === true });
    for (const w of result.written) {
      sink.stdout(`wrote ${w}\n`);
    }
    return 0;
  } catch (err) {
    sink.stderr(`actree init: ${(err as Error).message}\n`);
    return 1;
  }
}

// ----------------------------- validate -----------------------------------

async function runValidateCommand(
  argv: readonly string[],
  sink: LoggerSink,
): Promise<number> {
  if (argv.length === 0) {
    sink.stderr(
      `actree validate: PRD-409-R15 — this subcommand delegates to @act-spec/validator. Pass through args, e.g. \`actree validate https://example.com\`.\n`,
    );
    return 2;
  }
  // PRD-409-R15 — delegate to @act-spec/validator's runCli; the canonical
  // CLI is `act-validate` and `actree validate` is convenience-only.
  let validator: { runCli?: (argv: readonly string[], sink: LoggerSink) => Promise<number> };
  try {
    validator = await import('@act-spec/validator');
  } catch (err) {
    sink.stderr(`actree validate: failed to load @act-spec/validator: ${(err as Error).message}\n`);
    return 1;
  }
  if (typeof validator.runCli !== 'function') {
    sink.stderr(`actree validate: @act-spec/validator does not export runCli; run \`act-validate\` directly.\n`);
    return 1;
  }
  return validator.runCli(argv, sink);
}

/** Re-export the cli logger for advanced library use. */
export type { CliLogger };

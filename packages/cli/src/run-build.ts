/**
 * PRD-409-R4 / R7 / R12 / R13 / R14 / R16 / R20 — programmatic build entry.
 *
 * `runBuild(config, opts)`:
 *   - PRD-409-R4 — invokes `runPipeline` from `@act-spec/generator-core` exactly
 *     once against the resolved config; the CLI MUST NOT modify pipeline stages.
 *   - PRD-409-R7 — emits the static file set per PRD-105 layout into `outputDir`.
 *   - PRD-409-R12 — manifest construction with `delivery: "static"`,
 *     `act_version: "0.1"`, `conformance.level` from observed emissions.
 *   - PRD-409-R13 — writes the build-report sidecar at `buildReportPath`,
 *     defaulting to `./.act-build-report.json` at the project root (NOT
 *     inside `outputDir`). Operators who override into `outputDir` get a
 *     warning.
 *   - PRD-409-R14 — adapter pinning is enforced inside `runPipeline` via
 *     `enforceAdapterPinning`; failures surface as exceptions.
 *   - PRD-409-R20 — `mounts` declared in the config flow into the manifest
 *     via PRD-100-R7 / PRD-400-R19 (both owned by the framework).
 *
 * The report-write step intentionally bypasses `emitFiles`'s in-`outputDir`
 * sidecar and writes the report at the chosen `buildReportPath`. This is the
 * narrow CLI override `emitFiles` does not parameterize for; everything else
 * (manifest / index / nodes / subtrees / capability backing) flows through
 * the framework unchanged.
 */
import * as path from 'node:path';

import {
  atomicWrite,
  runPipeline,
  verifyCapabilityBacking,
  type BuildReport,
  type GeneratorConfig,
} from '@act-spec/generator-core';

import type { CliLogger } from './logger.js';

export interface RunBuildOptions {
  /** Working directory the report path is resolved against. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * PRD-409-R13 — explicit override for the build-report sidecar path.
   * Defaults to `<cwd>/.act-build-report.json` (project root, NOT inside
   * `outputDir`). Operators who set this inside `outputDir` get a warning.
   */
  buildReportPath?: string;
  /** Optional logger; defaults to a noop logger when not supplied. */
  logger?: CliLogger;
  /** Per-build timeout in ms (PRD-409-R10). When unset the build runs to completion. */
  timeoutMs?: number;
}

const ACT_VERSION = '0.1' as const;

function noopLogger(): CliLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

/**
 * PRD-409-R13 — return whether the resolved report path is inside `outputDir`.
 * Used to surface a warning per the PRD's error table.
 */
export function isReportInsideOutputDir(reportPath: string, outputDir: string): boolean {
  const normReport = path.resolve(reportPath);
  const normOutput = path.resolve(outputDir);
  if (normReport === normOutput) return true;
  const withSep = normOutput.endsWith(path.sep) ? normOutput : `${normOutput}${path.sep}`;
  return normReport.startsWith(withSep);
}

/**
 * PRD-409-R7 — write the static file set per PRD-105.
 */
async function emitStaticFiles(opts: {
  outputDir: string;
  outcome: Awaited<ReturnType<typeof runPipeline>>;
}): Promise<BuildReport['files']> {
  const files: BuildReport['files'] = [];
  const manifestPath = path.join(opts.outputDir, '.well-known', 'act.json');
  const indexPath = path.join(opts.outputDir, 'act', 'index.json');
  const manifestBody = JSON.stringify(opts.outcome.manifest, null, 2);
  const indexBody = JSON.stringify(opts.outcome.index, null, 2);
  await atomicWrite(manifestPath, manifestBody);
  files.push({ path: manifestPath, bytes: Buffer.byteLength(manifestBody, 'utf8'), band: 'core' });
  await atomicWrite(indexPath, indexBody);
  const indexEntry: BuildReport['files'][number] = {
    path: indexPath,
    bytes: Buffer.byteLength(indexBody, 'utf8'),
    band: 'core',
    ...(opts.outcome.index.etag !== undefined ? { etag: opts.outcome.index.etag } : {}),
  };
  files.push(indexEntry);

  for (const node of opts.outcome.nodes) {
    const nodePath = path.join(opts.outputDir, 'act', 'nodes', `${node.id}.json`);
    const body = JSON.stringify(node, null, 2);
    await atomicWrite(nodePath, body);
    files.push({
      path: nodePath,
      bytes: Buffer.byteLength(body, 'utf8'),
      etag: node.etag,
      band: 'core',
    });
  }

  for (const [rootId, st] of opts.outcome.subtrees) {
    const stPath = path.join(opts.outputDir, 'act', 'subtrees', `${rootId}.json`);
    const body = JSON.stringify(st, null, 2);
    await atomicWrite(stPath, body);
    files.push({
      path: stPath,
      bytes: Buffer.byteLength(body, 'utf8'),
      etag: st.etag,
      band: 'standard',
    });
  }

  return files;
}

export class BuildTimeoutError extends Error {
  public readonly partialReport: BuildReport;
  constructor(message: string, partialReport: BuildReport) {
    super(message);
    this.name = 'BuildTimeoutError';
    this.partialReport = partialReport;
  }
}

/**
 * PRD-409-R4 / R12 / R13 / R16 — public programmatic build.
 *
 * Returns the {@link BuildReport} per PRD-400-R27. Pipeline errors propagate.
 */
export async function runBuild(
  config: GeneratorConfig,
  opts: RunBuildOptions = {},
): Promise<BuildReport> {
  const cwd = opts.cwd ?? process.cwd();
  const logger = opts.logger ?? noopLogger();
  const startedAt = Date.now();
  const warnings: string[] = [];

  // PRD-409-R13 — default report path is at project root, NOT in outputDir.
  const reportPath = path.resolve(
    cwd,
    opts.buildReportPath ?? path.join(cwd, '.act-build-report.json'),
  );
  const outputDirAbs = path.resolve(cwd, config.outputDir);
  if (isReportInsideOutputDir(reportPath, outputDirAbs)) {
    const warn = `PRD-409-R13: buildReportPath "${reportPath}" is inside outputDir "${outputDirAbs}"; the report will ship to the deploy target. Move it to the project root.`;
    warnings.push(warn);
    logger.warn(warn);
  }

  // Resolve `outputDir` against `cwd` so the CLI behaves the same whether
  // invoked from a subprocess (where process.cwd() is the project root) or
  // programmatically (where the caller may pass any cwd).
  const resolvedConfig: GeneratorConfig = { ...config, outputDir: outputDirAbs };

  const pipelineRun = runPipeline({ config: resolvedConfig, logger });

  const outcome = await (opts.timeoutMs !== undefined && opts.timeoutMs > 0
    ? withTimeout(pipelineRun, opts.timeoutMs, reportPath, startedAt, config, warnings)
    : pipelineRun);

  // PRD-409-R7 — emit the static file set.
  const files = await emitStaticFiles({ outputDir: outputDirAbs, outcome });

  // PRD-400-R18 — capability backing.
  verifyCapabilityBacking(outcome.capabilities, files);

  const report: BuildReport = {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    conformanceTarget: config.conformanceTarget,
    conformanceAchieved: outcome.achieved,
    capabilities: outcome.capabilities,
    files,
    warnings: [...outcome.warnings, ...warnings],
    errors: [],
  };

  await atomicWrite(reportPath, JSON.stringify(report, null, 2));
  logger.info(
    `act build complete — ${files.length} file(s); achieved=${outcome.achieved}; act_version=${ACT_VERSION}`,
  );
  return report;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reportPath: string,
  startedAt: number,
  config: GeneratorConfig,
  warnings: string[],
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const partial: BuildReport = {
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        conformanceTarget: config.conformanceTarget,
        conformanceAchieved: 'core',
        capabilities: {},
        files: [],
        warnings,
        errors: [`PRD-409-R10: build exceeded timeout of ${timeoutMs}ms`],
      };
      atomicWrite(reportPath, JSON.stringify(partial, null, 2)).then(
        () => reject(new BuildTimeoutError(`build timed out after ${timeoutMs}ms`, partial)),
        (err: unknown) => reject(err as Error),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

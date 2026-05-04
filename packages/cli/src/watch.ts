/**
 * PRD-409-R6 — `actree build --watch` semantics.
 *
 * Run an initial build, then subscribe to filesystem change events on the
 * declared paths and rebuild on change with debouncing. Programmatic
 * adapters that expose a `watch(handler: () => void)` capability also
 * trigger rebuilds. CMS adapters that declare `capabilities.watch_polling`
 * are subscribed via `setInterval`.
 *
 * Implementation library notes (ADR-003 spirit):
 *   - We use Node's built-in `fs.watch` to avoid pulling chokidar into
 *     Track B's dependency surface; chokidar is a recommended-not-required
 *     library per the PRD's reference list. `fs.watch` is best-effort on
 *     macOS / Linux but sufficient for the CLI's "fire on any change in
 *     the declared roots" semantics, especially with debouncing.
 *   - Rebuild errors are logged but the watcher keeps running per
 *     PRD-409-R6: "MUST NOT exit on a single rebuild failure".
 *
 * The watcher returns a `{ close }` handle so library callers can dispose
 * deterministically. The CLI's signal handler installs `SIGINT` /
 * `SIGTERM` listeners that call `close` exactly once.
 */
import { watch as fsWatch, type FSWatcher } from 'node:fs';

import type { GeneratorConfig } from '@act-spec/generator-core';

import type { CliLogger } from './logger.js';
import { runBuild, type RunBuildOptions } from './run-build.js';

export interface WatchOptions extends RunBuildOptions {
  /** Extra paths to watch in addition to those declared by markdown adapters. */
  paths?: string[];
  /** Debounce delay for filesystem events (default 200ms per PRD-409-R6). */
  debounceMs?: number;
  /** Caller-supplied AbortSignal — `close` is called when it fires. */
  signal?: AbortSignal;
}

export interface WatchHandle {
  close(): Promise<void>;
}

/** PRD-409-R6 — collect watch paths from `markdown` adapter configs + extras. */
export function collectWatchPaths(
  config: GeneratorConfig,
  extras?: readonly string[],
): string[] {
  const paths = new Set<string>();
  for (const entry of config.adapters) {
    const cfg = entry.config;
    // PRD-201 — markdown adapter declares `sourceDir`.
    const sourceDir = cfg['sourceDir'];
    if (typeof sourceDir === 'string' && sourceDir.length > 0) paths.add(sourceDir);
    // Some PRDs use `roots` (per the spec text). Honor both.
    const roots = cfg['roots'];
    if (Array.isArray(roots)) {
      for (const r of roots) {
        if (typeof r === 'string' && r.length > 0) paths.add(r);
      }
    }
  }
  for (const e of extras ?? []) paths.add(e);
  return [...paths];
}

/**
 * PRD-409-R6 — programmatic watcher API.
 */
export async function watchBuild(
  config: GeneratorConfig,
  opts: WatchOptions = {},
): Promise<WatchHandle> {
  const debounceMs = opts.debounceMs ?? 200;
  const logger = opts.logger ?? noopLogger();

  // Initial build per PRD-409-R6 step 1.
  try {
    await runBuild(config, opts);
  } catch (err) {
    logger.error(`initial build failed: ${(err as Error).message}`);
    // Watcher is still installed; subsequent file changes get a chance.
  }

  const watchedPaths = collectWatchPaths(config, opts.paths);
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let inflight = false;
  let queued = false;

  async function rebuild(): Promise<void> {
    if (closing) return;
    if (inflight) {
      queued = true;
      return;
    }
    inflight = true;
    const start = Date.now();
    try {
      await runBuild(config, opts);
      logger.info(`rebuild done in ${Date.now() - start}ms`);
    } catch (err) {
      logger.error(`rebuild failed: ${(err as Error).message}`);
    } finally {
      inflight = false;
      if (queued && !closing) {
        queued = false;
        await rebuild();
      }
    }
  }

  function onEvent(): void {
    if (closing) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, debounceMs);
  }

  for (const p of watchedPaths) {
    try {
      const w = fsWatch(p, { recursive: true }, () => onEvent());
      w.on('error', (err: Error): void => {
        logger.warn(`watcher error on "${p}": ${err.message}`);
      });
      watchers.push(w);
    } catch (err) {
      logger.warn(`failed to watch "${p}": ${(err as Error).message}`);
    }
  }

  // Programmatic adapter watch hooks.
  for (const entry of config.adapters) {
    const adapter = entry.adapter as unknown as {
      watch?: (handler: () => void) => void | (() => void);
    };
    if (typeof adapter.watch === 'function') {
      try {
        adapter.watch(onEvent);
      } catch (err) {
        logger.warn(`adapter ${entry.adapter.name} watch threw: ${(err as Error).message}`);
      }
    }
  }

  function abortListener(): void {
    void handle.close();
  }
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) {
      // Caller already aborted; close immediately on the next tick.
      queueMicrotask(() => void handle.close());
    } else {
      opts.signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  const handle: WatchHandle = {
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      if (timer !== undefined) clearTimeout(timer);
      // Wait for the in-flight rebuild to settle (best-effort; bounded by node
      // event loop). The PRD allows up to 5s.
      const deadline = Date.now() + 5_000;
      while (inflight && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* best effort */
        }
      }
      if (opts.signal !== undefined) opts.signal.removeEventListener('abort', abortListener);
    },
  };

  return handle;
}

function noopLogger(): CliLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

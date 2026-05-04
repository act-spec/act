/**
 * PRD-409-R9 — logger modes for the CLI.
 *
 * Four mutually-exclusive output modes:
 *   - `silent`     — only errors print (to stderr).
 *   - `text`       — default; one line per event with timestamp + level + message.
 *   - `verbose`    — text mode + debug-level events.
 *   - `json`       — NDJSON: one JSON object per event on stdout.
 *
 * `--silent` combined with `--verbose` is a usage error (caller responsibility);
 * see {@link selectLoggerMode}.
 */
export type LoggerMode = 'silent' | 'text' | 'verbose' | 'json';

export interface CliLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerSink {
  stdout(s: string): void;
  stderr(s: string): void;
}

/**
 * PRD-409-R9 — pick the logger mode from the parsed flag set, returning a
 * usage-error string when the flags are mutually contradictory.
 */
export function selectLoggerMode(flags: {
  silent?: boolean;
  verbose?: boolean;
  json?: boolean;
}): { mode: LoggerMode } | { error: string } {
  const trio = [flags.silent === true, flags.verbose === true, flags.json === true].filter(Boolean).length;
  if (flags.silent === true && flags.verbose === true) {
    return { error: 'PRD-409-R9: --silent and --verbose are mutually exclusive' };
  }
  if (flags.silent === true && flags.json === true) {
    return { error: 'PRD-409-R9: --silent and --json are mutually exclusive' };
  }
  if (flags.verbose === true && flags.json === true) {
    // JSON mode already includes debug events; combining verbose+json
    // would just duplicate the intent. Per the PRD's "MUST NOT mix modes
    // in a single invocation" we reject.
    return { error: 'PRD-409-R9: --verbose and --json are mutually exclusive' };
  }
  if (trio === 0) return { mode: 'text' };
  if (flags.silent === true) return { mode: 'silent' };
  if (flags.json === true) return { mode: 'json' };
  return { mode: 'verbose' };
}

/**
 * PRD-409-R9 — build a logger that writes per the selected mode.
 *
 * `now` is injectable so tests can pin timestamps.
 */
export function createLogger(
  mode: LoggerMode,
  sink: LoggerSink,
  now: () => Date = (): Date => new Date(),
): CliLogger {
  function ts(): string {
    return now().toISOString();
  }
  function emitText(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const line = `${ts()} [${level}] ${message}\n`;
    if (level === 'error' || level === 'warn') sink.stderr(line);
    else sink.stdout(line);
  }
  function emitJson(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const obj = { timestamp: ts(), level, message };
    sink.stdout(`${JSON.stringify(obj)}\n`);
  }

  if (mode === 'silent') {
    return {
      debug(): void {
        /* noop */
      },
      info(): void {
        /* noop */
      },
      warn(): void {
        /* noop */
      },
      error(message: string): void {
        sink.stderr(`${ts()} [error] ${message}\n`);
      },
    };
  }
  if (mode === 'json') {
    return {
      debug(message: string): void {
        emitJson('debug', message);
      },
      info(message: string): void {
        emitJson('info', message);
      },
      warn(message: string): void {
        emitJson('warn', message);
      },
      error(message: string): void {
        emitJson('error', message);
      },
    };
  }
  if (mode === 'verbose') {
    return {
      debug(message: string): void {
        emitText('debug', message);
      },
      info(message: string): void {
        emitText('info', message);
      },
      warn(message: string): void {
        emitText('warn', message);
      },
      error(message: string): void {
        emitText('error', message);
      },
    };
  }
  // text (default) — drop debug.
  return {
    debug(): void {
      /* dropped at text level */
    },
    info(message: string): void {
      emitText('info', message);
    },
    warn(message: string): void {
      emitText('warn', message);
    },
    error(message: string): void {
      emitText('error', message);
    },
  };
}

import { describe, expect, it } from 'vitest';

import { createLogger, selectLoggerMode } from './logger.js';

function makeSink(): { stdout: string[]; stderr: string[]; sink: { stdout: (s: string) => void; stderr: (s: string) => void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    sink: {
      stdout: (s: string): void => {
        stdout.push(s);
      },
      stderr: (s: string): void => {
        stderr.push(s);
      },
    },
  };
}

const T = (): Date => new Date('2026-05-02T12:00:00Z');

describe('PRD-409-R9 selectLoggerMode', () => {
  it('PRD-409-R9: default (no flags) is text mode', () => {
    expect(selectLoggerMode({})).toEqual({ mode: 'text' });
  });

  it('PRD-409-R9: --silent and --verbose together is a usage error', () => {
    const r = selectLoggerMode({ silent: true, verbose: true });
    expect('error' in r).toBe(true);
  });

  it('PRD-409-R9: --silent and --json together is a usage error', () => {
    const r = selectLoggerMode({ silent: true, json: true });
    expect('error' in r).toBe(true);
  });

  it('PRD-409-R9: --verbose and --json together is a usage error', () => {
    const r = selectLoggerMode({ verbose: true, json: true });
    expect('error' in r).toBe(true);
  });

  it('PRD-409-R9: --silent alone selects silent mode', () => {
    expect(selectLoggerMode({ silent: true })).toEqual({ mode: 'silent' });
  });

  it('PRD-409-R9: --verbose alone selects verbose mode', () => {
    expect(selectLoggerMode({ verbose: true })).toEqual({ mode: 'verbose' });
  });

  it('PRD-409-R9: --json alone selects json mode', () => {
    expect(selectLoggerMode({ json: true })).toEqual({ mode: 'json' });
  });
});

describe('PRD-409-R9 createLogger', () => {
  it('PRD-409-R9 silent mode: only errors print, to stderr', () => {
    const { stdout, stderr, sink } = makeSink();
    const log = createLogger('silent', sink, T);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('boom');
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('boom');
  });

  it('PRD-409-R9 text mode: drops debug; info → stdout; warn/error → stderr', () => {
    const { stdout, stderr, sink } = makeSink();
    const log = createLogger('text', sink, T);
    log.debug('hidden');
    log.info('hello');
    log.warn('warn');
    log.error('err');
    expect(stdout.join('')).toContain('hello');
    expect(stdout.join('')).not.toContain('hidden');
    expect(stderr.join('')).toContain('warn');
    expect(stderr.join('')).toContain('err');
  });

  it('PRD-409-R9 verbose mode: emits debug events too', () => {
    const { stdout, sink } = makeSink();
    const log = createLogger('verbose', sink, T);
    log.debug('debug-line');
    expect(stdout.join('')).toContain('debug-line');
  });

  it('PRD-409-R9 json mode: emits NDJSON with timestamp/level/message', () => {
    const { stdout, sink } = makeSink();
    const log = createLogger('json', sink, T);
    log.info('hello');
    log.error('boom');
    const lines = stdout.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const a = JSON.parse(lines[0]!) as { timestamp: string; level: string; message: string };
    expect(a.timestamp).toBe('2026-05-02T12:00:00.000Z');
    expect(a.level).toBe('info');
    expect(a.message).toBe('hello');
    const b = JSON.parse(lines[1]!) as { level: string };
    expect(b.level).toBe('error');
  });
});

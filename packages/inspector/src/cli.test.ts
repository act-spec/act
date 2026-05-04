import { describe, expect, it } from 'vitest';
import { runCli, parseCliArgs } from './cli.js';
import { makeFetcher, makeStandardSite, makeCoreSite, makeStrictSite } from './_fixtures.js';
import type { CliSink } from './cli.js';
import { type ManifestSchema } from '@act-spec/core';

type Manifest = ManifestSchema.Manifest;

function newSink(): CliSink & { out: string; err: string } {
  let out = '';
  let err = '';
  return {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe('parseCliArgs (PRD-601-R16)', () => {
  it('rejects --json + --tsv as mutually exclusive (exit 2)', () => {
    const r = parseCliArgs(['--json', '--tsv'], {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mutually exclusive/);
  });

  it('returns parsed values for a valid argv', () => {
    const r = parseCliArgs(['--json', 'http://example.invalid'], {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values['json']).toBe(true);
      expect(r.positionals).toEqual(['http://example.invalid']);
    }
  });

  it('rejects unknown flags', () => {
    const r = parseCliArgs(['--bogus'], {});
    expect(r.ok).toBe(false);
  });
});

describe('runCli — top-level (PRD-601-R4 / R16)', () => {
  it('prints help on no argv (exit 0)', async () => {
    const s = newSink();
    const code = await runCli([], s);
    expect(code).toBe(0);
    expect(s.out).toMatch(/USAGE/);
  });

  it('prints help on --help (exit 0)', async () => {
    const s = newSink();
    const code = await runCli(['--help'], s);
    expect(code).toBe(0);
  });

  it('prints version on --version (exit 0)', async () => {
    const s = newSink();
    const code = await runCli(['--version'], s);
    expect(code).toBe(0);
    expect(s.out).toMatch(/act_version/);
  });

  it('exits 2 on an unknown subcommand', async () => {
    const s = newSink();
    const code = await runCli(['fizzbuzz'], s);
    expect(code).toBe(2);
    expect(s.err).toMatch(/unknown subcommand/);
  });
});

describe('runCli fetch (PRD-601-R5)', () => {
  it('exits 0 and prints the manifest on success', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['fetch', site.origin, '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/act_version/);
  });

  it('exits 4 on act_version MAJOR mismatch (PRD-601-R3 / R22)', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'major-mismatch' };
    const s = newSink();
    const code = await runCli(['fetch', site.origin], s, { fetch: makeFetcher(site) });
    expect(code).toBe(4);
  });

  it('exits 1 on auth-required (no headers supplied; PRD-601-R6)', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'auth-required' };
    const s = newSink();
    const code = await runCli(['fetch', site.origin], s, { fetch: makeFetcher(site) });
    expect(code).toBe(1);
  });

  it('with id, fetches a single node envelope (PRD-100-R21)', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['fetch', site.origin, 'intro', '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/"id"/);
  });

  it('with id + --subtree, fetches a subtree envelope (PRD-601-R11)', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['fetch', site.origin, 'intro', '--subtree', '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/"root"/);
  });

  it('exits 3 when --subtree is requested against a Core producer (PRD-601-R11 / R22)', async () => {
    const site = makeCoreSite();
    const s = newSink();
    const code = await runCli(['fetch', site.origin, 'intro', '--subtree'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(3);
  });

  it('exits 2 on missing url positional', async () => {
    const s = newSink();
    const code = await runCli(['fetch'], s);
    expect(code).toBe(2);
  });

  it('TSV output is accepted', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['fetch', site.origin, '--tsv'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/^field\tvalue/);
  });

  it('parses --header flags into a headers map (PRD-601-R18)', async () => {
    const site = makeStandardSite();
    let seen: string | null = null;
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      seen = init?.headers ? new Headers(init.headers).get('x-test') : null;
      return makeFetcher(site)(input, init);
    };
    const s = newSink();
    await runCli(['fetch', site.origin, '--header', 'X-Test: hello'], s, { fetch: fetcher });
    expect(seen).toBe('hello');
  });
});

describe('runCli walk (PRD-601-R7)', () => {
  it('exits 0 on a clean walk', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['walk', site.origin, '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/tree_summary/);
  });

  it('exits 3 on --use-ndjson against a Standard producer (PRD-601-R19 / R22)', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['walk', site.origin, '--use-ndjson'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(3);
  });

  it('exits 0 with --use-ndjson against a Plus producer', async () => {
    const site = makeStrictSite();
    const s = newSink();
    const code = await runCli(['walk', site.origin, '--use-ndjson', '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
  });

  it('honors --sample N', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['walk', site.origin, '--sample', '1', '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
  });

  it('exits 2 on missing url positional', async () => {
    const s = newSink();
    const code = await runCli(['walk'], s);
    expect(code).toBe(2);
  });

  it('TSV output is accepted', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['walk', site.origin, '--tsv'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/^id\ttype/);
  });

  it('rejects bad --sample as exit 2', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['walk', site.origin, '--sample', 'x'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(2);
  });
});

describe('runCli diff (PRD-601-R10 / R22)', () => {
  it('exits 0 when the two trees are identical', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['diff', site.origin, site.origin, '--json'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
  });

  it('exits 1 when there are differences', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    b.nodes = b.nodes.filter((n) => n.id !== 'intro');
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
      return makeFetcher(b)(input, init);
    };
    const s = newSink();
    const code = await runCli(['diff', a.origin, b.origin, '--json'], s, { fetch: fetcher });
    expect(code).toBe(1);
  });

  it('exits 0 with --no-fail-on-diff even when differences exist', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    b.nodes = b.nodes.filter((n) => n.id !== 'intro');
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
      return makeFetcher(b)(input, init);
    };
    const s = newSink();
    const code = await runCli(['diff', a.origin, b.origin, '--no-fail-on-diff'], s, { fetch: fetcher });
    expect(code).toBe(0);
  });

  it('exits 2 on missing url positional', async () => {
    const s = newSink();
    const code = await runCli(['diff', 'only-one-url'], s);
    expect(code).toBe(2);
  });

  it('--tsv emits the documented header', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['diff', site.origin, site.origin, '--tsv'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(0);
    expect(s.out).toMatch(/^id\tclassification/);
  });
});

describe('runCli token-budget (PRD-601-R12 / R22)', () => {
  it('exits 0 on a successful budget run', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['token-budget', site.origin, '--max-tokens', '1000', '--json'], s, {
      fetch: makeFetcher(site),
    });
    expect(code).toBe(0);
    expect(s.out).toMatch(/inclusion_order/);
  });

  it('exits 2 when --max-tokens is missing', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['token-budget', site.origin], s, { fetch: makeFetcher(site) });
    expect(code).toBe(2);
  });

  it('exits 2 on a non-integer --max-tokens', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['token-budget', site.origin, '--max-tokens', 'lots'], s, { fetch: makeFetcher(site) });
    expect(code).toBe(2);
  });

  it('rejects an unknown --strategy as exit 2', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['token-budget', site.origin, '--max-tokens', '100', '--strategy', 'random'], s, {
      fetch: makeFetcher(site),
    });
    expect(code).toBe(2);
  });

  it('honors --start-id', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(
      ['token-budget', site.origin, '--max-tokens', '1000', '--start-id', 'getting-started', '--json'],
      s,
      { fetch: makeFetcher(site) },
    );
    expect(code).toBe(0);
    expect(s.out).toMatch(/"start_id":\s*"getting-started"/);
  });

  it('--tsv emits the documented header', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['token-budget', site.origin, '--max-tokens', '1000', '--tsv'], s, {
      fetch: makeFetcher(site),
    });
    expect(code).toBe(0);
    expect(s.out).toMatch(/^order\tid\ttokens/);
  });

  it('accepts the alias subcommand "budget"', async () => {
    const site = makeStandardSite();
    const s = newSink();
    const code = await runCli(['budget', site.origin, '--max-tokens', '1000', '--json'], s, {
      fetch: makeFetcher(site),
    });
    expect(code).toBe(0);
  });

  it('exits 2 on missing url positional', async () => {
    const s = newSink();
    const code = await runCli(['token-budget', '--max-tokens', '100'], s);
    expect(code).toBe(2);
  });
});

describe('runCli — exit code surface (PRD-601-R22)', () => {
  it('exit 0 = success', async () => {
    const site = makeStandardSite();
    const s = newSink();
    expect(await runCli(['walk', site.origin, '--json'], s, { fetch: makeFetcher(site) })).toBe(0);
  });
  it('exit 1 = success with findings', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'auth-required' };
    const s = newSink();
    expect(await runCli(['walk', site.origin], s, { fetch: makeFetcher(site) })).toBe(1);
  });
  it('exit 2 = invocation error', async () => {
    const s = newSink();
    expect(await runCli(['walk'], s)).toBe(2);
  });
  it('exit 3 = level mismatch', async () => {
    const site = makeCoreSite();
    const s = newSink();
    expect(await runCli(['fetch', site.origin, 'intro', '--subtree'], s, { fetch: makeFetcher(site) })).toBe(3);
  });
  it('exit 4 = act_version MAJOR mismatch', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'major-mismatch' };
    const s = newSink();
    expect(await runCli(['walk', site.origin], s, { fetch: makeFetcher(site) })).toBe(4);
  });
});

describe('runCli — credential bytes never echoed (PRD-601-R18)', () => {
  it('does not include the Authorization header value in stdout/stderr', async () => {
    const site = makeStandardSite();
    site.manifest = { ...site.manifest, auth: { schemes: ['bearer'] } } as Manifest;
    const s = newSink();
    const code = await runCli(
      ['fetch', site.origin, '--header', 'Authorization: Bearer SUPERSECRETTOKEN', '--json'],
      s,
      { fetch: makeFetcher(site) },
    );
    expect(code).toBe(0);
    expect(s.out).not.toMatch(/SUPERSECRETTOKEN/);
    expect(s.err).not.toMatch(/SUPERSECRETTOKEN/);
  });
});

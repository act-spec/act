/**
 * Tests for `actree flatten <url>` (§5.2.6 / §6.40).
 *
 * Each test injects a fixture-driven fetch via the FlattenOptions hook so
 * we never touch the network. The fixture site has:
 *   - manifest at /.well-known/act.json (advertises index_url + node_url_template)
 *   - index at /act/index.json (3 leaves: intro, install, recipe)
 *   - 3 node envelopes at /act/nodes/<id>.json
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flattenSite, formatLlmsFull, runFlatten } from './flatten.js';

const ORIGIN = 'https://example.org';

interface Fixture {
  manifest?: unknown;
  manifestStatus?: number;
  manifestText?: string;
  index?: unknown;
  nodes: Record<string, unknown>;
}

function makeFetch(fx: Fixture): typeof globalThis.fetch {
  const manifest = fx.manifest ?? {
    act_version: '0.1',
    delivery: 'static',
    site: { name: 'Example Docs', description: 'A sample site' },
    defaultLocale: 'en',
    index_url: '/act/index.json',
    node_url_template: '/act/nodes/{id}.json',
  };
  const index = fx.index ?? {
    nodes: [
      { id: 'intro', type: 'doc', parent: null, locale: 'en' },
      { id: 'install', type: 'doc', parent: 'intro', locale: 'en' },
      { id: 'recipe', type: 'doc', parent: 'intro', locale: 'en' },
    ],
  };

  return async (input: RequestInfo | URL): Promise<Response> => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.endsWith('/.well-known/act.json')) {
      if (fx.manifestStatus !== undefined) {
        return new Response(fx.manifestText ?? 'not found', {
          status: fx.manifestStatus,
        });
      }
      if (fx.manifestText !== undefined) {
        return new Response(fx.manifestText, { status: 200 });
      }
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.endsWith('/act/index.json')) {
      return new Response(JSON.stringify(index), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const m = u.match(/\/act\/nodes\/(.+?)\.json$/);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      const body = fx.nodes[id];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };
}

const FIXTURE: Fixture = {
  nodes: {
    intro: {
      act_version: '0.1',
      id: 'intro',
      type: 'doc',
      title: 'Introduction',
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      summary: 'A short summary of the intro page.',
      content: [{ type: 'markdown', text: 'Welcome to the Example Docs.' }],
      tokens: { summary: 5, body: 5 },
    },
    install: {
      act_version: '0.1',
      id: 'install',
      type: 'doc',
      title: 'Install',
      etag: 's256:BBBBBBBBBBBBBBBBBBBBBB',
      summary: 'How to install.',
      content: [{ type: 'markdown', text: 'Run `npm install example`.' }],
      tokens: { summary: 3, body: 4 },
    },
    recipe: {
      act_version: '0.1',
      id: 'recipe',
      type: 'doc',
      title: 'Recipe',
      etag: 's256:CCCCCCCCCCCCCCCCCCCCCC',
      summary: 'A recipe.',
      content: [{ type: 'markdown', text: 'Step 1. Step 2. Step 3.' }],
      tokens: { summary: 2, body: 6 },
    },
  },
};

function makeSink(): {
  stdout: string[];
  stderr: string[];
  sink: { stdout: (s: string) => void; stderr: (s: string) => void };
} {
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

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-flatten-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('flattenSite (programmatic)', () => {
  it('renders site header + per-leaf sections with frontmatter and content', async () => {
    const out = await flattenSite(ORIGIN, { fetch: makeFetch(FIXTURE) });
    expect(out).toContain('# Example Docs');
    expect(out).toContain('> A sample site');
    expect(out).toContain('_locale: en_');
    // Each leaf renders frontmatter:
    expect(out).toContain('id: intro');
    expect(out).toContain('id: install');
    expect(out).toContain('id: recipe');
    // Titles + summaries + content text:
    expect(out).toContain('# Introduction');
    expect(out).toContain('A short summary of the intro page.');
    expect(out).toContain('Welcome to the Example Docs.');
    expect(out).toContain('# Install');
    expect(out).toContain('Run `npm install example`.');
    // Section separators:
    expect(out.split('\n---\n').length).toBeGreaterThanOrEqual(3);
  });

  it('locale fallback: requested locale missing → falls back to defaultLocale', async () => {
    const out = await flattenSite(ORIGIN, {
      fetch: makeFetch(FIXTURE),
      locale: 'fr',
    });
    // Render proceeds with default-locale entries (no `fr` entries exist).
    expect(out).toContain('_locale: fr_');
    expect(out).toContain('# Introduction');
  });

  it('throws a friendly error when the manifest endpoint 404s', async () => {
    const fetch = makeFetch({ ...FIXTURE, manifestStatus: 404 });
    await expect(flattenSite(ORIGIN, { fetch })).rejects.toThrow(/HTTP 404/);
  });

  it('throws when the manifest is not JSON', async () => {
    const fetch = makeFetch({ ...FIXTURE, manifestText: 'not json' });
    await expect(flattenSite(ORIGIN, { fetch })).rejects.toThrow(/not JSON/);
  });

  it('throws when the manifest declares an unsupported act_version', async () => {
    const fetch = makeFetch({ ...FIXTURE, manifest: { act_version: '99.0' } });
    await expect(flattenSite(ORIGIN, { fetch })).rejects.toThrow(/act_version/);
  });

  it('skips nodes that 404 rather than failing the whole render', async () => {
    const fx: Fixture = { nodes: { intro: FIXTURE.nodes['intro'] } };
    const out = await flattenSite(ORIGIN, { fetch: makeFetch(fx) });
    expect(out).toContain('# Introduction');
    expect(out).not.toContain('# Install');
  });
});

describe('formatLlmsFull --max-bytes', () => {
  it('truncates output and appends a marker when over budget', () => {
    const leaves = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      type: 'doc',
      title: `Node ${i}`,
      summary: 'summary '.repeat(50),
      content: [{ type: 'markdown', text: 'body '.repeat(100) }],
    }));
    const out = formatLlmsFull({
      site: { name: 'Big Site' },
      locale: 'en',
      leaves,
      maxBytes: 1_000,
    });
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(1_000);
    expect(out).toContain('truncated by actree flatten --max-bytes');
  });

  it('does not truncate when content fits in the budget', () => {
    const out = formatLlmsFull({
      site: { name: 'Tiny' },
      locale: 'en',
      leaves: [{ id: 'a', type: 'doc', title: 'A' }],
      maxBytes: 10_000,
    });
    expect(out).not.toContain('truncated');
  });
});

describe('runFlatten (argv-driven)', () => {
  it('writes to stdout by default', async () => {
    const { stdout, sink } = makeSink();
    const code = await runFlatten([ORIGIN], sink, {
      cwd: tmp,
      fetch: makeFetch(FIXTURE),
    });
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('# Example Docs');
  });

  it('--out writes to file and reports the size on stderr', async () => {
    const { stderr, sink, stdout } = makeSink();
    const outPath = path.join(tmp, 'dump.txt');
    const code = await runFlatten([ORIGIN, '--out', outPath], sink, {
      cwd: tmp,
      fetch: makeFetch(FIXTURE),
    });
    expect(code).toBe(0);
    // No stdout when --out is set:
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('wrote');
    const written = await fs.readFile(outPath, 'utf8');
    expect(written).toContain('# Example Docs');
  });

  it('exit 2 when <url> is missing', async () => {
    const { stderr, sink } = makeSink();
    const code = await runFlatten([], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('missing required <url>');
  });

  it('exit 2 when --max-bytes is not a positive integer', async () => {
    const { stderr, sink } = makeSink();
    const code = await runFlatten([ORIGIN, '--max-bytes', 'foo'], sink, {
      cwd: tmp,
      fetch: makeFetch(FIXTURE),
    });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('--max-bytes');
  });

  it('exit 2 on extra positional', async () => {
    const { stderr, sink } = makeSink();
    const code = await runFlatten([ORIGIN, 'extra'], sink, {
      cwd: tmp,
      fetch: makeFetch(FIXTURE),
    });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('extra positional');
  });

  it('exit 1 when manifest is invalid', async () => {
    const { stderr, sink } = makeSink();
    const code = await runFlatten([ORIGIN], sink, {
      cwd: tmp,
      fetch: makeFetch({ ...FIXTURE, manifestStatus: 404 }),
    });
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('actree flatten:');
    expect(stderr.join('')).toContain('HTTP 404');
  });

  it('exit 0 with --help', async () => {
    const { stdout, sink } = makeSink();
    const code = await runFlatten(['--help'], sink, { cwd: tmp });
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('actree flatten');
    expect(stdout.join('')).toContain('--max-bytes');
  });

  it('rejects unknown flag with exit 2', async () => {
    const { stderr, sink } = makeSink();
    const code = await runFlatten([ORIGIN, '--bogus'], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('actree flatten:');
  });
});

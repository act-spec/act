/**
 * `readStaticSource` tests — PRD-602-R24 / PRD-706-R13.
 *
 * The reader is the same walker entry point `@act-spec/validator`'s
 * `walkStatic` uses (drift prevention). Three paths:
 *   - Pre-loaded `envelopes` (build-time / test scaffolding).
 *   - `rootDir` filesystem read.
 *   - HTTP fetch of `manifestUrl` + chained envelopes.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeStaticEnvelopes } from './_fixtures.js';
import { readStaticSource } from './static-source.js';

describe('readStaticSource: pre-loaded envelopes path', () => {
  it('returns envelopes verbatim when supplied', async () => {
    const env = makeStaticEnvelopes();
    const result = await readStaticSource({
      kind: 'static',
      manifestUrl: 'https://unused/.well-known/act.json',
      envelopes: env,
    });
    expect(result.manifest).toEqual(env.manifest);
    expect(result.index.nodes).toHaveLength(env.index.nodes.length);
    expect(result.nodes).toHaveLength(env.nodes.length);
  });
});

describe('readStaticSource: filesystem (rootDir) path', () => {
  it('reads manifest, index, and node files from rootDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-bridge-static-'));
    try {
      const env = makeStaticEnvelopes();
      // Manifest at /.well-known/act.json
      await mkdir(join(dir, '.well-known'), { recursive: true });
      await writeFile(join(dir, '.well-known', 'act.json'), JSON.stringify(env.manifest));
      // Index at /act/index.json
      await mkdir(join(dir, 'act'), { recursive: true });
      await writeFile(join(dir, 'act', 'index.json'), JSON.stringify(env.index));
      // Nodes at /act/n/{id}
      await mkdir(join(dir, 'act', 'n'), { recursive: true });
      for (const n of env.nodes) {
        const nodePath = join(dir, 'act', 'n', n.id.replace(/\//g, '__'));
        // node_url_template is /act/n/{id}; we write the literal id with slashes
        // intact, requiring nested dirs:
        const nodeDir = join(dir, 'act', 'n', ...n.id.split('/').slice(0, -1));
        await mkdir(nodeDir, { recursive: true });
        await writeFile(join(dir, 'act', 'n', n.id), JSON.stringify(n));
        // Suppress lint (unused).
        void nodePath;
      }
      const result = await readStaticSource({
        kind: 'static',
        manifestUrl: '/.well-known/act.json',
        rootDir: dir,
      });
      expect(result.manifest.act_version).toBe('0.1');
      expect(result.index.nodes.length).toBe(env.index.nodes.length);
      expect(result.nodes.length).toBe(env.nodes.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('readStaticSource: HTTP path (synthetic fetcher)', () => {
  it('chains manifest → index → nodes through the supplied fetcher', async () => {
    const env = makeStaticEnvelopes();
    const fetcher: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/.well-known/act.json')) {
        return new Response(JSON.stringify(env.manifest), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/act/index.json')) {
        return new Response(JSON.stringify(env.index), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const m = /\/act\/n\/(.+)$/.exec(url);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        const node = env.nodes.find((n) => n.id === id);
        if (node) {
          return new Response(JSON.stringify(node), {
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response('not found', { status: 404 });
    };

    const result = await readStaticSource(
      { kind: 'static', manifestUrl: 'https://m.example.com/.well-known/act.json' },
      fetcher,
    );
    expect(result.manifest.act_version).toBe('0.1');
    expect(result.index.nodes.length).toBe(env.index.nodes.length);
    expect(result.nodes.length).toBe(env.nodes.length);
  });

  it('throws when the manifest URL is unreachable', async () => {
    const fetcher: typeof globalThis.fetch = async () =>
      new Response('not found', { status: 404 });
    await expect(
      readStaticSource(
        { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
        fetcher,
      ),
    ).rejects.toThrowError(/static source manifest unreachable/);
  });
});

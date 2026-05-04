import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GeneratorConfig } from '@act-spec/generator-core';
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';

import { collectWatchPaths, watchBuild } from './watch.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-watch-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function programmaticConfig(outDir: string, items: Array<{ id: string; title: string }>): GeneratorConfig {
  const adapter = defineProgrammaticAdapter({
    name: 'demo',
    enumerate: () => items,
    transform: (item) => ({
      act_version: '0.1',
      id: item.id,
      type: 'page',
      title: item.title,
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      summary: 'sum',
      content: [{ type: 'markdown', text: 'b' }],
      tokens: { summary: 1, body: 1 },
    }),
    capabilities: { level: 'core' },
  });
  return {
    conformanceTarget: 'core',
    outputDir: outDir,
    adapters: [{ adapter, config: {}, actVersion: '0.1' }],
    site: { name: 'Test' },
  };
}

describe('PRD-409-R6 collectWatchPaths', () => {
  it('PRD-409-R6: collects sourceDir from each markdown adapter config', () => {
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: 'dist',
      adapters: [
        { adapter: { name: 'a' } as never, config: { sourceDir: '/a/content' }, actVersion: '0.1' },
        { adapter: { name: 'b' } as never, config: { sourceDir: '/b/content' }, actVersion: '0.1' },
      ],
      site: { name: 't' },
    };
    expect(collectWatchPaths(cfg).sort()).toEqual(['/a/content', '/b/content']);
  });

  it('PRD-409-R6: also picks up `roots` arrays declared by the spec text', () => {
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: 'dist',
      adapters: [
        { adapter: { name: 'a' } as never, config: { roots: ['/a', '/b'] }, actVersion: '0.1' },
      ],
      site: { name: 't' },
    };
    expect(collectWatchPaths(cfg).sort()).toEqual(['/a', '/b']);
  });

  it('PRD-409-R6: appends caller-supplied extras', () => {
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: 'dist',
      adapters: [],
      site: { name: 't' },
    };
    expect(collectWatchPaths(cfg, ['/extra']).sort()).toEqual(['/extra']);
  });
});

describe('PRD-409-R6 watchBuild', () => {
  it('PRD-409-R6: runs an initial build and returns a closeable handle', async () => {
    const out = path.join(tmp, 'dist');
    const handle = await watchBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      paths: [tmp],
    });
    try {
      const stat = await fs.stat(path.join(out, '.well-known', 'act.json'));
      expect(stat.isFile()).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('PRD-409-R6: closes cleanly when the AbortSignal fires', async () => {
    const out = path.join(tmp, 'dist');
    const ac = new AbortController();
    const handle = await watchBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      paths: [tmp],
      signal: ac.signal,
    });
    ac.abort();
    // close() is idempotent and tolerates the abort path.
    await handle.close();
  });

  it('PRD-409-R6: tolerates an already-aborted signal at construction time', async () => {
    const out = path.join(tmp, 'dist');
    const ac = new AbortController();
    ac.abort();
    const handle = await watchBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      paths: [tmp],
      signal: ac.signal,
    });
    await handle.close();
  });

  it('PRD-409-R6: tolerates a failed initial build (logs and continues to install watcher)', async () => {
    const out = path.join(tmp, 'dist');
    // Adapter that throws → initial build fails. Watcher should still install.
    const adapter = defineProgrammaticAdapter({
      name: 'broken',
      enumerate: () => [{ id: 'home', title: 'x' }],
      // intentionally invalid (missing required fields) → ProgrammaticAdapterError
      transform: (item) => ({ id: item.id }) as never,
      capabilities: { level: 'core' },
      strict: true,
    });
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: out,
      adapters: [{ adapter, config: {}, actVersion: '0.1' }],
      site: { name: 'Test' },
    };
    const handle = await watchBuild(cfg, { cwd: tmp });
    await handle.close();
  });

  it('PRD-409-R6: warns when a watched path does not exist', async () => {
    const out = path.join(tmp, 'dist');
    const handle = await watchBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      paths: [path.join(tmp, 'does-not-exist')],
    });
    await handle.close();
  });

  it('PRD-409-R6: close() is idempotent', async () => {
    const out = path.join(tmp, 'dist');
    const handle = await watchBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      paths: [tmp],
    });
    await handle.close();
    await handle.close();
  });

  it('PRD-409-R6: tolerates an adapter.watch hook that throws', async () => {
    const out = path.join(tmp, 'dist');
    const adapter = defineProgrammaticAdapter({
      name: 'throwy',
      enumerate: () => [{ id: 'home', title: 'Home' }],
      transform: (item) => ({
        act_version: '0.1',
        id: item.id,
        type: 'page',
        title: item.title,
        etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
        summary: 'sum',
        content: [{ type: 'markdown', text: 'b' }],
        tokens: { summary: 1, body: 1 },
      }),
      capabilities: { level: 'core' },
    }) as unknown as { watch?: (h: () => void) => void };
    adapter.watch = (): void => {
      throw new Error('boom');
    };
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: out,
      adapters: [{ adapter: adapter as never, config: {}, actVersion: '0.1' }],
      site: { name: 'Test' },
    };
    const handle = await watchBuild(cfg, { cwd: tmp });
    await handle.close();
  });

  it('PRD-409-R6: rebuilds on filesystem change in a watched path', async () => {
    const out = path.join(tmp, 'dist');
    const watched = path.join(tmp, 'content');
    await fs.mkdir(watched, { recursive: true });
    await fs.writeFile(path.join(watched, 'a.md'), 'hello', 'utf8');
    let rebuildCount = 0;
    const logger = {
      debug: (): void => undefined,
      info: (msg: string): void => {
        if (msg.includes('rebuild done')) rebuildCount += 1;
      },
      warn: (): void => undefined,
      error: (): void => undefined,
    };
    const handle = await watchBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      paths: [watched],
      debounceMs: 30,
      logger,
    });
    try {
      // Trigger a change.
      await fs.writeFile(path.join(watched, 'b.md'), 'world', 'utf8');
      // Wait long enough for debounce + rebuild to complete.
      await new Promise((r) => setTimeout(r, 400));
      expect(rebuildCount).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.close();
    }
  });

  it('PRD-409-R6: subscribes to programmatic-adapter watch hooks when present', async () => {
    const out = path.join(tmp, 'dist');
    let registered: (() => void) | null = null;
    const adapter = defineProgrammaticAdapter({
      name: 'with-watch',
      enumerate: () => [{ id: 'home', title: 'Home' }],
      transform: (item) => ({
        act_version: '0.1',
        id: item.id,
        type: 'page',
        title: item.title,
        etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
        summary: 'sum',
        content: [{ type: 'markdown', text: 'b' }],
        tokens: { summary: 1, body: 1 },
      }),
      capabilities: { level: 'core' },
    }) as unknown as { watch?: (h: () => void) => void };
    adapter.watch = (h: () => void): void => {
      registered = h;
    };
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: out,
      adapters: [{ adapter: adapter as never, config: {}, actVersion: '0.1' }],
      site: { name: 'Test' },
    };
    const handle = await watchBuild(cfg, { cwd: tmp });
    try {
      expect(typeof registered).toBe('function');
    } finally {
      await handle.close();
    }
  });
});

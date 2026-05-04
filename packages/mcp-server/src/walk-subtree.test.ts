import { describe, expect, it } from 'vitest';

import { ServerCache } from './cache.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';
import { actWalkSubtree } from './tools/walk-subtree.js';

describe('actWalkSubtree', () => {
  it('walks descendants of a subtree root up to the requested depth', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actWalkSubtree(site.origin, 'guides', 3, {
      fetch: makeFetcher(site),
      cache,
    });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('guides');
    expect(ids).toContain('guides/install');
    // `intro` is a sibling of `guides`, not a descendant — it must not appear.
    expect(ids).not.toContain('intro');
  });

  it('clamps an out-of-range depth into [0, 8]', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actWalkSubtree(site.origin, 'root', 999, {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.depth).toBe(8);
  });

  it('with depth=0 returns just the root', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actWalkSubtree(site.origin, 'guides', 0, {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.nodes.map((n) => n.id)).toEqual(['guides']);
  });

  it('returns no nodes when the manifest cannot be loaded', async () => {
    const cache = new ServerCache();
    const fetcher: typeof globalThis.fetch = async () =>
      new Response('not found', { status: 404 });
    const result = await actWalkSubtree('http://example.invalid', 'root', 3, {
      fetch: fetcher,
      cache,
    });
    expect(result.nodes).toEqual([]);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

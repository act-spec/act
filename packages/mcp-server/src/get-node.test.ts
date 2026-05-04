import { describe, expect, it } from 'vitest';

import { ServerCache } from './cache.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';
import { actGetNode } from './tools/get-node.js';

describe('actGetNode', () => {
  it('returns a single node envelope by id', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actGetNode(site.origin, 'intro', {
      fetch: makeFetcher(site),
      cache,
    });
    expect((result.node as { id: string }).id).toBe('intro');
    expect((result.node as { title: string }).title).toBe('Introduction to Acme');
  });

  it('caches the node so a second call does not refetch', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    let fetchCount = 0;
    const real = makeFetcher(site);
    const counting: typeof globalThis.fetch = async (input, init) => {
      fetchCount += 1;
      return real(input, init);
    };
    await actGetNode(site.origin, 'intro', { fetch: counting, cache });
    const after1 = fetchCount;
    await actGetNode(site.origin, 'intro', { fetch: counting, cache });
    // Second call should not have fetched the node URL again.
    expect(fetchCount).toBe(after1);
  });

  it('records a finding (and null node) when the node is missing', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actGetNode(site.origin, 'does-not-exist', {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.node).toBeNull();
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

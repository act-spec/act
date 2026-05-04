import { describe, expect, it } from 'vitest';

import { ServerCache } from './cache.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';
import { actLoadSite } from './tools/load-site.js';

describe('actLoadSite', () => {
  it('returns the parsed manifest for a well-formed site', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actLoadSite(site.origin, {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.manifest).toMatchObject({
      act_version: '0.1',
      conformance: { level: 'standard' },
      root_id: 'root',
    });
    expect(result.url.endsWith('/.well-known/act.json')).toBe(true);
  });

  it('caches the manifest so a second call does not refetch', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    let fetchCount = 0;
    const real = makeFetcher(site);
    const counting: typeof globalThis.fetch = async (input, init) => {
      fetchCount += 1;
      return real(input, init);
    };
    await actLoadSite(site.origin, { fetch: counting, cache });
    const before = fetchCount;
    await actLoadSite(site.origin, { fetch: counting, cache });
    expect(fetchCount).toBe(before);
  });

  it('returns findings (and null manifest) when the well-known is unreachable', async () => {
    const cache = new ServerCache();
    const fetcher: typeof globalThis.fetch = async () =>
      new Response('not found', { status: 404 });
    const result = await actLoadSite('http://example.invalid', { fetch: fetcher, cache });
    expect(result.manifest).toBeNull();
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

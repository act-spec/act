import { describe, expect, it } from 'vitest';

import { ServerCache } from './cache.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';
import { actSearch } from './tools/search.js';

describe('actSearch', () => {
  it('finds matches in title (and reports the matched_in dimension)', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actSearch(site.origin, 'Introduction', {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.hits.length).toBeGreaterThan(0);
    const intro = result.hits.find((h) => h.id === 'intro');
    expect(intro?.matched_in).toBe('title');
  });

  it('falls back to body matches and emits an excerpt', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actSearch(site.origin, 'widget', {
      fetch: makeFetcher(site),
      cache,
    });
    const intro = result.hits.find((h) => h.id === 'intro');
    expect(intro?.matched_in).toBe('body');
    expect(intro?.excerpt).toContain('widget');
  });

  it('returns an empty hits array for an empty query', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actSearch(site.origin, '   ', {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.hits).toEqual([]);
  });

  it('returns no hits and findings when the manifest is unreachable', async () => {
    const cache = new ServerCache();
    const fetcher: typeof globalThis.fetch = async () =>
      new Response('not found', { status: 404 });
    const result = await actSearch('http://example.invalid', 'anything', {
      fetch: fetcher,
      cache,
    });
    expect(result.hits).toEqual([]);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('is case-insensitive', async () => {
    const site = makeStandardSite();
    const cache = new ServerCache();
    const result = await actSearch(site.origin, 'INSTALL', {
      fetch: makeFetcher(site),
      cache,
    });
    expect(result.hits.some((h) => h.id === 'guides/install')).toBe(true);
  });
});

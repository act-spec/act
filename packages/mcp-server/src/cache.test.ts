import { describe, expect, it } from 'vitest';

import { ServerCache } from './cache.js';

describe('ServerCache', () => {
  it('returns cached manifest within TTL and a miss after TTL', () => {
    let now = 1_000;
    const cache = new ServerCache({
      manifestTtlMs: 100,
      nodeTtlMs: 100,
      now: () => now,
    });
    cache.setManifest('https://a.example/', { hello: 'world' });
    expect(cache.getManifest('https://a.example/')).toEqual({ hello: 'world' });
    now += 200;
    expect(cache.getManifest('https://a.example/')).toBeUndefined();
  });

  it('partitions node entries by site URL', () => {
    let now = 0;
    const cache = new ServerCache({ now: () => now });
    cache.setNode('https://a.example/', 'n1', { id: 'n1', site: 'a' });
    cache.setNode('https://b.example/', 'n1', { id: 'n1', site: 'b' });
    expect(cache.getNode('https://a.example/', 'n1')).toMatchObject({ site: 'a' });
    expect(cache.getNode('https://b.example/', 'n1')).toMatchObject({ site: 'b' });
  });

  it('evicts the oldest entry once max is reached (LRU)', () => {
    let now = 0;
    const cache = new ServerCache({ maxEntries: 2, now: () => now });
    cache.setManifest('a', 1);
    cache.setManifest('b', 2);
    cache.setManifest('c', 3);
    expect(cache.getManifest('a')).toBeUndefined();
    expect(cache.getManifest('b')).toBe(2);
    expect(cache.getManifest('c')).toBe(3);
  });

  it('clear() drops all entries', () => {
    const cache = new ServerCache();
    cache.setManifest('a', 1);
    cache.setNode('a', 'n1', 2);
    cache.clear();
    expect(cache.getManifest('a')).toBeUndefined();
    expect(cache.getNode('a', 'n1')).toBeUndefined();
  });
});

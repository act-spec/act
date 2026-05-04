import { describe, expect, it } from 'vitest';
import { diff } from './diff.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';

describe('diff (PRD-601-R10 / R13)', () => {
  it('classifies every node as etag_unchanged when both trees are identical', async () => {
    const site = makeStandardSite();
    const fetcher = makeFetcher(site);
    const r = await diff(site.origin, site.origin, { fetch: fetcher });
    expect(r.added).toHaveLength(0);
    expect(r.removed).toHaveLength(0);
    expect(r.etag_changed).toHaveLength(0);
    expect(r.etag_unchanged.length).toBe(site.nodes.length);
  });

  it('reports added / removed nodes (PRD-601-R10)', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    // Drop one node from B; add a new one.
    b.nodes = b.nodes.filter((n) => n.id !== 'intro');
    b.nodes.push({
      id: 'newcomer',
      type: 'page',
      title: 'Newcomer',
      summary: 'new',
      tokens: { summary: 3 },
      etag: 's256:newnewnewnew',
      parent: 'root',
    });
    const r = await diff(a.origin, b.origin, {
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
        return makeFetcher(b)(input, init);
      },
    });
    expect(r.removed.map((e) => e.id)).toContain('intro');
    expect(r.added.map((e) => e.id)).toContain('newcomer');
  });

  it('reports etag_changed with token_delta (PRD-601-R10)', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    const idx = b.nodes.findIndex((n) => n.id === 'intro');
    b.nodes[idx] = { ...b.nodes[idx]!, etag: 's256:newetagnew', tokens: { summary: 99, body: 200 } };
    const r = await diff(a.origin, b.origin, {
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
        return makeFetcher(b)(input, init);
      },
    });
    const intro = r.etag_changed.find((e) => e.id === 'intro');
    expect(intro).toBeDefined();
    expect(intro?.token_delta.summary).toBe(99 - 10);
    expect(intro?.token_delta.body).toBe(200 - 100);
  });

  it('detects structural_change when same etag but parent changes (PRD-601-R10)', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    const idx = b.nodes.findIndex((n) => n.id === 'intro');
    b.nodes[idx] = { ...b.nodes[idx]!, parent: 'getting-started' };
    const r = await diff(a.origin, b.origin, {
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
        return makeFetcher(b)(input, init);
      },
    });
    const intro = r.structural_change.find((e) => e.id === 'intro');
    expect(intro).toBeDefined();
    expect(intro?.parent_change?.before).toBe('root');
    expect(intro?.parent_change?.after).toBe('getting-started');
  });

  it('emits per-field changes when --include-content is set (PRD-601-R10)', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    const idx = b.nodes.findIndex((n) => n.id === 'intro');
    b.nodes[idx] = { ...b.nodes[idx]!, etag: 's256:newetagnew', body: 'COMPLETELY-DIFFERENT' };
    const r = await diff(a.origin, b.origin, {
      includeContent: true,
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
        return makeFetcher(b)(input, init);
      },
    });
    const intro = r.etag_changed.find((e) => e.id === 'intro');
    expect(intro?.changes).toBeDefined();
    expect(intro?.changes?.length).toBeGreaterThan(0);
    // Etag itself should appear as a per-field change.
    expect(intro?.changes?.some((c) => c.pointer === '/etag')).toBe(true);
  });

  it('honors --ignore-fields to suppress per-field noise (PRD-601-R10)', async () => {
    const a = makeStandardSite('http://a.invalid');
    const b = makeStandardSite('http://b.invalid');
    const idx = b.nodes.findIndex((n) => n.id === 'intro');
    b.nodes[idx] = { ...b.nodes[idx]!, etag: 's256:newetagnew', body: 'updated' };
    const r = await diff(a.origin, b.origin, {
      includeContent: true,
      ignoreFields: ['/etag', 'content'],
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith(a.origin)) return makeFetcher(a)(input, init);
        return makeFetcher(b)(input, init);
      },
    });
    const intro = r.etag_changed.find((e) => e.id === 'intro');
    // /etag suppressed; content.0.text would not be (different ignore key).
    expect(intro?.changes?.some((c) => c.pointer === '/etag')).toBe(false);
  });

  it('rolls up the request count across both walks', async () => {
    const site = makeStandardSite();
    const r = await diff(site.origin, site.origin, { fetch: makeFetcher(site) });
    expect(r.walk_summary.requests_made).toBeGreaterThan(0);
  });

  it('produces a stable JSON shape with every documented top-level key (PRD-601-R14)', async () => {
    const site = makeStandardSite();
    const r = await diff(site.origin, site.origin, { fetch: makeFetcher(site) });
    expect(Object.keys(r).sort()).toEqual(
      [
        'added',
        'etag_changed',
        'etag_unchanged',
        'findings',
        'removed',
        'structural_change',
        'url_a',
        'url_b',
        'walk_summary',
      ].sort(),
    );
  });

  it('algorithm is O(N + M): each id classified at most once (PRD-601-R13)', async () => {
    const site = makeStandardSite();
    const r = await diff(site.origin, site.origin, { fetch: makeFetcher(site) });
    const allIds = new Set<string>([
      ...r.added.map((e) => e.id),
      ...r.removed.map((e) => e.id),
      ...r.etag_unchanged.map((e) => e.id),
      ...r.etag_changed.map((e) => e.id),
      ...r.structural_change.map((e) => e.id),
    ]);
    const total =
      r.added.length +
      r.removed.length +
      r.etag_unchanged.length +
      r.etag_changed.length +
      r.structural_change.length;
    // Each id classified into exactly one bucket (no double-counting).
    expect(total).toBe(allIds.size);
  });
});

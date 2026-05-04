import { describe, expect, it } from 'vitest';
import { inspect } from './inspect.js';
import { makeFetcher, makeStandardSite, makeCoreSite, makeStrictSite } from './_fixtures.js';

describe('inspect (PRD-601-R5)', () => {
  it('reports manifest declared values verbatim (PRD-601-R21)', async () => {
    const site = makeStandardSite();
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.declared.level).toBe('standard');
    expect(r.declared.delivery).toBe('static');
  });

  it('does NOT compute an achieved level (PRD-601-R21)', async () => {
    const site = makeStandardSite();
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect((r as Record<string, unknown>)['achieved']).toBeUndefined();
    expect((r as Record<string, unknown>)['gaps']).toBeUndefined();
  });

  it('lists endpoints from the manifest (PRD-601-R5(3))', async () => {
    const site = makeStandardSite();
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.endpoints.index).toBe('/act/index.json');
    expect(r.endpoints.node_template).toBe('/act/n/{id}.json');
    expect(r.endpoints.subtree_template).toBe('/act/sub/{id}.json');
  });

  it('omits subtree_template for a Core producer', async () => {
    const site = makeCoreSite();
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.endpoints.subtree_template).toBeUndefined();
  });

  it('lists Plus-specific endpoints when the manifest advertises them', async () => {
    const site = makeStrictSite();
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.endpoints.index_ndjson).toBe('/act/index.ndjson');
    expect(r.endpoints.search_template).toBe('/act/search?q={query}');
  });

  it('samples up to 16 nodes by default (PRD-601-R5(4))', async () => {
    const site = makeStandardSite();
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.sampled_nodes.length).toBeLessThanOrEqual(16);
  });

  it('passes auth.schemes through verbatim', async () => {
    const site = makeStandardSite();
    site.manifest = { ...site.manifest, auth: { schemes: ['bearer', 'basic'] } };
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.auth.schemes).toEqual(['bearer', 'basic']);
  });

  it('returns empty endpoints / declared on a broken manifest', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'unreachable' };
    const r = await inspect(site.origin, { fetch: makeFetcher(site) });
    expect(r.declared.level).toBeNull();
    expect(r.endpoints.index).toBeNull();
    expect(r.findings.some((f) => f.code === 'endpoint-404')).toBe(true);
  });
});

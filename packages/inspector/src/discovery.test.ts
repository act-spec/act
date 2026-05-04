import { describe, expect, it } from 'vitest';
import { discoverManifest, checkActVersion } from './discovery.js';
import { RequestBudget, InvocationCache } from './http.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';

function newBudget(fetcher: typeof globalThis.fetch, cap = 32): RequestBudget {
  return new RequestBudget(cap, fetcher);
}

describe('discoverManifest (PRD-101-R8 / PRD-601-R5(1))', () => {
  it('resolves an origin URL to its well-known manifest URL', async () => {
    const site = makeStandardSite();
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false);
    expect(r.manifestUrl).toBe(`${site.origin}/.well-known/act.json`);
    expect(r.manifest?.['act_version']).toBe('0.1');
    expect(r.findings).toHaveLength(0);
  });

  it('reports auth-required when the manifest endpoint returns 401 (PRD-601-R6)', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'auth-required' };
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false);
    expect(r.manifest).toBeNull();
    expect(r.findings.some((f) => f.code === 'auth-required')).toBe(true);
  });

  it('reports endpoint-404 when the manifest is unreachable (PRD-601-R5(2))', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'unreachable' };
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false);
    expect(r.manifest).toBeNull();
    expect(r.findings.some((f) => f.code === 'endpoint-404')).toBe(true);
  });

  it('reports manifest-parse-error on invalid JSON (PRD-601-R5(2))', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'parse-error' };
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false);
    expect(r.manifest).toBeNull();
    expect(r.findings.some((f) => f.code === 'manifest-parse-error')).toBe(true);
  });

  it('rejects unknown MAJOR act_version with code act-version-major-mismatch (PRD-601-R3)', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'major-mismatch' };
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false);
    expect(r.manifest).toBeNull();
    expect(r.findings.some((f) => f.code === 'act-version-major-mismatch')).toBe(true);
  });

  it('reports request-budget-exceeded if the budget is 0 (PRD-601-R20)', async () => {
    const site = makeStandardSite();
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher, 0), new InvocationCache(), false);
    expect(r.manifest).toBeNull();
    expect(r.findings.some((f) => f.code === 'request-budget-exceeded')).toBe(true);
  });

  it('emits If-None-Match on the second discoverManifest call when the cache has the ETag (PRD-601-R9)', async () => {
    const site = makeStandardSite();
    site.emitEtagHeaders = true;
    site.trace = [];
    const fetcher = makeFetcher(site);
    const cache = new InvocationCache();
    const budget = newBudget(fetcher, 8);
    await discoverManifest(site.origin, budget, cache, false);
    await discoverManifest(site.origin, budget, cache, false);
    expect(site.trace.length).toBe(2);
    expect(site.trace[0]?.ifNoneMatch).toBeNull();
    expect(site.trace[1]?.ifNoneMatch).not.toBeNull();
  });

  it('does NOT emit If-None-Match when noCache=true (PRD-601-R9)', async () => {
    const site = makeStandardSite();
    site.emitEtagHeaders = true;
    site.trace = [];
    const fetcher = makeFetcher(site);
    const cache = new InvocationCache();
    const budget = newBudget(fetcher, 8);
    await discoverManifest(site.origin, budget, cache, true);
    await discoverManifest(site.origin, budget, cache, true);
    expect(site.trace[1]?.ifNoneMatch).toBeNull();
  });

  it('passes operator-supplied headers through to the fetcher (PRD-601-R18)', async () => {
    const site = makeStandardSite();
    let seen: string | null = null;
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      seen = init?.headers ? new Headers(init.headers).get('authorization') : null;
      return makeFetcher(site)(input, init);
    };
    await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false, {
      authorization: 'Bearer secret',
    });
    expect(seen).toBe('Bearer secret');
  });

  it('treats a fetch throw as a manifest-fetch-failed finding', async () => {
    const fetcher: typeof globalThis.fetch = () => {
      throw new Error('network down');
    };
    const r = await discoverManifest('http://example.invalid', newBudget(fetcher), new InvocationCache(), false);
    expect(r.findings.some((f) => f.code === 'manifest-fetch-failed')).toBe(true);
  });
});

describe('tolerates unknown optional fields (PRD-601-R2 / PRD-108-R7)', () => {
  it('passes unknown manifest fields through to the JSON output', async () => {
    const site = makeStandardSite();
    site.manifest = {
      ...site.manifest,
      // Unknown future field; PRD-108-R7 forbids the parser from rejecting it.
      experimental_capability_set: ['foo', 'bar'],
    } as unknown as typeof site.manifest;
    const fetcher = makeFetcher(site);
    const r = await discoverManifest(site.origin, newBudget(fetcher), new InvocationCache(), false);
    expect(r.manifest).not.toBeNull();
    expect((r.manifest as Record<string, unknown>)['experimental_capability_set']).toEqual(['foo', 'bar']);
  });
});

describe('checkActVersion (PRD-601-R3)', () => {
  it('emits no finding for the bundled version', () => {
    expect(checkActVersion({ act_version: '0.1' })).toHaveLength(0);
  });

  it('emits act-version-major-mismatch for a future MAJOR', () => {
    const f = checkActVersion({ act_version: '999.0' });
    expect(f).toHaveLength(1);
    expect(f[0]?.code).toBe('act-version-major-mismatch');
    expect(f[0]?.severity).toBe('error');
  });

  it('emits version-mismatch (warn) for a different MINOR within the same MAJOR (PRD-108-R7)', () => {
    const f = checkActVersion({ act_version: '0.2' });
    expect(f).toHaveLength(1);
    expect(f[0]?.code).toBe('version-mismatch');
    expect(f[0]?.severity).toBe('warn');
  });

  it('returns no finding when act_version is missing', () => {
    expect(checkActVersion({})).toHaveLength(0);
    expect(checkActVersion(null)).toHaveLength(0);
  });
});

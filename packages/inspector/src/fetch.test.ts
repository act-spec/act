import { describe, expect, it } from 'vitest';
import { node, subtree } from './fetch.js';
import { makeFetcher, makeStandardSite, makeCoreSite } from './_fixtures.js';

describe('node (PRD-601-R15 / PRD-100-R21)', () => {
  it('fetches and returns a node envelope', async () => {
    const site = makeStandardSite();
    const r = await node(site.origin, 'intro', { fetch: makeFetcher(site) });
    expect(r.node).not.toBeNull();
    expect((r.node as Record<string, unknown>)['id']).toBe('intro');
    expect(r.findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('reports endpoint-404 on a missing node id', async () => {
    const site = makeStandardSite();
    const r = await node(site.origin, 'does-not-exist', { fetch: makeFetcher(site) });
    expect(r.node).toBeNull();
    expect(r.findings.some((f) => f.code === 'endpoint-404')).toBe(true);
  });

  it('returns null + findings when manifest discovery fails', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'unreachable' };
    const r = await node(site.origin, 'intro', { fetch: makeFetcher(site) });
    expect(r.node).toBeNull();
  });
});

describe('subtree (PRD-601-R11)', () => {
  it('fetches and returns a subtree envelope from a Standard producer', async () => {
    const site = makeStandardSite();
    const r = await subtree(site.origin, 'intro', { fetch: makeFetcher(site) });
    expect(r.subtree).not.toBeNull();
  });

  it('errors with subtree-requires-standard against a Core producer (PRD-601-R11 / R22 exit 3)', async () => {
    const site = makeCoreSite();
    const r = await subtree(site.origin, 'intro', { fetch: makeFetcher(site) });
    expect(r.subtree).toBeNull();
    expect(r.findings.some((f) => f.code === 'subtree-requires-standard')).toBe(true);
  });

  it('errors when --depth is out of range [0, 8] (PRD-601-R11)', async () => {
    const site = makeStandardSite();
    const r = await subtree(site.origin, 'intro', { fetch: makeFetcher(site), depth: 99 });
    expect(r.subtree).toBeNull();
    expect(r.findings.some((f) => f.code === 'subtree-depth-out-of-range')).toBe(true);
  });

  it('reports endpoint-404 on a missing subtree id', async () => {
    const site = makeStandardSite();
    const r = await subtree(site.origin, 'does-not-exist', { fetch: makeFetcher(site) });
    expect(r.subtree).toBeNull();
    expect(r.findings.some((f) => f.code === 'endpoint-404')).toBe(true);
  });
});

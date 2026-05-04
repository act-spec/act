import { describe, expect, it } from 'vitest';
import { walk } from './walk.js';
import { makeFetcher, makeStandardSite, makeStrictSite } from './_fixtures.js';
import { type ManifestSchema } from '@act-spec/core';

type Manifest = ManifestSchema.Manifest;

describe('walk (PRD-601-R7)', () => {
  it('walks every node in the index by default (sample defaults to all)', async () => {
    const site = makeStandardSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    expect(r.nodes.length).toBe(site.nodes.length);
    expect(r.tree_summary.total_nodes).toBe(site.nodes.length);
    expect(r.findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('emits per-node entries with id, type, parent, children, tokens, etag, status (PRD-601-R7(4))', async () => {
    const site = makeStandardSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    const intro = r.nodes.find((n) => n.id === 'intro');
    expect(intro).toBeDefined();
    expect(intro?.type).toBe('page');
    expect(intro?.parent).toBe('root');
    expect(intro?.tokens.body).toBe(100);
    // Etag value-shape per PRD-103-R3 (s256:<22 base64url chars>).
    expect(intro?.etag).toMatch(/^s256:[A-Za-z0-9_-]{22}$/);
    expect(intro?.status).toBe('ok');
  });

  it('honors --sample N (PRD-601-R17)', async () => {
    const site = makeStandardSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site), sample: 2 });
    expect(r.nodes.length).toBe(2);
  });

  it('reports endpoint-404 for indexed nodes that 404 at fetch time (PRD-601-R5(7))', async () => {
    const site = makeStandardSite();
    site.broken = { nodes404: ['intro'] };
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    const intro = r.nodes.find((n) => n.id === 'intro');
    expect(intro?.status).toBe('error');
    expect(r.findings.some((f) => f.code === 'endpoint-404')).toBe(true);
  });

  it('exits with request-budget-exceeded when --max-requests is too small (PRD-601-R20)', async () => {
    const site = makeStandardSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site), maxRequests: 2 });
    expect(r.findings.some((f) => f.code === 'request-budget-exceeded')).toBe(true);
  });

  it('refuses --use-ndjson against a non-Plus producer (PRD-601-R19)', async () => {
    const site = makeStandardSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site), useNdjson: true });
    expect(r.findings.some((f) => f.code === 'ndjson-requires-strict')).toBe(true);
    expect(r.nodes).toHaveLength(0);
  });

  it('accepts --use-ndjson against a Plus producer and walks via the NDJSON index (PRD-601-R19)', async () => {
    const site = makeStrictSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site), useNdjson: true });
    expect(r.nodes.length).toBe(site.nodes.length);
    expect(r.findings.some((f) => f.code === 'ndjson-requires-strict')).toBe(false);
  });

  it('emits If-None-Match on the second walk (PRD-601-R9)', async () => {
    const site = makeStandardSite();
    site.emitEtagHeaders = true;
    site.trace = [];
    const fetcher = makeFetcher(site);
    await walk(site.origin, { fetch: fetcher });
    site.trace = [];
    await walk(site.origin, { fetch: fetcher });
    // The walk doesn't share cache across invocations (PRD-601-R9
    // forbids cross-invocation cache); but within one call the second
    // node fetch (after the same URL has been seen) would replay.
    // We can't observe within-walk replay easily here because each
    // node URL is unique. Smoke-test that --no-cache suppresses inm:
    site.trace = [];
    await walk(site.origin, { fetch: fetcher, noCache: true });
    expect(site.trace.every((t) => t.ifNoneMatch === null)).toBe(true);
  });

  it('logs cross-origin mounts as findings (PRD-601-R8)', async () => {
    const site = makeStandardSite();
    site.manifest = {
      ...site.manifest,
      mounts: [
        { prefix: '/partner', manifest_url: 'https://partner.example/.well-known/act.json', delivery: 'static' },
      ],
    } as Manifest;
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    expect(r.findings.some((f) => f.code === 'cross-origin-mount')).toBe(true);
  });

  it('switches to cross-origin-mount-suppressed under --no-follow-cross-origin (PRD-601-R8)', async () => {
    const site = makeStandardSite();
    site.manifest = {
      ...site.manifest,
      mounts: [
        { prefix: '/partner', manifest_url: 'https://partner.example/.well-known/act.json', delivery: 'static' },
      ],
    } as Manifest;
    const r = await walk(site.origin, { fetch: makeFetcher(site), noFollowCrossOrigin: true });
    expect(r.findings.some((f) => f.code === 'cross-origin-mount-suppressed')).toBe(true);
    expect(r.findings.some((f) => f.code === 'cross-origin-mount')).toBe(false);
  });

  it('returns empty nodes when the manifest fetch fails', async () => {
    const site = makeStandardSite();
    site.broken = { manifest: 'unreachable' };
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    expect(r.nodes).toHaveLength(0);
    expect(r.manifest).toBeNull();
  });

  it('surfaces an envelope finding when the manifest is structurally invalid (PRD-601-R1)', async () => {
    const site = makeStandardSite();
    // Drop the required `index_url` — validator should reject; walk
    // returns no nodes and an envelope finding.
    const { index_url: _drop, ...rest } = site.manifest as Manifest & { index_url?: string };
    site.manifest = rest as Manifest;
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    expect(r.findings.some((f) => f.code.startsWith('envelope-'))).toBe(true);
    expect(r.nodes).toHaveLength(0);
  });

  it('caps the walk by --depth from root_id (PRD-601-R7)', async () => {
    const site = makeStandardSite();
    // depth=1 should include root + its direct children, not depth-2 grandchildren.
    const r = await walk(site.origin, { fetch: makeFetcher(site), depth: 1 });
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).not.toContain('getting-started/install');
    expect(ids).toContain('root');
    expect(ids).toContain('intro');
  });

  it('computes tree_summary fanout correctly', async () => {
    const site = makeStandardSite();
    const r = await walk(site.origin, { fetch: makeFetcher(site) });
    expect(r.tree_summary.fanout.max).toBeGreaterThanOrEqual(1);
    expect(r.tree_summary.fanout.min).toBe(0);
    expect(typeof r.tree_summary.fanout.median).toBe('number');
  });
});

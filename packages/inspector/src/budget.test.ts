import { describe, expect, it } from 'vitest';
import { budget } from './budget.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';

describe('budget (PRD-601-R12)', () => {
  it('defaults strategy to breadth-first and starts at root_id', async () => {
    const site = makeStandardSite();
    const r = await budget(site.origin, 1000, { fetch: makeFetcher(site) });
    expect(r.strategy).toBe('breadth-first');
    expect(r.start_id).toBe('root');
  });

  it('breadth-first: includes the start node first, then layer by layer', async () => {
    const site = makeStandardSite();
    const r = await budget(site.origin, 1000, { fetch: makeFetcher(site), strategy: 'breadth-first' });
    expect(r.inclusion_order[0]?.id).toBe('root');
    // Direct children of root come before their grandchildren.
    const ids = r.inclusion_order.map((e) => e.id);
    expect(ids.indexOf('intro')).toBeLessThan(ids.indexOf('getting-started/install'));
    expect(ids.indexOf('getting-started')).toBeLessThan(ids.indexOf('getting-started/install'));
  });

  it('deepest-first: leaves first, ancestors last', async () => {
    const site = makeStandardSite();
    const r = await budget(site.origin, 1000, { fetch: makeFetcher(site), strategy: 'deepest-first' });
    const ids = r.inclusion_order.map((e) => e.id);
    expect(ids.indexOf('getting-started/install')).toBeLessThan(ids.indexOf('getting-started'));
    expect(ids.indexOf('getting-started')).toBeLessThan(ids.indexOf('root'));
  });

  it('respects the budget cap and reports excluded nodes', async () => {
    const site = makeStandardSite();
    // Tight budget — root (5+0) + intro (10+100) = 115. Cap at 50.
    const r = await budget(site.origin, 50, { fetch: makeFetcher(site) });
    expect(r.summary.tokens_used).toBeLessThanOrEqual(50);
    expect(r.summary.nodes_excluded).toBeGreaterThan(0);
    expect(r.summary.nodes_included + r.summary.nodes_excluded).toBe(4);
  });

  it('supports a custom tokenizer (PRD-601-R12 / Q3 resolution)', async () => {
    const site = makeStandardSite();
    let count = 0;
    const r = await budget(site.origin, 100, {
      fetch: makeFetcher(site),
      tokenizer: () => {
        count += 1;
        return 1;
      },
    });
    // Each visited node went through the tokenizer at least once.
    expect(count).toBeGreaterThan(0);
    expect(r.inclusion_order.every((e) => e.tokens === 1)).toBe(true);
  });

  it('honors --start-id to start at an arbitrary subtree root', async () => {
    const site = makeStandardSite();
    const r = await budget(site.origin, 10000, { fetch: makeFetcher(site), startId: 'getting-started' });
    expect(r.start_id).toBe('getting-started');
    expect(r.inclusion_order[0]?.id).toBe('getting-started');
    // Should not include intro or root (different subtree).
    expect(r.inclusion_order.map((e) => e.id)).not.toContain('intro');
    expect(r.inclusion_order.map((e) => e.id)).not.toContain('root');
  });

  it('returns an empty inclusion order when start_id is not in the tree', async () => {
    const site = makeStandardSite();
    const r = await budget(site.origin, 1000, { fetch: makeFetcher(site), startId: 'nonexistent' });
    expect(r.inclusion_order).toHaveLength(0);
  });
});

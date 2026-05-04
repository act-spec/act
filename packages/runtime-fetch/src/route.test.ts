/**
 * PRD-505-R4 / R5 — route table + endpoint matcher tests.
 *
 * The route table is built once at construction; the matcher returns
 * true for paths that hit ACT endpoints (manifest / index / node /
 * subtree / ndjson / search). Matching IDs may contain `/` per
 * PRD-100-R10 — exercised explicitly via `doc/intro`.
 */
import { describe, expect, it } from 'vitest';

import { coreManifest, strictManifest, standardManifest } from './_fixtures.js';
import { buildRouteTable, matchesActEndpoint, matchesTemplatePath } from './route.js';

describe('PRD-505-R4 buildRouteTable', () => {
  it('builds the Core route table with default basePath and manifestPath', () => {
    const t = buildRouteTable(coreManifest(), '', '/.well-known/act.json');
    expect(t.manifestPath).toBe('/.well-known/act.json');
    expect(t.indexPath).toBe('/act/index.json');
    expect(t.nodePrefix).toBe('/act/n/');
    expect(t.nodeSuffix).toBe('');
    expect(t.subtreePrefix).toBeNull();
    expect(t.ndjsonPath).toBeNull();
    expect(t.searchPath).toBeNull();
  });

  it('prefixes the route table with basePath (PRD-505-R3)', () => {
    const t = buildRouteTable(coreManifest(), '/app', '/.well-known/act.json');
    expect(t.manifestPath).toBe('/app/.well-known/act.json');
    expect(t.indexPath).toBe('/app/act/index.json');
    expect(t.nodePrefix).toBe('/app/act/n/');
  });

  it('accepts a non-default manifestPath (PRD-505-R5 / OQ2)', () => {
    const t = buildRouteTable(coreManifest(), '', '/api/act-manifest.json');
    expect(t.manifestPath).toBe('/api/act-manifest.json');
  });

  it('builds Standard routes (subtree)', () => {
    const t = buildRouteTable(standardManifest(), '', '/.well-known/act.json');
    expect(t.subtreePrefix).toBe('/act/sub/');
    expect(t.subtreeSuffix).toBe('');
  });

  it('builds Plus routes (ndjson + search) — PRD-505-R11', () => {
    const t = buildRouteTable(strictManifest(), '', '/.well-known/act.json');
    expect(t.ndjsonPath).toBe('/act/index.ndjson');
    expect(t.searchPath).toBe('/act/search');
  });

  it('handles a node template with a non-empty suffix', () => {
    const m = coreManifest({ node_url_template: '/act/n/{id}.json' });
    const t = buildRouteTable(m, '', '/.well-known/act.json');
    expect(t.nodePrefix).toBe('/act/n/');
    expect(t.nodeSuffix).toBe('.json');
  });
});

describe('PRD-505-R5 matchesActEndpoint', () => {
  const routes = buildRouteTable(strictManifest(), '', '/.well-known/act.json');

  it('matches the manifest path (exact)', () => {
    expect(matchesActEndpoint('/.well-known/act.json', routes)).toBe(true);
    expect(matchesActEndpoint('/.well-known/other.json', routes)).toBe(false);
  });

  it('matches the index path (exact)', () => {
    expect(matchesActEndpoint('/act/index.json', routes)).toBe(true);
    expect(matchesActEndpoint('/act/index.html', routes)).toBe(false);
  });

  it('matches a node id including `/` (PRD-100-R10)', () => {
    expect(matchesActEndpoint('/act/n/doc/intro', routes)).toBe(true);
    expect(matchesActEndpoint('/act/n/single', routes)).toBe(true);
  });

  it('rejects an empty `{id}` capture', () => {
    expect(matchesActEndpoint('/act/n/', routes)).toBe(false);
  });

  it('matches a subtree request', () => {
    expect(matchesActEndpoint('/act/sub/doc/intro', routes)).toBe(true);
  });

  it('matches the ndjson endpoint and the search pathname', () => {
    expect(matchesActEndpoint('/act/index.ndjson', routes)).toBe(true);
    expect(matchesActEndpoint('/act/search', routes)).toBe(true);
  });

  it('returns false for unrelated host paths (PRD-505-R5 passthrough)', () => {
    expect(matchesActEndpoint('/api/users', routes)).toBe(false);
    expect(matchesActEndpoint('/blog/post-1', routes)).toBe(false);
  });

  it('Core routes do not match Standard / Plus paths', () => {
    const coreRoutes = buildRouteTable(coreManifest(), '', '/.well-known/act.json');
    expect(matchesActEndpoint('/act/sub/doc/intro', coreRoutes)).toBe(false);
    expect(matchesActEndpoint('/act/index.ndjson', coreRoutes)).toBe(false);
    expect(matchesActEndpoint('/act/search', coreRoutes)).toBe(false);
  });
});

describe('PRD-505-R5 matchesTemplatePath', () => {
  it('requires a non-empty middle (PRD-100-R10)', () => {
    expect(matchesTemplatePath('/act/n/x', '/act/n/', '')).toBe(true);
    expect(matchesTemplatePath('/act/n/', '/act/n/', '')).toBe(false);
  });

  it('respects suffix (e.g., `.json`)', () => {
    expect(matchesTemplatePath('/act/n/x.json', '/act/n/', '.json')).toBe(true);
    expect(matchesTemplatePath('/act/n/x.html', '/act/n/', '.json')).toBe(false);
  });

  it('returns false on prefix miss', () => {
    expect(matchesTemplatePath('/other/n/x', '/act/n/', '')).toBe(false);
  });
});

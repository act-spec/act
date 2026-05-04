/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-non-null-assertion */
/**
 * Shared test fixtures: a mock fetcher factory that serves a small
 * canned ACT tree per test. The fixtures here intentionally model
 * three producer levels (Core, Standard, Plus) so PRD-601-R11 / R19
 * branches can be exercised without a live server.
 */
import { type ManifestSchema } from '@act-spec/core';

type Manifest = ManifestSchema.Manifest;

export interface FixtureNode {
  id: string;
  type: string;
  title: string;
  parent?: string | null;
  children?: string[];
  summary?: string;
  body?: string;
  tokens: { summary: number; body?: number };
  etag: string;
}

export interface FixtureSite {
  origin: string;
  manifest: Manifest;
  nodes: FixtureNode[];
  /** Optional: deliberately broken endpoints to exercise error paths. */
  broken?: { manifest?: 'parse-error' | 'unreachable' | 'auth-required' | 'major-mismatch'; index?: 'unreachable' | '500'; nodes404?: string[] };
  /** Optional: emit ETag headers. Enables If-None-Match cache hits. */
  emitEtagHeaders?: boolean;
  /** Optional: track conditional requests so a test can assert 304s. */
  trace?: { url: string; ifNoneMatch: string | null }[];
}

/**
 * Producer-shaped ETag value: `s256:<22 base64url chars>` per
 * PRD-103-R3. The fixture etags here are deterministic-ish strings of
 * length 22 chosen for readability in test failures; the validator
 * only checks the regex shape, not the digest derivation.
 */
function fixtureEtag(seed: string): string {
  const padded = (seed + 'AAAAAAAAAAAAAAAAAAAAAA').slice(0, 22);
  return `s256:${padded}`;
}

export function makeStandardSite(origin = 'http://example.invalid'): FixtureSite {
  const nodes: FixtureNode[] = [
    {
      id: 'root',
      type: 'index',
      title: 'Root',
      summary: 'root summary',
      tokens: { summary: 5, body: 0 },
      etag: fixtureEtag('root'),
      children: ['intro', 'getting-started'],
    },
    {
      id: 'intro',
      type: 'page',
      title: 'Intro',
      parent: 'root',
      summary: 'intro summary',
      body: 'intro body',
      tokens: { summary: 10, body: 100 },
      etag: fixtureEtag('intro'),
    },
    {
      id: 'getting-started',
      type: 'page',
      title: 'Getting Started',
      parent: 'root',
      summary: 'gs summary',
      body: 'gs body',
      tokens: { summary: 12, body: 200 },
      etag: fixtureEtag('gs'),
      children: ['getting-started/install'],
    },
    {
      id: 'getting-started/install',
      type: 'page',
      title: 'Install',
      parent: 'getting-started',
      summary: 'install summary',
      body: 'install body',
      tokens: { summary: 8, body: 50 },
      etag: fixtureEtag('install'),
    },
  ];
  return {
    origin,
    nodes,
    manifest: {
      act_version: '0.1',
      site: { name: 'fixture' },
      delivery: 'static',
      conformance: { level: 'standard' },
      index_url: '/act/index.json',
      node_url_template: '/act/n/{id}.json',
      subtree_url_template: '/act/sub/{id}.json',
      root_id: 'root',
    },
  };
}

export function makeCoreSite(origin = 'http://example.invalid'): FixtureSite {
  const s = makeStandardSite(origin);
  const { subtree_url_template: _drop, ...rest } = s.manifest as Manifest & { subtree_url_template?: string };
  s.manifest = { ...rest, conformance: { level: 'core' } };
  return s;
}

export function makeStrictSite(origin = 'http://example.invalid'): FixtureSite {
  const s = makeStandardSite(origin);
  s.manifest = {
    ...s.manifest,
    conformance: { level: 'strict' },
    index_ndjson_url: '/act/index.ndjson',
    search_url_template: '/act/search?q={query}',
  };
  return s;
}

/**
 * Build a `fetch`-shaped function that serves the fixture site.
 * Honors `If-None-Match` (returns 304 when the request etag matches
 * the node's stored etag). Records request URLs into `site.trace`.
 */
export function makeFetcher(site: FixtureSite): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const inm = init?.headers
      ? new Headers(init.headers).get('if-none-match')
      : null;
    site.trace?.push({ url, ifNoneMatch: inm });

    if (u.pathname === '/.well-known/act.json') {
      if (site.broken?.manifest === 'unreachable') return new Response('not found', { status: 404 });
      if (site.broken?.manifest === 'auth-required') {
        return new Response('unauth', {
          status: 401,
          headers: { 'www-authenticate': 'Bearer realm="acme"' },
        });
      }
      if (site.broken?.manifest === 'parse-error') {
        return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const body = site.broken?.manifest === 'major-mismatch'
        ? { ...site.manifest, act_version: '999.0' }
        : site.manifest;
      return jsonResponse(JSON.stringify(body), site, '/.well-known/act.json', inm);
    }

    if (u.pathname === '/act/index.json') {
      if (site.broken?.index === 'unreachable') return new Response('boom', { status: 500 });
      if (site.broken?.index === '500') return new Response('boom', { status: 500 });
      const idx = {
        act_version: '0.1',
        nodes: site.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          summary: n.summary ?? n.title,
          tokens: { summary: n.tokens.summary, ...(n.tokens.body !== undefined ? { body: n.tokens.body } : {}) },
          etag: n.etag,
          ...(n.parent !== undefined ? { parent: n.parent } : {}),
          ...(n.children !== undefined ? { children: n.children } : {}),
        })),
      };
      return jsonResponse(JSON.stringify(idx), site, '/act/index.json', inm);
    }

    if (u.pathname === '/act/index.ndjson') {
      const lines = site.nodes
        .map((n) =>
          JSON.stringify({
            id: n.id,
            type: n.type,
            title: n.title,
            summary: n.summary ?? n.title,
            tokens: { summary: n.tokens.summary, ...(n.tokens.body !== undefined ? { body: n.tokens.body } : {}) },
            etag: n.etag,
            ...(n.parent !== undefined ? { parent: n.parent } : {}),
            ...(n.children !== undefined ? { children: n.children } : {}),
          }),
        )
        .join('\n');
      return new Response(lines, {
        status: 200,
        headers: { 'content-type': 'application/act-index+json; profile=ndjson' },
      });
    }

    let m = /^\/act\/n\/(.+)\.json$/.exec(u.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (site.broken?.nodes404?.includes(id)) return new Response('not found', { status: 404 });
      const node = site.nodes.find((n) => n.id === id);
      if (!node) return new Response('not found', { status: 404 });
      const body = {
        act_version: '0.1',
        id: node.id,
        type: node.type,
        title: node.title,
        summary: node.summary ?? node.title,
        content: [{ type: 'prose', text: node.body ?? '' }],
        tokens: { summary: node.tokens.summary, ...(node.tokens.body !== undefined ? { body: node.tokens.body } : {}) },
        etag: node.etag,
      };
      return jsonResponse(JSON.stringify(body), site, u.pathname, inm, node.etag);
    }
    m = /^\/act\/sub\/(.+)\.json$/.exec(u.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      const node = site.nodes.find((n) => n.id === id);
      if (!node) return new Response('not found', { status: 404 });
      const body = {
        act_version: '0.1',
        root: node.id,
        etag: node.etag,
        depth: 3,
        nodes: [
          {
            act_version: '0.1',
            id: node.id,
            type: node.type,
            title: node.title,
            summary: node.summary ?? node.title,
            content: [{ type: 'prose', text: node.body ?? '' }],
            tokens: { summary: node.tokens.summary, ...(node.tokens.body !== undefined ? { body: node.tokens.body } : {}) },
            etag: node.etag,
          },
        ],
      };
      return jsonResponse(JSON.stringify(body), site, u.pathname, inm, node.etag);
    }

    return new Response('not found', { status: 404 });
  };
}

function jsonResponse(
  body: string,
  site: FixtureSite,
  path: string,
  ifNoneMatch: string | null,
  etagOverride?: string,
): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const slug = (path.replace(/[^a-z0-9]/gi, '') + 'AAAAAAAAAAAAAAAAAAAAAA').slice(0, 22);
  const etag = etagOverride ?? `s256:${slug}`;
  if (site.emitEtagHeaders) {
    headers['etag'] = etag;
    if (ifNoneMatch !== null) {
      const stripped = ifNoneMatch.replace(/^"|"$/g, '');
      if (stripped === etag) {
        return new Response(null, { status: 304, headers });
      }
    }
  }
  return new Response(body, { status: 200, headers });
}

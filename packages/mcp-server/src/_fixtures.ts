/* eslint-disable @typescript-eslint/require-await */
/**
 * Test fixtures: a tiny ACT site (manifest + index + a handful of
 * nodes) plus a `fetch`-shaped serving function. The server's tools
 * never hit the network in unit tests — they get this fetcher injected.
 *
 * The shape mirrors `packages/inspector/src/_fixtures.ts` but is local
 * so we can keep mcp-server's tests independent.
 */

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

const ETAG_PADDING = 'AAAAAAAAAAAAAAAAAAAAAA';

function fixtureEtag(seed: string): string {
  return `s256:${(seed + ETAG_PADDING).slice(0, 22)}`;
}

export function makeStandardSite(origin = 'http://example.invalid') {
  const nodes: FixtureNode[] = [
    {
      id: 'root',
      type: 'index',
      title: 'Acme Docs',
      summary: 'root summary',
      tokens: { summary: 5, body: 0 },
      etag: fixtureEtag('root'),
      children: ['intro', 'guides'],
    },
    {
      id: 'intro',
      type: 'page',
      title: 'Introduction to Acme',
      parent: 'root',
      summary: 'intro summary',
      body: 'Welcome to the Acme widget catalog. This page explains what a widget is.',
      tokens: { summary: 10, body: 100 },
      etag: fixtureEtag('intro'),
    },
    {
      id: 'guides',
      type: 'index',
      title: 'Guides',
      parent: 'root',
      summary: 'guides summary',
      tokens: { summary: 4, body: 0 },
      etag: fixtureEtag('guides'),
      children: ['guides/install'],
    },
    {
      id: 'guides/install',
      type: 'page',
      title: 'Install',
      parent: 'guides',
      summary: 'How to install Acme.',
      body: 'Run `npm install acme`. The installer writes a manifest to disk.',
      tokens: { summary: 8, body: 50 },
      etag: fixtureEtag('install'),
    },
  ];
  return {
    origin,
    nodes,
    manifest: {
      act_version: '0.1',
      site: { name: 'Acme' },
      delivery: 'static',
      conformance: { level: 'standard' },
      index_url: '/act/index.json',
      node_url_template: '/act/n/{id}.json',
      subtree_url_template: '/act/sub/{id}.json',
      root_id: 'root',
    } as Record<string, unknown>,
  };
}

export type FixtureSite = ReturnType<typeof makeStandardSite>;

/**
 * Build a `fetch`-shaped function that serves the fixture site's
 * `.well-known/act.json`, index, and per-node URLs.
 */
export function makeFetcher(site: FixtureSite): typeof globalThis.fetch {
  return async (input, _init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    const u = new URL(url);

    if (u.pathname === '/.well-known/act.json') {
      return jsonResponse(JSON.stringify(site.manifest));
    }

    if (u.pathname === '/act/index.json') {
      const idx = {
        act_version: '0.1',
        nodes: site.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          summary: n.summary ?? n.title,
          tokens: {
            summary: n.tokens.summary,
            ...(n.tokens.body !== undefined ? { body: n.tokens.body } : {}),
          },
          etag: n.etag,
          ...(n.parent !== undefined ? { parent: n.parent } : {}),
          ...(n.children !== undefined ? { children: n.children } : {}),
        })),
      };
      return jsonResponse(JSON.stringify(idx));
    }

    const nodeMatch = /^\/act\/n\/(.+)\.json$/.exec(u.pathname);
    if (nodeMatch) {
      const id = decodeURIComponent(nodeMatch[1]!);
      const node = site.nodes.find((n) => n.id === id);
      if (!node) return new Response('not found', { status: 404 });
      const body = {
        act_version: '0.1',
        id: node.id,
        type: node.type,
        title: node.title,
        summary: node.summary ?? node.title,
        content: [{ type: 'prose', text: node.body ?? '' }],
        tokens: {
          summary: node.tokens.summary,
          ...(node.tokens.body !== undefined ? { body: node.tokens.body } : {}),
        },
        etag: node.etag,
      };
      return jsonResponse(JSON.stringify(body));
    }

    return new Response('not found', { status: 404 });
  };
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

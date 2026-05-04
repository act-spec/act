/**
 * Integration tests for the assembled MCP server: boot one in-memory,
 * pair it with a Client, and exercise the four tools end-to-end via
 * the JSON-RPC layer the SDK provides.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createServer } from './server.js';
import { makeFetcher, makeStandardSite } from './_fixtures.js';

async function bootPair(siteUrl: string, fetcher: typeof globalThis.fetch) {
  const mcp = createServer({ fetch: fetcher, defaultSiteUrl: siteUrl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await Promise.all([
    mcp.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { mcp, client };
}

describe('createServer (integration via in-memory transport)', () => {
  it('lists exactly the four ACT tools', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual(['act_get_node', 'act_load_site', 'act_search', 'act_walk_subtree']);
    await client.close();
    await mcp.close();
  });

  it('act_load_site returns the manifest', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const result = await client.callTool({ name: 'act_load_site', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { manifest: { root_id: string } };
    expect(parsed.manifest.root_id).toBe('root');
    await client.close();
    await mcp.close();
  });

  it('act_walk_subtree returns descendants of the requested root', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const result = await client.callTool({
      name: 'act_walk_subtree',
      arguments: { node_id: 'guides', depth: 2 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { nodes: Array<{ id: string }> };
    expect(parsed.nodes.map((n) => n.id)).toContain('guides/install');
    await client.close();
    await mcp.close();
  });

  it('act_get_node returns a single envelope', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const result = await client.callTool({
      name: 'act_get_node',
      arguments: { node_id: 'intro' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { node: { id: string; title: string } };
    expect(parsed.node.id).toBe('intro');
    expect(parsed.node.title).toBe('Introduction to Acme');
    await client.close();
    await mcp.close();
  });

  it('act_search returns hits across title / summary / body', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const result = await client.callTool({
      name: 'act_search',
      arguments: { query: 'widget' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { hits: Array<{ id: string; matched_in: string }> };
    expect(parsed.hits.some((h) => h.id === 'intro' && h.matched_in === 'body')).toBe(true);
    await client.close();
    await mcp.close();
  });

  it('returns an error result when a required argument is missing', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const result = await client.callTool({
      name: 'act_get_node',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    await client.close();
    await mcp.close();
  });

  it('rejects unknown tool names with an error result', async () => {
    const site = makeStandardSite();
    const { mcp, client } = await bootPair(site.origin, makeFetcher(site));
    const result = await client.callTool({
      name: 'act_nope' as never,
      arguments: {},
    });
    expect(result.isError).toBe(true);
    await client.close();
    await mcp.close();
  });
});

#!/usr/bin/env node
/**
 * `act-mcp-server` CLI — boot a stdio MCP server pointed at any ACT-
 * emitting site.
 *
 *   npx @act-spec/mcp-server https://act-spec.org
 *
 * The optional positional URL becomes the default site URL; when set,
 * tool calls may omit the `url` parameter (Claude Desktop, Cursor, etc.
 * tend to omit it once they've configured the server). When omitted,
 * every tool call must supply `url` explicitly.
 *
 * Diagnostics go to stderr so they don't pollute the JSON-RPC stream
 * on stdout. We do NOT pre-flight the URL — pre-flight failures get
 * surfaced as findings on the first `act_load_site` call instead.
 */
import { createServer } from '../dist/index.js';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stderr.write(
    [
      'Usage: act-mcp-server [<url>]',
      '',
      '  <url>    Optional default ACT site URL. When set, tools may omit `url`.',
      '',
      'The server speaks the Model Context Protocol over stdio. Connect from',
      'Claude Desktop, Cursor, or any other MCP-capable agent. See the package',
      'README for client-specific configuration.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const defaultSiteUrl = argv.length > 0 && !argv[0].startsWith('-') ? argv[0] : undefined;

const config = defaultSiteUrl !== undefined ? { defaultSiteUrl } : {};

const mcp = createServer(config);
mcp.connectStdio()
  .then(() => {
    if (defaultSiteUrl !== undefined) {
      process.stderr.write(`act-mcp-server: ready (default site: ${defaultSiteUrl})\n`);
    } else {
      process.stderr.write('act-mcp-server: ready (no default site; supply `url` per tool call)\n');
    }
  })
  .catch((err) => {
    process.stderr.write(`act-mcp-server: failed to start: ${err?.message ?? String(err)}\n`);
    process.exit(1);
  });

const shutdown = async () => {
  try {
    await mcp.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

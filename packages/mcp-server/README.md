# @act-spec/mcp-server

Universal MCP server for any [ACT](https://act-spec.org)-emitting site.
Point it at a URL; expose ACT tools to any MCP-capable agent (Claude
Desktop, Cursor, Continue, …) over stdio.

## What it is

Most ACT sites are static — a `.well-known/act.json` manifest pointing
at an index and per-node JSON files. AI agents that don't natively
speak ACT can still browse those sites if you put a thin MCP shim in
front. That's what this package is.

The server is stateless and universal: it doesn't ship its own content,
it just fetches whatever ACT site the user (or the agent's
configuration) points it at.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Quick start

```sh
npx @act-spec/mcp-server https://act-spec.org
```

The optional positional URL becomes the default site for tool calls
that omit `url`. Without it, every tool call must supply `url`
explicitly.

## Claude Desktop

Add this to `claude_desktop_config.json`
(`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS):

```jsonc
{
  "mcpServers": {
    "act-spec": {
      "command": "npx",
      "args": ["-y", "@act-spec/mcp-server", "https://act-spec.org"]
    }
  }
}
```

Restart Claude Desktop. The four tools (`act_load_site`,
`act_walk_subtree`, `act_get_node`, `act_search`) appear in the tool
picker.

## Cursor

`~/.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "act-spec": {
      "command": "npx",
      "args": ["-y", "@act-spec/mcp-server", "https://act-spec.org"]
    }
  }
}
```

## Tool reference

### `act_load_site(url)`

Fetches `<url>/.well-known/act.json` and returns the parsed manifest
plus any structural findings.

- `url` *(string, required when no default site is configured)* —
  origin or any URL on the site.

Returns `{ url, manifest, findings }`.

### `act_walk_subtree(url, node_id, depth?)`

Walks descendants of `node_id` up to `depth` levels (default 3, max 8).
Useful for browsing a documentation section without fetching the whole
tree.

- `url` *(string)*
- `node_id` *(string, required)*
- `depth` *(number, optional, default 3, clamped to `[0, 8]`)*

Returns `{ url, root_id, depth, nodes, truncated, findings }` where
each node is `{ id, type, parent, children, title?, summary? }`.

### `act_get_node(url, node_id)`

Fetches a single ACT node envelope by id.

- `url` *(string)*
- `node_id` *(string, required)*

Returns `{ url, node, findings }`.

### `act_search(url, query)`

Case-insensitive substring search across `title`, `summary`, and prose
blocks in `content[]`.

- `url` *(string)*
- `query` *(string, required)*

Returns `{ url, query, hits, truncated, findings }` where each hit is
`{ id, type, title, matched_in: 'title' | 'summary' | 'body', excerpt? }`.

## Limitations

`act_search` is a deliberately naive implementation:

- Substring match only. No tokenization, no stemming.
- No relevance ranking. Hits appear in walk order.
- No operators, no quoting, no fuzzy matching.
- It walks the entire index and fetches every node body that doesn't
  match on title or summary. On large sites this is slow.

If your producer advertises a `search_url_template` (Strict conformance
level), prefer their endpoint directly. A future release will route
through it transparently when present.

## Self-hosting

For a self-hosted deployment that does NOT use this npm package, point
clients at a hosted MCP endpoint instead — see
`examples/hybrid-static-runtime-mcp/` in this repo. The hosted endpoint
runs the same code in a Cloudflare Worker.

## Hosted alternative

The reference impl runs at `mcp.act-spec.org` (Streamable HTTP). Any
MCP-capable agent that supports remote servers can connect without a
local install.

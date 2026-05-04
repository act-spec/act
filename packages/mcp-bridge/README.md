# @act-spec/mcp-bridge

ACT-MCP bridge for ACT (Agent Content Tree). Wraps an `ActRuntime` (or a
multi-mount `BridgeConfig.mounts` array) and exposes ACT nodes as MCP 1.0
resources under the canonical `act://` URI scheme. Single-source and
multi-mount construction (runtime + static walker mixes) are both
supported.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/mcp-bridge": "workspace:*" } }
```

## Usage

Single-source (runtime-backed) bridge:

```ts
import { createActMcpBridge } from '@act-spec/mcp-bridge';
import { createRuntime } from '@act-spec/runtime-core';

const runtime = createRuntime({ /* … */ });

const bridge = createActMcpBridge({
  mcp: { name: 'acme-bridge', version: '0.1.0' },
  host: 'acme.example.com',
  identity: { /* IdentityBridge */ },
  runtime,
});

await bridge.start(stdioTransport);
```

Multi-mount bridge — mix a runtime mount with a static walker mount:

```ts
import { createActMcpBridge, readStaticSource } from '@act-spec/mcp-bridge';

const bridge = createActMcpBridge({
  mcp: { name: 'acme-bridge', version: '0.1.0' },
  host: 'acme.example.com',
  identity,
  mounts: [
    { prefix: 'live',    runtime },
    { prefix: 'archive', staticSource: await readStaticSource('./public/act') },
  ],
});
```

URI helpers (no bridge required):

```ts
import { buildResourceUri, buildManifestUri } from '@act-spec/mcp-bridge';

const uri = buildResourceUri('acme.example.com', ['live'], 'node-123');
// => 'act://acme.example.com/live/n/node-123'
```

The conformance harness (`runMcpEnumerationProbe`) verifies that the union
of bridge-enumerated `act://` resources equals the static-emitted +
runtime-served node IDs.

## Conformance / what's tested

Every public API has a citing test in the package's test suite, including
the construction-time validation set (`BridgeConfigurationError` for
partial-validity, missing `IdentityBridge`, prefix coherence, `act_version`
pin, and host checks), the URI scheme, the outcome → MCP error mapper
(`mapOutcomeToMcpError`), and the static walker drift-prevention contract.
The conformance gate runs `runMcpEnumerationProbe` against the bundled
fixtures.

```bash
pnpm -F @act-spec/mcp-bridge conformance
```

## Configuration (selected)

| Option | Notes |
| --- | --- |
| `mcp.name` / `mcp.version` | MCP server identity. |
| `host` | URI host segment; validated by `isValidMcpHost`. |
| `identity` | `IdentityBridge` — required. |
| `runtime` | Single-source mount (`ActRuntime`). |
| `mounts` | Multi-mount alternative; array of `BridgeMount`. |
| `act_version` | Pinned to the supported ACT version. |

## Peer / runtime dependencies

| Dependency | Range |
| --- | --- |
| `@modelcontextprotocol/sdk` | `^1.29.0` (bundled) |
| `@act-spec/runtime-core` | workspace |

The transport is host-supplied. v0.1 ships stdio compatibility; HTTP+SSE
transports are wired by the host application.

## Links

- Runtime core: [`@act-spec/runtime-core`](../runtime-core)
- Repository: <https://github.com/act-spec/act>

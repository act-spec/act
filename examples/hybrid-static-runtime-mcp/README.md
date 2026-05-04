# Ship your own MCP server for your ACT content

Hybrid: static + runtime + MCP. A single deployable that combines pre-built static ACT files, a request-time runtime mount with auth and tenant scoping, and an MCP bridge that exposes both as resources to AI agents under one URI namespace.

This is the canonical reference for sites that want to **self-host** an MCP server for their ACT content rather than point agents at the shared hosted service at `mcp.act-spec.org`.

## What this example demonstrates

- A **static manifest + index** emitted at build time from a markdown corpus (the same plugin-driven shape Docusaurus / Astro / Next plugins emit).
- A **runtime API** for live nodes — auth-aware (cookie + bearer), ETag-aware, tenant-scoped, with byte-equivalent cross-tenant 404s.
- A **self-hosted MCP bridge** built on `@act-spec/mcp-bridge`. Both mounts surface as MCP resources under the `act://` URI scheme; an `IdentityBridge` translates MCP-side auth to ACT request headers.
- A **single deployment unit** — one Node HTTP listener serves `/.well-known/act.json`, `/marketing/*`, and `/app/*` from one origin.
- A **hermetic conformance gate** (build → byte-equality re-build → validator walk → two-principal probe → MCP enumeration probe) wired into one script.

## When to choose this versus `mcp.act-spec.org`

The hosted server at `mcp.act-spec.org` works for any site that emits ACT — point it at your URL and agents can call `act_load_site`, `act_walk_subtree`, `act_get_node`. Self-host when:

| Situation | Use hosted | Self-host |
|---|---|---|
| Public, anonymous-readable docs | yes | optional |
| Authenticated content (cookie / bearer / SSO) | no | required — the hosted server cannot see your auth |
| Privacy-sensitive content (don't want a third party fetching it) | no | required |
| Multi-tenant runtime content with per-identity scoping | no | required |
| Custom MCP resources or tools beyond the standard ACT surface | no | required |
| High request volume (avoid the hosted shared rate limit) | no | recommended |

If your needs match any "self-host" row, this example is the template.

## Architecture

```
                            +------------------------+
   browser / agent --HTTP-->|  your origin           |
                            |                        |
                            |  /.well-known/act.json |  parent (routing) manifest, static
                            |                        |
                            |  /marketing/*          |  static dist/marketing/ files
                            |    .well-known/...     |    (public, anon-readable)
                            |    act/index.json      |    Cache-Control: public, max-age=300
                            |    act/index.ndjson    |
                            |    act/nodes/*.json    |
                            |    act/search.json     |
                            |                        |
                            |  /app/.well-known/...  |  runtime mount (cookie + bearer)
                            |  /app/act/index.json   |    identity-scoped index
                            |  /app/act/n/{id}       |    tenant-scoped node, ETag
                            |  /app/act/sub/{id}     |    subtree (depth-bounded)
                            +------------------------+
                                       |
                                       v
                            +------------------------+
   MCP-capable agent <----->|  @act-spec/mcp-bridge  |
                            |   act://<host>/...     |  resources, not tools
                            |   IdentityBridge maps  |  MCP auth -> ACT headers
                            |   MCP -> runtime/static|
                            +------------------------+
```

The bridge surfaces ACT trees as **MCP resources** (`ListResources` / `ReadResource`), not as MCP tools. Anonymous MCP sessions see only the marketing slice; sessions with a bearer token in `mcpContext.auth.token` see marketing + their tenant's app tree. The auth boundary is enforced by `runtime.resolveNode` — a layer the bridge does not bypass.

## Prerequisites

- Node >= 20.18
- pnpm >= 10
- An ACT site to point at — this example ships its own marketing markdown corpus and an in-memory tenant fixture, so you can run it standalone.

## Quickstart

From the repository root:

```sh
pnpm install
pnpm -F @act-spec/example-hybrid-static-runtime-mcp build:marketing
pnpm -F @act-spec/example-hybrid-static-runtime-mcp start
```

`start` boots a Node HTTP server on `http://127.0.0.1:3706` (override with `PORT=…`).

Verify the static parent manifest:

```sh
curl -i http://127.0.0.1:3706/.well-known/act.json
```

Verify the static marketing mount:

```sh
curl -i http://127.0.0.1:3706/marketing/.well-known/act.json
curl -i http://127.0.0.1:3706/marketing/act/index.json
curl -i http://127.0.0.1:3706/marketing/act/nodes/marketing/landing.json
```

Verify the runtime app mount (bearer-token auth, two-principal fixture):

```sh
# anonymous → 401 with WWW-Authenticate
curl -i http://127.0.0.1:3706/app/.well-known/act.json

# tenant A
curl -i -H 'Authorization: Bearer bearer-token-A' \
  http://127.0.0.1:3706/app/act/index.json
curl -i -H 'Authorization: Bearer bearer-token-A' \
  http://127.0.0.1:3706/app/act/n/doc/acme-roadmap-2026

# tenant B sees only its own docs; cross-tenant reads collapse to a
# byte-identical 404 vs a non-existent id
curl -i -H 'Authorization: Bearer bearer-token-B' \
  http://127.0.0.1:3706/app/act/n/doc/acme-roadmap-2026
```

Exercise the MCP bridge:

```sh
pnpm -F @act-spec/example-hybrid-static-runtime-mcp probe:mcp
```

This script constructs the bridge with both mounts, runs the bridge's enumeration probe, and asserts the surfaced URI set matches the expected union of static + runtime ids. It runs the bridge in-process (no transport); see "Wiring the bridge to a transport" below for the production posture.

Run the full conformance gate (build → byte-equality re-build → validator → two-principal probe → MCP probe):

```sh
pnpm -F @act-spec/example-hybrid-static-runtime-mcp conformance
```

## How it's wired

File-by-file walkthrough of the load-bearing pieces:

- `marketing/content/*.md` — the markdown corpus (landing, about, pricing). Anything you'd put in a Docusaurus / Astro `docs/` directory works.
- `scripts/build-marketing.ts` — drives `runBuild` from `@act-spec/cli` over the markdown corpus through `@act-spec/adapter-markdown`, then layers the Plus-tier surface (`index.ndjson`, `search.json`, `subtree_url_template`) onto the emitted manifest. Also writes the parent routing manifest at `dist/.well-known/act.json` declaring both mounts.
- `src/lib/act-runtime/index.ts` — the `ActRuntime` for the app mount. `resolveManifest` / `resolveIndex` / `resolveNode` / `resolveSubtree` enforce identity, scope to tenant, derive ETags via `defaultEtagComputer`, and carry one optional public branch (`PUBLIC_LANDING_ID`).
- `src/lib/act-host/identity.ts` — the `IdentityResolver`: validates `Cookie` and `Authorization: Bearer …` headers via `src/lib/auth.ts` and returns `{ kind: 'principal', key: userId }` or `{ kind: 'anonymous' }`.
- `src/lib/act-host/tenant.ts` — the `TenantResolver`: maps a principal to its tenant key.
- `src/app/act-mount.ts` — wires `defineActMount` from `@act-spec/runtime-next` with the runtime, identity resolver, tenant resolver, and `basePath: '/app'`. Returns the canonical App Router-style handler set (`manifest`, `index`, `node`, `subtree`).
- `src/app/server.ts` — the unified Node HTTP listener. Routes `/marketing/*` to static files in `dist/marketing/`, routes `/app/*` to the SDK's mount handlers, and serves the parent manifest from `dist/.well-known/act.json`. This is the file you'd replace with Vercel routing or CloudFront behaviors in production.
- `scripts/probe-mcp.ts` — constructs `createActMcpBridge` from `@act-spec/mcp-bridge` with a two-mount config (static marketing + runtime app), wires an `IdentityBridge` mapping MCP-side `auth.token` to a bearer header, and runs `runMcpEnumerationProbe` to verify the surfaced URI set.

There is no `Dockerfile` / `wrangler.toml` / `vercel.json` in the example — it is a plain Node listener so the conformance gate can run in-process. Production deployment notes below.

## Wiring the bridge to a transport

The `probe-mcp.ts` script exercises the bridge directly (no transport). To expose it to a real MCP client, attach a transport. The bridge instance returned by `createActMcpBridge` carries an `mcpServer` from `@modelcontextprotocol/sdk`. Two common shapes:

- **stdio** — for local agents (Claude Desktop, mcp-inspector). Spawn a Node entrypoint that builds the bridge and connects `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. The bridge config stays identical; only the transport changes.
- **HTTP / SSE** — for remote agents. Mount the SDK's `SSEServerTransport` (or the Streamable HTTP transport in newer SDK versions) on a route like `/mcp` and let the same Node listener that serves the static + runtime mounts also handle MCP traffic. This is what "single deployment unit" means in practice.

This example does not ship the transport-attached entrypoint — it is a reference for the bridge construction shape. See `@act-spec/mcp-bridge`'s README for the full transport options.

## Production deployment notes

- **Cache headers / CDN.** The static marketing files are emitted with `Cache-Control: public, max-age=300, must-revalidate`. Front the static prefix with a CDN; do **not** cache the runtime mount or the per-tenant index. The runtime mount's ETags are identity-scoped, so any shared cache must vary on the auth principal.
- **Rate limiting.** Self-hosting removes the hosted server's shared limit; rate-limit at your origin or CDN. Anonymous traffic on the marketing mount can be aggressive; authenticated app-mount traffic should be limited per-principal.
- **HTTPS / CORS.** Terminate TLS at your origin or CDN. CORS posture is adopter-defined; the spec's wire-format security guidance lands in `spec/v0.2/wire-format/security.md` (in flight). For now: same-origin or an explicit allowlist.
- **Auth.** This example validates bearer tokens against an in-memory map (`src/lib/db.ts`) — replace with your session store. The `IdentityResolver` interface is the only contract: return `{ kind: 'principal', key }` or `{ kind: 'anonymous' }`. Cookie auth works the same way; the resolver reads `Cookie` and consults your session store.
- **Determinism.** The build is byte-deterministic across consecutive runs (the conformance script asserts this). If you fork the build script, preserve that property — agents and CDNs benefit from stable hashes.

## Adding custom MCP resources

The bridge exposes ACT nodes as MCP resources, not tools. To add a custom resource (e.g. a synthesised pricing summary not present in the ACT tree), wrap or extend the `mcpServer` instance returned by `createActMcpBridge` with an additional `setRequestHandler` for the affected schema, taking care not to shadow the bridge's `act://` URI handling.

To add custom MCP **tools** instead — the standard MCP idiom for verbs like `act_get_pricing` — register them on the same `mcpServer` via `ListToolsRequestSchema` / `CallToolRequestSchema`. A minimal sketch (not shipped in the example):

```ts
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

bridge.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'act_get_pricing',
      description: 'Return current Acme pricing tiers.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}));

bridge.mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'act_get_pricing') {
    return { content: [{ type: 'text', text: JSON.stringify(getPricingTiers()) }] };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});
```

Custom tools are how this template extends past what the hosted `mcp.act-spec.org` can offer.

## Testing your MCP server

The example's `probe:mcp` script is the in-process integration test — run it after any change to the bridge, runtime, or identity wiring:

```sh
pnpm -F @act-spec/example-hybrid-static-runtime-mcp probe:mcp
```

Once you wire a transport, point an MCP client at it. The MCP Inspector (`@modelcontextprotocol/inspector`) is the canonical interactive client — it supports stdio and SSE transports and lets you list resources, read resources, and exercise any custom tools you register.

## Conformance

```sh
pnpm -F @act-spec/example-hybrid-static-runtime-mcp conformance
```

The chain runs five gates:

1. Build the marketing static tree + parent routing manifest.
2. Re-build and assert byte-equality (deterministic-build invariant).
3. Validator runtime-walk against the parent manifest and each leaf manifest.
4. Two-principal probe on the runtime mount: per-tenant ETag scoping + cross-tenant byte-identical 404s.
5. MCP enumeration probe: surfaced URI set equals the expected union of static + runtime ids; per-mount manifests surfaced; auth boundary verified.

See `spec/v0.2/wire-format/conformance.md` for the full conformance posture.

## Troubleshooting

- **Port already in use.** `start` listens on 3706 by default. Override with `PORT=…`. Stop any prior `start` invocation; `pnpm dlx kill-port 3706` clears stragglers.
- **Marketing manifest 404.** Run `build:marketing` before `start` — the static files live under `dist/marketing/` and the parent manifest under `dist/.well-known/`. They are regenerated from scratch on every build.
- **App mount returns 401 even with a bearer.** The example's bearer fixture is `bearer-token-A` (tenant-acme) and `bearer-token-B` (tenant-beta), defined in `src/lib/db.ts`. Custom tokens require seeding that file (or replacing it with a real session store).
- **Cross-tenant request returns 404, not 403.** This is intentional: the runtime collapses cross-tenant access to a byte-identical 404 vs a non-existent id, so existence is not leaked across tenants. See the two-principal probe.
- **MCP probe reports unexpected URIs.** The bridge's anonymous enumeration sees the static mount fully but resolves the runtime mount under an anonymous context — which the resolver answers with `auth_required`. The probe expects marketing-only node URIs at the anonymous layer; tenant-scoped URIs are exercised through the authenticated path. If you change the runtime resolver's anonymous behaviour, update the probe's expectations.
- **Build is non-deterministic.** Re-runs must produce byte-identical output under `dist/`. The most common cause is a wall-clock timestamp leaking into a manifest field; the example pins `generated_at` to a fixed value (see `scripts/build-marketing.ts`).

## See also

- `packages/mcp-server/README.md` — the universal MCP server (`@act-spec/mcp-server`) for the hosted-style pattern; point it at any ACT URL.
- `packages/mcp-bridge/README.md` — the bridge library this example uses; transport options, multi-mount construction, URI helpers.
- `spec/v0.2/` — the v0.2 wire format and conformance spec.
- `mcp.act-spec.org` — the hosted MCP server, for sites that don't need to self-host.

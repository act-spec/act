---
title: Runtime SDK
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Runtime SDK

> An ACT producer may serve its tree from static files or from a runtime
> SDK that synthesizes the manifest, index, and per-node responses on
> demand. This document defines the runtime contract: the resolver
> interface every host application registers, the request/response
> lifecycle, the freshness model (ETag and conditional GET), the
> identity and tenancy hooks for authenticated trees, the per-framework
> reference SDKs, and the conformance requirements a runtime producer
> MUST satisfy.

## Why runtime mode

A static producer is the simplest deployment shape: build a directory
of JSON files, host them on a CDN, declare `delivery: "static"`. A
runtime producer is necessary when:

- the tree is **large** (millions of nodes) and rebuilding the static
  fileset on every content change is impractical,
- content is **per-tenant or per-identity** (a SaaS workspace where
  each customer sees a different tree),
- the source of truth is a **live database, search index, or external
  API** that has no natural static export,
- delivery is **gated by authentication** and the tree must be
  served only after credential evaluation.

A runtime producer declares `delivery: "runtime"` in its manifest. The
wire format consumed by clients is identical to the static profile —
the same envelopes pass the same schema validation. The runtime SDK
exists to translate between the application's domain (database rows,
CMS pages, tenant scopes, principal identities) and the wire format
clients see.

The runtime contract is orthogonal to the conformance level. A Core
runtime is permitted; a Strict static producer is permitted. A runtime
producer MAY be public (anonymous-readable) or auth-gated; the level
is independent of the auth posture.

## The resolver interface

A host application registers an `ActRuntime` object with the SDK. The
runtime exposes a small set of resolver methods, each returning an
`Outcome<T>` discriminated union. Resolvers are framework-agnostic:
they receive a normalized request value object and return a typed
result; the leaf SDK (Next.js, Express, generic fetch handler) wires
each resolver to a framework-native HTTP route.

```ts
interface ActRuntime {
  resolveManifest(req: ActRequest, ctx: ActContext): Promise<Outcome<Manifest>>;
  resolveIndex(req: ActRequest, ctx: ActContext): Promise<Outcome<Index>>;
  resolveNode(req: ActRequest, ctx: ActContext, args: { id: string }): Promise<Outcome<Node>>;

  // Standard-tier and above.
  resolveSubtree?(req: ActRequest, ctx: ActContext, args: { id: string; depth: number }): Promise<Outcome<Subtree>>;

  // Strict-tier (NDJSON sharding and search advertisement).
  resolveIndexNdjson?(req: ActRequest, ctx: ActContext): Promise<Outcome<AsyncIterable<IndexEntry>>>;
  resolveSearch?(req: ActRequest, ctx: ActContext, args: { query: string }): Promise<Outcome<unknown>>;
}

type Outcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "auth_required" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "validation"; details?: Record<string, unknown> }
  | { kind: "internal"; details?: Record<string, unknown> };
```

A resolver MUST return one of the discriminator values listed above.
A resolver throwing an uncaught exception MUST be mapped by the SDK to
`{ kind: "internal" }`; the exception's message MUST NOT propagate to
the response body.

`Manifest`, `Index`, `Node`, `Subtree`, and `IndexEntry` are the
TypeScript types corresponding to the envelope schemas in
[wire-format/manifest.md](./wire-format/manifest.md),
[wire-format/index.md](./wire-format/index.md), and
[wire-format/node.md](./wire-format/node.md).

### Construction-time capability gate

The SDK's construction function MUST validate, at startup, that the
registered resolver set is consistent with the manifest's declared
`conformance.level`:

- Level `"core"` requires `resolveManifest`, `resolveIndex`, and
  `resolveNode`.
- Level `"standard"` additionally requires `resolveSubtree` AND a
  populated `subtree_url_template` on the manifest.
- Level `"strict"` additionally requires `resolveIndexNdjson` AND
  `resolveSearch`, with `index_ndjson_url` AND `search_url_template`
  populated on the manifest.

A mismatch MUST throw a configuration error before any request is
served. The check MUST NOT be deferred to request time.

The SDK MUST also validate that `auth.schemes` declarations in the
manifest are consistent with the rest of the manifest: if
`auth.schemes` includes `"oauth2"`, the manifest MUST declare
`auth.oauth2.{authorization_endpoint, token_endpoint, scopes_supported}`.
Inconsistent manifests MUST be rejected at construction.

## Request lifecycle

Every ACT request MUST traverse the SDK's dispatch pipeline in this
order:

1. **Normalize.** Convert the framework-native request into a
   common `ActRequest` value object (URL, headers, cookies).
2. **Validate `act_version`** if the request carries one. Reject
   requests claiming a higher MAJOR than the SDK supports — the
   rejection is bounded; no body parsing.
3. **Resolve identity** via the registered `IdentityResolver`.
4. **Resolve tenant** via the registered `TenantResolver` — only
   when identity is non-anonymous and the manifest declares
   tenanting; otherwise tenant is `null`.
5. **Honor `If-None-Match`** by computing or looking up the cached
   ETag for the requested resource and emitting `304 Not Modified`
   on match.
6. **Invoke the appropriate resolver.**
7. **Map the `Outcome<T>`** to an HTTP response with the correct
   status code, error envelope (on failure paths), and body.
8. **Apply caching headers** per the freshness model below.
9. **Apply the discovery hand-off `Link` header.**
10. **Log the event** via the registered logger, never including
    PII or credentials.

The pipeline MUST be deterministic. Reordering steps (e.g., resolving
the resource before checking `If-None-Match`) is non-conformant.

## Identity and tenancy

A host application MUST register an `IdentityResolver` of shape
`(req: ActRequest) => Promise<Identity>`:

```ts
type Identity =
  | { kind: "anonymous" }
  | { kind: "principal"; key: string }
  | { kind: "auth_required"; reason?: "missing" | "expired" | "invalid" };
```

The principal `key` MUST be a stable identity (a user UUID, a
principal ID); it MUST NOT be a session token, a JWT, or any value
that rotates within the principal's lifetime. The `key` is used as the
identity input to ETag derivation and to caching headers; instability
in the key produces ETag flapping and cache misses.

The `IdentityResolver` MUST NOT throw on missing credentials — it
returns `{ kind: "auth_required" }`. It MAY throw on infrastructure
errors (the identity provider is unreachable); the SDK maps such
throws to `{ kind: "internal" }`.

A host MAY register a `TenantResolver` of shape
`(req, identity) => Promise<Tenant>` where `Tenant` is
`{ kind: "single" }` for non-tenanted deployments or
`{ kind: "scoped"; key: string }`. The same stability rules apply to
the tenant `key`.

## ETag freshness and 304

Runtime ETag derivation differs from the static recipe in
[wire-format/etag.md](./wire-format/etag.md): the runtime hash input
includes the resolved identity and tenant, ensuring that two
principals viewing the same node receive distinct ETags.

The default runtime ETag computer MUST:

1. Construct the input triple `{ identity, payload, tenant }` where
   `identity` is the principal key (or JSON `null` for anonymous),
   `payload` is the envelope minus its `etag` field, and `tenant` is
   the tenant key (or JSON `null` for `single`).
2. JCS-canonicalize the triple per RFC 8785.
3. SHA-256 the canonical bytes.
4. Encode as base64url without padding.
5. Truncate to 22 characters and prepend `s256:`.

A host MAY supply a custom ETag computer; the override MUST be
deterministic given the same input triple, MUST NOT mix request-local
data into the computation (timestamps, request IDs, nonces, replica
IDs), and MUST return a value matching the value-shape regex
`^[a-z0-9]+:[A-Za-z0-9_-]+$`.

Before invoking a resolver, the SDK MUST compute (or recompute) the
resource's current ETag. If the request carries `If-None-Match`
matching the current value byte-for-byte, the SDK MUST emit `304 Not
Modified` with the `ETag` header echoed and no body. On `200`, the
SDK MUST emit the `ETag` header. The header value MUST NOT carry the
`W/` weak-validator prefix; ACT ETags are strong validators.

## Caching headers

The SDK MUST set `Cache-Control` based on the resolved identity:

| Identity | Tenant | `Cache-Control` | `Vary` |
|---|---|---|---|
| principal | any | `private, must-revalidate` | `Authorization` (or `Cookie` per primary scheme) |
| anonymous | single | `public, max-age=<seconds>` (default 0) | (none) |
| anonymous | scoped | `public, max-age=<seconds>` | tenant-disambiguating header per host config |

A host MAY override per-endpoint via configuration. The SDK MUST NOT
emit `Cache-Control: private` on responses derived with anonymous
identity — it would falsely scope a public response.

## Status code and error envelope mapping

The SDK MUST map each `Outcome<T>` discriminator to exactly one HTTP
status code and exactly one error envelope:

| Outcome | Status | `error.code` | Notes |
|---|---|---|---|
| `ok` | 200 (or 304 on ETag match) | n/a | Body is the envelope. |
| `auth_required` | 401 | `auth_required` | One `WWW-Authenticate` header per advertised scheme. |
| `not_found` | 404 | `not_found` | Same envelope used for absent and forbidden — see below. |
| `rate_limited` | 429 | `rate_limited` | `Retry-After: <seconds>`. |
| `validation` | 4xx (400 default; 406 for content-negotiation refusal) | `validation` | `details` propagated subject to redaction. |
| `internal` | 5xx (500 default) | `internal` | `details` MAY be omitted; if present MUST NOT include stack traces. |

### Existence non-leak

The 404 path MUST be a single code path used for both genuinely
absent resources AND resources that exist but are not visible to the
identity. The SDK MUST emit byte-for-byte identical responses for the
two cases, modulo opaque non-identity-correlated request IDs.
Specifically the SDK MUST NOT vary `Cache-Control`, `error.message`,
`Content-Length`, or response timing in a way correlated with the
distinction.

A 401 is reserved for the case where authentication is missing or
invalid at the scope, NOT for a per-resource access denial. See
[wire-format/security.md](./wire-format/security.md) for the threat
model.

### Auth challenges

The SDK MUST emit one `WWW-Authenticate` header per advertised
`auth.schemes` entry on every 401, in the order they appear in the
manifest. The SDK MUST expose a public helper `buildAuthChallenges`
that constructs the header values from the manifest. The set of
headers MUST be a function of the manifest — NOT of the request URL.

### Error message safety

`error.message` is a fixed, code-specific human-readable string. The
SDK MUST NOT propagate free-form text from the resolver into
`error.message`. Default messages per code:

- `auth_required` → `"Authentication required to access this resource."`
- `not_found` → `"The requested resource is not available."`
- `rate_limited` → `"Too many requests; retry after the indicated interval."`
- `validation` → `"The request was rejected by validation."`
- `internal` → `"An internal error occurred."`

A host MAY override these via configuration; the SDK MUST validate the
override does not contain raw braces, angle brackets, or other
character classes indicative of unredacted source data.

## Content negotiation

The SDK MUST honor `Accept` for the index endpoint:

- `Accept: application/act-index+json` (or absent, or `*/*`) → returns
  the JSON index variant.
- `Accept: application/act-index+json; profile=ndjson` → returns the
  NDJSON index variant. This routes to `resolveIndexNdjson`; if the
  resolver is not registered the SDK MUST return 406 Not Acceptable
  with `error.code: "validation"`.

For other endpoints (manifest, node, subtree, search), `Accept` is
informational; the SDK serves the canonical envelope regardless. The
SDK MUST NOT serve a different envelope shape based on `Accept` —
content negotiation in v0.2 is restricted to the index NDJSON / JSON
pair.

## Discovery hand-off

The SDK MUST emit the discovery hand-off `Link` header on every
authenticated response from an ACT endpoint (every 200, 304, 401,
404, 429, and 5xx). The header value is:

```
Link: </.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"
```

When the SDK is mounted at a non-root `basePath`, the path is prefixed
accordingly. The SDK MAY expose a public middleware helper for the
host to mount on its non-ACT endpoints; the helper enforces the
header on every authenticated response per
[wire-format/security.md](./wire-format/security.md).

## Mountability

The SDK MUST be mountable at any URL path. The construction function
accepts a `basePath` configuration (default `""`) that is prepended to
every advertised URL in the manifest and stripped from incoming
request paths before matching. This makes the SDK composable with a
parent manifest's `mounts` declaration in
[wire-format/manifest.md](./wire-format/manifest.md). Leaf SDKs MUST
NOT hard-code the well-known path; the path is configurable but
defaults to `/.well-known/act.json`.

## Observability

The SDK MUST accept an opaque `Logger` of shape
`{ event: (e: ActLogEvent) => void }`. The SDK MUST NOT pass the
Logger:

- request URLs whose path components carry auth-scoped identifiers
  (paths containing tenant IDs, principal IDs, or session
  identifiers) — the SDK passes a redacted form,
- identity tokens, session IDs, raw header values (the SDK passes a
  header summary: scheme names present, but not values),
- resolver-returned envelope content beyond `{ id, type }` when the
  envelope is identity-scoped,
- error stack traces.

The Logger contract is the project's PII firewall for observability.
The SDK MUST emit Logger events for at minimum: request received,
identity resolved, tenant resolved, ETag match, resolver invoked,
response sent, and error.

## Reference SDKs

The TypeScript reference set ships in v0.2.

### Next.js

`@act-spec/runtime-next` is the Next.js binding. It provides a
factory `createActHandlers(config)` returning an object with
`{ GET, POST, OPTIONS }` route handlers compatible with the Next.js
App Router file-route convention. The host mounts the handlers under:

- `app/.well-known/act.json/route.ts` (manifest),
- `app/act/index.json/route.ts` (index),
- `app/act/n/[...id]/route.ts` (node — catch-all to admit IDs
  containing `/`),
- `app/act/sub/[...id]/route.ts` (subtree, when at Standard or
  higher).

The SDK supports both Edge and Node.js runtimes with parity. The
`basePath` is configured at construction; the file routes obtain the
SDK's normalized handler from a single shared `ActRuntime`.

The Next.js SDK MAY also be used in the Pages Router via API route
adapters; App Router is the canonical integration.

### Express

`@act-spec/runtime-express` is the Express binding. The factory
`createActRouter(config)` returns an Express `Router` instance:

```ts
import express from "express";
import { createActRouter } from "@act-spec/runtime-express";

const app = express();
app.use(createActRouter({ runtime, basePath: "" }));
app.listen(3000);
```

The router exposes:

- `GET /.well-known/act.json` (manifest),
- `GET /act/index.json` (index),
- `GET /act/n/:id(*)` (node, with the `(*)` regex modifier admitting
  IDs containing `/`),
- `GET /act/sub/:id(*)` (subtree).

The router can be mounted under a parent prefix via standard
`app.use(prefix, router)` — the SDK's `basePath` MUST match.

### Generic fetch handler

`@act-spec/runtime-core` is the framework-neutral binding. The
factory `createActFetchHandler(config)` returns a WHATWG-compatible
`(req: Request) => Promise<Response>` handler usable in any
fetch-shaped runtime: Cloudflare Workers, Deno Deploy, Bun,
edge-runtime, Hono, Fastify (via adapter), Vercel Functions, AWS
Lambda Function URLs.

```ts
import { createActFetchHandler } from "@act-spec/runtime-core";

const handler = createActFetchHandler({ runtime, basePath: "" });
export default { fetch: handler };  // Cloudflare Worker
```

### Spec-only mappings

`@act-spec/runtime-fastapi` (Python / FastAPI) and
`@act-spec/runtime-rails` (Ruby / Rails) are spec-only mappings in
v0.2 — the contract above defines what a conformant FastAPI or Rails
binding MUST satisfy, but no first-party implementation ships in
v0.2. Community implementations are welcome; conformance is
enforceable via the validator at [tooling.md](./tooling.md).

## Examples

### Minimum-conformant Core deployment (generic fetch)

```ts
import { createActFetchHandler } from "@act-spec/runtime-core";

const runtime = {
  async resolveManifest() {
    return {
      kind: "ok",
      value: {
        site: { name: "Example" },
        index_url: "/act/index.json",
        node_url_template: "/act/n/{id}.json",
        conformance: { level: "core" },
        delivery: "runtime",
      },
    };
  },
  async resolveIndex() {
    return { kind: "ok", value: { entries: [/* ... */] } };
  },
  async resolveNode(_req, _ctx, { id }) {
    const node = await db.findNode(id);
    if (!node) return { kind: "not_found" };
    return { kind: "ok", value: node };
  },
};

export default {
  fetch: createActFetchHandler({ runtime, basePath: "" }),
};
```

### Authenticated runtime with identity propagation (Next.js)

```ts
// app/.well-known/act.json/route.ts (and similar for the other endpoints)
import { createActHandlers } from "@act-spec/runtime-next";
import { runtime } from "@/act-runtime";

const handlers = createActHandlers({
  runtime,
  basePath: "",
  identity: async (req) => {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return { kind: "auth_required", reason: "missing" };
    const principal = await verifyJwt(token);
    if (!principal) return { kind: "auth_required", reason: "invalid" };
    return { kind: "principal", key: principal.userId };
  },
  tenant: async (_req, identity) => {
    if (identity.kind !== "principal") return { kind: "single" };
    const tenantId = await lookupTenant(identity.key);
    return { kind: "scoped", key: tenantId };
  },
});

export const { GET, OPTIONS } = handlers;
```

The manifest's `auth.schemes` declares `["oauth2"]`; on an
unauthenticated request the SDK emits 401 with one `WWW-Authenticate:
Bearer realm="...", error="invalid_token", scope="...",
authorization_uri="..."` header derived from the manifest's
`auth.oauth2` block.

### Hybrid mount under a parent manifest

A static-profile parent manifest declares:

```json
{
  "delivery": "static",
  "mounts": [
    { "prefix": "/app/", "delivery": "runtime", "manifest_url": "https://app.example.com/.well-known/act.json" }
  ]
}
```

The runtime SDK at `app.example.com` is configured with `basePath:
""` and serves its own manifest at the well-known path. Consumers
walking the parent see the static tree under most prefixes and the
runtime tree under `/app/`. Cross-origin trust evaluation per
[wire-format/security.md](./wire-format/security.md) applies.

## Conformance

| Requirement | Core | Standard | Strict |
|---|---|---|---|
| `resolveManifest`, `resolveIndex`, `resolveNode` registered | MUST | MUST | MUST |
| `resolveSubtree` registered AND `subtree_url_template` set | OPTIONAL | MUST | MUST |
| `resolveIndexNdjson` registered AND `index_ndjson_url` set | OPTIONAL | OPTIONAL | MUST when sharded |
| `resolveSearch` registered AND `search_url_template` set | OPTIONAL | OPTIONAL | OPTIONAL |
| `act_version` injected on every envelope | MUST | MUST | MUST |
| `delivery: "runtime"` on the manifest | MUST | MUST | MUST |
| 304 on `If-None-Match` match | MUST | MUST | MUST |
| Strong `ETag` header (no `W/` prefix) | MUST | MUST | MUST |
| 401 with one `WWW-Authenticate` per scheme on auth failure | MUST | MUST | MUST |
| Existence non-leak (byte-identical 404 for absent vs forbidden) | MUST | MUST | MUST |
| Discovery hand-off `Link` header on every ACT response | MUST | MUST | MUST |
| Bounded `act_version` rejection (no body parsing) | MUST | MUST | MUST |
| Cache-Control reflects identity (private/public) | MUST | MUST | MUST |
| Logger MUST NOT receive PII or credentials | MUST | MUST | MUST |
| Mountable under arbitrary `basePath` | MUST | MUST | MUST |

A runtime producer MUST NOT advertise a capability whose underlying
resolver is not registered. A runtime producer MUST NOT serve a
manifest with `delivery: "static"`; the mismatch is a startup
configuration error.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

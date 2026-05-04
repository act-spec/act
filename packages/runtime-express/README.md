# @act-spec/runtime-express

Express runtime SDK for [ACT (Agent Content Tree)](https://github.com/act-spec/act).

This package is a thin **leaf adapter** over [`@act-spec/runtime-core`](../runtime-core).
It binds runtime-core's framework-neutral resolver / dispatch contract onto
Express's Router / middleware idiom, adding only the framework-specific
glue: catch-all `:id(*)` routing for IDs containing `/`, request
normalization (`req.headers`, `req.cookies`, `req.originalUrl`), the
`app.use(prefix, router)` mount pattern for hybrid deployments, and an
Express-flavored `actLinkHeaderMiddleware` for the discovery hand-off
`Link` header on non-ACT routes.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/runtime-express": "workspace:*" } }
```

`express` is a `peerDependencies` entry (`>=4.17 <6`) so consumers
control the version. The SDK does not import Express at runtime — its
public surface uses minimal structural interfaces that are
type-compatible with `@types/express`'s `Request` / `Response` /
`Router` / `RequestHandler`.

## Quick start (Core)

```ts
// src/server.ts
import express from 'express';
import session from 'express-session';
import { actRouter } from '@act-spec/runtime-express';

const app = express();
app.use(session({ secret: process.env.SESSION_SECRET!, resave: false, saveUninitialized: false }));

app.use(
  '/',
  actRouter({
    manifest: {
      act_version: '0.1',
      site: { name: 'Acme Workspace' },
      delivery: 'runtime',
      conformance: { level: 'core' },
      auth: { schemes: ['cookie', 'bearer'] },
      index_url: '/act/index.json',
      node_url_template: '/act/n/{id}',
    },
    runtime: {
      async resolveManifest(req, ctx) { /* ... */ },
      async resolveIndex(req, ctx) { /* ... */ },
      async resolveNode(req, ctx, { id }) { /* ... */ },
    },
    identityResolver: async (actReq) => {
      const sid = actReq.getCookie('connect.sid');
      if (!sid) return { kind: 'auth_required', reason: 'missing' };
      const session = await sessionStore.get(sid);
      if (!session?.userId) return { kind: 'auth_required', reason: 'invalid' };
      return { kind: 'principal', key: session.userId };
    },
    tenantResolver: async (actReq, identity) => {
      if (identity.kind !== 'principal') return { kind: 'single' };
      const user = await db.users.findUnique({ where: { id: identity.key } });
      return { kind: 'scoped', key: user!.tenantId };
    },
  }),
);

app.listen(3000);
```

The router handles `act_version` injection, ETag computation, 401 / 404
mapping, the discovery hand-off `Link` header, and content negotiation —
the host writes resolution logic only.

## Routes registered

The Router carries the following routes (relative to the mount point):

| Route | Endpoint | Level |
|---|---|---|
| `GET /.well-known/act.json` | manifest | Core |
| `GET /act/index.json` | index | Core |
| `GET /act/n/:id(*)` | node (IDs MAY contain `/`) | Core |
| `GET /act/sub/:id(*)` | subtree | Standard / Plus |
| `GET /act/index.ndjson` | NDJSON-streamed index | Plus |
| `GET /act/search?q={query}` | search | Plus |

The `:id(*)` catch-all form is **mandatory** for nodes and subtrees — IDs
may contain `/`, and the single-segment `:id` form would silently truncate
them.

## Discovery hand-off Link header

The SDK emits the discovery `Link` header on every ACT-endpoint response
automatically. To emit the header on **non-ACT** routes (the host
application's HTML pages, JSON APIs), mount the
`actLinkHeaderMiddleware` globally:

```ts
import { actLinkHeaderMiddleware } from '@act-spec/runtime-express';

app.use(
  actLinkHeaderMiddleware({
    isAuthenticated: (req) => !!req.session?.userId,
  }),
);
```

The `isAuthenticated` predicate is the host's responsibility — keep it
fast (cookie / header presence check), NOT a full identity verification.

## Hybrid mounts

An Express app MAY participate in a parent manifest's `mounts` array
by setting `basePath` AND mounting at the matching path:

```ts
app.use(
  '/app',
  actRouter({
    manifest: { /* ... conformance: { level: 'standard' }, ... */ },
    basePath: '/app',
    runtime: { /* ... */ },
    identityResolver: /* ... */,
  }),
);
```

The served manifest then advertises URLs prefixed with `/app`. The
parent manifest at `/.well-known/act.json` (typically served by a
sibling static-export build) declares the mount at `prefix: "/app"`.

The `basePath` MUST equal the path Express strips in
`app.use(prefix, router)`. Mismatch results in incorrect advertised
URLs; the test fixture matrix documents the requirement.

## Two-principal probe (cross-tenant non-disclosure)

This package wires the **mandatory** two-principal probe from
[`@act-spec/runtime-core/test-utils`](../runtime-core/src/test-utils)
against an in-process synthetic resolver. The probe verifies that:

1. Each principal can resolve their own visible nodes (sanity baseline).
2. Cross-tenant requests (principal A asks for principal B's node, and
   vice versa) return 404.
3. The cross-tenant 404 is **byte-equivalent** to an absent-node 404
   (status, body, every header — `Content-Type`, `Cache-Control`,
   `Link`).
4. The discovery `Link` header is present and identical across both 404
   paths (does not leak tenant identity in error cases).

The probe is in `src/probe.test.ts` and runs as part of `pnpm test`. It
is a **CI-mandatory test**; do not skip and do not weaken.

## Ad-hoc middleware (escape hatch)

For hosts that need bespoke routing (a single endpoint behind a custom
middleware chain), use `createActMiddleware`:

```ts
import { createActMiddleware } from '@act-spec/runtime-express';

const opts = { /* same as actRouter */ };
app.get('/custom-path/manifest', createActMiddleware(opts, 'manifest'));
app.get('/custom-path/index', createActMiddleware(opts, 'index'));
```

Multiple `createActMiddleware` calls with the **same `opts` reference**
share one `ActRuntimeInstance` (memoized via WeakMap).

## Conformance

`pnpm -F @act-spec/runtime-express conformance` runs `@act-spec/validator`
in `validateSite` runtime-walk mode against an in-process Standard
mount via a synthetic fetcher (no real HTTP server). Pass criterion: 0
gaps; achieved level == declared level.

## NDJSON streaming and reverse proxies

For Plus deployments, the `/act/index.ndjson` route streams via
`res.write()` per line. Reverse proxies in front of your Express app
(nginx, Caddy) MUST be configured to disable buffering on
`/act/index.ndjson` so clients see lines incrementally.

```nginx
location /act/index.ndjson {
  proxy_buffering off;
  proxy_pass http://app;
}
```

## License

Apache-2.0. See [LICENSE](../../LICENSE).

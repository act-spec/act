# @act-spec/runtime-next

Next.js runtime SDK for [ACT (Agent Content Tree)](https://github.com/act-spec/act).

This package is a thin **leaf adapter** over [`@act-spec/runtime-core`](../runtime-core).
It binds runtime-core's framework-neutral resolver / dispatch contract
onto Next.js's App Router (and a Pages Router escape hatch), adding only
the framework-specific glue: catch-all `[...id]` segment joining, request
normalization (`Request.cookies`), the App Router file layout, and a
`middleware.ts`-shaped helper for the discovery hand-off `Link` header on
non-ACT routes.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/runtime-next": "workspace:*" } }
```

`next` is a `peerDependencies` entry (`>=14.2 <16`) so consumers control
the version. The SDK does not import Next at runtime — handlers are
WHATWG `(req: Request, ctx) => Promise<Response>` functions, compatible
with both the Node.js Runtime and the Edge Runtime.

## Quick start (Core)

```ts
// app/act-mount.ts
import { defineActMount } from '@act-spec/runtime-next';

export const actMount = defineActMount({
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
  identityResolver: async (req) => {
    const principal = await yourAuth(req);
    if (!principal) return { kind: 'auth_required', reason: 'missing' };
    return { kind: 'principal', key: principal.id };
  },
  tenantResolver: async (req, identity) => ({ kind: 'scoped', key: identity.kind === 'principal' ? identity.key : 'default' }),
});
```

```ts
// app/.well-known/act.json/route.ts
import { actMount } from '@/app/act-mount';
export const GET = actMount.manifest;
```

```ts
// app/act/index.json/route.ts
import { actMount } from '@/app/act-mount';
export const GET = actMount.index;
```

```ts
// app/act/n/[...id]/route.ts
import { actMount } from '@/app/act-mount';
export const GET = actMount.node;
```

The catch-all `[...id]` segment is **mandatory** for nodes and subtrees —
IDs may contain `/`, and the single-segment `[id]` form would silently
truncate them.

## File layout (App Router)

```
app/
├── .well-known/
│   └── act.json/route.ts          # GET = actMount.manifest
├── act/
│   ├── index.json/route.ts        # GET = actMount.index
│   ├── index.ndjson/route.ts      # Plus only — GET = actMount.indexNdjson
│   ├── n/[...id]/route.ts         # GET = actMount.node
│   ├── sub/[...id]/route.ts       # Standard / Plus — GET = actMount.subtree
│   └── search/route.ts            # Plus only — GET = actMount.search
└── act-mount.ts                    # exports actMount = defineActMount({ ... })
```

## Discovery hand-off Link header

The SDK emits the discovery `Link` header on every ACT-endpoint response
automatically. To emit the header on **non-ACT** routes (the host
application's HTML pages), mount the `actLinkHeaderMiddleware` in
`middleware.ts`:

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import { actLinkHeaderMiddleware } from '@act-spec/runtime-next';

const linkMw = actLinkHeaderMiddleware({
  isAuthenticated: (req) => req.cookies.has('next-auth.session-token'),
});

export async function middleware(req: Request) {
  const res = NextResponse.next();
  return linkMw(req, res);
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
```

The `isAuthenticated` predicate is the host's responsibility — keep it
fast (cookie / header presence check), NOT a full identity verification
(too expensive on every page load).

## Hybrid mounts

A Next.js app MAY participate in a parent manifest's `mounts` array
by setting `basePath`:

```ts
defineActMount({
  manifest: { /* ... conformance: { level: 'standard' }, ... */ },
  basePath: '/app',
  // ...
});
```

The served manifest then advertises URLs prefixed with `/app`; the
parent manifest at `/.well-known/act.json` (typically served by a
sibling static-export build) declares the mount at `prefix: "/app"`.

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

## Pages Router escape hatch

For hosts that have not migrated to the App Router:

```ts
// pages/api/act/[...act].ts
import { createActPagesHandler } from '@act-spec/runtime-next';
export default createActPagesHandler({ /* same options as defineActMount */ });
```

The Pages Router branch normalizes requests through the same dispatch
pipeline. NDJSON streaming is buffered (eager) since legacy
`NextApiResponse` does not support streaming bodies; **use the App
Router for Plus deployments**.

## Conformance

`pnpm -F @act-spec/runtime-next conformance` runs `@act-spec/validator`
in `validateSite` runtime-walk mode against an in-process Standard
mount via a synthetic fetcher (no real HTTP server). Pass criterion: 0
gaps; achieved level == declared level.

## License

Apache-2.0. See [LICENSE](../../LICENSE).

# Multi-tenant SaaS workspace serving ACT live

A real, runnable Next.js 14 App Router app: a multi-tenant SaaS workspace that serves ACT **at request time** instead of pre-building static files. Every authenticated user sees only their tenant's data, and cross-tenant access returns a byte-identical 404 to a request for a non-existent document — no information leak.

If you're building a multi-tenant app where the content tree depends on who's signed in (typical for SaaS, dashboards, internal tools), this is the integration shape.

## The stack

- **Next.js 14** App Router with route handlers under `src/app/.well-known/` and `src/app/act/`
- **`@act-spec/runtime-next`** — the runtime SDK, mounted via `defineActMount`
- **`@act-spec/runtime-core`** — the underlying contracts and helpers
- **In-memory tenant / user / document store** at `src/lib/db.ts` (stand-in for whatever your app uses)
- **Cookie + bearer auth** advertised in the manifest

## How ACT plugs in

Drop **one `defineActMount` call** + **four route files** into your existing Next.js app. The route files are tiny — each one delegates to a handler the SDK gave you.

```
src/app/
├── .well-known/act.json/route.ts        # → actMount.manifest
├── act/
│   ├── index.json/route.ts              # → actMount.index
│   ├── n/[...id]/route.ts               # → actMount.node
│   └── sub/[...id]/route.ts             # → actMount.subtree
src/lib/act-mount.ts                     # defineActMount({...})
src/middleware.ts                        # discovery Link header for non-ACT routes
```

Everything else — auth challenge responses, tenant scoping, ETag derivation, cache headers, cross-tenant 404 byte-equivalence — is handled by the SDK.

## Quick start (your project)

Add ACT to your existing Next.js App Router app in **four steps**:

**1. Install:**

```sh
pnpm add @act-spec/runtime-next @act-spec/runtime-core
```

**2. Define the mount** — `src/lib/act-mount.ts`:

```ts
import { defineActMount } from '@act-spec/runtime-next/mount';
import { resolveIdentity } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { actRuntime, MANIFEST } from '@/lib/act-runtime';

export const actMount = defineActMount({
  manifest: MANIFEST,
  runtime: actRuntime,
  identityResolver: resolveIdentity,
  tenantResolver: resolveTenant,
  basePath: '',
});
```

**3. Create four route files** — each is one line of glue:

```ts
// src/app/.well-known/act.json/route.ts
import { actMount } from '@/lib/act-mount';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => actMount.manifest(req);
```

```ts
// src/app/act/index.json/route.ts
import { actMount } from '@/lib/act-mount';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => actMount.index(req);
```

```ts
// src/app/act/n/[...id]/route.ts
import { actMount } from '@/lib/act-mount';
export const dynamic = 'force-dynamic';
export const GET = (req: Request, ctx: { params: { id: string[] } }) =>
  actMount.node(req, ctx);
```

```ts
// src/app/act/sub/[...id]/route.ts
import { actMount } from '@/lib/act-mount';
export const dynamic = 'force-dynamic';
export const GET = (req: Request, ctx: { params: { id: string[] } }) =>
  actMount.subtree?.(req, ctx) ?? new Response(null, { status: 404 });
```

**4. (Optional) discovery Link header on non-ACT routes** — `src/middleware.ts`:

```ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const LINK = '</.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (req.headers.get('cookie')?.includes('session=')) res.headers.append('Link', LINK);
  return res;
}

export const config = {
  matcher: '/((?!api|_next|favicon.ico|act|\\.well-known).*)',
};
```

That's it. `next dev` and `next build` now serve a fully ACT-conformant runtime mount alongside your app's existing routes.

## Run this example

```sh
pnpm install                                              # from the repo root

# Boot the Next.js dev server
pnpm -F @act-spec/example-nextjs-saas-runtime dev         # http://localhost:3000

# In your browser:
#   /                                       ← dashboard with "Sign in as user-A/B" buttons
#   /.well-known/act.json                   ← 401 (signed out) / 200 (signed in)
#   /act/n/public/landing                   ← anonymous-readable
#   /act/index.json                         ← filtered to your tenant

# Or via curl with bearer tokens:
curl -i -H 'Authorization: Bearer bearer-token-A' http://localhost:3000/act/n/doc/acme-roadmap-2026

# Cross-tenant attack: user-B asks for user-A's doc → 404 byte-identical to a non-existent doc:
curl -i -H 'Authorization: Bearer bearer-token-B' http://localhost:3000/act/n/doc/acme-roadmap-2026
curl -i -H 'Authorization: Bearer bearer-token-B' http://localhost:3000/act/n/doc/never-existed
# (the two responses MUST be byte-identical — the conformance probe asserts this)

# Validate + run the two-principal security probe (in-process, no Next.js needed):
pnpm -F @act-spec/example-nextjs-saas-runtime validate
pnpm -F @act-spec/example-nextjs-saas-runtime probe
pnpm -F @act-spec/example-nextjs-saas-runtime conformance   # validate + probe
```

### What the runtime guarantees

- Every authenticated response carries `Cache-Control: private, must-revalidate` + `Vary: Cookie`. Per-tenant ETags are derived from the per-identity content set.
- A request for a document the current identity can't see is indistinguishable from a request for a document that doesn't exist. Same status, same headers, same body bytes.
- The two-principal probe (`pnpm probe`) automates the cross-tenant attack and fails the build if any response leaks information about another tenant's content.

### Verifying ACT against the rendered dashboard

With `pnpm dev` running, sign in as user-A in the browser, then check `/act/index.json` — you should see exactly the documents listed on the dashboard (titles and IDs match). Sign out, sign in as user-B, refresh — the index changes to user-B's tenant. Cross-tenant probes return 404 with no leak.

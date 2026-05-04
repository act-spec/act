# @act-spec/runtime-core

Runtime SDK contract for [ACT (Agent Content Tree)](https://github.com/act-spec/act).

This package is the framework that all first-party runtime SDK leaves
(`@act-spec/runtime-next`, `@act-spec/runtime-express`,
`@act-spec/runtime-fetch`) consume. Leaf packages are thin framework
adapters; the resolver shape, identity context, capability negotiation,
conditional GET handling, error envelope construction, and discovery
hand-off all live here.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/runtime-core": "workspace:*" } }
```

## Public surface

The exports group under three families:

### Resolver contract

```ts
import type { ActRuntime, Outcome, ActContext } from '@act-spec/runtime-core';
```

A host application implements `ActRuntime` (Core methods `resolveManifest`,
`resolveIndex`, `resolveNode`; Standard `resolveSubtree`; Strict
`resolveIndexNdjson`, `resolveSearch`) and returns an `Outcome<T>`
discriminated union (`ok`, `not_found`, `auth_required`, `rate_limited`,
`validation`, `internal`).

### Identity & tenancy hooks

```ts
import type { Identity, Tenant, IdentityResolver, TenantResolver } from '@act-spec/runtime-core';
```

`Identity.key` and `Tenant.key` are stable opaque strings — never session
tokens, never per-request values.

### Construction & dispatch

```ts
import { createActRuntime } from '@act-spec/runtime-core';
const runtime = createActRuntime({ manifest, runtime, identityResolver, ... });
const response = await runtime.dispatch(actRequest);
```

`createActRuntime` validates capability negotiation at **construction time** —
declaring `conformance.level: "strict"` without registering `resolveSearch`
throws synchronously, never at request time.

### Helpers

- `encodeIdForUrl(id)` — per-segment percent-encoding for ACT IDs.
- `buildAuthChallenges(manifest)` — one `WWW-Authenticate` value per advertised
  scheme in `auth.schemes` order.
- `defaultEtagComputer(input)` — runtime ETag triple (JCS + SHA-256 +
  base64url no-pad + truncate to 22 + `s256:` prefix). Re-exports
  `@act-spec/validator`'s implementation.
- `actLinkHeaderMiddleware({ basePath })` — emits the runtime-only `Link
  rel="act"` header for non-ACT branches.

## Two-principal probe harness (`@act-spec/runtime-core/test-utils`)

```ts
import { runTwoPrincipalProbe } from '@act-spec/runtime-core/test-utils';

await runTwoPrincipalProbe({
  runtime,
  principalA: { identity: { kind: 'principal', key: 'alice' }, tenant: { kind: 'scoped', key: 'acme' }, visibleNodeIds: ['a-doc'] },
  principalB: { identity: { kind: 'principal', key: 'bob' }, tenant: { kind: 'scoped', key: 'globex' }, visibleNodeIds: ['b-doc'] },
  absentNodeId: 'definitely-not-a-real-doc',
});
```

The harness is **mandatory** for every leaf runtime SDK. It probes:

- **Cross-tenant non-disclosure.** Principal A cannot resolve principal B's
  visible node IDs; the response is byte-equivalent to a request for a node
  that does not exist.
- **Existence-non-leak.** The cross-tenant 404 has identical body, identical
  headers, and identical `Content-Length` to the absent-node 404. The
  discovery `Link` header is identical (it does not leak tenant identity).

The probe accepts a synthetic conformant resolver in this package's tests and
is wired into the leaf SDK conformance gates.

## Links

- Repository: <https://github.com/act-spec/act>

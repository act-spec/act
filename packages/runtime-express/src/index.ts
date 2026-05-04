/**
 * @act-spec/runtime-express — PRD-502 Express runtime SDK.
 *
 * Public surface per PRD-502-R1. The package exposes:
 *
 *   - `actRouter(options)` (PRD-502-R2, R3) — aggregate router factory
 *     returning an Express-compatible Router with every per-endpoint route
 *     wired and one `ActRuntimeInstance` shared across all of them.
 *   - `createActMiddleware(options, endpoint)` (PRD-502-R20) — per-endpoint
 *     factory escape hatch for hosts that want bespoke routing.
 *   - `actLinkHeaderMiddleware(opts)` (PRD-502-R17) — discovery hand-off
 *     middleware for non-ACT routes (host-mounted globally).
 *   - `fromExpress(req)` (PRD-502-R5) — request normalizer (exported for
 *     advanced hosts + the conformance harness).
 *
 * Re-exports a few `@act-spec/runtime-core` types for consumer convenience
 * so a host adopting `@act-spec/runtime-express` does not need a second
 * import (the contract types are owned by PRD-500; non-normative re-export
 * per PRD-502 non-goal #1).
 */

export const RUNTIME_EXPRESS_PACKAGE_NAME = '@act-spec/runtime-express' as const;

// PRD-502-R2, R3, R20, R17 — public factories.
export {
  actLinkHeaderMiddleware,
  actRouter,
  createActMiddleware,
} from './router.js';

// PRD-502-R5 — request normalization (exported for advanced hosts +
// the conformance harness).
export { fromExpress } from './request.js';

// PRD-502-R10 — response writer (exported for the same reasons).
export { writeExpress } from './response.js';

// PRD-502-R1 — public type surface.
export type {
  ActEndpoint,
  ActRouterHandle,
  ActRouterOptions,
  ExpressLinkHeaderMiddlewareOptions,
  ExpressNextFunction,
  ExpressRequestHandler,
  ExpressRequestLike,
  ExpressResponseLike,
  ExpressRouter,
} from './types.js';

// PRD-502 non-goal #1 — re-export the runtime-core types every consumer
// needs so they import once. PRD-500 owns the contract.
export type {
  ActContext,
  ActRequest,
  ActResponse,
  ActRuntime,
  ActRuntimeInstance,
  EtagComputer,
  Identity,
  IdentityResolver,
  Index,
  IndexEntry,
  Logger,
  Manifest,
  Node,
  Outcome,
  Subtree,
  Tenant,
  TenantResolver,
} from '@act-spec/runtime-core';
export { ConfigurationError, defaultEtagComputer } from '@act-spec/runtime-core';

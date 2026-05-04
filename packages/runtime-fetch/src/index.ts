/**
 * @act-spec/runtime-fetch — PRD-505 generic WHATWG-fetch handler.
 *
 * Public surface per PRD-505-R1. The package exposes a single factory
 * function:
 *
 *   - `createActFetchHandler(options)` (PRD-505-R2) — returns a
 *     `(req: Request) => Promise<Response | null>` handler. The whole
 *     adapter is a closure; no per-endpoint factories, no router
 *     classes. The handler runs unchanged on Cloudflare Workers, Deno
 *     Deploy, Bun, Vercel Edge, Hono, Service Workers, and Node 20+.
 *
 * Re-exports a few `@act-spec/runtime-core` types for consumer
 * convenience so a host adopting `@act-spec/runtime-fetch` does not
 * need a second import (the contract types are owned by PRD-500;
 * non-normative re-export — same pattern as `@act-spec/runtime-next` /
 * `@act-spec/runtime-express`).
 */

export const RUNTIME_FETCH_PACKAGE_NAME = '@act-spec/runtime-fetch' as const;

// PRD-505-R2 — the public factory.
export { createActFetchHandler } from './handler.js';

// PRD-505-R6 — request normalization (exported for advanced hosts and
// the conformance harness).
export { fromFetchRequest, parseCookieHeader } from './request.js';

// PRD-505-R8 — response wiring (exported for the same reasons).
export { toFetchResponse } from './response.js';

// PRD-505-R4 / R5 — route helpers (exported for advanced hosts that
// want to inspect the routing decision before dispatch).
export { buildRouteTable, matchesActEndpoint, matchesTemplatePath } from './route.js';
export type { RouteTable } from './route.js';

// PRD-505-R1 — public type surface.
export type {
  ActFetchHandler,
  ActFetchHandlerHandle,
  ActFetchHandlerMode,
  CreateActFetchHandlerOptions,
} from './types.js';

// Non-goal #1 (PRD-505) — re-export the runtime-core types every
// consumer needs so they import once. PRD-500 owns the contract.
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

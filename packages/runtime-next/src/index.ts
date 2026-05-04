/**
 * @act-spec/runtime-next — PRD-501 Next.js runtime SDK.
 *
 * Public surface per PRD-501-R1. The package exposes:
 *
 *   - `defineActMount(options)` (PRD-501-R3) — aggregate mount factory
 *     returning App Router Route Handlers + a discovery-Link middleware.
 *   - `createActHandler(options)` (PRD-501-R2) — per-endpoint factory.
 *   - `actLinkHeaderMiddleware(opts)` (PRD-501-R17) — discovery hand-off
 *     middleware for non-ACT routes (host-mounted in `middleware.ts`).
 *   - `createActPagesHandler(options)` (PRD-501-R20) — Pages Router
 *     escape hatch.
 *
 * Re-exports a few `@act-spec/runtime-core` types for consumer
 * convenience so a host adopting `@act-spec/runtime-next` does not need
 * a second import (the contract types are owned by PRD-500; this is
 * non-normative re-export per PRD-501 non-goal #1).
 */

export const RUNTIME_NEXT_PACKAGE_NAME = '@act-spec/runtime-next' as const;

// PRD-501-R2, R3 — handler + mount factories.
export { actLinkHeaderMiddleware, createActHandler, defineActMount } from './mount.js';

// PRD-501-R5, R20 — request normalization (exported for advanced hosts +
// the conformance harness).
export { fromAppRouter, fromPagesRouter } from './request.js';

// PRD-501-R20 — Pages Router escape hatch.
export { createActPagesHandler } from './pages.js';

// PRD-501-R4 — catch-all helpers (exported for testing / advanced hosts).
export { buildEndpointUrl, readCatchAllId } from './catchall.js';

// PRD-501-R1 — public type surface.
export type {
  ActMountHandlers,
  CreateActHandlerOptions,
  DefineActMountOptions,
  NextActHandler,
  NextActPagesHandler,
  NextLinkHeaderMiddleware,
  NextLinkHeaderMiddlewareOptions,
  PagesApiRequestLike,
  PagesApiResponseLike,
} from './types.js';

// PRD-501 non-goal #1 — re-export the runtime-core types every consumer
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
export {
  ConfigurationError,
  defaultEtagComputer,
} from '@act-spec/runtime-core';

/**
 * @act-spec/runtime-core — PRD-500 runtime SDK contract.
 *
 * Public surface per PRD-500-R1. Leaf SDKs (PRD-501 Next.js, PRD-502
 * Express, PRD-505 generic fetch) consume this package's `createActRuntime`
 * entry point and adapt their framework's request/response types to the
 * normalized `ActRequest` / `ActResponse` shapes per PRD-500-R2 + R11.
 */

export const RUNTIME_CORE_PACKAGE_NAME = '@act-spec/runtime-core' as const;

// Types — PRD-500-R1 normative interface set.
export type {
  ActContext,
  ActEndpoint,
  ActLogEvent,
  ActRequest,
  ActResponse,
  ActRuntime,
  ActRuntimeConfig,
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
} from './types.js';

// Construction & dispatch — PRD-500-R10, R5.
export { ConfigurationError, createActRuntime } from './runtime.js';

// Helpers — PRD-500-R13, R14, R20, R29.
export { decodeIdFromUrl, encodeIdForUrl } from './encoding.js';
export { buildAuthChallenges } from './auth.js';
export { defaultEtagComputer, isValidEtagShape, unquoteIfNoneMatch } from './etag.js';
export { ERROR_MESSAGES, buildErrorEnvelope, type ErrorCode } from './error.js';
export { actLinkHeaderMiddleware, buildDiscoveryLink } from './discovery.js';
export { applyCacheHeaders, cacheControlFor, varyFor } from './cache.js';

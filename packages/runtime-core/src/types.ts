/**
 * PRD-500 normative TypeScript interface set.
 *
 * Per PRD-500-R1 the signatures here are the **contract**. Each leaf runtime
 * SDK (PRD-501 Next.js, PRD-502 Express, PRD-505 generic fetch) MUST expose a
 * public API structurally compatible with these types — adapters MAY widen,
 * MUST NOT narrow.
 */
import type {
  ManifestSchema,
  IndexSchema,
  NodeSchema,
  SubtreeSchema,
} from '@act-spec/core';

// --- Wire-format envelope shortcuts ----------------------------------------

/** PRD-100-R3 manifest envelope (re-exported as a convenience). */
export type Manifest = ManifestSchema.Manifest;
/** PRD-100-R16 index envelope. */
export type Index = IndexSchema.Index;
/** PRD-100-R21 node envelope. */
export type Node = NodeSchema.Node;
/** PRD-100-R32 subtree envelope. */
export type Subtree = SubtreeSchema.Subtree;
/** PRD-100-R16 / R20 — single index entry (NDJSON line). */
export type IndexEntry = IndexSchema.Index['nodes'][number];

// --- Request normalization (PRD-500-R2) ------------------------------------

/**
 * PRD-500-R2 normalized request shape. A thin TS interface over WHATWG
 * `Request`. Leaf adapters MUST construct an `ActRequest` per-request and
 * MUST NOT carry framework-mutable state on it.
 */
export interface ActRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  readonly url: URL;
  readonly headers: Headers;
  /** Cookie accessor (frameworks differ in cookie parsing; the SDK uses this). */
  getCookie(name: string): string | undefined;
}

// --- Identity & tenancy (PRD-500-R6, R7) -----------------------------------

/**
 * PRD-500-R6 identity discriminator.
 *
 * `key` MUST be a stable opaque string (UUID, principal ID). It MUST NOT be a
 * session token, JWT, or any value that rotates within the principal's
 * lifetime — the SDK uses it as the `identity` input to PRD-103-R6's ETag
 * derivation triple and a rotating value would break cache validity.
 */
export type Identity =
  | { kind: 'anonymous' }
  | { kind: 'principal'; key: string }
  | { kind: 'auth_required'; reason?: 'missing' | 'expired' | 'invalid' };

/**
 * PRD-500-R7 tenant discriminator. `key` is opaque per the same constraints
 * as `Identity.key`.
 */
export type Tenant = { kind: 'single' } | { kind: 'scoped'; key: string };

/** PRD-500-R6 — identity hook: `(req) => Promise<Identity>`. */
export type IdentityResolver = (req: ActRequest) => Promise<Identity>;

/** PRD-500-R7 — tenant hook: `(req, identity) => Promise<Tenant>`. */
export type TenantResolver = (req: ActRequest, identity: Identity) => Promise<Tenant>;

// --- Outcome discriminated union (PRD-500-R4) ------------------------------

/**
 * PRD-500-R4 closed `Outcome<T>` discriminator. The SDK maps each kind to an
 * HTTP response per PRD-500-R17 and the §"Errors" table of PRD-500.
 */
export type Outcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not_found' }
  | { kind: 'auth_required' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'validation'; details?: Record<string, unknown> }
  | { kind: 'internal'; details?: Record<string, unknown> };

// --- Per-request context (PRD-500-R3) --------------------------------------

/** PRD-500-R3 — passed to every resolver method. */
export interface ActContext {
  readonly identity: Identity;
  readonly tenant: Tenant;
}

// --- Resolver contract (PRD-500-R3) ----------------------------------------

/**
 * PRD-500-R3 resolver interface. Core methods are required; Standard +
 * Plus methods are required when `manifest.conformance.level` declares them
 * (PRD-500-R10 + R32 / R33 / R34).
 */
export interface ActRuntime {
  resolveManifest(req: ActRequest, ctx: ActContext): Promise<Outcome<Manifest>>;
  resolveIndex(req: ActRequest, ctx: ActContext): Promise<Outcome<Index>>;
  resolveNode(
    req: ActRequest,
    ctx: ActContext,
    params: { id: string },
  ): Promise<Outcome<Node>>;

  // PRD-500-R32 — REQUIRED when level >= 'standard'.
  resolveSubtree?(
    req: ActRequest,
    ctx: ActContext,
    params: { id: string; depth: number },
  ): Promise<Outcome<Subtree>>;

  // PRD-500-R33 / R34 — REQUIRED when level === 'strict'.
  resolveIndexNdjson?(
    req: ActRequest,
    ctx: ActContext,
  ): Promise<Outcome<AsyncIterable<IndexEntry>>>;
  resolveSearch?(
    req: ActRequest,
    ctx: ActContext,
    params: { query: string },
  ): Promise<Outcome<unknown>>;
}

// --- ETag override hook (PRD-500-R20, R21) ---------------------------------

/**
 * PRD-500-R20 / R21 override shape. Hosts MAY supply a custom computer; the
 * default is `defaultEtagComputer` which implements PRD-103-R6's runtime
 * triple. Overrides MUST be deterministic given the same input triple and
 * MUST NOT mix request-local data into the computation (PRD-103-R7,
 * PRD-109-R17).
 */
export type EtagComputer = (input: {
  identity: string | null;
  payload: unknown;
  tenant: string | null;
}) => string;

// --- Logger contract (PRD-500-R23, R24) ------------------------------------

/** PRD-500-R24 logged event-set discriminator. */
export type ActEndpoint = 'manifest' | 'index' | 'node' | 'subtree' | 'ndjson' | 'search';

/**
 * PRD-500-R24 — discriminated union of Logger event types. The SDK MUST emit
 * at minimum the events listed below; hosts switching on `type` tolerate
 * future additions per PRD-108-R7.
 */
export type ActLogEvent =
  | { type: 'request_received'; method: string; path: string; has_auth: boolean }
  | { type: 'identity_resolved'; kind: Identity['kind'] }
  | { type: 'tenant_resolved'; kind: Tenant['kind'] }
  | { type: 'etag_match'; endpoint: ActEndpoint }
  | { type: 'resolver_invoked'; endpoint: ActEndpoint; outcome_kind: Outcome<unknown>['kind'] }
  | { type: 'response_sent'; status: number; etag_present: boolean }
  | {
      type: 'error';
      stage: 'normalize' | 'identify' | 'tenant' | 'resolve' | 'encode';
      message: string;
    };

/** PRD-500-R23 logger hook. The SDK enforces the no-PII shape on its side. */
export interface Logger {
  event(e: ActLogEvent): void;
}

// --- Configuration (PRD-500-R10, R26) --------------------------------------

/** PRD-500 §"Configuration shape" — input to `createActRuntime`. */
export interface ActRuntimeConfig {
  /** Pre-validated manifest. SDK injects `act_version` / `delivery: "runtime"` per PRD-500-R8. */
  readonly manifest: Manifest;
  /** The host's resolver implementations. */
  readonly runtime: ActRuntime;
  /** PRD-500-R6 hook. Required (no anonymous-fallback default — explicit by design). */
  readonly identityResolver: IdentityResolver;
  /** PRD-500-R7 hook. Optional; defaults to `{ kind: 'single' }` if omitted. */
  readonly tenantResolver?: TenantResolver;
  /** PRD-500-R20 / R21 override. Defaults to `defaultEtagComputer`. */
  readonly etagComputer?: EtagComputer;
  /** PRD-500-R23 hook. Defaults to no-op. */
  readonly logger?: Logger;
  /** PRD-500-R26 mount prefix. Default `""` (mount at root). */
  readonly basePath?: string;
  /** PRD-500-R22 — default `Cache-Control: max-age=<n>` for anonymous responses. Default 0. */
  readonly anonymousCacheSeconds?: number;
  /**
   * PRD-500-R26 — well-known manifest path. Default `/.well-known/act.json`
   * per PRD-100-R3. The leaf SDK MUST NOT hard-code the path.
   */
  readonly wellKnownPath?: string;
}

// --- Response (PRD-500-R11, R15) -------------------------------------------

/**
 * PRD-500-R11 — adapter-facing response. The body is either a JSON string,
 * an `AsyncIterable<string>` of NDJSON lines, or `null` (304 / HEAD).
 */
export interface ActResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string | AsyncIterable<string> | null;
}

// --- Construction handle (PRD-500-R5, R10, R27) ----------------------------

/** PRD-500 dispatch entry point + optional lifetime hooks (PRD-500-R27). */
export interface ActRuntimeInstance {
  /** PRD-500-R5 — the SDK's deterministic dispatch pipeline. */
  dispatch(req: ActRequest): Promise<ActResponse>;
  /** PRD-500-R27 — optional. Called before first dispatch. */
  init?(): Promise<void>;
  /** PRD-500-R27 — optional. Called on shutdown. */
  dispose?(): Promise<void>;
  /**
   * Internal — exposed for the two-principal probe harness so the harness can
   * derive the well-known + index + node paths without re-implementing the
   * SDK's URL math. Public so `@act-spec/runtime-core/test-utils` can read it.
   */
  readonly basePath: string;
  /** Internal — same rationale; the harness derives the well-known path here. */
  readonly wellKnownPath: string;
  /** Internal — exposed so the harness can build template-substituted URLs. */
  readonly manifest: Manifest;
}

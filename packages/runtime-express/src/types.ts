/**
 * PRD-502 normative TypeScript surface for `@act-spec/runtime-express`.
 *
 * Per PRD-502-R1 these signatures are the contract. PRD-502 narrows
 * PRD-500's framework-neutral contract onto Express without widening
 * obligations.
 *
 * Notes on Express coupling (PRD-502-R19):
 *   - We do NOT `import type` from `'express'` at the package level so the
 *     SDK builds and tests without `express` / `@types/express` installed.
 *     `express` is a `peerDependencies` entry; `@types/express` is a
 *     `peerDependenciesMeta` optional peer (PRD-502-R19 says peer-style
 *     dep, with the SDK building standalone).
 *   - The handler / router / middleware shapes below are minimal
 *     structural types that match the `@types/express` shapes consumers
 *     install. A host re-exporting our `actRouter` and tightening the
 *     return type to `import('express').Router` is structurally
 *     compatible.
 *   - PRD-502-R5 — request normalization is internal; the SDK's
 *     `IdentityResolver` / `TenantResolver` operate on PRD-500's
 *     `ActRequest`, NOT on `express.Request`. The Express-flavored
 *     accessors are confined to `actLinkHeaderMiddleware`'s
 *     `isAuthenticated` predicate (PRD-502-R17).
 */
import type {
  ActEndpoint,
  ActRuntime,
  ActRuntimeInstance,
  EtagComputer,
  IdentityResolver,
  Logger,
  Manifest,
  TenantResolver,
} from '@act-spec/runtime-core';

// --- Minimal Express structural types (PRD-502-R19) -----------------------

/**
 * PRD-502-R5 — minimal Express `Request` shape the SDK reads. Matches
 * the public surface of `@types/express`'s `Request` for the fields
 * we touch. We do NOT model the full Request because hosts do; the
 * structural compatibility is one-way (Express's Request is assignable
 * to ours).
 */
export interface ExpressRequestLike {
  readonly method?: string;
  /** Path-stripped URL after `app.use(prefix, router)` mount. */
  readonly url?: string;
  /** Pre-mount-strip URL — used by the SDK for the canonical URL (PRD-502-R5). */
  readonly originalUrl?: string;
  readonly protocol?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  /** path-to-regexp captured params. */
  readonly params?: Record<string, string | undefined>;
  readonly query?: Record<string, string | string[] | undefined>;
  /** Populated by `cookie-parser` middleware when registered. */
  readonly cookies?: Record<string, string | undefined>;
  /**
   * Express's `req.get(name)` accessor. Optional because the SDK's
   * fallback path reads `req.headers` directly when the accessor is
   * absent (e.g., in the in-process test harness).
   */
  get?(name: string): string | undefined;
}

/**
 * PRD-502-R10 — minimal Express `Response` shape the SDK writes to.
 * `@types/express`'s `Response` is structurally compatible. Methods
 * return `this` per Express's chainable pattern; the SDK does not
 * rely on the return value.
 */
export interface ExpressResponseLike {
  status(code: number): ExpressResponseLike;
  setHeader(name: string, value: string | string[]): void;
  /** Append-style header setter; matches Express's multi-value semantics. */
  append(name: string, value: string): ExpressResponseLike;
  send(body?: string | Buffer | null): ExpressResponseLike;
  end(body?: string): ExpressResponseLike;
  /** PRD-502-R10 — flush headers before NDJSON streaming. */
  flushHeaders?(): void;
  /** PRD-502-R10 — per-line write for NDJSON. */
  write(chunk: string | Uint8Array): boolean;
  /** Track whether a response has been sent (defensive checks). */
  readonly headersSent?: boolean;
}

/** Standard Express middleware signature. */
export type ExpressNextFunction = (err?: unknown) => void;

/** PRD-502-R19 — Express `RequestHandler`-compatible signature. */
export type ExpressRequestHandler = (
  req: ExpressRequestLike,
  res: ExpressResponseLike,
  next: ExpressNextFunction,
) => void | Promise<void>;

/**
 * PRD-502-R2 — minimal Express `Router` shape we return. Express's
 * `Router` exposes `get`, `post`, ... and is itself a function (mountable
 * via `app.use(router)`). We MUST mirror both: the `actRouter` factory
 * returns a callable middleware that ALSO carries the route registration
 * methods so it composes into Express's `app.use(prefix, router)`
 * pattern.
 */
export type ExpressRouter = ExpressRequestHandler & {
  get(path: string, ...handlers: ExpressRequestHandler[]): ExpressRouter;
  /** Methods we don't use but include for `@types/express` structural compat. */
  use?(...args: unknown[]): ExpressRouter;
  post?(path: string, ...handlers: ExpressRequestHandler[]): ExpressRouter;
  put?(path: string, ...handlers: ExpressRequestHandler[]): ExpressRouter;
  delete?(path: string, ...handlers: ExpressRequestHandler[]): ExpressRouter;
  patch?(path: string, ...handlers: ExpressRequestHandler[]): ExpressRouter;
  /** Express's `Router` carries a `stack` of layers; not used by the SDK. */
  readonly stack?: unknown;
};

// --- Public option types --------------------------------------------------

/** PRD-502-R2 — input to `actRouter` and `createActMiddleware`. */
export interface ActRouterOptions {
  readonly manifest: Manifest;
  readonly runtime: ActRuntime;
  readonly identityResolver: IdentityResolver;
  readonly tenantResolver?: TenantResolver;
  readonly etagComputer?: EtagComputer;
  readonly logger?: Logger;
  readonly basePath?: string;
  readonly anonymousCacheSeconds?: number;
  /**
   * PRD-500-R26 well-known manifest path. Defaults to
   * `/.well-known/act.json`. Most hosts leave this alone.
   */
  readonly wellKnownPath?: string;
}

/** PRD-502-R17 — discovery hand-off middleware options. */
export interface ExpressLinkHeaderMiddlewareOptions {
  readonly basePath?: string;
  readonly wellKnownPath?: string;
  readonly isAuthenticated: (req: ExpressRequestLike) => boolean | Promise<boolean>;
}

/**
 * Internal — handle exposed by `actRouter` for the test harness (the
 * two-principal probe). Public so `@act-spec/runtime-core/test-utils`
 * can derive paths without re-implementing URL math.
 */
export interface ActRouterHandle {
  readonly _instance: ActRuntimeInstance;
}

/** Re-export PRD-500's endpoint discriminator for `createActMiddleware`. */
export type { ActEndpoint };

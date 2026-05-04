/**
 * PRD-501 normative TypeScript surface for `@act-spec/runtime-next`.
 *
 * Per PRD-501-R1 these signatures are the contract — the package's public
 * surface MUST be structurally compatible. PRD-501 narrows PRD-500's
 * framework-neutral contract onto Next.js without widening obligations.
 *
 * Notes on Next.js coupling:
 *   - We do NOT import `next` at the type level for the App Router shape;
 *     App Router Route Handlers are `(req: Request, ctx: { params }) =>
 *     Promise<Response>` per Next's published convention. Modeling the
 *     handler with WHATWG `Request`/`Response` keeps the SDK
 *     Edge-runtime-clean per PRD-501-R19 and keeps `next` a true
 *     `peerDependencies` entry (consumers who only use the App Router
 *     never touch the Pages Router types).
 *   - The Pages Router escape hatch (PRD-501-R20) is typed against a
 *     minimal structural shape; we deliberately do NOT `import type`
 *     from `'next'` so this package builds without `next` installed
 *     (consumers wire their `NextApiRequest` / `NextApiResponse`
 *     themselves; the structural compatibility is enforced at the host
 *     re-export site).
 */
import type {
  ActRuntime,
  ActRuntimeInstance,
  EtagComputer,
  IdentityResolver,
  Logger,
  Manifest,
  TenantResolver,
} from '@act-spec/runtime-core';

/**
 * PRD-501-R2 — App Router Route Handler signature. Matches Next.js's
 * published convention for the `GET` export of an `app/.../route.ts` file.
 * `ctx.params` is a `Record<string, string | string[]>` because catch-all
 * dynamic segments (`[...id]`) yield arrays per PRD-501-R4.
 *
 * For v0.1 only `GET` is generated; future MINOR MAY add `POST`.
 */
export type NextActHandler = (
  req: Request,
  ctx?: { params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>> },
) => Promise<Response>;

/** PRD-501-R3 — input to `defineActMount`. */
export interface DefineActMountOptions {
  readonly manifest: Manifest;
  readonly runtime: ActRuntime;
  readonly identityResolver: IdentityResolver;
  readonly tenantResolver?: TenantResolver;
  readonly etagComputer?: EtagComputer;
  readonly logger?: Logger;
  readonly basePath?: string;
  readonly anonymousCacheSeconds?: number;
  readonly wellKnownPath?: string;
}

/** PRD-501-R3 — return shape: per-endpoint handlers + middleware. */
export interface ActMountHandlers {
  /** Mount at `app/.well-known/act.json/route.ts`. */
  readonly manifest: NextActHandler;
  /** Mount at `app/act/index.json/route.ts`. */
  readonly index: NextActHandler;
  /** Mount at `app/act/n/[...id]/route.ts`. */
  readonly node: NextActHandler;
  /** Standard — mount at `app/act/sub/[...id]/route.ts`. */
  readonly subtree?: NextActHandler;
  /** Plus — mount at `app/act/index.ndjson/route.ts`. */
  readonly indexNdjson?: NextActHandler;
  /** Plus — mount at `app/act/search/route.ts`. */
  readonly search?: NextActHandler;
  /** PRD-501-R17 — discovery hand-off Link middleware for non-ACT routes. */
  readonly linkHeaderMiddleware: NextLinkHeaderMiddleware;
  /**
   * Internal — the `ActRuntimeInstance` constructed under the hood. Exposed
   * so test harnesses (the two-principal probe) and conformance walkers
   * can derive paths without re-implementing URL math.
   */
  readonly _instance: ActRuntimeInstance;
}

/** PRD-501-R2 — per-endpoint factory options. */
export interface CreateActHandlerOptions extends DefineActMountOptions {
  readonly endpoint: 'manifest' | 'index' | 'node' | 'subtree' | 'indexNdjson' | 'search';
}

/** PRD-501-R17 — middleware options. */
export interface NextLinkHeaderMiddlewareOptions {
  readonly basePath?: string;
  readonly wellKnownPath?: string;
  readonly isAuthenticated: (req: Request) => boolean | Promise<boolean>;
}

/**
 * PRD-501-R17 — middleware signature. Accepts a Request + an upstream
 * Response (as produced by `NextResponse.next()` or any framework
 * `Response`) and returns a Response with the discovery hand-off `Link`
 * header appended when the predicate returns truthy.
 *
 * The middleware does NOT consume or mutate the response body — it only
 * appends a header on a clone of the headers map.
 */
export type NextLinkHeaderMiddleware = (
  req: Request,
  res: Response,
) => Promise<Response>;

/**
 * PRD-501-R20 — Pages Router escape-hatch handler. Structurally typed so
 * the package does not require `next` at type-check time.
 */
export interface PagesApiRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly query: Record<string, string | string[] | undefined>;
  readonly cookies?: Record<string, string | undefined>;
}

export interface PagesApiResponseLike {
  status(code: number): PagesApiResponseLike;
  setHeader(name: string, value: string | string[]): void;
  end(body?: string): void;
}

export type NextActPagesHandler = (
  req: PagesApiRequestLike,
  res: PagesApiResponseLike,
) => Promise<void>;

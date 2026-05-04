/**
 * PRD-505 normative TypeScript surface for `@act-spec/runtime-fetch`.
 *
 * Per PRD-505-R1 these signatures are the contract — the package's public
 * surface MUST be structurally compatible. PRD-505 narrows PRD-500's
 * framework-neutral contract onto the WHATWG Fetch standard surface
 * (`Request`, `Response`, `Headers`, `URL`) without widening obligations.
 *
 * Notes on portability (PRD-505-R3 / risk row #1):
 *   - We do NOT import any Node-only API (`node:http`, `node:stream`, etc.).
 *     The handler runs unchanged on Cloudflare Workers, Deno Deploy, Bun's
 *     `Bun.serve`, Vercel Edge Functions, Hono, the Service Worker spec, and
 *     Node 20+ where WHATWG `Request` / `Response` are global.
 *   - The handler signature is `(req: Request) => Promise<Response | null>`
 *     by default; in `passthrough` mode (PRD-505-R5) `null` falls through
 *     to the host's own router, in `strict` mode the handler returns a 404
 *     with the ACT error envelope.
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
 * PRD-505-R2 — the public handler shape. A WHATWG-fetch-compatible
 * function returning either a `Response` (when the request matched an
 * ACT endpoint) or `null` (passthrough mode, when the host should chain
 * its own router).
 *
 * Hosts in `strict` mode (PRD-505-R5) get a `Response` for non-matches as
 * well — the handler still resolves to `Response | null` at the type
 * level so a single signature serves both modes.
 */
export type ActFetchHandler = (request: Request) => Promise<Response | null>;

/**
 * PRD-505-R5 — handler routing mode.
 *  - `passthrough` (default): non-matching requests resolve to `null` so
 *    the host can chain `actHandler(req) ?? hostHandler(req)`.
 *  - `strict`: non-matching requests resolve to a 404 with the ACT error
 *    envelope. The body and headers MUST be byte-identical to the
 *    in-band 404 (PRD-109-R3 / PRD-500-R18 — non-disclosure).
 */
export type ActFetchHandlerMode = 'passthrough' | 'strict';

/**
 * PRD-505-R2 — input to `createActFetchHandler`. The shape mirrors
 * `ActRuntimeConfig` (PRD-500) plus the two PRD-505-specific fields:
 * `manifestPath` (PRD-505-R5 / OQ2) and `mode` (PRD-505-R5).
 */
export interface CreateActFetchHandlerOptions {
  readonly manifest: Manifest;
  readonly runtime: ActRuntime;
  readonly identityResolver: IdentityResolver;
  readonly tenantResolver?: TenantResolver;
  readonly etagComputer?: EtagComputer;
  readonly logger?: Logger;
  /** PRD-505-R3 / PRD-500-R26 mount prefix. Default `""`. */
  readonly basePath?: string;
  readonly anonymousCacheSeconds?: number;
  /**
   * PRD-505-R5 / OQ2 — well-known manifest path. Default
   * `/.well-known/act.json` per PRD-100-R3. The leaf SDK MUST NOT
   * hard-code the path; some deployments must serve the manifest at a
   * non-default path (behind an `/api/` rewrite, or where
   * `/.well-known/` is reserved by another protocol).
   */
  readonly manifestPath?: string;
  /**
   * PRD-505-R5 — `passthrough` (default) returns `null` for non-matching
   * requests so the host can chain. `strict` returns a 404 with the ACT
   * error envelope (byte-identical to the in-band 404).
   */
  readonly mode?: ActFetchHandlerMode;
}

/**
 * Internal handle exposed for the two-principal probe harness so the
 * harness can derive paths without re-implementing URL math. Re-uses the
 * same shape as `runtime-next` / `runtime-express` (`._instance`).
 */
export interface ActFetchHandlerHandle {
  /** The underlying `ActRuntimeInstance` (PRD-500-R5). */
  readonly _instance: ActRuntimeInstance;
}

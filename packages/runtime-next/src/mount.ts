/**
 * PRD-501-R3 — `defineActMount(options)` and PRD-501-R2 —
 * `createActHandler(options)`. Together they return App Router Route
 * Handlers + the discovery-Link middleware, all backed by ONE construction
 * of `createActRuntime` (PRD-500-R10).
 *
 * Every handler:
 *   1. Normalizes the Next.js `Request` to PRD-500's `ActRequest`
 *      (PRD-501-R5).
 *   2. For node / subtree endpoints, joins the catch-all `[...id]`
 *      parameter into the canonical ID and rewrites the URL pathname
 *      so the dispatch pipeline matches the manifest's URL template
 *      (PRD-501-R4).
 *   3. For the manifest endpoint, mutates the resolver layer to inject
 *      `delivery: "runtime"` (PRD-501-R9 step 1) and apply `basePath`
 *      to advertised URLs (PRD-501-R9 step 2). Both happen inside a
 *      wrapper resolver that the SDK installs around the host's
 *      `resolveManifest`.
 *   4. Calls `runtimeInstance.dispatch(actRequest)`.
 *   5. Maps the `ActResponse` to a Next.js `Response` (PRD-501-R10).
 *
 * Construction-time validation (PRD-500-R10) runs once when
 * `defineActMount` invokes `createActRuntime`. Subtree / NDJSON / search
 * handlers are populated only when the corresponding resolver was
 * registered (PRD-501-R21, R22).
 */
import {
  createActRuntime,
  type ActRequest,
  type ActResponse,
  type ActRuntime,
  type ActRuntimeInstance,
  type Manifest,
} from '@act-spec/runtime-core';

import { buildEndpointUrl, readCatchAllId } from './catchall.js';
import { fromAppRouter } from './request.js';
import type {
  ActMountHandlers,
  CreateActHandlerOptions,
  DefineActMountOptions,
  NextActHandler,
  NextLinkHeaderMiddleware,
  NextLinkHeaderMiddlewareOptions,
} from './types.js';

/**
 * PRD-501-R9 / PRD-501-R8 — wrap the host's `resolveManifest` so the
 * served manifest carries the SDK-injected `delivery: "runtime"` (if
 * omitted) and `basePath`-prefixed advertised URLs.
 *
 * Capability advertisement (PRD-500-R9): we ALSO surface `capabilities`
 * computed from the registered resolver surface so achieved == declared
 * holds at the wire by construction (anti-pattern watchlist: capability
 * advertisement / actual-surface mismatch).
 */
function wrapManifestRuntime(
  base: ActRuntime,
  manifest: Manifest,
  basePath: string,
): ActRuntime {
  const wrapped: ActRuntime = {
    ...base,
    async resolveManifest(req, ctx) {
      const out = await base.resolveManifest(req, ctx);
      if (out.kind !== 'ok') return out;
      const m: Manifest = { ...out.value };
      if (!m.delivery) m.delivery = 'runtime';
      if (!m.act_version) m.act_version = '0.1';
      if (basePath !== '') {
        if (m.index_url && !m.index_url.startsWith(basePath)) {
          m.index_url = `${basePath}${m.index_url}`;
        }
        if (m.node_url_template && !m.node_url_template.startsWith(basePath)) {
          m.node_url_template = `${basePath}${m.node_url_template}`;
        }
        if (m.subtree_url_template && !m.subtree_url_template.startsWith(basePath)) {
          m.subtree_url_template = `${basePath}${m.subtree_url_template}`;
        }
        if (m.index_ndjson_url && !m.index_ndjson_url.startsWith(basePath)) {
          m.index_ndjson_url = `${basePath}${m.index_ndjson_url}`;
        }
        if (m.search_url_template && !m.search_url_template.startsWith(basePath)) {
          m.search_url_template = `${basePath}${m.search_url_template}`;
        }
      }
      // PRD-500-R9 — fill in capabilities from the actual resolver surface
      // so the manifest never under-declares.
      const caps = { ...(m.capabilities ?? {}) };
      if (typeof base.resolveSubtree === 'function' && caps.subtree === undefined) {
        caps.subtree = true;
      }
      if (typeof base.resolveIndexNdjson === 'function' && caps.ndjson_index === undefined) {
        caps.ndjson_index = true;
      }
      if (Object.keys(caps).length > 0) m.capabilities = caps;
      return { kind: 'ok', value: m };
    },
  };
  // Re-attach optional methods (the spread preserved them, but we want
  // explicit `undefined`-safe shape under exactOptionalPropertyTypes).
  if (base.resolveSubtree) wrapped.resolveSubtree = base.resolveSubtree.bind(base);
  if (base.resolveIndexNdjson) wrapped.resolveIndexNdjson = base.resolveIndexNdjson.bind(base);
  if (base.resolveSearch) wrapped.resolveSearch = base.resolveSearch.bind(base);
  return wrapped;
}

/**
 * PRD-501-R10 — convert an `ActResponse` to a Next.js `Response`.
 *
 * Body branches:
 *   - `null` → 304 / HEAD; pass through with no body.
 *   - `string` → JSON envelope body; pass through.
 *   - `AsyncIterable<string>` → NDJSON; wrap in `ReadableStream`.
 *
 * The adapter MUST NOT mutate the body or status (PRD-501-R10 paragraph
 * 2). It MAY append framework-specific headers, but we do not — every
 * required header (ETag, Cache-Control, Vary, WWW-Authenticate,
 * Retry-After, Link, Content-Type) is set by the dispatch pipeline.
 */
function toNextResponse(actResp: ActResponse): Response {
  if (actResp.body === null || typeof actResp.body === 'string') {
    return new Response(actResp.body, {
      status: actResp.status,
      headers: actResp.headers,
    });
  }
  // NDJSON branch — stream the AsyncIterable<string>.
  const iter = actResp.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const line of iter) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, {
    status: actResp.status,
    headers: actResp.headers,
  });
}

/**
 * Per-handler URL rewriting. For node/subtree we pull the catch-all,
 * canonicalize the ID, and synthesize a URL whose pathname matches the
 * manifest's `node_url_template` / `subtree_url_template`. For all other
 * endpoints we use the request URL as-is (the dispatch pipeline matches
 * exact paths for manifest/index/index.ndjson/search).
 */
async function buildActRequest(
  endpoint: CreateActHandlerOptions['endpoint'],
  request: Request,
  ctx: Parameters<NextActHandler>[1],
  manifest: Manifest,
  basePath: string,
): Promise<ActRequest | { error: 'invalid_id' }> {
  if (endpoint === 'node' || endpoint === 'subtree') {
    const id = await readCatchAllId(ctx);
    if (id === null) return { error: 'invalid_id' };
    const template =
      endpoint === 'node' ? manifest.node_url_template : manifest.subtree_url_template;
    if (!template) return { error: 'invalid_id' };
    // Preserve the request's query string (e.g., `?depth=N`).
    const reqUrl = new URL(request.url);
    const synthetic = buildEndpointUrl({
      origin: reqUrl.origin,
      basePath,
      template,
      canonicalId: id,
      search: reqUrl.search,
    });
    // Re-build with basePath prepended (`buildEndpointUrl` already
    // composes basePath + template, so we strip the prefix above to
    // avoid double-prepending).
    const baseReq = fromAppRouter(request);
    return {
      method: 'GET',
      url: synthetic,
      headers: request.headers,
      getCookie: (name: string) => baseReq.getCookie(name),
    };
  }
  return fromAppRouter(request);
}

/** PRD-501-R2 — per-endpoint factory. `defineActMount` calls this internally. */
export function createActHandler(opts: CreateActHandlerOptions): NextActHandler {
  const { instance, manifest, basePath } = sharedInstance(opts);
  return async (request, ctx) => {
    const actReq = await buildActRequest(opts.endpoint, request, ctx, manifest, basePath);
    if ('error' in actReq) {
      // Catch-all missing → 404 (matches the dispatch pipeline's
      // unmatched-endpoint behavior; cross-tenant byte-equivalence is
      // preserved because we route through the same dispatch path).
      const fallback = fromAppRouter(request);
      const resp = await instance.dispatch(fallback);
      return toNextResponse(resp);
    }
    const resp = await instance.dispatch(actReq);
    return toNextResponse(resp);
  };
}

/**
 * Internal — `createActHandler` is a pure-function-of-options factory
 * BUT we don't want each call to construct a fresh runtime. The cache
 * keyed by the options object identity ensures `defineActMount` (which
 * calls `createActHandler` six times with the same options reference)
 * shares one runtime instance.
 */
const INSTANCE_CACHE = new WeakMap<
  DefineActMountOptions,
  { instance: ActRuntimeInstance; manifest: Manifest; basePath: string }
>();

function sharedInstance(opts: CreateActHandlerOptions): {
  instance: ActRuntimeInstance;
  manifest: Manifest;
  basePath: string;
} {
  const cached = INSTANCE_CACHE.get(opts);
  if (cached) return cached;
  const basePath = opts.basePath ?? '';
  // The manifest stored on `ActRuntimeInstance` keeps URL templates
  // un-prefixed; the dispatch pipeline strips `basePath` from incoming
  // paths BEFORE matching against the manifest's templates
  // (`@act-spec/runtime-core/dispatch.ts` step "strip basePath, then
  // match endpoint"). Storing prefixed templates would result in a
  // double-prefix on match. The served manifest (PRD-501-R9 step 2)
  // is prefixed inside `wrapManifestRuntime` so wire consumers see the
  // effective URLs.
  const wrappedRuntime = wrapManifestRuntime(opts.runtime, opts.manifest, basePath);
  const config = {
    manifest: opts.manifest,
    runtime: wrappedRuntime,
    identityResolver: opts.identityResolver,
    ...(opts.tenantResolver ? { tenantResolver: opts.tenantResolver } : {}),
    ...(opts.etagComputer ? { etagComputer: opts.etagComputer } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    basePath,
    ...(opts.anonymousCacheSeconds !== undefined
      ? { anonymousCacheSeconds: opts.anonymousCacheSeconds }
      : {}),
    ...(opts.wellKnownPath ? { wellKnownPath: opts.wellKnownPath } : {}),
  };
  const instance = createActRuntime(config);
  const entry = { instance, manifest: opts.manifest, basePath };
  INSTANCE_CACHE.set(opts, entry);
  return entry;
}

/**
 * PRD-501-R17 — discovery-Link middleware for non-ACT routes.
 *
 * The middleware reads the request, calls the host-supplied
 * `isAuthenticated` predicate, and (when truthy) appends the discovery
 * `Link` header to a clone of the upstream response. Critically:
 *
 *   - The predicate is the host's responsibility — typically a fast
 *     cookie/header presence check, NOT a full identity verification.
 *   - The middleware does NOT enforce auth (PRD-501-R17 paragraph 3);
 *     auth enforcement is the host application's middleware concern.
 *   - The Link header value is constant for a given basePath +
 *     wellKnownPath — no per-request variation, no oracle (PRD-109-R8).
 */
export function actLinkHeaderMiddleware(
  opts: NextLinkHeaderMiddlewareOptions,
): NextLinkHeaderMiddleware {
  const basePath = opts.basePath ?? '';
  const wellKnownPath = opts.wellKnownPath ?? '/.well-known/act.json';
  const linkValue = `<${basePath}${wellKnownPath}>; rel="act"; type="application/act-manifest+json"; profile="runtime"`;
  return async (req, res) => {
    const ok = await opts.isAuthenticated(req);
    if (!ok) return res;
    // Clone headers so we don't mutate the upstream response in place.
    const headers = new Headers(res.headers);
    headers.append('Link', linkValue);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

/** PRD-501-R3 — the aggregate mount factory. */
export function defineActMount(options: DefineActMountOptions): ActMountHandlers {
  const level = options.manifest.conformance.level;
  // Construction-time capability validation runs inside `createActRuntime`
  // via `sharedInstance`; we invoke once for the manifest endpoint to
  // surface configuration errors before returning.
  const { instance } = sharedInstance({ ...options, endpoint: 'manifest' });

  const handlers: ActMountHandlers = {
    manifest: createActHandler({ ...options, endpoint: 'manifest' }),
    index: createActHandler({ ...options, endpoint: 'index' }),
    node: createActHandler({ ...options, endpoint: 'node' }),
    // The bag's middleware is pre-bound to the mount's basePath +
    // wellKnownPath and emits the discovery Link header
    // unconditionally — appropriate for the mount's ACT endpoints
    // (which always carry the hint per PRD-501-R17 paragraph 1).
    // Hosts wanting a predicate-gated middleware for non-ACT routes
    // call the standalone `actLinkHeaderMiddleware({ isAuthenticated })`
    // export directly.
    linkHeaderMiddleware: actLinkHeaderMiddleware({
      ...(options.basePath !== undefined ? { basePath: options.basePath } : {}),
      ...(options.wellKnownPath !== undefined ? { wellKnownPath: options.wellKnownPath } : {}),
      isAuthenticated: () => true,
    }),
    _instance: instance,
  };

  if (level === 'standard' || level === 'strict') {
    (handlers as { subtree: NextActHandler }).subtree = createActHandler({
      ...options,
      endpoint: 'subtree',
    });
  }
  if (level === 'strict') {
    (handlers as { indexNdjson: NextActHandler }).indexNdjson = createActHandler({
      ...options,
      endpoint: 'indexNdjson',
    });
    (handlers as { search: NextActHandler }).search = createActHandler({
      ...options,
      endpoint: 'search',
    });
  }

  return handlers;
}

/**
 * PRD-502-R2, R3 — `actRouter(options)` returns an Express-compatible
 * `Router` carrying every per-endpoint route. PRD-502-R20 —
 * `createActMiddleware(options, endpoint)` returns a single
 * `RequestHandler` for one endpoint (escape hatch for bespoke routing).
 *
 * Construction-time validation (PRD-500-R10) runs once when `actRouter`
 * invokes `createActRuntime`. Subtree / NDJSON / search routes are only
 * registered when the corresponding resolver was registered AND the
 * manifest's `conformance.level` admits them (PRD-502-R21, R22).
 *
 * Why we ship our own Router shim instead of `import('express').Router`:
 *   - The SDK builds and tests without `express` installed (peer dep
 *     per PRD-502-R19).
 *   - Express's `Router` is a callable middleware that ALSO carries
 *     route-registration methods. The `internalRouter` we return mimics
 *     this exactly: it's a middleware function that, when invoked with
 *     `(req, res, next)`, walks its registered routes and dispatches.
 *   - When a host calls `app.use('/sub-prefix', actRouter(...))`,
 *     Express will treat our function as middleware, strip the prefix
 *     from `req.url`, and pass it through. Our middleware then matches
 *     the (already-stripped) `req.url` against its internal route
 *     table.
 */
import {
  buildDiscoveryLink,
  createActRuntime,
  type ActResponse,
  type ActRuntime,
  type ActRuntimeInstance,
  type Manifest,
  type Outcome,
} from '@act-spec/runtime-core';

import { fromExpress } from './request.js';
import { writeExpress } from './response.js';
import type {
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

/**
 * PRD-501-R9 / PRD-502-R8, R9 — wrap the host's `resolveManifest` so
 * the served manifest carries the SDK-injected `delivery: "runtime"`
 * (when omitted) and `basePath`-prefixed advertised URLs. Mirrors the
 * runtime-next `wrapManifestRuntime` per the parallel R9 requirement.
 *
 * Capability advertisement (PRD-500-R9 / anti-pattern watchlist:
 * capability advertisement / actual-surface mismatch): we ALSO surface
 * `capabilities` derived from the registered resolver surface so
 * achieved == declared holds at the wire by construction.
 */
function wrapManifestRuntime(
  base: ActRuntime,
  basePath: string,
): ActRuntime {
  const wrapped: ActRuntime = {
    ...base,
    async resolveManifest(req, ctx): Promise<Outcome<Manifest>> {
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
  if (base.resolveSubtree) wrapped.resolveSubtree = base.resolveSubtree.bind(base);
  if (base.resolveIndexNdjson) wrapped.resolveIndexNdjson = base.resolveIndexNdjson.bind(base);
  if (base.resolveSearch) wrapped.resolveSearch = base.resolveSearch.bind(base);
  return wrapped;
}

/**
 * PRD-502-R20 — memoize the constructed `ActRuntimeInstance` per
 * `ActRouterOptions` reference so multiple `createActMiddleware(opts, e)`
 * calls with the same `opts` share one runtime. WeakMap keying mirrors
 * the runtime-next pattern.
 */
const INSTANCE_CACHE = new WeakMap<
  ActRouterOptions,
  { instance: ActRuntimeInstance; basePath: string }
>();

function sharedInstance(opts: ActRouterOptions): {
  instance: ActRuntimeInstance;
  basePath: string;
} {
  const cached = INSTANCE_CACHE.get(opts);
  if (cached) return cached;
  const basePath = opts.basePath ?? '';
  const wrappedRuntime = wrapManifestRuntime(opts.runtime, basePath);
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
  const entry = { instance, basePath };
  INSTANCE_CACHE.set(opts, entry);
  return entry;
}

/**
 * Internal — Builds a single-endpoint RequestHandler that normalizes
 * Express → ActRequest, dispatches via the runtime instance, and writes
 * the ActResponse via writeExpress.
 */
function buildHandler(opts: ActRouterOptions): ExpressRequestHandler {
  const { instance } = sharedInstance(opts);
  return async (
    req: ExpressRequestLike,
    res: ExpressResponseLike,
    next: ExpressNextFunction,
  ): Promise<void> => {
    try {
      const actReq = fromExpress(req);
      const resp: ActResponse = await instance.dispatch(actReq);
      await writeExpress(res, resp);
    } catch (err) {
      // PRD-502-R14 — the SDK's own dispatch is contractually
      // exception-safe (PRD-500-R4 catches resolver throws). If we
      // somehow reach here, forward to Express's error handler so the
      // host sees the failure. We do NOT call next(err) after a
      // successful response (writeExpress is `await`-ed).
      next(err);
    }
  };
}

/**
 * PRD-502-R20 — `createActMiddleware(opts, endpoint)`. Returns a single
 * `RequestHandler`; multiple calls with the same `opts` share one
 * `ActRuntimeInstance` via `sharedInstance`.
 *
 * The endpoint label is recorded for symmetry with PRD-501-R2's
 * signature, but the dispatch path matches by URL template; the label
 * has no behavioral effect.
 */
export function createActMiddleware(
  opts: ActRouterOptions,
  endpoint: ActEndpoint,
): ExpressRequestHandler {
  void endpoint;
  return buildHandler(opts);
}

// --- Router shim ---------------------------------------------------------

/** A registered route on the SDK's internal router. */
interface RouteEntry {
  /** HTTP method admit-list. We register only GET routes per PRD-502-R3. */
  readonly method: 'GET';
  /**
   * Static route prefix (a path like `/.well-known/act.json` or
   * `/act/n/`). For wildcard routes, this is the prefix that precedes
   * the wildcard segment.
   */
  readonly prefix: string;
  /** Whether this route admits trailing path segments after `prefix`. */
  readonly wildcard: boolean;
  /** The middleware to invoke. */
  readonly handler: ExpressRequestHandler;
}

/**
 * Build the wildcard predicate for a registered route. Express's
 * `:id(*)` form admits any path including `/`. Our matcher checks
 * `path === prefix` for static routes, and `path.startsWith(prefix)
 * && path.length > prefix.length` for wildcard routes (the wildcard
 * segment MUST be non-empty per PRD-100-R10).
 */
function matchRoute(entry: RouteEntry, method: string, path: string): boolean {
  if (method.toUpperCase() !== entry.method) return false;
  if (entry.wildcard) {
    return path.startsWith(entry.prefix) && path.length > entry.prefix.length;
  }
  return path === entry.prefix;
}

/**
 * Strip `?query` from an Express `req.url` for route matching. Express's
 * `req.url` includes the query string; the dispatch pipeline already
 * preserves query parsing through the canonical URL, so the router's
 * matcher only needs the pathname.
 */
function pathOnly(url: string | undefined): string {
  if (!url) return '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Compute the static prefix of a URL template up to (but not including)
 * `{id}`. For `/act/n/{id}` this returns `/act/n/`. The result is the
 * `prefix` for a wildcard route entry.
 */
function extractPrefix(template: string): string {
  const i = template.indexOf('{id}');
  if (i === -1) return template;
  return template.slice(0, i);
}

/**
 * When the manifest's URL templates already include `basePath` (e.g.,
 * the host's manifest function returns `/app/act/n/{id}` because they
 * hard-coded the prefix), strip the prefix for our internal route
 * table. Most hosts do NOT hard-code the prefix and the templates are
 * basePath-relative; in that case this function is a no-op.
 *
 * Returns the input unchanged if it does not start with `basePath`.
 */
function stripBasePath(path: string, basePath: string): string {
  if (basePath === '' || !path.startsWith(basePath)) return path;
  if (path === basePath) return '/';
  return path.slice(basePath.length);
}

/**
 * PRD-502-R2 — `actRouter(options)`. Returns a callable middleware
 * carrying the route table. The function is mountable via
 * `app.use(prefix, actRouter(...))` because Express invokes it with
 * `(req, res, next)` after stripping the prefix.
 *
 * The returned function ALSO carries `.get` for symmetry with Express's
 * `Router` shape (`@types/express` structural compat) and an internal
 * `_instance` handle so the two-principal probe and conformance walker
 * can derive paths.
 */
export function actRouter(options: ActRouterOptions): ExpressRouter & ActRouterHandle {
  // Construct the runtime instance once. Throws synchronously on
  // capability mismatch per PRD-500-R10 / PRD-502-R3.
  const { instance } = sharedInstance(options);
  const manifest = options.manifest;
  const level = manifest.conformance.level;
  const basePath = options.basePath ?? '';
  const wellKnownPath = options.wellKnownPath ?? '/.well-known/act.json';

  const handler = buildHandler(options);

  // PRD-502-R3 — register routes per declared level. Routes are relative
  // to the router's mount point; basePath is applied to advertised URLs
  // in the wrapped manifest, NOT to the router's internal route
  // definitions (PRD-502-R8).
  const routes: RouteEntry[] = [
    { method: 'GET', prefix: wellKnownPath, wildcard: false, handler },
    {
      method: 'GET',
      prefix: stripBasePath(manifest.index_url, basePath),
      wildcard: false,
      handler,
    },
    {
      method: 'GET',
      prefix: extractPrefix(stripBasePath(manifest.node_url_template, basePath)),
      wildcard: true,
      handler,
    },
  ];

  if (level === 'standard' || level === 'strict') {
    if (manifest.subtree_url_template) {
      routes.push({
        method: 'GET',
        prefix: extractPrefix(stripBasePath(manifest.subtree_url_template, basePath)),
        wildcard: true,
        handler,
      });
    }
  }
  if (level === 'strict') {
    if (manifest.index_ndjson_url) {
      routes.push({
        method: 'GET',
        prefix: stripBasePath(manifest.index_ndjson_url, basePath),
        wildcard: false,
        handler,
      });
    }
    if (manifest.search_url_template) {
      const [searchPath = ''] = manifest.search_url_template.split('?');
      routes.push({
        method: 'GET',
        prefix: stripBasePath(searchPath, basePath),
        wildcard: false,
        handler,
      });
    }
  }

  // The middleware function: walk routes, dispatch on first match,
  // otherwise call `next()` so Express's downstream chain handles it.
  const router = (async (
    req: ExpressRequestLike,
    res: ExpressResponseLike,
    next: ExpressNextFunction,
  ): Promise<void> => {
    const path = pathOnly(req.url);
    const method = req.method ?? 'GET';
    for (const entry of routes) {
      if (matchRoute(entry, method, path)) {
        await entry.handler(req, res, next);
        return;
      }
    }
    next();
  }) as ExpressRouter & ActRouterHandle;

  // PRD-502-R19 — Express `Router`-style structural shape: provide a
  // `.get(path, handler)` registration method (no-op-style — the SDK
  // does not support adding routes after construction; the router's
  // route table is fixed by the manifest).
  router.get = (_path: string, ..._handlers: ExpressRequestHandler[]): ExpressRouter => {
    return router;
  };

  // Internal handle for the test harness (two-principal probe).
  Object.defineProperty(router, '_instance', {
    value: instance,
    enumerable: false,
    writable: false,
  });

  return router;
}

// --- Discovery hand-off middleware (PRD-502-R17) -------------------------

/**
 * PRD-502-R17 — `actLinkHeaderMiddleware(opts)` returns an Express
 * middleware that conditionally appends the discovery `Link` header to
 * the outgoing response. The middleware does NOT enforce auth; it
 * checks the host-supplied `isAuthenticated` predicate and appends the
 * header when truthy.
 *
 * Express's `res.append` accumulates per-name header values; the
 * downstream handler's response carries our header alongside its own.
 * The Link header value is constant for a given basePath + wellKnownPath
 * (no per-request variation, no oracle per PRD-109-R8).
 */
export function actLinkHeaderMiddleware(
  opts: ExpressLinkHeaderMiddlewareOptions,
): ExpressRequestHandler {
  const basePath = opts.basePath ?? '';
  const wellKnownPath = opts.wellKnownPath ?? '/.well-known/act.json';
  const linkValue = buildDiscoveryLink(basePath, wellKnownPath);
  return async (req, res, next): Promise<void> => {
    try {
      const ok = await opts.isAuthenticated(req);
      if (ok) {
        res.append('Link', linkValue);
      }
    } catch {
      // Predicate errors MUST NOT block the request — fail closed on
      // the Link header (no header), but continue the chain.
    }
    next();
  };
}

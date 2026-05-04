/**
 * PRD-505-R2 — `createActFetchHandler(options)` factory.
 *
 * Returns a single function `(req: Request) => Promise<Response | null>`
 * that runs unchanged on every WHATWG-fetch host: Cloudflare Workers,
 * Deno Deploy, Bun's `Bun.serve`, Vercel Edge Functions, Hono, Service
 * Workers, Node 20+ (where `Request` / `Response` are global).
 *
 * The whole adapter is a closure; no per-endpoint factories, no router
 * classes, no aggregate helpers — PRD-505-R2 mandates the single-function
 * surface.
 *
 * Pipeline:
 *   1. Normalize `Request` → `ActRequest` per PRD-505-R6 (`./request.ts`).
 *   2. Match the request path against the manifest's advertised paths
 *      (PRD-505-R5; `./route.ts`). For non-matches:
 *        - `passthrough` mode (default) → return `null` so the host can
 *          chain its own router.
 *        - `strict` mode → return a 404 with the ACT error envelope
 *          (byte-identical to the in-band 404 per PRD-109-R3 / PRD-500-R18).
 *   3. Invoke `instance.dispatch(actRequest)` (PRD-500-R5). The dispatch
 *      pipeline owns identity / tenant resolution, ETag, conditional GET,
 *      cache headers, content negotiation, the discovery `Link` header,
 *      and error envelope construction.
 *   4. Translate `ActResponse` → `Response` per PRD-505-R8
 *      (`./response.ts`).
 *
 * Construction-time validation (PRD-500-R10) runs synchronously inside
 * `createActRuntime`; configuration mismatches throw before the function
 * returns (PRD-505-R2 paragraph 2).
 */
import {
  createActRuntime,
  type ActRuntime,
  type ActRuntimeInstance,
  type Manifest,
} from '@act-spec/runtime-core';

import { fromFetchRequest } from './request.js';
import { buildRouteTable, matchesActEndpoint, type RouteTable } from './route.js';
import { toFetchResponse } from './response.js';
import type {
  ActFetchHandler,
  ActFetchHandlerHandle,
  CreateActFetchHandlerOptions,
} from './types.js';

const DEFAULT_MANIFEST_PATH = '/.well-known/act.json';

/**
 * Wrap the host's `resolveManifest` to inject `delivery: "runtime"`,
 * `act_version`, `basePath`-prefixed advertised URLs, and capability
 * flags computed from the actual resolver surface.
 *
 * Mirrors the runtime-next / runtime-express `wrapManifestRuntime`
 * helpers verbatim — same anti-pattern protection (capability
 * advertisement / actual-surface mismatch per PRD-500-R9). See
 * `runtime-next/src/mount.ts` for the canonical reference.
 */
function wrapManifestRuntime(base: ActRuntime, basePath: string): ActRuntime {
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
      // PRD-500-R9 — capabilities computed from the actual resolver
      // surface so achieved == declared by construction.
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
 * PRD-505-R2 — `createActFetchHandler(options)`. Returns a
 * `(request: Request) => Promise<Response | null>` handler. The handler
 * carries an internal `_instance` handle (non-enumerable) for the
 * two-principal probe harness and conformance walker.
 */
export function createActFetchHandler(
  options: CreateActFetchHandlerOptions,
): ActFetchHandler & ActFetchHandlerHandle {
  const basePath = options.basePath ?? '';
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const mode = options.mode ?? 'passthrough';

  // PRD-500-R10 — synchronous capability negotiation. Throws on
  // mismatch. The wrapped runtime injects delivery/basePath/capabilities
  // into the served manifest.
  const wrappedRuntime = wrapManifestRuntime(options.runtime, basePath);
  const config = {
    manifest: options.manifest,
    runtime: wrappedRuntime,
    identityResolver: options.identityResolver,
    ...(options.tenantResolver ? { tenantResolver: options.tenantResolver } : {}),
    ...(options.etagComputer ? { etagComputer: options.etagComputer } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    basePath,
    ...(options.anonymousCacheSeconds !== undefined
      ? { anonymousCacheSeconds: options.anonymousCacheSeconds }
      : {}),
    wellKnownPath: manifestPath,
  };
  const instance: ActRuntimeInstance = createActRuntime(config);

  // PRD-505-R4 — pre-compute the route table for passthrough decisions.
  // The dispatch pipeline does its own match (and would 404 a non-match);
  // we need to know BEFORE dispatching so passthrough mode can return
  // `null` per PRD-505-R5.
  const routes: RouteTable = buildRouteTable(options.manifest, basePath, manifestPath);

  const handler: ActFetchHandler = async (request: Request) => {
    const url = new URL(request.url);
    const matched = matchesActEndpoint(url.pathname, routes);
    if (!matched) {
      if (mode === 'strict') {
        // PRD-505-R5 — strict mode returns a 404 with the ACT error
        // envelope. The body MUST be byte-identical to the in-band 404
        // (the dispatch pipeline's "no endpoint matched" branch).
        // We synthesize a synthetic ActRequest pointing at a path
        // that the dispatch pipeline will treat as outside basePath
        // (which produces a `not_found` outcome per dispatch.ts).
        // The simplest form: dispatch the unmatched request through
        // runtime-core, which already produces the canonical 404
        // envelope + headers (Link, Content-Type) for any unrecognized
        // path inside basePath. For paths outside basePath the
        // pipeline also produces the same 404. Either way the body is
        // byte-identical to a failed in-band lookup.
        const actRequest = fromFetchRequest(request);
        const actResponse = await instance.dispatch(actRequest);
        return toFetchResponse(actResponse);
      }
      return null;
    }
    const actRequest = fromFetchRequest(request);
    const actResponse = await instance.dispatch(actRequest);
    return toFetchResponse(actResponse);
  };

  // Internal probe / walker handle (non-enumerable so it doesn't leak
  // into framework introspection). Mirrors the runtime-express /
  // runtime-next `_instance` shape.
  const handle = handler as ActFetchHandler & ActFetchHandlerHandle;
  Object.defineProperty(handle, '_instance', {
    value: instance,
    enumerable: false,
    writable: false,
  });
  return handle;
}

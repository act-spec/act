/**
 * PRD-500-R5 dispatch pipeline. Every ACT request traverses these steps in
 * order:
 *
 *   1. Normalize (PRD-500-R2; the leaf adapter does this; we receive an
 *      `ActRequest`).
 *   2. PRD-500-R30 bounded `act_version` MAJOR rejection.
 *   3. Resolve identity via the registered `IdentityResolver` (PRD-500-R6).
 *   4. Resolve tenant via the registered `TenantResolver` (PRD-500-R7).
 *   5. Honor `If-None-Match` early-exit (PRD-500-R19).
 *   6. Invoke the appropriate resolver from PRD-500-R3.
 *   7. Map the `Outcome<T>` to an HTTP response (PRD-500-R15 / R17 / R18).
 *   8. Apply caching headers per PRD-500-R22.
 *   9. Apply discovery hand-off Link header per PRD-500-R29.
 *  10. Log the event via the registered `Logger` per PRD-500-R23 / R24.
 *
 * Deviations (skipping a step, reordering 3↔4) are violations.
 */
import { applyCacheHeaders } from './cache.js';
import { buildDiscoveryLink } from './discovery.js';
import { decodeIdFromUrl } from './encoding.js';
import {
  buildErrorEnvelope,
  buildErrorHeaders,
  codeForOutcome,
  statusForOutcome,
  type ErrorCode,
} from './error.js';
import { isValidEtagShape, unquoteIfNoneMatch } from './etag.js';
import type {
  ActContext,
  ActEndpoint,
  ActRequest,
  ActResponse,
  ActRuntime,
  EtagComputer,
  Identity,
  IdentityResolver,
  IndexEntry,
  Logger,
  Manifest,
  Outcome,
  Tenant,
  TenantResolver,
} from './types.js';

/** Internal context built by `createActRuntime` and threaded through dispatch. */
export interface DispatchContext {
  readonly manifest: Manifest;
  readonly runtime: ActRuntime;
  readonly identityResolver: IdentityResolver;
  readonly tenantResolver: TenantResolver;
  readonly etagComputer: EtagComputer;
  readonly logger: Logger;
  readonly basePath: string;
  readonly wellKnownPath: string;
  readonly anonymousCacheSeconds: number;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)$/;
const SUPPORTED_MAJOR = 0;

/** Strip `etag` field from an envelope (PRD-103-R6 step 1). */
function stripEtag<T extends { etag?: unknown }>(envelope: T): Omit<T, 'etag'> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(envelope)) {
    if (k === 'etag') continue;
    out[k] = v;
  }
  return out as Omit<T, 'etag'>;
}

/** PRD-500-R30 — bounded `act_version` rejection. */
function checkActVersion(req: ActRequest): { ok: true } | { ok: false; reason: string } {
  // The version may arrive as `Accept-Version: <v>` or in the URL's query
  // (`act_version=<v>`). Body inspection is forbidden per PRD-500-R30
  // (rejection is bounded — no body parse).
  const headerValue = req.headers.get('accept-version');
  const queryValue = req.url.searchParams.get('act_version');
  const candidates = [headerValue, queryValue].filter((v): v is string => !!v);
  for (const v of candidates) {
    const m = VERSION_PATTERN.exec(v);
    if (!m) {
      return { ok: false, reason: 'act_version_unsupported' };
    }
    // Type guard: the regex pattern guarantees group 1 exists.
    const major = Number(m[1]);
    if (major > SUPPORTED_MAJOR) {
      return { ok: false, reason: 'act_version_unsupported' };
    }
  }
  return { ok: true };
}

/**
 * PRD-500-R26 — strip the configured basePath from the request path before
 * matching. Returns `null` if the request is outside the basePath (the leaf
 * adapter is responsible for not routing those to us, but this is a defense).
 */
function stripBasePath(pathname: string, basePath: string): string | null {
  if (basePath === '') return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(basePath + '/')) return pathname.slice(basePath.length);
  return null;
}

/**
 * Match the request path to one of the configured endpoints. Returns the
 * endpoint kind and (for node/subtree/search) the extracted parameter.
 */
type EndpointMatch =
  | { endpoint: 'manifest' }
  | { endpoint: 'index' }
  | { endpoint: 'ndjson' }
  | { endpoint: 'node'; id: string }
  | { endpoint: 'subtree'; id: string }
  | { endpoint: 'search' }
  | null;

function matchEndpoint(pathname: string, manifest: Manifest, wellKnownPath: string): EndpointMatch {
  if (pathname === wellKnownPath) return { endpoint: 'manifest' };
  if (pathname === manifest.index_url) return { endpoint: 'index' };
  if (manifest.index_ndjson_url && pathname === manifest.index_ndjson_url) {
    return { endpoint: 'ndjson' };
  }
  // Node template — replace `{id}` with a regex match on the URL-encoded form.
  const nodeMatch = matchTemplate(pathname, manifest.node_url_template);
  if (nodeMatch !== null) return { endpoint: 'node', id: decodeIdFromUrl(nodeMatch) };
  if (manifest.subtree_url_template) {
    const subMatch = matchTemplate(pathname, manifest.subtree_url_template);
    if (subMatch !== null) return { endpoint: 'subtree', id: decodeIdFromUrl(subMatch) };
  }
  if (manifest.search_url_template) {
    // Search templates are ?q={query} style — match on the pathname only.
    const [searchPath] = manifest.search_url_template.split('?');
    if (pathname === searchPath) return { endpoint: 'search' };
  }
  return null;
}

/**
 * Match a URL template like `/act/n/{id}.json` against a pathname; return the
 * matched `{id}` or `null`. The template's `{id}` can match any non-empty
 * sequence including slashes (IDs may carry `/`).
 */
function matchTemplate(pathname: string, template: string): string | null {
  const idx = template.indexOf('{id}');
  if (idx === -1) return null;
  const prefix = template.slice(0, idx);
  const suffix = template.slice(idx + '{id}'.length);
  if (!pathname.startsWith(prefix)) return null;
  if (!pathname.endsWith(suffix)) return null;
  const middle = pathname.slice(prefix.length, pathname.length - suffix.length);
  if (middle.length === 0) return null;
  return middle;
}

/**
 * PRD-500-R16 — content-negotiation for the index endpoint.
 *  - `Accept: application/act-index+json; profile=ndjson` → ndjson variant.
 *  - Anything else (including `*\/*`, missing) → json variant.
 *
 * Returns `'unsupported'` when ndjson is requested but no resolver is
 * registered → 406 per the negative branch.
 */
function selectIndexVariant(
  req: ActRequest,
  runtime: ActRuntime,
): 'json' | 'ndjson' | 'unsupported' {
  const accept = req.headers.get('accept') ?? '';
  if (/profile=ndjson/.test(accept)) {
    return runtime.resolveIndexNdjson ? 'ndjson' : 'unsupported';
  }
  return 'json';
}

/** PRD-100-R10 ID grammar (with PRD-102-R29 variant extension per A6). */
const ID_RE = /^[a-z0-9]([a-z0-9._-]|\/)*[a-z0-9](@[a-z0-9-]+)?$/;

/** PRD-500-R12 — validate an envelope's IDs before serializing. */
function validateEnvelopeIds(envelope: { id?: unknown; nodes?: unknown }): boolean {
  if (typeof envelope.id === 'string' && !ID_RE.test(envelope.id)) return false;
  if (Array.isArray(envelope.nodes)) {
    for (const n of envelope.nodes) {
      if (!n || typeof n !== 'object') return false;
      const id = (n as { id?: unknown }).id;
      if (typeof id !== 'string' || !ID_RE.test(id)) return false;
    }
  }
  return true;
}

/** PRD-500-R23 — redact a path that may carry tenant identifiers. */
function redactPath(pathname: string): string {
  // Replace numeric or UUID-like segments with `<id>`.
  return pathname
    .split('/')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return '<id>';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return '<id>';
      return seg;
    })
    .join('/');
}

/** Content-Type per endpoint (PRD-100-R46 + runtime profile). */
function contentTypeFor(endpoint: ActEndpoint): string {
  switch (endpoint) {
    case 'manifest':
      return 'application/act-manifest+json; profile=runtime';
    case 'index':
      return 'application/act-index+json; profile=runtime';
    case 'node':
      return 'application/act-node+json; profile=runtime';
    case 'subtree':
      return 'application/act-subtree+json; profile=runtime';
    case 'ndjson':
      return 'application/act-index+json; profile=ndjson; profile=runtime';
    case 'search':
      // PRD-500-R34 — opaque-but-JSON per Q13.
      return 'application/json; profile=runtime';
  }
}

/**
 * PRD-500-R5 — the dispatch entry point. Construction errors don't reach
 * here — they're thrown from `createActRuntime`.
 */
export async function dispatch(req: ActRequest, ctx: DispatchContext): Promise<ActResponse> {
  const linkHeader = buildDiscoveryLink(ctx.basePath, ctx.wellKnownPath);
  const manifest = ctx.manifest;
  const path = req.url.pathname;

  // Step 10 prep — log request_received with redacted path (PRD-500-R23 / R24).
  ctx.logger.event({
    type: 'request_received',
    method: req.method,
    path: redactPath(path),
    has_auth: req.headers.has('authorization') || req.headers.has('cookie'),
  });

  // Step 2 — bounded act_version rejection (PRD-500-R30).
  const versionCheck = checkActVersion(req);
  if (!versionCheck.ok) {
    return finalizeResponse(
      buildOutcomeResponse(
        { kind: 'validation', details: { reason: versionCheck.reason } },
        manifest,
      ),
      linkHeader,
      ctx.logger,
    );
  }

  // Step — strip basePath, then match endpoint.
  const stripped = stripBasePath(path, ctx.basePath);
  if (stripped === null) {
    // Outside basePath — return 404 (no leaf SDK should route this here, but
    // belt-and-braces: emit a clean 404 rather than null).
    return finalizeResponse(
      buildOutcomeResponse({ kind: 'not_found' }, manifest),
      linkHeader,
      ctx.logger,
    );
  }
  const match = matchEndpoint(stripped, manifest, ctx.wellKnownPath);
  if (!match) {
    return finalizeResponse(
      buildOutcomeResponse({ kind: 'not_found' }, manifest),
      linkHeader,
      ctx.logger,
    );
  }

  // Step 3 — identify (PRD-500-R6). The IdentityResolver MUST NOT throw on
  // missing creds; if it does, we map to internal per PRD-500-R4.
  let identity: Identity;
  try {
    identity = await ctx.identityResolver(req);
  } catch {
    ctx.logger.event({ type: 'error', stage: 'identify', message: 'identity_resolver_threw' });
    return finalizeResponse(
      buildOutcomeResponse({ kind: 'internal' }, manifest),
      linkHeader,
      ctx.logger,
    );
  }
  ctx.logger.event({ type: 'identity_resolved', kind: identity.kind });

  // PRD-500-R6 / R17 — auth_required short-circuits before resolver invoke.
  if (identity.kind === 'auth_required') {
    return finalizeResponse(
      buildOutcomeResponse({ kind: 'auth_required' }, manifest),
      linkHeader,
      ctx.logger,
    );
  }

  // Step 4 — resolve tenant. PRD-500-R7 — anonymous identity OR no manifest
  // tenanting → tenant defaults to `single`. We always invoke the resolver
  // and let it return `{ kind: 'single' }` for the no-tenant case (the
  // default resolver does so).
  let tenant: Tenant;
  try {
    tenant = await ctx.tenantResolver(req, identity);
  } catch {
    ctx.logger.event({ type: 'error', stage: 'tenant', message: 'tenant_resolver_threw' });
    return finalizeResponse(
      buildOutcomeResponse({ kind: 'internal' }, manifest),
      linkHeader,
      ctx.logger,
    );
  }
  ctx.logger.event({ type: 'tenant_resolved', kind: tenant.kind });

  const actContext: ActContext = { identity, tenant };

  // Steps 5+6 — resolver invocation. NDJSON / search short-circuit content
  // negotiation for index.
  const result = await invokeResolver(req, actContext, match, ctx);
  ctx.logger.event({
    type: 'resolver_invoked',
    endpoint: result.endpoint,
    outcome_kind: result.outcome.kind,
  });

  // Step 7 + 8 + 9 — map outcome → response, apply cache + discovery.
  if (result.outcome.kind !== 'ok') {
    const errResp = buildOutcomeResponse(result.outcome, manifest);
    return finalizeResponse(errResp, linkHeader, ctx.logger);
  }

  // Success — serialize and apply ETag / cache.
  const resp = buildOkResponse(result, actContext, ctx, req);
  return finalizeResponse(resp, linkHeader, ctx.logger);
}

interface ResolverResult {
  endpoint: ActEndpoint;
  outcome: Outcome<unknown>;
  // For NDJSON we route differently in `buildOkResponse`.
  ndjson?: AsyncIterable<IndexEntry>;
}

async function invokeResolver(
  req: ActRequest,
  ctx: ActContext,
  match: NonNullable<EndpointMatch>,
  d: DispatchContext,
): Promise<ResolverResult> {
  switch (match.endpoint) {
    case 'manifest': {
      const out = await safeInvoke(() => d.runtime.resolveManifest(req, ctx));
      return { endpoint: 'manifest', outcome: out };
    }
    case 'index': {
      const variant = selectIndexVariant(req, d.runtime);
      if (variant === 'unsupported') {
        return {
          endpoint: 'index',
          outcome: { kind: 'validation', details: { reason: 'ndjson_not_supported' } },
        };
      }
      if (variant === 'ndjson' && d.runtime.resolveIndexNdjson) {
        const out = await safeInvoke(() => d.runtime.resolveIndexNdjson!(req, ctx));
        if (out.kind === 'ok') {
          return { endpoint: 'ndjson', outcome: out, ndjson: out.value };
        }
        return { endpoint: 'ndjson', outcome: out };
      }
      const out = await safeInvoke(() => d.runtime.resolveIndex(req, ctx));
      return { endpoint: 'index', outcome: out };
    }
    case 'ndjson': {
      if (!d.runtime.resolveIndexNdjson) {
        return {
          endpoint: 'ndjson',
          outcome: { kind: 'validation', details: { reason: 'ndjson_not_supported' } },
        };
      }
      const out = await safeInvoke(() => d.runtime.resolveIndexNdjson!(req, ctx));
      if (out.kind === 'ok') {
        return { endpoint: 'ndjson', outcome: out, ndjson: out.value };
      }
      return { endpoint: 'ndjson', outcome: out };
    }
    case 'node': {
      const out = await safeInvoke(() => d.runtime.resolveNode(req, ctx, { id: match.id }));
      return { endpoint: 'node', outcome: out };
    }
    case 'subtree': {
      if (!d.runtime.resolveSubtree) {
        return { endpoint: 'subtree', outcome: { kind: 'not_found' } };
      }
      // PRD-500-R32 — depth bounded [0, 8]; default 3.
      const depthRaw = req.url.searchParams.get('depth');
      let depth = 3;
      if (depthRaw !== null) {
        const parsed = Number(depthRaw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) {
          return {
            endpoint: 'subtree',
            outcome: { kind: 'validation', details: { reason: 'depth_out_of_range' } },
          };
        }
        depth = parsed;
      }
      const out = await safeInvoke(() =>
        d.runtime.resolveSubtree!(req, ctx, { id: match.id, depth }),
      );
      return { endpoint: 'subtree', outcome: out };
    }
    case 'search': {
      if (!d.runtime.resolveSearch) {
        return { endpoint: 'search', outcome: { kind: 'not_found' } };
      }
      const query = req.url.searchParams.get('q') ?? req.url.searchParams.get('query') ?? '';
      const out = await safeInvoke(() => d.runtime.resolveSearch!(req, ctx, { query }));
      return { endpoint: 'search', outcome: out };
    }
  }
}

async function safeInvoke<T>(fn: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await fn();
  } catch {
    // PRD-500-R4 — uncaught exceptions map to internal; the message MUST NOT
    // propagate to the response.
    return { kind: 'internal' };
  }
}

interface OkPipelineState {
  status: number;
  headers: Headers;
  body: string | AsyncIterable<string> | null;
}

function buildOkResponse(
  result: ResolverResult,
  actContext: ActContext,
  d: DispatchContext,
  req: ActRequest,
): OkPipelineState {
  const headers = new Headers({ 'Content-Type': contentTypeFor(result.endpoint) });

  // NDJSON branch (PRD-500-R33 + R19's per-line ETag rule).
  if (result.endpoint === 'ndjson' && result.ndjson) {
    applyCacheHeaders(headers, actContext.identity, actContext.tenant, d.manifest, d.anonymousCacheSeconds);
    const stream = ndjsonStream(result.ndjson);
    return { status: 200, headers, body: stream };
  }

  // Search branch — opaque-but-JSON per PRD-500-R34.
  if (result.endpoint === 'search' && result.outcome.kind === 'ok') {
    const value = result.outcome.value;
    applyCacheHeaders(headers, actContext.identity, actContext.tenant, d.manifest, d.anonymousCacheSeconds);
    return { status: 200, headers, body: JSON.stringify(value) };
  }

  // JSON branch — manifest / index / node / subtree.
  if (result.outcome.kind !== 'ok') {
    // Defensive — we only get here on `ok`, but typescript narrows easier
    // when we assert.
    throw new Error('buildOkResponse called on non-ok outcome');
  }
  const envelope = result.outcome.value as Record<string, unknown>;

  // PRD-500-R12 — inject act_version + validate IDs.
  const withVersion: Record<string, unknown> = { act_version: '0.1', ...envelope };
  if (envelope.act_version && envelope.act_version !== '0.1') {
    // PRD-500-R12 — conflict → internal.
    return mapInternal(d.manifest);
  }
  // PRD-500-R8 — if manifest endpoint, ensure delivery: 'runtime'.
  if (result.endpoint === 'manifest') {
    if (!withVersion.delivery) withVersion.delivery = 'runtime';
    if (withVersion.delivery !== 'runtime') {
      return mapInternal(d.manifest);
    }
  }
  if (!validateEnvelopeIds(withVersion)) {
    return mapInternal(d.manifest);
  }

  // PRD-500-R20 — compute ETag from the canonical triple (without the
  // envelope's own etag field).
  const stripped = stripEtag(withVersion);
  const identityKey = actContext.identity.kind === 'principal' ? actContext.identity.key : null;
  const tenantKey = actContext.tenant.kind === 'scoped' ? actContext.tenant.key : null;
  const etag = d.etagComputer({ identity: identityKey, payload: stripped, tenant: tenantKey });
  if (!isValidEtagShape(etag)) {
    // PRD-500-R21 — invalid override return → internal + log.
    d.logger.event({ type: 'error', stage: 'encode', message: 'etag_override_invalid_shape' });
    return mapInternal(d.manifest);
  }
  const finalEnvelope = { ...stripped, etag };

  // PRD-500-R19 — If-None-Match early exit. The header value may be quoted.
  const inm = req.headers.get('if-none-match');
  if (inm && unquoteIfNoneMatch(inm) === etag) {
    const h304 = new Headers();
    h304.set('ETag', `"${etag}"`);
    applyCacheHeaders(h304, actContext.identity, actContext.tenant, d.manifest, d.anonymousCacheSeconds);
    d.logger.event({ type: 'etag_match', endpoint: result.endpoint });
    return { status: 304, headers: h304, body: null };
  }

  headers.set('ETag', `"${etag}"`);
  applyCacheHeaders(headers, actContext.identity, actContext.tenant, d.manifest, d.anonymousCacheSeconds);

  return { status: 200, headers, body: JSON.stringify(finalEnvelope) };
}

function mapInternal(manifest: Manifest): OkPipelineState {
  const headers = buildErrorHeaders({ kind: 'internal' }, manifest);
  return { status: 500, headers, body: buildErrorEnvelope('internal') };
}

async function* ndjsonStream(iter: AsyncIterable<IndexEntry>): AsyncIterable<string> {
  for await (const entry of iter) {
    yield JSON.stringify(entry) + '\n';
  }
}

function buildOutcomeResponse(
  outcome: Exclude<Outcome<unknown>, { kind: 'ok' }>,
  manifest: Manifest,
): OkPipelineState {
  const status = statusForOutcome(outcome);
  const code: ErrorCode = codeForOutcome(outcome);
  const headers = buildErrorHeaders(outcome, manifest);
  // Special-case 406 for NDJSON-not-supported.
  let finalStatus = status;
  if (
    outcome.kind === 'validation' &&
    outcome.details &&
    outcome.details['reason'] === 'ndjson_not_supported'
  ) {
    finalStatus = 406;
  }
  // PRD-500-R30 → 400 default for act_version_unsupported (status already 400).
  const body =
    outcome.kind === 'validation' || outcome.kind === 'rate_limited'
      ? buildErrorEnvelope(
          code,
          outcome.kind === 'rate_limited'
            ? { retry_after_seconds: outcome.retryAfterSeconds }
            : outcome.details,
        )
      : buildErrorEnvelope(code);
  return { status: finalStatus, headers, body };
}

function finalizeResponse(
  state: OkPipelineState,
  linkHeader: string,
  logger: Logger,
): ActResponse {
  // PRD-500-R29 — Link header on every dispatched response.
  state.headers.set('Link', linkHeader);
  logger.event({
    type: 'response_sent',
    status: state.status,
    etag_present: state.headers.has('ETag'),
  });
  return { status: state.status, headers: state.headers, body: state.body };
}

/**
 * Shared test fixtures: minimal manifests, resolver factories, and a
 * lightweight in-process Express `req` / `res` stub used across the
 * unit test suite. Deliberately not exported from the package's public
 * surface (`index.ts`); strictly internal.
 */
/* eslint-disable @typescript-eslint/require-await */
import type {
  ActRuntime,
  Identity,
  IdentityResolver,
  Manifest,
  TenantResolver,
} from '@act-spec/runtime-core';

import type { ExpressRequestLike, ExpressResponseLike } from './types.js';

export function coreManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'express-test.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    auth: { schemes: ['bearer'] },
    index_url: '/act/index.json',
    node_url_template: '/act/n/{id}',
    ...overrides,
  };
}

export function standardManifest(overrides: Partial<Manifest> = {}): Manifest {
  return coreManifest({
    conformance: { level: 'standard' },
    subtree_url_template: '/act/sub/{id}',
    ...overrides,
  });
}

export function strictManifest(overrides: Partial<Manifest> = {}): Manifest {
  return coreManifest({
    conformance: { level: 'strict' },
    subtree_url_template: '/act/sub/{id}',
    index_ndjson_url: '/act/index.ndjson',
    search_url_template: '/act/search?q={query}',
    ...overrides,
  });
}

/**
 * Tenant-scoped runtime: each `tenantKey` owns a set of node IDs. A node
 * is visible only to its owning tenant; cross-tenant access returns
 * `not_found` (PRD-109-R3 / PRD-500-R18 byte-equivalence).
 */
export function tenantedRuntime(seed: Record<string, string[]>): ActRuntime {
  return {
    async resolveManifest(_req, _ctx) {
      return { kind: 'ok', value: coreManifest() };
    },
    async resolveIndex(_req, ctx) {
      if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
      const tenantKey = ctx.tenant.kind === 'scoped' ? ctx.tenant.key : 'default';
      const ids = seed[tenantKey] ?? [];
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          nodes: ids.map((id) => ({
            id,
            type: 'article',
            title: `Title ${id}`,
            summary: `Summary ${id}`,
            tokens: { summary: 4 },
            etag: '',
            updated_at: '2026-05-02T00:00:00Z',
          })),
        },
      };
    },
    async resolveNode(_req, ctx, params) {
      if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
      const tenantKey = ctx.tenant.kind === 'scoped' ? ctx.tenant.key : 'default';
      const ids = seed[tenantKey] ?? [];
      if (!ids.includes(params.id)) return { kind: 'not_found' };
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          id: params.id,
          type: 'article',
          title: `Title ${params.id}`,
          summary: `Summary ${params.id}`,
          content: [{ type: 'prose', text: `Body for ${params.id}` }],
          tokens: { summary: 4, body: 12 },
          etag: '',
        },
      };
    },
  };
}

/** Static identity resolver — returns the configured `Identity` regardless of request. */
export function staticIdentity(identity: Identity): IdentityResolver {
  return async () => identity;
}

export function staticTenant(key: string): TenantResolver {
  return async () => ({ kind: 'scoped', key });
}

// --- In-process Express req/res stubs ------------------------------------

/**
 * A lightweight `ExpressResponseLike` recorder. Captures status, headers,
 * and body (string or NDJSON-streamed concat) for assertion.
 *
 * Mirrors the parts of `@types/express`'s `Response` the SDK touches:
 * `status`, `setHeader`, `append`, `send`, `end`, `flushHeaders`,
 * `write`, `headersSent`. Tests assert on `.statusCode`, `.body`, and
 * `.collectedHeaders` (a Map of name → array of values to round-trip
 * `WWW-Authenticate` / `Link` multi-value semantics).
 */
export interface RecordingResponse extends ExpressResponseLike {
  statusCode: number;
  body: string;
  collectedHeaders: Map<string, string[]>;
  headersFlushed: boolean;
  ended: boolean;
  /** Track explicit `headersSent` for the `writeExpress` short-circuit. */
  headersSent: boolean;
}

export function recordingResponse(): RecordingResponse {
  const buckets = new Map<string, string[]>();
  const setHeader = (name: string, value: string | string[]): void => {
    const lower = name.toLowerCase();
    const arr: string[] = Array.isArray(value) ? [...value] : [value];
    buckets.set(lower, arr);
  };
  const append = (name: string, value: string): RecordingResponse => {
    const lower = name.toLowerCase();
    const existing = buckets.get(lower) ?? [];
    existing.push(value);
    buckets.set(lower, existing);
    return res;
  };
  const res: RecordingResponse = {
    statusCode: 0,
    body: '',
    collectedHeaders: buckets,
    headersFlushed: false,
    ended: false,
    headersSent: false,
    status(code: number): RecordingResponse {
      res.statusCode = code;
      return res;
    },
    setHeader,
    append,
    send(body): RecordingResponse {
      if (typeof body === 'string') res.body = body;
      else if (body instanceof Uint8Array) res.body = new TextDecoder().decode(body);
      res.ended = true;
      res.headersSent = true;
      return res;
    },
    end(body): RecordingResponse {
      if (typeof body === 'string') res.body += body;
      res.ended = true;
      res.headersSent = true;
      return res;
    },
    flushHeaders(): void {
      res.headersFlushed = true;
      res.headersSent = true;
    },
    write(chunk: string | Uint8Array): boolean {
      const s =
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      res.body += s;
      return true;
    },
  };
  return res;
}

/** Build a minimal `ExpressRequestLike` for tests. */
export interface RequestStubInit {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Record<string, string | string[]>;
  readonly cookies?: Record<string, string>;
  readonly host?: string;
  readonly basePath?: string;
}

export function requestStub(init: RequestStubInit): ExpressRequestLike {
  const headers: Record<string, string | string[] | undefined> = { ...(init.headers ?? {}) };
  if (!headers['host']) headers['host'] = init.host ?? 'express-test.example';
  const fullPath = `${init.basePath ?? ''}${init.path}`;
  // `req.url` is what Express passes after stripping the mount prefix
  // (path-stripped form). We simulate the stripped form.
  const stub: ExpressRequestLike = {
    method: init.method ?? 'GET',
    url: init.path,
    originalUrl: fullPath,
    protocol: 'http',
    headers,
    get(name: string): string | undefined {
      const v = headers[name.toLowerCase()];
      if (Array.isArray(v)) return v[0];
      return v;
    },
    ...(init.cookies ? { cookies: init.cookies } : {}),
  };
  return stub;
}

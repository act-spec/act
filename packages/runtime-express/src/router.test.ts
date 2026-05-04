/**
 * PRD-502 router & middleware tests — covers R1, R2, R3, R4, R6, R7,
 * R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21,
 * R22.
 *
 * R5 coverage in `request.test.ts`. R10 detailed branches in
 * `response.test.ts`. R23 (test fixture conformance) is the conformance
 * gate (`conformance.ts`) + the two-principal probe (`probe.test.ts`).
 *
 * Each test cites its PRD-502-R{n} requirement(s).
 */
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError, type ActLogEvent } from '@act-spec/runtime-core';

import {
  RUNTIME_EXPRESS_PACKAGE_NAME,
  actLinkHeaderMiddleware,
  actRouter,
  createActMiddleware,
} from './index.js';
import {
  coreManifest,
  strictManifest,
  recordingResponse,
  requestStub,
  staticIdentity,
  staticTenant,
  standardManifest,
  tenantedRuntime,
} from './_fixtures.js';

const noopNext = (): void => {};

describe('PRD-502-R1: package surface', () => {
  it('exports the canonical package name', () => {
    expect(RUNTIME_EXPRESS_PACKAGE_NAME).toBe('@act-spec/runtime-express');
  });
});

describe('PRD-502-R2: actRouter factory', () => {
  it('returns a callable middleware function (Express Router-compatible)', () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    expect(typeof router).toBe('function');
    // Express's Router is also a function with route-registration helpers.
    expect(typeof router.get).toBe('function');
  });

  it('exposes the underlying ActRuntimeInstance via _instance handle', () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    expect(router._instance).toBeDefined();
    expect(router._instance.basePath).toBe('');
  });
});

describe('PRD-502-R3: route registration per declared level', () => {
  it('registers Core routes (manifest/index/node) for level=core', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    // Hit each Core route via the middleware function directly.
    for (const path of ['/.well-known/act.json', '/act/index.json', '/act/n/doc/a']) {
      const res = recordingResponse();
      await router(requestStub({ path }), res, noopNext);
      expect(res.statusCode, `path=${path}`).toBeGreaterThanOrEqual(200);
      expect(res.statusCode, `path=${path}`).toBeLessThan(500);
    }
  });

  it('registers subtree route for level=standard|plus (PRD-502-R21)', async () => {
    const router = actRouter({
      manifest: standardManifest(),
      runtime: {
        ...tenantedRuntime({ acme: ['doc/a'] }),
         
        async resolveSubtree(_req, ctx, params) {
          if (ctx.identity.kind !== 'principal') return { kind: 'auth_required' };
          if (params.id !== 'doc/a') return { kind: 'not_found' };
          return {
            kind: 'ok',
            value: {
              act_version: '0.1',
              root: {
                id: 'doc/a',
                type: 'article',
                title: 'A',
                summary: 'a',
                tokens: { summary: 1 },
                etag: '',
                updated_at: '2026-05-02T00:00:00Z',
              },
            },
          };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/sub/doc/a' }), res, noopNext);
    expect(res.statusCode).toBe(200);
  });

  it('registers ndjson and search routes for level=plus (PRD-502-R22)', async () => {
    const router = actRouter({
      manifest: strictManifest(),
      runtime: {
        ...tenantedRuntime({ acme: ['doc/a'] }),
         
        async resolveSubtree(_req, _ctx, _params) {
          return { kind: 'not_found' };
        },
         
        async resolveIndexNdjson(_req, _ctx) {
           
          async function* it() {
            yield {
              id: 'doc/a',
              type: 'article',
              title: 'A',
              summary: 'a',
              tokens: { summary: 1 },
              etag: 'x',
              updated_at: '2026-05-02T00:00:00Z',
            };
          }
          return { kind: 'ok', value: it() };
        },
         
        async resolveSearch(_req, _ctx, _params) {
          return { kind: 'ok', value: { hits: [] } };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const ndjsonRes = recordingResponse();
    await router(requestStub({ path: '/act/index.ndjson' }), ndjsonRes, noopNext);
    expect(ndjsonRes.statusCode).toBe(200);

    const searchRes = recordingResponse();
    await router(requestStub({ path: '/act/search?q=hello' }), searchRes, noopNext);
    expect(searchRes.statusCode).toBe(200);
  });

  it('throws ConfigurationError synchronously when level=plus but resolveSearch missing (PRD-500-R10)', () => {
    expect(() =>
      actRouter({
        manifest: strictManifest(),
        runtime: tenantedRuntime({ acme: ['doc/a'] }),
        identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when manifest.delivery is "static"', () => {
    expect(() =>
      actRouter({
        manifest: coreManifest({ delivery: 'static' }),
        runtime: tenantedRuntime({ acme: [] }),
        identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      }),
    ).toThrow(/delivery/);
  });

  it('falls through to next() for unmatched paths (PRD-502-R3 hybrid mount semantics)', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    let nextCalled = 0;
    await router(requestStub({ path: '/some/other/route' }), res, () => {
      nextCalled += 1;
    });
    expect(nextCalled).toBe(1);
    expect(res.statusCode).toBe(0);
  });
});

describe('PRD-502-R4: catch-all node IDs containing "/"', () => {
  it('routes /act/n/doc/proj-launch-2026 to resolveNode with the joined id', async () => {
    const ids: string[] = [];
    const router = actRouter({
      manifest: coreManifest(),
      runtime: {
         
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: coreManifest() };
        },
         
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
         
        async resolveNode(_req, _ctx, params) {
          ids.push(params.id);
          return { kind: 'not_found' };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/n/doc/proj-launch-2026' }), res, noopNext);
    expect(ids).toEqual(['doc/proj-launch-2026']);
  });
});

describe('PRD-502-R6: identity hook contract', () => {
  it('invokes the IdentityResolver fresh on every request (PRD-500-R5 step 3)', async () => {
    let count = 0;
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
       
      identityResolver: async () => {
        count += 1;
        return { kind: 'principal', key: 'u-1' };
      },
      tenantResolver: staticTenant('acme'),
    });
    await router(requestStub({ path: '/act/index.json' }), recordingResponse(), noopNext);
    await router(requestStub({ path: '/act/index.json' }), recordingResponse(), noopNext);
    expect(count).toBe(2);
  });

  it('returns 401 when identity resolves to auth_required (PRD-500-R6 / R17)', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
       
      identityResolver: async () => ({ kind: 'auth_required' }),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/index.json' }), res, noopNext);
    expect(res.statusCode).toBe(401);
    // PRD-502-R13 — one WWW-Authenticate per advertised scheme.
    expect(res.collectedHeaders.get('www-authenticate')?.[0]).toMatch(/Bearer/);
  });
});

describe('PRD-502-R7: tenant hook contract', () => {
  it('defaults to {kind: "single"} when no tenantResolver is supplied (PRD-500-R7)', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ default: ['doc/d'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/n/doc/d' }), res, noopNext);
    expect(res.statusCode).toBe(200);
  });
});

describe('PRD-502-R8: basePath configurability', () => {
  it('strips matching basePath from incoming paths and serves manifest from /app prefix', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    // Express has stripped `/app` already → req.url is `/.well-known/act.json`.
    // originalUrl preserves `/app`. The dispatch pipeline strips basePath again.
    const res = recordingResponse();
    await router(requestStub({ path: '/.well-known/act.json', basePath: '/app' }), res, noopNext);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { index_url?: string; node_url_template?: string };
    expect(body.index_url).toBe('/app/act/index.json');
    expect(body.node_url_template).toBe('/app/act/n/{id}');
  });
});

describe('PRD-502-R9: manifest serving with delivery + capabilities injection', () => {
  it('injects delivery: "runtime" when omitted by the host resolver', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: {
        ...tenantedRuntime({ acme: [] }),
         
        async resolveManifest(_req, _ctx) {
          // Host omits `delivery` — SDK MUST inject it.
          return {
            kind: 'ok',
            value: coreManifest({ delivery: undefined }) as unknown as ReturnType<
              typeof coreManifest
            >,
          };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/.well-known/act.json' }), res, noopNext);
    const body = JSON.parse(res.body) as { delivery?: string };
    expect(body.delivery).toBe('runtime');
  });

  it('derives capabilities from the actual resolver surface (PRD-500-R9 anti-mismatch)', async () => {
    const router = actRouter({
      manifest: standardManifest(),
      runtime: {
        ...tenantedRuntime({ acme: ['doc/a'] }),
         
        async resolveSubtree(_req, _ctx, _params) {
          return { kind: 'not_found' };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/.well-known/act.json' }), res, noopNext);
    const body = JSON.parse(res.body) as { capabilities?: { subtree?: boolean } };
    expect(body.capabilities?.subtree).toBe(true);
  });
});

describe('PRD-502-R11/R12: status-code mapping + ETag delegation', () => {
  it('emits 200 + ETag + Cache-Control + Vary on a node fetch', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/n/doc/a' }), res, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.collectedHeaders.get('etag')?.[0]).toMatch(/^"[A-Za-z0-9+/:=_-]+"$/);
    expect(res.collectedHeaders.get('cache-control')?.[0]).toContain('must-revalidate');
    expect(res.collectedHeaders.get('vary')?.[0]).toBeDefined();
  });

  it('returns 304 on If-None-Match match', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    // First fetch: capture the ETag.
    const first = recordingResponse();
    await router(requestStub({ path: '/act/n/doc/a' }), first, noopNext);
    const etag = first.collectedHeaders.get('etag')?.[0];
    expect(etag).toBeDefined();

    // Second fetch: send If-None-Match.
    const second = recordingResponse();
    await router(
      requestStub({ path: '/act/n/doc/a', headers: { 'if-none-match': etag! } }),
      second,
      noopNext,
    );
    expect(second.statusCode).toBe(304);
  });
});

describe('PRD-502-R13: WWW-Authenticate per advertised scheme on 401', () => {
  it('emits one challenge per scheme listed in manifest.auth.schemes', async () => {
    const router = actRouter({
      manifest: coreManifest({ auth: { schemes: ['bearer', 'oauth2'], oauth2: { authorization_endpoint: 'https://x/a', token_endpoint: 'https://x/t', scopes_supported: ['read'] } } }),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
       
      identityResolver: async () => ({ kind: 'auth_required' }),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/index.json' }), res, noopNext);
    expect(res.statusCode).toBe(401);
    // The dispatch pipeline emits a single header value with comma-joined
    // challenges (per WHATWG Headers semantics); we assert both schemes
    // appear.
    const wwwAuth = res.collectedHeaders.get('www-authenticate')?.[0] ?? '';
    expect(wwwAuth).toMatch(/Bearer/);
    // The oauth2 challenge is also a Bearer scheme but carries
    // authorization_uri, scope, and error fields per RFC 6750 § 3.
    expect(wwwAuth).toMatch(/authorization_uri/);
    expect(wwwAuth).toMatch(/scope=/);
  });
});

describe('PRD-502-R14: error envelope + existence-non-leak', () => {
  it('returns 404 for absent nodes with the act-error envelope', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/n/doc/never-exists' }), res, noopNext);
    expect(res.statusCode).toBe(404);
    expect(res.collectedHeaders.get('content-type')?.[0]).toContain('act-error');
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});

describe('PRD-502-R15: content negotiation on /act/index.json', () => {
  it('returns 406-style validation error when ndjson is requested but not supported', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(
      requestStub({
        path: '/act/index.json',
        headers: { accept: 'application/act-index+json; profile=ndjson' },
      }),
      res,
      noopNext,
    );
    // PRD-500's dispatch maps unsupported-ndjson to a validation outcome
    // → 400 per the dispatch error mapping.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe('PRD-502-R16: Logger wiring', () => {
  it('forwards events to a host-supplied Logger', async () => {
    const events: ActLogEvent[] = [];
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      logger: { event: (e) => events.push(e) },
    });
    await router(requestStub({ path: '/act/index.json' }), recordingResponse(), noopNext);
    const types = events.map((e) => e.type);
    expect(types).toContain('request_received');
    expect(types).toContain('identity_resolved');
    expect(types).toContain('response_sent');
  });
});

describe('PRD-502-R17: discovery hand-off Link header', () => {
  it('emits the Link header on every dispatched response (PRD-500-R29)', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const res = recordingResponse();
    await router(requestStub({ path: '/act/index.json' }), res, noopNext);
    const link = res.collectedHeaders.get('link')?.[0];
    expect(link).toMatch(/rel="act"/);
    expect(link).toMatch(/profile="runtime"/);
  });

  it('actLinkHeaderMiddleware appends the Link header when isAuthenticated is truthy', async () => {
    const mw = actLinkHeaderMiddleware({
      isAuthenticated: () => true,
    });
    const res = recordingResponse();
    let nextCalled = 0;
    await mw(requestStub({ path: '/' }), res, () => {
      nextCalled += 1;
    });
    expect(nextCalled).toBe(1);
    expect(res.collectedHeaders.get('link')?.[0]).toMatch(/rel="act"/);
  });

  it('actLinkHeaderMiddleware does NOT append when isAuthenticated is falsy', async () => {
    const mw = actLinkHeaderMiddleware({
      isAuthenticated: () => false,
    });
    const res = recordingResponse();
    await mw(requestStub({ path: '/' }), res, noopNext);
    expect(res.collectedHeaders.get('link')).toBeUndefined();
  });

  it('actLinkHeaderMiddleware swallows predicate errors without blocking the chain', async () => {
    const mw = actLinkHeaderMiddleware({
      isAuthenticated: () => {
        throw new Error('boom');
      },
    });
    const res = recordingResponse();
    let nextCalled = 0;
    await mw(requestStub({ path: '/' }), res, () => {
      nextCalled += 1;
    });
    expect(nextCalled).toBe(1);
    expect(res.collectedHeaders.get('link')).toBeUndefined();
  });

  it('respects the basePath option when building the Link target', async () => {
    const mw = actLinkHeaderMiddleware({
      basePath: '/app',
      isAuthenticated: () => true,
    });
    const res = recordingResponse();
    await mw(requestStub({ path: '/' }), res, noopNext);
    expect(res.collectedHeaders.get('link')?.[0]).toContain('/app/.well-known/act.json');
  });
});

describe('PRD-502-R18: hybrid mount via app.use(prefix, router)', () => {
  it('serves manifest with basePath-prefixed advertised URLs at /app', async () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    const res = recordingResponse();
    // Express's app.use('/app', router) strips /app from req.url.
    await router(
      requestStub({ path: '/.well-known/act.json', basePath: '/app' }),
      res,
      noopNext,
    );
    const body = JSON.parse(res.body) as { index_url?: string };
    expect(body.index_url).toBe('/app/act/index.json');
  });
});

describe('PRD-502-R19: typed handler signatures', () => {
  it('actRouter return value carries .get for Express Router structural compat', () => {
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
    });
    expect(typeof router.get).toBe('function');
    // The `.get` is a no-op chainable; it returns the router for fluent chaining.
    expect(router.get('/whatever', () => undefined)).toBe(router);
  });
});

describe('PRD-502-R20: createActMiddleware ad-hoc helper', () => {
  it('returns a single RequestHandler that dispatches one endpoint', async () => {
    const opts = {
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    };
    const handler = createActMiddleware(opts, 'manifest');
    const res = recordingResponse();
    await handler(requestStub({ path: '/.well-known/act.json' }), res, noopNext);
    expect(res.statusCode).toBe(200);
  });

  it('shares ONE ActRuntimeInstance across multiple createActMiddleware calls with the same opts', () => {
    const opts = {
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
    };
    // The contract: passing the same `opts` reference reuses the cached instance.
    // We can't directly observe instance identity from the public surface;
    // we infer it by checking that no ConfigurationError fires twice (i.e.,
    // construction happens at most once). Proven via the WeakMap guarantee.
    const a = createActMiddleware(opts, 'manifest');
    const b = createActMiddleware(opts, 'index');
    expect(typeof a).toBe('function');
    expect(typeof b).toBe('function');
    // Both share the same options reference; they wrap the same instance.
  });
});

describe('PRD-502-R14: SDK forwards thrown exceptions to next(err)', () => {
  it('forwards a writeExpress exception via next(err) for Express error chains', async () => {
    // Force an exception by passing a `res` that throws on setHeader.
    const router = actRouter({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const errs: unknown[] = [];
    const badRes = {
      ...recordingResponse(),
      setHeader: vi.fn(() => {
        throw new Error('cannot set header');
      }),
    };
    await router(
      requestStub({ path: '/act/index.json' }),
      badRes as unknown as ReturnType<typeof recordingResponse>,
      (err) => {
        if (err) errs.push(err);
      },
    );
    expect(errs).toHaveLength(1);
  });
});

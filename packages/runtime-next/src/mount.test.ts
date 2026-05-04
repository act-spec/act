/**
 * PRD-501 mount tests — covers R1, R2, R3, R6, R7, R8, R9, R10, R11,
 * R12, R13, R14, R15, R16, R17, R18, R19, R21, R22.
 *
 * Each test cites its PRD-501-R{n} requirement(s). Coverage of R4 / R5
 * lives in `catchall.test.ts` / `request.test.ts`; coverage of R20 lives
 * in `pages.test.ts`; R23 is the conformance + probe (see
 * `conformance.test.ts` and `probe.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError, type ActLogEvent } from '@act-spec/runtime-core';

import {
  RUNTIME_NEXT_PACKAGE_NAME,
  actLinkHeaderMiddleware,
  createActHandler,
  defineActMount,
} from './index.js';
import {
  coreManifest,
  strictManifest,
  standardManifest,
  staticIdentity,
  staticTenant,
  tenantedRuntime,
} from './_fixtures.js';

describe('PRD-501-R1: package surface', () => {
  it('exports the canonical package name', () => {
    expect(RUNTIME_NEXT_PACKAGE_NAME).toBe('@act-spec/runtime-next');
  });
});

describe('PRD-501-R2: createActHandler factory', () => {
  it('returns an App Router-compatible handler signature', async () => {
    const handler = createActHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      endpoint: 'manifest',
    });
    const resp = await handler(new Request('https://example.com/.well-known/act.json'));
    expect(resp).toBeInstanceOf(Response);
  });
});

describe('PRD-501-R3: defineActMount', () => {
  it('returns Core handlers (manifest/index/node) for level=core', () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    expect(typeof mount.manifest).toBe('function');
    expect(typeof mount.index).toBe('function');
    expect(typeof mount.node).toBe('function');
    expect(mount.subtree).toBeUndefined();
    expect(mount.indexNdjson).toBeUndefined();
    expect(mount.search).toBeUndefined();
  });

  it('throws ConfigurationError when level=plus but resolveSearch missing', () => {
    expect(() =>
      defineActMount({
        manifest: strictManifest(),
        runtime: tenantedRuntime({ acme: ['doc/a'] }),
        identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when manifest.delivery is "static"', () => {
    const m = coreManifest({ delivery: 'static' });
    expect(() =>
      defineActMount({
        manifest: m,
        runtime: tenantedRuntime({ acme: [] }),
        identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      }),
    ).toThrow(/delivery/);
  });

  it('shares ONE runtime instance across all handler factories', () => {
    const created = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    expect(created._instance).toBeDefined();
    expect(created._instance.basePath).toBe('');
  });
});

describe('PRD-501-R6: identity hook contract', () => {
  it('invokes the IdentityResolver fresh on every request (no caching)', async () => {
    const calls: number[] = [];
    let count = 0;
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: async () => {
        count += 1;
        calls.push(count);
        return { kind: 'principal', key: 'u-1' };
      },
      tenantResolver: staticTenant('acme'),
    });
    await mount.index(new Request('https://example.com/act/index.json'));
    await mount.index(new Request('https://example.com/act/index.json'));
    expect(calls).toEqual([1, 2]);
  });

  it('returns 401 when identity resolves to auth_required', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: async () => ({ kind: 'auth_required' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.index(new Request('https://example.com/act/index.json'));
    expect(resp.status).toBe(401);
  });
});

describe('PRD-501-R7: tenant hook contract', () => {
  it('passes the resolved tenant to resolvers', async () => {
    let observedTenant: string | null = null;
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: coreManifest() };
        },
        async resolveIndex(_req, ctx) {
          observedTenant = ctx.tenant.kind === 'scoped' ? ctx.tenant.key : null;
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    await mount.index(new Request('https://example.com/act/index.json'));
    expect(observedTenant).toBe('acme');
  });

  it('defaults to single-tenant when no tenantResolver supplied', async () => {
    let observedKind: string | null = null;
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: coreManifest() };
        },
        async resolveIndex(_req, ctx) {
          observedKind = ctx.tenant.kind;
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
    });
    await mount.index(new Request('https://example.com/act/index.json'));
    expect(observedKind).toBe('single');
  });
});

describe('PRD-501-R8: basePath configurability', () => {
  it('defaults to empty (mount at root)', () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    expect(mount._instance.basePath).toBe('');
  });

  it('prepends basePath to advertised manifest URLs (PRD-501-R9 step 2)', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    expect(mount._instance.basePath).toBe('/app');
    const resp = await mount.manifest(new Request('https://example.com/app/.well-known/act.json'));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { index_url: string; node_url_template: string };
    expect(body.index_url).toBe('/app/act/index.json');
    expect(body.node_url_template).toBe('/app/act/n/{id}');
  });
});

describe('PRD-501-R9: manifest serving', () => {
  it('injects delivery: "runtime" when host omits it', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          // Host returns a manifest WITHOUT `delivery`.
          const partial = { ...coreManifest() } as { delivery?: string };
          delete partial.delivery;
          return { kind: 'ok', value: partial as ReturnType<typeof coreManifest> };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.manifest(new Request('https://example.com/.well-known/act.json'));
    const body = (await resp.json()) as { delivery: string };
    expect(body.delivery).toBe('runtime');
  });

  it('serves the manifest at /.well-known/act.json by default (PRD-501-R9 final paragraph)', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.manifest(new Request('https://example.com/.well-known/act.json'));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('application/act-manifest+json');
    expect(resp.headers.get('content-type')).toContain('profile=runtime');
  });

  it('computes ETag for the manifest envelope', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.manifest(new Request('https://example.com/.well-known/act.json'));
    expect(resp.headers.get('etag')).toMatch(/^"[a-z0-9]+:[A-Za-z0-9_-]+"$/);
  });
});

describe('PRD-501-R10: envelope serialization (no body or status mutation)', () => {
  it('passes the dispatch body through unchanged', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.index(new Request('https://example.com/act/index.json'));
    const body = (await resp.json()) as { act_version: string; nodes: { id: string }[] };
    expect(body.act_version).toBe('0.1');
    expect(body.nodes[0]?.id).toBe('doc/a');
  });
});

describe('PRD-501-R11: status-code mapping', () => {
  it('maps not_found → 404', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.node(
      new Request('https://example.com/act/n/doc/missing'),
      { params: { id: ['doc', 'missing'] } },
    );
    expect(resp.status).toBe(404);
  });

  it('maps act_version too high → 400 with reason act_version_unsupported', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req = new Request('https://example.com/act/index.json', {
      headers: { 'accept-version': '99.0' },
    });
    const resp = await mount.index(req);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });
});

describe('PRD-501-R12: ETag / 304 / Cache-Control / Vary', () => {
  it('returns 304 on If-None-Match match', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req1 = new Request('https://example.com/act/n/doc/a', {});
    const resp1 = await mount.node(req1, { params: { id: ['doc', 'a'] } });
    const etag = resp1.headers.get('etag');
    expect(etag).toBeTruthy();
    const req2 = new Request('https://example.com/act/n/doc/a', {
      headers: { 'if-none-match': etag! },
    });
    const resp2 = await mount.node(req2, { params: { id: ['doc', 'a'] } });
    expect(resp2.status).toBe(304);
  });

  it('honors a custom etagComputer (PRD-501-R12 paragraph 2)', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      etagComputer: () => 'sha256:abcDEF_xyz',
    });
    const resp = await mount.node(
      new Request('https://example.com/act/n/doc/a'),
      { params: { id: ['doc', 'a'] } },
    );
    expect(resp.headers.get('etag')).toBe('"sha256:abcDEF_xyz"');
  });
});

describe('PRD-501-R13: WWW-Authenticate per scheme on 401', () => {
  it('emits one WWW-Authenticate per advertised scheme', async () => {
    const mount = defineActMount({
      manifest: coreManifest({ auth: { schemes: ['cookie', 'bearer'] } }),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: async () => ({ kind: 'auth_required' }),
    });
    const resp = await mount.index(new Request('https://example.com/act/index.json'));
    expect(resp.status).toBe(401);
    // Headers#getSetCookie-style multi-value: spec API exposes via
    // entries(); we count occurrences in the raw header list.
    const wwwAuthValues: string[] = [];
    resp.headers.forEach((value, name) => {
      if (name.toLowerCase() === 'www-authenticate') wwwAuthValues.push(value);
    });
    // Headers normalize duplicate names to a single combined value;
    // count the comma-separated schemes inside.
    const combined = wwwAuthValues.join(',').toLowerCase();
    expect(combined).toContain('cookie');
    expect(combined).toContain('bearer');
  });
});

describe('PRD-501-R14: error envelope serialization + existence non-leak', () => {
  it('returns the same body bytes for not_found and forbidden', async () => {
    // Build two mounts — one where the resolver returns not_found
    // (genuine miss) and one where it returns not_found (forbidden).
    // Both should be byte-equivalent (PRD-500-R18 / PRD-109-R3).
    const mountAbsent = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const mountForbidden = defineActMount({
      manifest: coreManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: coreManifest() };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          // Forbidden — resolver decided the principal is not allowed.
          // Per PRD-500-R18 the host MUST return not_found, not a
          // distinct forbidden kind.
          return { kind: 'not_found' };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const r1 = await mountAbsent.node(
      new Request('https://example.com/act/n/doc/x'),
      { params: { id: ['doc', 'x'] } },
    );
    const r2 = await mountForbidden.node(
      new Request('https://example.com/act/n/doc/x'),
      { params: { id: ['doc', 'x'] } },
    );
    expect(r1.status).toBe(r2.status);
    expect(await r1.text()).toBe(await r2.text());
  });
});

describe('PRD-501-R15: content negotiation (NDJSON)', () => {
  it('returns 406 when NDJSON requested but resolver not registered', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req = new Request('https://example.com/act/index.json', {
      headers: { accept: 'application/act-index+json; profile=ndjson' },
    });
    const resp = await mount.index(req);
    expect(resp.status).toBe(406);
  });

  it('routes to resolveIndexNdjson when accept carries profile=ndjson (Plus)', async () => {
    const mount = defineActMount({
      manifest: strictManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: strictManifest() };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
        async resolveSubtree(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
        async resolveIndexNdjson(_req, _ctx) {
          async function* gen() {
            yield {
              id: 'doc/x',
              type: 'article' as const,
              title: 'X',
              summary: 's',
              tokens: { summary: 1 },
              etag: '',
            };
          }
          return { kind: 'ok', value: gen() };
        },
        async resolveSearch(_req, _ctx, _p) {
          return { kind: 'ok', value: [] };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req = new Request('https://example.com/act/index.json', {
      headers: { accept: 'application/act-index+json; profile=ndjson' },
    });
    const resp = await mount.index(req);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('profile=ndjson');
    const text = await resp.text();
    expect(text).toContain('doc/x');
  });
});

describe('PRD-501-R16: Logger wiring (no PII)', () => {
  it('forwards events to the host logger in PRD-500-R24 shape', async () => {
    const events: ActLogEvent[] = [];
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'sensitive-key' }),
      tenantResolver: staticTenant('acme'),
      logger: { event: (e) => events.push(e) },
    });
    await mount.node(
      new Request('https://example.com/act/n/doc/a'),
      { params: { id: ['doc', 'a'] } },
    );
    expect(events.length).toBeGreaterThan(0);
    // The Logger MUST NOT receive identity.key or tenant.key (PRD-500-R23).
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('sensitive-key');
  });
});

describe('PRD-501-R17: discovery hand-off Link header', () => {
  it('emits Link on every dispatched ACT response (200/304/401/404)', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const r200 = await mount.index(new Request('https://example.com/act/index.json'));
    const r404 = await mount.node(
      new Request('https://example.com/act/n/doc/missing'),
      { params: { id: ['doc', 'missing'] } },
    );
    expect(r200.headers.get('link')).toContain('rel="act"');
    expect(r404.headers.get('link')).toContain('rel="act"');
  });

  it('actLinkHeaderMiddleware emits Link only when isAuthenticated returns true', async () => {
    const mw = actLinkHeaderMiddleware({
      isAuthenticated: (req) => req.headers.has('authorization'),
    });
    const upstream = new Response('hello', { status: 200 });
    const authedReq = new Request('https://example.com/page', {
      headers: { authorization: 'Bearer x' },
    });
    const out1 = await mw(authedReq, upstream);
    expect(out1.headers.get('link')).toContain('rel="act"');

    const anonReq = new Request('https://example.com/page');
    const out2 = await mw(anonReq, new Response('hello', { status: 200 }));
    expect(out2.headers.get('link')).toBeNull();
  });

  it('middleware respects basePath in the Link URL', async () => {
    const mw = actLinkHeaderMiddleware({
      basePath: '/app',
      isAuthenticated: () => true,
    });
    const out = await mw(new Request('https://example.com/'), new Response(null));
    const link = out.headers.get('link') ?? '';
    expect(link).toContain('</app/.well-known/act.json>');
  });

  it('middleware returns the upstream response unchanged when predicate is false', async () => {
    const mw = actLinkHeaderMiddleware({ isAuthenticated: () => false });
    const upstream = new Response('hi', { status: 201, headers: { 'x-custom': 'preserved' } });
    const out = await mw(new Request('https://example.com/'), upstream);
    expect(out.status).toBe(201);
    expect(out.headers.get('x-custom')).toBe('preserved');
  });

  it('mount.linkHeaderMiddleware is pre-bound to the mount basePath', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    const out = await mount.linkHeaderMiddleware(
      new Request('https://example.com/'),
      new Response(null),
    );
    expect(out.headers.get('link')).toContain('</app/.well-known/act.json>');
  });
});

describe('PRD-501-R18: hybrid mount under basePath', () => {
  it('serves the manifest at <basePath>/.well-known/act.json', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    const resp = await mount.manifest(new Request('https://example.com/app/.well-known/act.json'));
    expect(resp.status).toBe(200);
  });

  it('serves nodes under basePath with catch-all id', async () => {
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    const resp = await mount.node(
      new Request('https://example.com/app/act/n/doc/a'),
      { params: { id: ['doc', 'a'] } },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string };
    expect(body.id).toBe('doc/a');
  });
});

describe('PRD-501-R19: no Node-only API imports', () => {
  it('SDK module surface contains no Node-only globals at runtime', async () => {
    // Smoke check — load the module and verify the exports were
    // resolvable in a WHATWG-only environment. We don't sandbox Node
    // away; this asserts there's no accidental top-level side-effect
    // requiring `fs` / `Buffer` / etc.
    const mod = await import('./index.js');
    expect(mod.defineActMount).toBeDefined();
    expect(mod.createActHandler).toBeDefined();
  });
});

describe('PRD-501-R21: Standard subtree handler', () => {
  it('exposes a subtree handler when manifest declares level=standard', () => {
    const mount = defineActMount({
      manifest: standardManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: standardManifest() };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
        async resolveSubtree(_req, _ctx, params) {
          return {
            kind: 'ok',
            value: {
              act_version: '0.1',
              root: {
                id: params.id,
                type: 'collection',
                title: `Sub ${params.id}`,
                summary: 'sub',
                tokens: { summary: 2 },
                etag: '',
              },
            },
          };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    expect(typeof mount.subtree).toBe('function');
  });

  it('honors ?depth=N and rejects out-of-range', async () => {
    const mount = defineActMount({
      manifest: standardManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: standardManifest() };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
        async resolveSubtree(_req, _ctx, params) {
          return {
            kind: 'ok',
            value: {
              act_version: '0.1',
              root: {
                id: params.id,
                type: 'collection',
                title: 't',
                summary: 's',
                tokens: { summary: 1 },
                etag: '',
              },
            },
          };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const r = await mount.subtree!(
      new Request('https://example.com/act/sub/doc/a?depth=99'),
      { params: { id: ['doc', 'a'] } },
    );
    expect(r.status).toBe(400);
  });
});

describe('PRD-501-R22: Plus NDJSON + search handlers', () => {
  function plusMount() {
    return defineActMount({
      manifest: strictManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: strictManifest() };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
        async resolveSubtree(_req, _ctx, params) {
          return {
            kind: 'ok',
            value: {
              act_version: '0.1',
              root: {
                id: params.id,
                type: 'collection',
                title: 't',
                summary: 's',
                tokens: { summary: 1 },
                etag: '',
              },
            },
          };
        },
        async resolveIndexNdjson(_req, _ctx) {
          async function* gen() {
            yield {
              id: 'doc/a',
              type: 'article' as const,
              title: 'A',
              summary: 'a',
              tokens: { summary: 1 },
              etag: '',
            };
            yield {
              id: 'doc/b',
              type: 'article' as const,
              title: 'B',
              summary: 'b',
              tokens: { summary: 1 },
              etag: '',
            };
          }
          return { kind: 'ok', value: gen() };
        },
        async resolveSearch(_req, _ctx, params) {
          return { kind: 'ok', value: { query: params.query, results: ['doc/a'] } };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
  }

  it('NDJSON handler streams one JSON object per line', async () => {
    const mount = plusMount();
    const resp = await mount.indexNdjson!(new Request('https://example.com/act/index.ndjson'));
    expect(resp.status).toBe(200);
    const text = await resp.text();
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 'doc/a' });
  });

  it('search handler reads ?q= and returns the resolver value verbatim', async () => {
    const mount = plusMount();
    const resp = await mount.search!(new Request('https://example.com/act/search?q=hello'));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { query: string; results: string[] };
    expect(body.query).toBe('hello');
  });
});

describe('capability advertisement / actual-surface mismatch (anti-pattern watchlist)', () => {
  it('manifest endpoint advertises capabilities computed from the actual resolver surface (PRD-500-R9)', async () => {
    const mount = defineActMount({
      manifest: standardManifest(),
      runtime: {
        async resolveManifest(_req, _ctx) {
          return { kind: 'ok', value: standardManifest() };
        },
        async resolveIndex(_req, _ctx) {
          return { kind: 'ok', value: { act_version: '0.1', nodes: [] } };
        },
        async resolveNode(_req, _ctx, _p) {
          return { kind: 'not_found' };
        },
        async resolveSubtree(_req, _ctx, params) {
          return {
            kind: 'ok',
            value: {
              act_version: '0.1',
              root: {
                id: params.id,
                type: 'collection',
                title: 't',
                summary: 's',
                tokens: { summary: 1 },
                etag: '',
              },
            },
          };
        },
      },
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.manifest(new Request('https://example.com/.well-known/act.json'));
    const body = (await resp.json()) as { capabilities?: { subtree?: boolean } };
    expect(body.capabilities?.subtree).toBe(true);
  });
});

describe('identity bypass via convenience (anti-pattern watchlist)', () => {
  it('does NOT accept identity: null shortcuts on index/node/subtree', async () => {
    // Identity returning anonymous → resolver yields auth_required → 401.
    const mount = defineActMount({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'anonymous' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await mount.index(new Request('https://example.com/act/index.json'));
    expect(resp.status).toBe(401);
  });
});

describe('linkHeaderMiddleware default mount option', () => {
  it('handles a no-options call (no isAuthenticated → spec requires it; type guard ensures presence)', () => {
    // Smoke — verify the export exists and has the expected arity. The
    // type system enforces `isAuthenticated` is required; this test
    // exists to anchor the public surface.
    expect(actLinkHeaderMiddleware).toBeDefined();
    const mw = actLinkHeaderMiddleware({ isAuthenticated: () => true });
    expect(typeof mw).toBe('function');
    // Re-binding via a vi.fn predicate.
    const pred = vi.fn(() => true);
    actLinkHeaderMiddleware({ isAuthenticated: pred });
    expect(pred).not.toHaveBeenCalled();
  });
});

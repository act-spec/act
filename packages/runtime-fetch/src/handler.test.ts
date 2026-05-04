/**
 * PRD-505-R2 / R3 / R5 / R7 / R8 / R9 / R10 / R11 / R12 — handler factory
 * tests against an in-process `createActFetchHandler`.
 *
 * Strategy: build a handler with a tenanted in-process resolver, drive
 * WHATWG `Request` instances through it, and assert on the returned
 * `Response | null` shape per requirement.
 */
import { ConfigurationError } from '@act-spec/runtime-core';
import { describe, expect, it } from 'vitest';

import { createActFetchHandler } from './handler.js';
import {
  coreManifest,
  strictManifest,
  strictRuntime,
  standardManifest,
  staticIdentity,
  staticTenant,
  tenantedRuntime,
} from './_fixtures.js';
import type { ActLogEvent } from '@act-spec/runtime-core';

const ORIGIN = 'http://probe.local';

function buildCoreHandler() {
  return createActFetchHandler({
    manifest: coreManifest(),
    runtime: tenantedRuntime({ acme: ['doc/intro'] }),
    identityResolver: staticIdentity({ kind: 'principal', key: 'user-A' }),
    tenantResolver: staticTenant('acme'),
  });
}

describe('PRD-505-R2 createActFetchHandler shape', () => {
  it('returns a single function: (Request) => Promise<Response | null>', async () => {
    const h = buildCoreHandler();
    expect(typeof h).toBe('function');
    const resp = await h(new Request(`${ORIGIN}/.well-known/act.json`));
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(Response);
  });

  it('exposes an internal _instance handle for the probe / walker (non-enumerable)', () => {
    const h = buildCoreHandler();
    expect(h._instance).toBeDefined();
    // Non-enumerable so framework introspection doesn't see it.
    const keys = Object.keys(h);
    expect(keys).not.toContain('_instance');
  });

  it('throws ConfigurationError synchronously on capability mismatch (PRD-500-R10)', () => {
    expect(() =>
      createActFetchHandler({
        // Manifest declares Standard but no resolveSubtree → mismatch.
        manifest: standardManifest(),
        runtime: tenantedRuntime({ acme: ['doc/a'] }),
        identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
        tenantResolver: staticTenant('acme'),
      }),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when manifest.delivery is "static" (PRD-500-R8)', () => {
    expect(() =>
      createActFetchHandler({
        manifest: coreManifest({ delivery: 'static' }),
        runtime: tenantedRuntime({ acme: ['doc/a'] }),
        identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      }),
    ).toThrow(ConfigurationError);
  });
});

describe('PRD-505-R5 URL routing + passthrough mode', () => {
  it('returns null for non-matching paths in passthrough mode (default)', async () => {
    const h = buildCoreHandler();
    const resp = await h(new Request(`${ORIGIN}/api/some-other-route`));
    expect(resp).toBeNull();
  });

  it('returns 404 for non-matching paths in strict mode (with ACT envelope)', async () => {
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
      mode: 'strict',
    });
    const resp = await h(new Request(`${ORIGIN}/api/some-other-route`));
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(404);
    const text = await resp!.text();
    const body = JSON.parse(text) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
    // PRD-500-R29 — discovery Link header even on 404.
    expect(resp!.headers.get('Link')).toContain('rel="act"');
  });

  it('routes the manifest endpoint to dispatch (200 + Link header + Content-Type)', async () => {
    const h = buildCoreHandler();
    const resp = await h(new Request(`${ORIGIN}/.well-known/act.json`));
    expect(resp!.status).toBe(200);
    expect(resp!.headers.get('Content-Type')).toContain('application/act-manifest+json');
    expect(resp!.headers.get('Link')).toContain('rel="act"');
  });

  it('routes a node id containing `/` (PRD-100-R10 + PRD-505-R5)', async () => {
    const h = buildCoreHandler();
    const resp = await h(
      new Request(`${ORIGIN}/act/n/doc/intro`, {
        headers: { authorization: 'Bearer token' },
      }),
    );
    expect(resp!.status).toBe(200);
    const text = await resp!.text();
    const body = JSON.parse(text) as { id: string };
    expect(body.id).toBe('doc/intro');
  });

  it('routes the index endpoint and returns the index envelope', async () => {
    const h = buildCoreHandler();
    const resp = await h(new Request(`${ORIGIN}/act/index.json`));
    expect(resp!.status).toBe(200);
    const text = await resp!.text();
    const body = JSON.parse(text) as { nodes: { id: string }[] };
    expect(body.nodes.map((n) => n.id)).toEqual(['doc/intro']);
  });

  it('returns 404 (not null) for a recognized node id that does not exist (in-band)', async () => {
    const h = buildCoreHandler();
    const resp = await h(new Request(`${ORIGIN}/act/n/doc/never-existed`));
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(404);
  });
});

describe('PRD-505-R3 basePath', () => {
  it('serves the manifest at the basePath-prefixed well-known path', async () => {
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    const ok = await h(new Request(`${ORIGIN}/app/.well-known/act.json`));
    expect(ok!.status).toBe(200);
    // The advertised URLs in the served manifest are basePath-prefixed.
    const body = JSON.parse(await ok!.text()) as {
      index_url: string;
      node_url_template: string;
    };
    expect(body.index_url).toBe('/app/act/index.json');
    expect(body.node_url_template).toBe('/app/act/n/{id}');
    // The un-prefixed path is passthrough (null).
    const passthrough = await h(new Request(`${ORIGIN}/.well-known/act.json`));
    expect(passthrough).toBeNull();
  });

  it('routes node IDs through the basePath prefix', async () => {
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
      basePath: '/app',
    });
    const resp = await h(new Request(`${ORIGIN}/app/act/n/doc/intro`));
    expect(resp!.status).toBe(200);
    const body = JSON.parse(await resp!.text()) as { id: string };
    expect(body.id).toBe('doc/intro');
  });
});

describe('PRD-505-R5 / OQ2 manifestPath override', () => {
  it('serves the manifest at a non-default manifestPath', async () => {
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
      manifestPath: '/api/act-manifest.json',
    });
    const ok = await h(new Request(`${ORIGIN}/api/act-manifest.json`));
    expect(ok!.status).toBe(200);
    // Default well-known path is now passthrough.
    const passthrough = await h(new Request(`${ORIGIN}/.well-known/act.json`));
    expect(passthrough).toBeNull();
  });
});

describe('PRD-505-R7 identity / tenant hooks', () => {
  it('returns 401 when IdentityResolver returns auth_required', async () => {
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
      identityResolver: staticIdentity({ kind: 'auth_required', reason: 'missing' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await h(new Request(`${ORIGIN}/act/index.json`));
    expect(resp!.status).toBe(401);
    expect(resp!.headers.get('WWW-Authenticate')).toBeDefined();
  });

  it('passes the IdentityResolver an ActRequest with header access (PRD-505-R6 + R7)', async () => {
    let capturedAuth: string | null = null;
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
       
      identityResolver: async (actReq) => {
        capturedAuth = actReq.headers.get('authorization');
        return { kind: 'principal', key: 'user-X' };
      },
      tenantResolver: staticTenant('acme'),
    });
    await h(
      new Request(`${ORIGIN}/act/index.json`, {
        headers: { authorization: 'Bearer xyz' },
      }),
    );
    expect(capturedAuth).toBe('Bearer xyz');
  });
});

describe('PRD-505-R8 conditional GET (If-None-Match → 304)', () => {
  it('returns 304 when the ETag matches the request-supplied If-None-Match', async () => {
    const h = buildCoreHandler();
    // First request to get the ETag.
    const ok = await h(new Request(`${ORIGIN}/act/n/doc/intro`));
    const etag = ok!.headers.get('ETag');
    expect(etag).toBeTruthy();
    const repeat = await h(
      new Request(`${ORIGIN}/act/n/doc/intro`, {
        headers: { 'If-None-Match': etag! },
      }),
    );
    expect(repeat!.status).toBe(304);
    expect(await repeat!.text()).toBe('');
  });
});

describe('PRD-505-R9 logger wiring', () => {
  it('passes logger events through to the host-registered Logger', async () => {
    const events: ActLogEvent[] = [];
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/intro'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
      logger: { event: (e) => events.push(e) },
    });
    await h(new Request(`${ORIGIN}/.well-known/act.json`));
    const types = events.map((e) => e.type);
    expect(types).toContain('request_received');
    expect(types).toContain('identity_resolved');
    expect(types).toContain('response_sent');
  });
});

describe('PRD-505-R10 Standard subtree routing', () => {
  it('routes subtree requests when the manifest declares Standard', async () => {
    const runtime = strictRuntime({ acme: ['doc/intro'] });
    const h = createActFetchHandler({
      manifest: standardManifest(),
      runtime,
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await h(new Request(`${ORIGIN}/act/sub/doc/intro`));
    expect(resp!.status).toBe(200);
    const body = JSON.parse(await resp!.text()) as { root: string };
    expect(body.root).toBe('doc/intro');
  });

  it('rejects out-of-range depth with a 400 (PRD-505-R10)', async () => {
    const runtime = strictRuntime({ acme: ['doc/intro'] });
    const h = createActFetchHandler({
      manifest: standardManifest(),
      runtime,
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await h(new Request(`${ORIGIN}/act/sub/doc/intro?depth=99`));
    expect(resp!.status).toBe(400);
  });
});

describe('PRD-505-R11 Plus NDJSON + search routing', () => {
  it('streams the NDJSON endpoint via a ReadableStream-bodied Response', async () => {
    const runtime = strictRuntime({ acme: ['doc/intro'] });
    const h = createActFetchHandler({
      manifest: strictManifest(),
      runtime,
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await h(new Request(`${ORIGIN}/act/index.ndjson`));
    expect(resp!.status).toBe(200);
    expect(resp!.headers.get('Content-Type')).toContain('ndjson');
    const text = await resp!.text();
    const lines = text.trim().split('\n');
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!) as { id: string };
    expect(entry.id).toBe('doc/intro');
  });

  it('routes the search endpoint and returns the resolver value verbatim', async () => {
    const runtime = strictRuntime({ acme: ['doc/intro'] });
    const h = createActFetchHandler({
      manifest: strictManifest(),
      runtime,
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
    });
    const resp = await h(new Request(`${ORIGIN}/act/search?q=hello`));
    expect(resp!.status).toBe(200);
    expect(resp!.headers.get('Content-Type')).toContain('application/json');
    const body = JSON.parse(await resp!.text()) as { query: string };
    expect(body.query).toBe('hello');
  });
});

describe('PRD-505-R8 / PRD-109-R3 cross-tenant 404 byte-equivalence (existence-non-leak)', () => {
  it('cross-tenant 404 body and headers match the absent-node 404', async () => {
    const runtime = tenantedRuntime({ acme: ['doc/a'], beta: ['doc/b'] });
    // Tenant resolver returns acme always — so doc/b is "cross-tenant"
    // from acme's perspective.
    const h = createActFetchHandler({
      manifest: coreManifest(),
      runtime,
      identityResolver: staticIdentity({ kind: 'principal', key: 'u' }),
      tenantResolver: staticTenant('acme'),
    });
    const cross = await h(new Request(`${ORIGIN}/act/n/doc/b`));
    const absent = await h(new Request(`${ORIGIN}/act/n/doc/never-existed`));
    expect(cross!.status).toBe(404);
    expect(absent!.status).toBe(404);
    // Bodies byte-equivalent.
    const crossText = await cross!.text();
    const absentText = await absent!.text();
    expect(crossText).toBe(absentText);
    // Headers that matter byte-equivalent.
    expect(cross!.headers.get('Content-Type')).toBe(absent!.headers.get('Content-Type'));
    expect(cross!.headers.get('Link')).toBe(absent!.headers.get('Link'));
  });
});

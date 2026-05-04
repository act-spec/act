/**
 * PRD-501-R20 — Pages Router escape-hatch tests.
 */
import { describe, expect, it } from 'vitest';

import { createActPagesHandler } from './pages.js';
import {
  coreManifest,
  staticIdentity,
  staticTenant,
  tenantedRuntime,
} from './_fixtures.js';
import type { PagesApiRequestLike, PagesApiResponseLike } from './types.js';

function makeRes(): PagesApiResponseLike & {
  _status: number;
  _headers: Record<string, string | string[]>;
  _body: string;
} {
  const state = {
    _status: 200,
    _headers: {} as Record<string, string | string[]>,
    _body: '',
  };
  return Object.assign(state, {
    status(code: number) {
      state._status = code;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      state._headers[name] = value;
    },
    end(body?: string) {
      state._body = body ?? '';
    },
  } as Pick<PagesApiResponseLike, 'status' | 'setHeader' | 'end'>);
}

describe('PRD-501-R20: Pages Router handler', () => {
  it('serves the manifest envelope', async () => {
    const handler = createActPagesHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req: PagesApiRequestLike = {
      method: 'GET',
      url: '/.well-known/act.json',
      headers: { host: 'example.com' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('application/act-manifest+json');
    expect(JSON.parse(res._body)).toMatchObject({ act_version: '0.1' });
  });

  it('serves a node envelope', async () => {
    const handler = createActPagesHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req: PagesApiRequestLike = {
      method: 'GET',
      url: '/act/n/doc/a',
      headers: { host: 'example.com' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toMatchObject({ id: 'doc/a' });
  });

  it('returns 404 for cross-tenant access (existence non-leak preserved)', async () => {
    const handler = createActPagesHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: ['doc/a'], beta: ['doc/b'] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req: PagesApiRequestLike = {
      method: 'GET',
      url: '/act/n/doc/b',
      headers: { host: 'example.com' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  it('preserves the Link header on 404', async () => {
    const handler = createActPagesHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req: PagesApiRequestLike = {
      method: 'GET',
      url: '/act/n/doc/missing',
      headers: { host: 'example.com' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    const link = res._headers['link'];
    const linkStr = Array.isArray(link) ? link.join(',') : link;
    expect(linkStr).toContain('rel="act"');
  });

  it('falls back to localhost when host header missing', async () => {
    const handler = createActPagesHandler({
      manifest: coreManifest(),
      runtime: tenantedRuntime({ acme: [] }),
      identityResolver: staticIdentity({ kind: 'principal', key: 'u-1' }),
      tenantResolver: staticTenant('acme'),
    });
    const req: PagesApiRequestLike = {
      method: 'GET',
      url: '/.well-known/act.json',
      headers: {},
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});

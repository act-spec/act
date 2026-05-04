/**
 * PRD-500 dispatch pipeline tests. Covers requirements R2, R5, R6, R7,
 * R12, R15, R16, R17, R18, R19, R22, R23, R24, R25, R29, R30, R32, R33,
 * R34, plus R20 (default ETag) and R21 (override invalid shape).
 */
import { describe, expect, it, vi } from 'vitest';

import { createActRuntime } from './runtime.js';
import { defaultEtagComputer } from './etag.js';
import type {
  ActLogEvent,
  ActRequest,
  ActRuntime,
  ActRuntimeConfig,
  Identity,
  IdentityResolver,
  Logger,
  Manifest,
  Tenant,
  TenantResolver,
} from './types.js';

// ---------- helpers --------------------------------------------------------

function req(path: string, init: { headers?: Record<string, string>; method?: ActRequest['method'] } = {}): ActRequest {
  const url = new URL(`http://x.example${path}`);
  return {
    method: init.method ?? 'GET',
    url,
    headers: new Headers(init.headers ?? {}),
    getCookie: () => undefined,
  };
}

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'd.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    index_url: '/i.json',
    node_url_template: '/n/{id}.json',
    ...overrides,
  } as Manifest;
}

type NodeValue = Extract<Awaited<ReturnType<ActRuntime['resolveNode']>>, { kind: 'ok' }>['value'];
type IndexValue = Extract<Awaited<ReturnType<ActRuntime['resolveIndex']>>, { kind: 'ok' }>['value'];

const sampleNode = {
  act_version: '0.1',
  id: 'intro',
  type: 'doc',
  title: 'Intro',
} as unknown as NodeValue;

interface RtState {
  identity: Identity;
  tenant: Tenant;
  visibleNodes: Set<string>;
}

function makeRuntime(state: RtState, partial: Partial<ActRuntime> = {}): ActRuntime {
  return {
    resolveManifest: async () => ({ kind: 'ok', value: manifest() }),
    resolveIndex: async () => ({
      kind: 'ok',
      value: {
        act_version: '0.1',
        nodes: [...state.visibleNodes].map((id) => ({ id, type: 'doc' })),
      } as unknown as IndexValue,
    }),
    resolveNode: async (_req, _ctx, params) => {
      if (!state.visibleNodes.has(params.id)) return { kind: 'not_found' };
      return { kind: 'ok', value: { ...sampleNode, id: params.id } };
    },
    ...partial,
  } as ActRuntime;
}

function buildSystem(opts: {
  manifest?: Manifest;
  state?: RtState;
  runtime?: Partial<ActRuntime>;
  identityResolver?: IdentityResolver;
  tenantResolver?: TenantResolver;
  logger?: Logger;
  etagComputer?: ActRuntimeConfig['etagComputer'];
  basePath?: string;
  anonymousCacheSeconds?: number;
}) {
  const state: RtState = opts.state ?? {
    identity: { kind: 'anonymous' },
    tenant: { kind: 'single' },
    visibleNodes: new Set(['intro']),
  };
  const m = opts.manifest ?? manifest();
  const rt = makeRuntime(state, opts.runtime);
  const config: ActRuntimeConfig = {
    manifest: m,
    runtime: rt,
    identityResolver: opts.identityResolver ?? (async () => state.identity),
    tenantResolver: opts.tenantResolver ?? (async () => state.tenant),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.etagComputer ? { etagComputer: opts.etagComputer } : {}),
    ...(opts.basePath !== undefined ? { basePath: opts.basePath } : {}),
    ...(opts.anonymousCacheSeconds !== undefined ? { anonymousCacheSeconds: opts.anonymousCacheSeconds } : {}),
  };
  return { instance: createActRuntime(config), state };
}

async function bodyOf(resp: { body: string | AsyncIterable<string> | null }): Promise<string> {
  if (resp.body === null) return '';
  if (typeof resp.body === 'string') return resp.body;
  const parts: string[] = [];
  for await (const p of resp.body) parts.push(p);
  return parts.join('');
}

// ---------- tests ----------------------------------------------------------

describe('PRD-500-R5: dispatch pipeline order', () => {
  it('logs request_received → identity_resolved → tenant_resolved → resolver_invoked → response_sent', async () => {
    const events: ActLogEvent[] = [];
    const logger: Logger = { event: (e) => events.push(e) };
    const { instance } = buildSystem({ logger });
    await instance.dispatch(req('/n/intro.json'));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('request_received');
    expect(types).toContain('identity_resolved');
    expect(types).toContain('tenant_resolved');
    expect(types).toContain('resolver_invoked');
    expect(types[types.length - 1]).toBe('response_sent');
  });
});

describe('PRD-500-R15: 200 path serialization (manifest / index / node)', () => {
  it('serves the manifest at the well-known path with ETag + Link + Content-Type', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/.well-known/act.json'));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toMatch(/application\/act-manifest\+json/);
    expect(resp.headers.get('ETag')).toMatch(/^"s256:[A-Za-z0-9_-]{22}"$/);
    expect(resp.headers.get('Link')).toContain('rel="act"');
  });

  it('serves the index with `application/act-index+json; profile=runtime`', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/i.json'));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/act-index+json; profile=runtime');
  });

  it('serves a visible node with the act-node Content-Type', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/act-node+json; profile=runtime');
    expect(resp.headers.get('ETag')).toMatch(/^"s256:/);
  });

  it('PRD-500-R12 — injects act_version=0.1 on every envelope', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json'));
    const env = JSON.parse(await bodyOf(resp)) as { act_version: string };
    expect(env.act_version).toBe('0.1');
  });
});

describe('PRD-500-R17 / R18: error envelope + existence-non-leak', () => {
  it('returns a 404 with not_found error envelope for unknown IDs', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/missing.json'));
    expect(resp.status).toBe(404);
    expect(resp.headers.get('Content-Type')).toBe('application/act-error+json; profile=runtime');
    const env = JSON.parse(await bodyOf(resp)) as { error: { code: string } };
    expect(env.error.code).toBe('not_found');
  });

  it('PRD-500-R18 — existence non-leak: cross-tenant 404 byte-equivalent to absent 404', async () => {
    const stateA: RtState = {
      identity: { kind: 'principal', key: 'alice' },
      tenant: { kind: 'scoped', key: 'acme' },
      visibleNodes: new Set(['a-doc']),
    };
    const { instance } = buildSystem({ state: stateA });

    const absent = await instance.dispatch(req('/n/does-not-exist.json'));
    const cross = await instance.dispatch(req('/n/b-doc.json'));

    expect(absent.status).toBe(404);
    expect(cross.status).toBe(404);
    expect(await bodyOf(absent)).toBe(await bodyOf(cross));
    // Headers should match (Cache-Control, Content-Type, Link).
    expect(absent.headers.get('Cache-Control')).toBe(cross.headers.get('Cache-Control'));
    expect(absent.headers.get('Link')).toBe(cross.headers.get('Link'));
    expect(absent.headers.get('Content-Type')).toBe(cross.headers.get('Content-Type'));
  });

  it('emits one WWW-Authenticate per scheme on 401 (PRD-500-R14 + R17)', async () => {
    const m = manifest({ auth: { schemes: ['cookie', 'bearer'] } as Manifest['auth'] });
    const { instance } = buildSystem({
      manifest: m,
      identityResolver: async () => ({ kind: 'auth_required', reason: 'missing' }),
    });
    const resp = await instance.dispatch(req('/n/x.json'));
    expect(resp.status).toBe(401);
    // Headers.get returns comma-joined; we check via getSetCookie-style by
    // inspecting the entries.
    const all: string[] = [];
    resp.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'www-authenticate') all.push(v);
    });
    // Headers will combine duplicates in `forEach`; the joined value is a
    // single comma-list per WHATWG. Assert both schemes are present.
    const joined = all.join(',');
    expect(joined).toContain('Cookie realm');
    expect(joined).toContain('Bearer realm');
  });

  it('emits Retry-After on 429 (PRD-500-R17)', async () => {
    const { instance } = buildSystem({
      runtime: {
        resolveNode: async () => ({ kind: 'rate_limited', retryAfterSeconds: 12 }),
      },
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(429);
    expect(resp.headers.get('Retry-After')).toBe('12');
    const env = JSON.parse(await bodyOf(resp)) as { error: { code: string; details: { retry_after_seconds: number } } };
    expect(env.error.code).toBe('rate_limited');
    expect(env.error.details.retry_after_seconds).toBe(12);
  });

  it('returns 500 internal when a resolver throws (PRD-500-R4)', async () => {
    const { instance } = buildSystem({
      runtime: {
        resolveNode: async () => {
          throw new Error('boom');
        },
      },
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(500);
    const body = await bodyOf(resp);
    expect(body).not.toContain('boom'); // PRD-109-R14: error message MUST NOT propagate.
  });

  it('returns 500 when the IdentityResolver throws (PRD-500-R6)', async () => {
    const { instance } = buildSystem({
      identityResolver: async () => {
        throw new Error('idp-down');
      },
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(500);
  });

  it('returns 500 when the TenantResolver throws (PRD-500-R7)', async () => {
    const { instance } = buildSystem({
      tenantResolver: async () => {
        throw new Error('tenant-lookup-failed');
      },
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(500);
  });
});

describe('PRD-500-R19 / R20: ETag + If-None-Match', () => {
  it('emits the same ETag across two identical requests (PRD-103-R7 determinism)', async () => {
    const { instance } = buildSystem({});
    const r1 = await instance.dispatch(req('/n/intro.json'));
    const r2 = await instance.dispatch(req('/n/intro.json'));
    expect(r1.headers.get('ETag')).toBe(r2.headers.get('ETag'));
  });

  it('returns 304 with no body when If-None-Match matches', async () => {
    const { instance } = buildSystem({});
    const r1 = await instance.dispatch(req('/n/intro.json'));
    const etag = r1.headers.get('ETag')!;
    const r2 = await instance.dispatch(req('/n/intro.json', { headers: { 'If-None-Match': etag } }));
    expect(r2.status).toBe(304);
    expect(await bodyOf(r2)).toBe('');
    expect(r2.headers.get('ETag')).toBe(etag);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const { instance } = buildSystem({});
    const r2 = await instance.dispatch(req('/n/intro.json', { headers: { 'If-None-Match': '"s256:wrongetagbytesxxxxx"' } }));
    expect(r2.status).toBe(200);
  });

  it('PRD-500-R21 — invalid override return shape maps to 500 internal', async () => {
    const { instance } = buildSystem({
      etagComputer: () => 'not-a-valid-etag-shape',
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(500);
  });

  it('PRD-500-R20 — defaultEtagComputer matches the on-the-wire ETag', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json'));
    const env = JSON.parse(await bodyOf(resp)) as { etag: string };
    const headerEtag = resp.headers.get('ETag')!.replace(/^"|"$/g, '');
    expect(env.etag).toBe(headerEtag);
    // The header etag MUST be reproducible by the public default computer.
    const stripped = JSON.parse(await bodyOf(await instance.dispatch(req('/n/intro.json')))) as Record<string, unknown>;
    delete stripped.etag;
    const recomputed = defaultEtagComputer({ identity: null, payload: stripped, tenant: null });
    expect(recomputed).toBe(env.etag);
  });
});

describe('PRD-500-R22: Cache-Control + Vary by identity', () => {
  it('emits private + Vary on principal responses', async () => {
    const m = manifest({ auth: { schemes: ['bearer'] } as Manifest['auth'] });
    const stateP: RtState = {
      identity: { kind: 'principal', key: 'u1' },
      tenant: { kind: 'single' },
      visibleNodes: new Set(['intro']),
    };
    const { instance } = buildSystem({ manifest: m, state: stateP });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.headers.get('Cache-Control')).toBe('private, must-revalidate');
    expect(resp.headers.get('Vary')).toBe('Authorization');
  });

  it('emits public + max-age on anonymous responses with configured anonymousCacheSeconds', async () => {
    const { instance } = buildSystem({ anonymousCacheSeconds: 120 });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.headers.get('Cache-Control')).toBe('public, max-age=120');
  });
});

describe('PRD-500-R16: content negotiation for the index endpoint', () => {
  it('routes ndjson Accept profile to resolveIndexNdjson', async () => {
    const m = manifest({
      conformance: { level: 'strict' },
      subtree_url_template: '/sub/{id}.json',
      index_ndjson_url: '/i.ndjson',
      search_url_template: '/s?q={query}',
    });
    const { instance } = buildSystem({
      manifest: m,
      runtime: {
        resolveSubtree: async () => ({ kind: 'not_found' }),
        resolveSearch: async () => ({ kind: 'ok', value: {} }),
        resolveIndexNdjson: async () => ({
          kind: 'ok',
          value: (async function* () {
            yield { id: 'a', type: 'doc' };
            yield { id: 'b', type: 'doc' };
          })(),
        }),
      },
    });
    const resp = await instance.dispatch(
      req('/i.json', { headers: { Accept: 'application/act-index+json; profile=ndjson' } }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toMatch(/profile=ndjson/);
    const text = await bodyOf(resp);
    expect(text.split('\n').filter(Boolean).length).toBe(2);
  });

  it('returns 406 when ndjson is requested but no resolver is registered', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(
      req('/i.json', { headers: { Accept: 'application/act-index+json; profile=ndjson' } }),
    );
    expect(resp.status).toBe(406);
    const env = JSON.parse(await bodyOf(resp)) as { error: { code: string; details: { reason: string } } };
    expect(env.error.code).toBe('validation');
    expect(env.error.details.reason).toBe('ndjson_not_supported');
  });

  it('PRD-500-R33: serves NDJSON at the configured index_ndjson_url', async () => {
    const m = manifest({
      conformance: { level: 'strict' },
      subtree_url_template: '/sub/{id}.json',
      index_ndjson_url: '/i.ndjson',
      search_url_template: '/s?q={query}',
    });
    const { instance } = buildSystem({
      manifest: m,
      runtime: {
        resolveSubtree: async () => ({ kind: 'not_found' }),
        resolveSearch: async () => ({ kind: 'ok', value: {} }),
        resolveIndexNdjson: async () => ({
          kind: 'ok',
          value: (async function* () {
            yield { id: 'one', type: 'doc' };
          })(),
        }),
      },
    });
    const resp = await instance.dispatch(req('/i.ndjson'));
    expect(resp.status).toBe(200);
    expect(await bodyOf(resp)).toBe(JSON.stringify({ id: 'one', type: 'doc' }) + '\n');
  });
});

describe('PRD-500-R30: bounded act_version rejection', () => {
  it('rejects request with Accept-Version of a future MAJOR', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json', { headers: { 'Accept-Version': '99.0' } }));
    expect(resp.status).toBe(400);
    const env = JSON.parse(await bodyOf(resp)) as { error: { code: string; details: { reason: string } } };
    expect(env.error.code).toBe('validation');
    expect(env.error.details.reason).toBe('act_version_unsupported');
  });

  it('rejects malformed Accept-Version', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json', { headers: { 'Accept-Version': 'banana' } }));
    expect(resp.status).toBe(400);
  });

  it('accepts the configured MAJOR (0.x)', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json', { headers: { 'Accept-Version': '0.1' } }));
    expect(resp.status).toBe(200);
  });

  it('honors act_version query parameter (rejects future MAJOR)', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json?act_version=99.0'));
    expect(resp.status).toBe(400);
  });
});

describe('PRD-500-R32: subtree depth bounds', () => {
  function strictManifest(): Manifest {
    return manifest({
      conformance: { level: 'strict' },
      subtree_url_template: '/sub/{id}.json',
      index_ndjson_url: '/i.ndjson',
      search_url_template: '/s?q={query}',
    });
  }
  type SubtreeValue = Extract<
    Awaited<ReturnType<NonNullable<ActRuntime['resolveSubtree']>>>,
    { kind: 'ok' }
  >['value'];
  function strictRuntime() {
    const subtreeValue = { act_version: '0.1', root: { id: 'intro' } } as unknown as SubtreeValue;
    return {
      resolveSubtree: vi.fn(async (_req, _ctx, _p) => ({
        kind: 'ok' as const,
        value: subtreeValue,
      })),
      resolveSearch: async () => ({ kind: 'ok' as const, value: {} }),
      resolveIndexNdjson: async () => ({
        kind: 'ok' as const,
        value: (async function* () {
          // empty
        })(),
      }),
    };
  }

  it('returns 400 when depth is out of [0, 8]', async () => {
    const partial = strictRuntime();
    const { instance } = buildSystem({ manifest: strictManifest(), runtime: partial });
    const resp = await instance.dispatch(req('/sub/intro.json?depth=99'));
    expect(resp.status).toBe(400);
    const env = JSON.parse(await bodyOf(resp)) as { error: { details: { reason: string } } };
    expect(env.error.details.reason).toBe('depth_out_of_range');
    expect(partial.resolveSubtree).not.toHaveBeenCalled();
  });

  it('defaults depth to 3 when omitted', async () => {
    const partial = strictRuntime();
    const { instance } = buildSystem({ manifest: strictManifest(), runtime: partial });
    await instance.dispatch(req('/sub/intro.json'));
    expect(partial.resolveSubtree).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      id: 'intro',
      depth: 3,
    });
  });
});

describe('PRD-500-R34: search resolver (Plus)', () => {
  it('serves resolveSearch with `application/json; profile=runtime`', async () => {
    const m = manifest({
      conformance: { level: 'strict' },
      subtree_url_template: '/sub/{id}.json',
      index_ndjson_url: '/i.ndjson',
      search_url_template: '/s?q={query}',
    });
    const { instance } = buildSystem({
      manifest: m,
      runtime: {
        resolveSubtree: async () => ({ kind: 'not_found' }),
        resolveIndexNdjson: async () => ({
          kind: 'ok',
          value: (async function* () {})(),
        }),
        resolveSearch: async (_req, _ctx, p) => ({ kind: 'ok', value: { hits: [p.query] } }),
      },
    });
    const resp = await instance.dispatch(req('/s?q=hello'));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/json; profile=runtime');
    expect(JSON.parse(await bodyOf(resp))).toEqual({ hits: ['hello'] });
  });
});

describe('PRD-500-R23 / R24: Logger no-PII shape', () => {
  it('logs identity_resolved without the principal key', async () => {
    const events: ActLogEvent[] = [];
    const logger: Logger = { event: (e) => events.push(e) };
    const stateP: RtState = {
      identity: { kind: 'principal', key: 'super-secret-uuid-12345' },
      tenant: { kind: 'scoped', key: 'tenant-id-67890' },
      visibleNodes: new Set(['intro']),
    };
    const { instance } = buildSystem({ logger, state: stateP });
    await instance.dispatch(req('/n/intro.json'));
    const idEvent = events.find((e) => e.type === 'identity_resolved')!;
    expect(JSON.stringify(idEvent)).not.toContain('super-secret-uuid-12345');
    const tnEvent = events.find((e) => e.type === 'tenant_resolved')!;
    expect(JSON.stringify(tnEvent)).not.toContain('tenant-id-67890');
  });

  it('logs request_received with redacted path (numeric segments masked)', async () => {
    const events: ActLogEvent[] = [];
    const logger: Logger = { event: (e) => events.push(e) };
    const m = manifest({ node_url_template: '/n/{id}/{id}.json' });
    const stateP: RtState = {
      identity: { kind: 'anonymous' },
      tenant: { kind: 'single' },
      visibleNodes: new Set(['12345']),
    };
    const { instance } = buildSystem({ logger, manifest: m, state: stateP });
    await instance.dispatch(req('/n/12345/anything.json'));
    const ev = events.find((e) => e.type === 'request_received') as Extract<ActLogEvent, { type: 'request_received' }>;
    expect(ev.path).toContain('<id>');
  });
});

describe('PRD-500-R25: X-Request-Id is not consumed for ETag', () => {
  it('two requests with different X-Request-Id produce identical ETags', async () => {
    const { instance } = buildSystem({});
    const a = await instance.dispatch(req('/n/intro.json', { headers: { 'X-Request-Id': 'req-1' } }));
    const b = await instance.dispatch(req('/n/intro.json', { headers: { 'X-Request-Id': 'req-2' } }));
    expect(a.headers.get('ETag')).toBe(b.headers.get('ETag'));
  });
});

describe('PRD-500-R26: basePath mounting', () => {
  it('serves the well-known under basePath', async () => {
    const { instance } = buildSystem({ basePath: '/app' });
    const resp = await instance.dispatch(req('/app/.well-known/act.json'));
    expect(resp.status).toBe(200);
    // Discovery Link reflects the basePath.
    expect(resp.headers.get('Link')).toContain('/app/.well-known/act.json');
  });

  it('returns 404 when the path is outside basePath', async () => {
    const { instance } = buildSystem({ basePath: '/app' });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(404);
  });

  it('serves a node under basePath', async () => {
    const { instance } = buildSystem({ basePath: '/app' });
    const resp = await instance.dispatch(req('/app/n/intro.json'));
    expect(resp.status).toBe(200);
  });
});

describe('PRD-500-R29: discovery Link header on every response', () => {
  it('emits Link on 200', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.headers.get('Link')).toContain('rel="act"');
  });

  it('emits Link on 404 (PRD-500-R29)', async () => {
    const { instance } = buildSystem({});
    const resp = await instance.dispatch(req('/n/missing.json'));
    expect(resp.headers.get('Link')).toContain('rel="act"');
  });

  it('emits Link on 401', async () => {
    const m = manifest({ auth: { schemes: ['bearer'] } as Manifest['auth'] });
    const { instance } = buildSystem({
      manifest: m,
      identityResolver: async () => ({ kind: 'auth_required', reason: 'missing' }),
    });
    const resp = await instance.dispatch(req('/n/x.json'));
    expect(resp.headers.get('Link')).toContain('rel="act"');
  });
});

describe('PRD-500-R12: invalid envelope IDs map to internal', () => {
  it('returns 500 when resolveNode returns an envelope with an invalid id', async () => {
    const { instance } = buildSystem({
      runtime: {
        resolveNode: async () => ({
          kind: 'ok',
          value: { ...sampleNode, id: 'BAD ID WITH SPACES' },
        }),
      },
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(500);
  });

  it('returns 500 when a resolver returns an envelope with conflicting act_version', async () => {
    const { instance } = buildSystem({
      runtime: {
        resolveNode: async () => ({
          kind: 'ok',
          value: { ...sampleNode, act_version: '99.99', id: 'intro' },
        }),
      },
    });
    const resp = await instance.dispatch(req('/n/intro.json'));
    expect(resp.status).toBe(500);
  });
});

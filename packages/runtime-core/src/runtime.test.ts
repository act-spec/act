/**
 * PRD-500-R8, R9, R10, R28 — `createActRuntime` construction tests.
 */
import { describe, expect, it } from 'vitest';

import { ConfigurationError, createActRuntime } from './runtime.js';
import { RUNTIME_CORE_PACKAGE_NAME } from './index.js';
import type {
  ActContext,
  ActRequest,
  ActRuntime,
  ActRuntimeConfig,
  Identity,
  Manifest,
} from './types.js';

const stubIdentity = async (_req: ActRequest): Promise<Identity> => ({ kind: 'anonymous' });

function coreManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'core.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    index_url: '/i.json',
    node_url_template: '/n/{id}.json',
    ...overrides,
  } as Manifest;
}

function coreRuntime(overrides: Partial<ActRuntime> = {}): ActRuntime {
  const indexValue = { act_version: '0.1', nodes: [] };
  return {
    resolveManifest: async (_req, _ctx) => ({ kind: 'ok', value: coreManifest() }),
    resolveIndex: async (_req, _ctx) =>
      ({ kind: 'ok', value: indexValue } as Awaited<ReturnType<ActRuntime['resolveIndex']>>),
    resolveNode: async (_req, _ctx, _p) => ({ kind: 'not_found' as const }),
    ...overrides,
  };
}

function configFor(manifest: Manifest, runtime: ActRuntime): ActRuntimeConfig {
  return { manifest, runtime, identityResolver: stubIdentity };
}

describe('PRD-500-R28: package layout', () => {
  it('exports the canonical package name', () => {
    expect(RUNTIME_CORE_PACKAGE_NAME).toBe('@act-spec/runtime-core');
  });
});

describe('PRD-500-R10: capability negotiation at construction time (Core)', () => {
  it('succeeds when Core resolvers are registered', () => {
    const inst = createActRuntime(configFor(coreManifest(), coreRuntime()));
    expect(inst.basePath).toBe('');
    expect(inst.wellKnownPath).toBe('/.well-known/act.json');
  });

  it('throws when resolveManifest is missing', () => {
    const m = coreManifest();
    const r = coreRuntime();
    delete (r as Partial<ActRuntime>).resolveManifest;
    expect(() => createActRuntime(configFor(m, r))).toThrow(ConfigurationError);
  });

  it('throws when resolveIndex is missing', () => {
    const r = coreRuntime();
    delete (r as Partial<ActRuntime>).resolveIndex;
    expect(() => createActRuntime(configFor(coreManifest(), r))).toThrow(/resolveIndex/);
  });

  it('throws when resolveNode is missing', () => {
    const r = coreRuntime();
    delete (r as Partial<ActRuntime>).resolveNode;
    expect(() => createActRuntime(configFor(coreManifest(), r))).toThrow(/resolveNode/);
  });
});

describe('PRD-500-R10 / R32: capability negotiation at construction time (Standard)', () => {
  it('throws when resolveSubtree is missing for level=standard', () => {
    const m = coreManifest({
      conformance: { level: 'standard' },
      subtree_url_template: '/sub/{id}.json',
    });
    expect(() => createActRuntime(configFor(m, coreRuntime()))).toThrow(/resolveSubtree/);
  });

  it('throws when subtree_url_template is missing for level=standard', () => {
    const m = coreManifest({ conformance: { level: 'standard' } });
    const r = coreRuntime({
      resolveSubtree: async () => ({ kind: 'not_found' }),
    });
    expect(() => createActRuntime(configFor(m, r))).toThrow(/subtree_url_template/);
  });

  it('succeeds when standard config is complete', () => {
    const m = coreManifest({
      conformance: { level: 'standard' },
      subtree_url_template: '/sub/{id}.json',
    });
    const r = coreRuntime({
      resolveSubtree: async () => ({ kind: 'not_found' }),
    });
    expect(() => createActRuntime(configFor(m, r))).not.toThrow();
  });
});

describe('PRD-500-R10 / R33 / R34: capability negotiation at construction time (Plus)', () => {
  function strictManifest(): Manifest {
    return coreManifest({
      conformance: { level: 'strict' },
      subtree_url_template: '/sub/{id}.json',
      index_ndjson_url: '/i.ndjson',
      search_url_template: '/search?q={query}',
    });
  }
  function strictRuntime(): ActRuntime {
    return coreRuntime({
      resolveSubtree: async () => ({ kind: 'not_found' }),
      resolveIndexNdjson: async () => ({
        kind: 'ok',
        value: (async function* () {})(),
      }),
      resolveSearch: async () => ({ kind: 'ok', value: {} }),
    });
  }

  it('succeeds for a complete plus config', () => {
    expect(() => createActRuntime(configFor(strictManifest(), strictRuntime()))).not.toThrow();
  });

  it('throws when resolveIndexNdjson is missing', () => {
    const r = strictRuntime();
    delete (r as Partial<ActRuntime>).resolveIndexNdjson;
    expect(() => createActRuntime(configFor(strictManifest(), r))).toThrow(/resolveIndexNdjson/);
  });

  it('throws when resolveSearch is missing', () => {
    const r = strictRuntime();
    delete (r as Partial<ActRuntime>).resolveSearch;
    expect(() => createActRuntime(configFor(strictManifest(), r))).toThrow(/resolveSearch/);
  });

  it('throws when index_ndjson_url is missing', () => {
    const m = strictManifest();
    delete (m as Partial<Manifest>).index_ndjson_url;
    expect(() => createActRuntime(configFor(m, strictRuntime()))).toThrow(/index_ndjson_url/);
  });

  it('throws when search_url_template is missing', () => {
    const m = strictManifest();
    delete (m as Partial<Manifest>).search_url_template;
    expect(() => createActRuntime(configFor(m, strictRuntime()))).toThrow(/search_url_template/);
  });
});

describe('PRD-500-R10: oauth2 manifest validation', () => {
  it('throws when auth.oauth2 is incomplete', () => {
    const m = coreManifest({
      auth: { schemes: ['oauth2'] } as Manifest['auth'],
    });
    expect(() => createActRuntime(configFor(m, coreRuntime()))).toThrow(/oauth2/);
  });

  it('succeeds when oauth2 fields are complete', () => {
    const m = coreManifest({
      auth: {
        schemes: ['oauth2'],
        oauth2: {
          authorization_endpoint: 'https://x/auth',
          token_endpoint: 'https://x/token',
          scopes_supported: ['act.read'],
        },
      } as Manifest['auth'],
    });
    expect(() => createActRuntime(configFor(m, coreRuntime()))).not.toThrow();
  });
});

describe('PRD-500-R9: capability under-declaration is a startup error', () => {
  it('throws when capabilities.subtree=true but resolveSubtree missing', () => {
    const m = coreManifest({ capabilities: { subtree: true } });
    expect(() => createActRuntime(configFor(m, coreRuntime()))).toThrow(/capabilities.subtree/);
  });

  it('throws when capabilities.ndjson_index=true but resolveIndexNdjson missing', () => {
    const m = coreManifest({ capabilities: { ndjson_index: true } });
    expect(() => createActRuntime(configFor(m, coreRuntime()))).toThrow(/capabilities.ndjson_index/);
  });
});

describe('PRD-500-R8: manifest delivery handling', () => {
  it('injects delivery=runtime when host omits it', () => {
    const m = coreManifest();
    delete (m as Partial<Manifest>).delivery;
    const inst = createActRuntime(configFor(m, coreRuntime()));
    expect(inst.manifest.delivery).toBe('runtime');
  });

  it('injects act_version=0.1 when host omits it', () => {
    const m = coreManifest();
    delete (m as Partial<Manifest>).act_version;
    const inst = createActRuntime(configFor(m, coreRuntime()));
    expect(inst.manifest.act_version).toBe('0.1');
  });

  it('throws when host supplies delivery=static (configuration error)', () => {
    const m = coreManifest({ delivery: 'static' });
    expect(() => createActRuntime(configFor(m, coreRuntime()))).toThrow(/delivery/);
  });
});

describe('PRD-500-R26: mountability', () => {
  it('honors a configured basePath', () => {
    const inst = createActRuntime({
      ...configFor(coreManifest(), coreRuntime()),
      basePath: '/app',
    });
    expect(inst.basePath).toBe('/app');
  });

  it('honors a configured well-known path', () => {
    const inst = createActRuntime({
      ...configFor(coreManifest(), coreRuntime()),
      wellKnownPath: '/act.json',
    });
    expect(inst.wellKnownPath).toBe('/act.json');
  });

  it('defaults well-known to /.well-known/act.json (PRD-100-R3)', () => {
    const inst = createActRuntime(configFor(coreManifest(), coreRuntime()));
    expect(inst.wellKnownPath).toBe('/.well-known/act.json');
  });
});

// Smoke check that ConfigurationError is named correctly so consumers can
// `instanceof` it from across module boundaries.
describe('ConfigurationError class', () => {
  it('has name "ConfigurationError"', () => {
    const e = new ConfigurationError('oops');
    expect(e.name).toBe('ConfigurationError');
    expect(e.message).toBe('oops');
  });
});

describe('PRD-500-R27: lifetime hooks are optional', () => {
  it('returns an instance with no init/dispose by default', () => {
    const inst = createActRuntime(configFor(coreManifest(), coreRuntime()));
    // PRD-500-R27 — init() and dispose() are OPTIONAL; the SDK MAY omit them.
    // The returned instance shape MUST allow both shapes (`undefined` or function).
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: PRD-500-R27 asserts undefined / function shape, no invocation.
    expect(inst.init).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: PRD-500-R27 asserts undefined / function shape, no invocation.
    expect(inst.dispose).toBeUndefined();
    // dispatch() is the required method per PRD-500-R5.
    expect(typeof inst.dispatch).toBe('function');
  });
});

describe('PRD-500-R1 / R3: ActRuntime interface is structurally compatible', () => {
  it('a minimal Core runtime satisfies the interface and dispatches', async () => {
    // PRD-500-R1 — leaf SDKs MUST expose a public API structurally compatible
    // with these signatures; this test pins the structural shape that the
    // contract package itself satisfies.
    const inst = createActRuntime(configFor(coreManifest(), coreRuntime()));
    const req: ActRequest = {
      method: 'GET',
      url: new URL('http://x/.well-known/act.json'),
      headers: new Headers(),
      getCookie: () => undefined,
    };
    const resp = await inst.dispatch(req);
    expect(resp.status).toBe(200);
  });
});

// Use `_ctx` parameter intentionally; placate `noUnusedLocals` in test fixtures.
type _CtxRef = ActContext;

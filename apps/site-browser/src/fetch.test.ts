// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We mock `@act-spec/validator` at the module boundary so the fetch tests
// don't depend on AJV-compiled schemas. Each validate* helper returns no
// gaps/warnings by default; individual tests override via the mock-call
// surface when they need to assert dispatch.
vi.mock('@act-spec/validator', () => ({
  validateManifest: vi.fn(() => ({ ok: true, gaps: [], warnings: [] })),
  validateIndex: vi.fn(() => ({ ok: true, gaps: [], warnings: [] })),
  validateNode: vi.fn(() => ({ ok: true, gaps: [], warnings: [] })),
  validateSubtree: vi.fn(() => ({ ok: true, gaps: [], warnings: [] })),
}));

vi.mock('@act-spec/inspector', () => ({
  node: vi.fn(),
  ACT_VERSION: '0.1',
  INSPECTOR_VERSION: '0.0.0',
}));

import {
  loadHtml,
  loadIndexLazy,
  loadNode,
  loadSite,
  loadSubtree,
  normaliseManifestUrl,
  type SiteHandle,
} from './fetch.js';
import {
  validateIndex,
  validateManifest,
  validateNode,
  validateSubtree,
} from '@act-spec/validator';

interface FetchCallStub {
  ok: boolean;
  status?: number;
  body?: unknown;
  throws?: unknown;
}

function stubFetch(map: Record<string, FetchCallStub>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const stub = map[url];
    if (!stub) throw new Error(`unstubbed fetch URL: ${url}`);
    if (stub.throws !== undefined) {
      if (stub.throws instanceof Error) throw stub.throws;
      throw new Error('non-Error stub.throws');
    }
    const bodyText = stub.body === undefined ? '' : JSON.stringify(stub.body);
    return {
      ok: stub.ok,
      status: stub.status ?? (stub.ok ? 200 : 404),
      json: async () => stub.body,
      text: async () => bodyText,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const validManifest = {
  act_version: '0.1',
  site: { id: 'demo', name: 'Demo' },
  index_url: '/act/index.json',
  node_url_template: '/act/nodes/{id}.json',
  root_id: 'root',
  conformance: { level: 'core' },
  delivery: 'static',
};

const validIndex = {
  act_version: '0.1',
  nodes: [
    { id: 'root', type: 'site_root', title: 'Root', summary: '', children: [] },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('normaliseManifestUrl', () => {
  it('appends /.well-known/act.json to a bare origin', () => {
    expect(normaliseManifestUrl('https://x')).toBe('https://x/.well-known/act.json');
  });

  it('strips a trailing slash before appending', () => {
    expect(normaliseManifestUrl('https://x/')).toBe('https://x/.well-known/act.json');
    expect(normaliseManifestUrl('https://x///')).toBe('https://x/.well-known/act.json');
  });

  it('passes well-known URLs through unchanged', () => {
    const u = 'https://x/.well-known/act.json';
    expect(normaliseManifestUrl(u)).toBe(u);
  });

  it('passes any /act.json URL through unchanged', () => {
    expect(normaliseManifestUrl('https://x/foo/act.json')).toBe('https://x/foo/act.json');
  });

  it('trims whitespace before normalising', () => {
    expect(normaliseManifestUrl('  https://x  ')).toBe('https://x/.well-known/act.json');
  });
});

describe('loadSite', () => {
  beforeEach(() => {
    vi.mocked(validateManifest).mockReturnValue({ ok: true, gaps: [], warnings: [] });
    vi.mocked(validateIndex).mockReturnValue({ ok: true, gaps: [], warnings: [] });
  });

  it('returns a SiteHandle with manifest + rootId on happy path (does NOT fetch index)', async () => {
    const fetchFn = stubFetch({
      'https://x/.well-known/act.json': { ok: true, body: validManifest },
    });

    const result = await loadSite('https://x');
    if (!('manifestUrl' in result)) {
      throw new Error('expected SiteHandle, got failure');
    }
    expect(result.manifestUrl).toBe('https://x/.well-known/act.json');
    expect(result.manifest.site.name).toBe('Demo');
    expect(result.rootId).toBe('root');
    expect(result.manifestGaps).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.manifestBytes).toBe(JSON.stringify(validManifest).length);
    // Critical: progressive walk model — index is never fetched eagerly.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://x/.well-known/act.json', expect.any(Object));
  });

  it('returns errors with scope=manifest when the manifest 404s', async () => {
    stubFetch({
      'https://x/.well-known/act.json': { ok: false, status: 404 },
    });
    const result = await loadSite('https://x');
    expect('manifestUrl' in result).toBe(false);
    if ('manifestUrl' in result) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.scope).toBe('manifest');
    expect(result.errors[0]?.message).toContain('404');
  });

  it('marks cors:true when fetch throws TypeError', async () => {
    stubFetch({
      'https://x/.well-known/act.json': { throws: new TypeError('Failed to fetch'), ok: false },
    });
    const result = await loadSite('https://x');
    if ('manifestUrl' in result) throw new Error('expected failure');
    expect(result.errors[0]?.cors).toBe(true);
  });

  it('does NOT mark cors:true for a non-TypeError throw', async () => {
    stubFetch({
      'https://x/.well-known/act.json': { throws: new Error('aborted'), ok: false },
    });
    const result = await loadSite('https://x');
    if ('manifestUrl' in result) throw new Error('expected failure');
    expect(result.errors[0]?.cors).toBeUndefined();
  });

  it('aborts with scope=manifest when validateManifest reports a blocking gap', async () => {
    vi.mocked(validateManifest).mockReturnValueOnce({
      ok: false,
      gaps: [{ requirement: 'PRD-600-R1', missing: 'site is required', level: 'core' }],
      warnings: [],
    });
    stubFetch({
      'https://x/.well-known/act.json': { ok: true, body: { not: 'a manifest' } },
    });
    const result = await loadSite('https://x');
    if ('manifestUrl' in result) throw new Error('expected failure');
    expect(result.errors[0]?.scope).toBe('manifest');
    expect(result.errors[0]?.message).toContain('site is required');
  });

  it('propagates non-blocking manifest gaps onto the SiteHandle', async () => {
    vi.mocked(validateManifest).mockReturnValueOnce({
      ok: false,
      gaps: [{ requirement: 'PRD-100-R3', missing: 'optional field', level: 'strict' }],
      warnings: [{ code: 'soft', message: 'heads up', level: 'strict' }],
    });
    stubFetch({
      'https://x/.well-known/act.json': { ok: true, body: validManifest },
    });
    const result = await loadSite('https://x');
    if (!('manifestUrl' in result)) throw new Error('expected SiteHandle');
    expect(result.manifestGaps).toHaveLength(1);
    expect(result.manifestWarnings).toHaveLength(1);
  });
});

describe('loadNode', () => {
  function handle(): SiteHandle {
    return {
      manifestUrl: 'https://x/.well-known/act.json',
      manifest: validManifest as SiteHandle['manifest'],
      rootId: 'root',
      errors: [],
      manifestGaps: [],
      manifestWarnings: [],
      manifestBytes: 0,
      manifestGzipBytes: null,
      hasSubtreeTemplate: false,
    };
  }

  it('substitutes {id} into node_url_template and resolves against manifestUrl', async () => {
    const body = { act_version: '0.1', id: 'root', type: 'site_root' };
    const fetchFn = stubFetch({
      'https://x/act/nodes/root.json': {
        ok: true,
        body,
      },
    });
    const outcome = await loadNode(handle(), 'root');
    expect(outcome.error).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledWith(
      'https://x/act/nodes/root.json',
      expect.any(Object),
    );
    expect(outcome.bytes).toBe(JSON.stringify(body).length);
  });

  it('URL-encodes ids that contain slashes', async () => {
    const fetchFn = stubFetch({
      'https://x/act/nodes/cms%2Fen-US%2Flanding.json': {
        ok: true,
        body: { id: 'cms/en-US/landing' },
      },
    });
    await loadNode(handle(), 'cms/en-US/landing');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://x/act/nodes/cms%2Fen-US%2Flanding.json',
      expect.any(Object),
    );
  });

  it('populates gaps and warnings from validateNode', async () => {
    vi.mocked(validateNode).mockReturnValueOnce({
      ok: false,
      gaps: [{ requirement: 'PRD-100-R5', missing: 'no etag', level: 'core' }],
      warnings: [{ code: 'X', message: 'm', level: 'strict' }],
    });
    stubFetch({
      'https://x/act/nodes/root.json': { ok: true, body: { id: 'root' } },
    });
    const outcome = await loadNode(handle(), 'root');
    expect(outcome.gaps).toHaveLength(1);
    expect(outcome.warnings).toHaveLength(1);
  });

  it('returns a node-scope error on HTTP 404', async () => {
    stubFetch({
      'https://x/act/nodes/missing.json': { ok: false, status: 404 },
    });
    const outcome = await loadNode(handle(), 'missing');
    expect(outcome.error?.scope).toBe('node');
    expect(outcome.error?.message).toContain('404');
    expect(outcome.bytes).toBe(0);
  });

  it('marks cors:true on TypeError throw', async () => {
    stubFetch({
      'https://x/act/nodes/root.json': { throws: new TypeError('boom'), ok: false },
    });
    const outcome = await loadNode(handle(), 'root');
    expect(outcome.error?.cors).toBe(true);
  });
});

describe('CORS detection (via loadSite)', () => {
  it('TypeError -> cors:true', async () => {
    stubFetch({
      'https://x/.well-known/act.json': { throws: new TypeError('Failed'), ok: false },
    });
    const r = await loadSite('https://x');
    if ('manifestUrl' in r) throw new Error('expected failure');
    expect(r.errors[0]?.cors).toBe(true);
  });

  it('plain Error -> cors omitted', async () => {
    stubFetch({
      'https://x/.well-known/act.json': { throws: new Error('Failed'), ok: false },
    });
    const r = await loadSite('https://x');
    if ('manifestUrl' in r) throw new Error('expected failure');
    expect(r.errors[0]?.cors).toBeUndefined();
  });
});

describe('loadSubtree', () => {
  function handleWithSubtree(): SiteHandle {
    const m = {
      ...validManifest,
      subtree_url_template: '/act/subtrees/{id}.json',
    } as SiteHandle['manifest'];
    return {
      manifestUrl: 'https://x/.well-known/act.json',
      manifest: m,
      rootId: 'root',
      errors: [],
      manifestGaps: [],
      manifestWarnings: [],
      manifestBytes: 0,
      manifestGzipBytes: null,
      hasSubtreeTemplate: true,
    };
  }

  it('fetches the subtree URL and reports byte size', async () => {
    const subtreeBody = {
      act_version: '0.1',
      root: 'catalog',
      depth: 1,
      truncated: true,
      tokens: { summary: 0, body: 0 },
      nodes: [{ id: 'catalog', type: 'index', title: 'Catalog' }],
    };
    stubFetch({
      'https://x/act/subtrees/catalog.json': { ok: true, body: subtreeBody },
    });
    const outcome = await loadSubtree(handleWithSubtree(), 'catalog');
    expect(outcome.error).toBeUndefined();
    expect(outcome.subtree?.root).toBe('catalog');
    expect(outcome.bytes).toBe(JSON.stringify(subtreeBody).length);
  });

  it('errors with scope=subtree when manifest does not advertise subtree_url_template', async () => {
    const noSub = handleWithSubtree();
    delete (noSub.manifest as Record<string, unknown>).subtree_url_template;
    noSub.hasSubtreeTemplate = false;
    const outcome = await loadSubtree(noSub, 'catalog');
    expect(outcome.error?.scope).toBe('subtree');
    expect(outcome.error?.message).toContain('does not advertise');
  });

  it('returns scope=subtree on HTTP 404', async () => {
    stubFetch({
      'https://x/act/subtrees/missing.json': { ok: false, status: 404 },
    });
    const outcome = await loadSubtree(handleWithSubtree(), 'missing');
    expect(outcome.error?.scope).toBe('subtree');
    expect(outcome.error?.message).toContain('404');
  });

  it('surfaces validateSubtree gaps + warnings', async () => {
    vi.mocked(validateSubtree).mockReturnValueOnce({
      ok: false,
      gaps: [{ requirement: 'PRD-100-R7', missing: 'root unset', level: 'core' }],
      warnings: [{ code: 'soft', message: 'm', level: 'strict' }],
    });
    stubFetch({
      'https://x/act/subtrees/root.json': { ok: true, body: { x: 1 } },
    });
    const outcome = await loadSubtree(handleWithSubtree(), 'root');
    expect(outcome.gaps).toHaveLength(1);
    expect(outcome.warnings).toHaveLength(1);
  });
});

describe('loadIndexLazy', () => {
  function h(): SiteHandle {
    return {
      manifestUrl: 'https://x/.well-known/act.json',
      manifest: validManifest as SiteHandle['manifest'],
      rootId: 'root',
      errors: [],
      manifestGaps: [],
      manifestWarnings: [],
      manifestBytes: 0,
      manifestGzipBytes: null,
      hasSubtreeTemplate: false,
    };
  }

  it('fetches the flat index on demand and reports bytes', async () => {
    stubFetch({
      'https://x/act/index.json': { ok: true, body: validIndex },
    });
    const outcome = await loadIndexLazy(h());
    expect(outcome.error).toBeUndefined();
    expect(outcome.entries).toHaveLength(1);
    expect(outcome.bytes).toBe(JSON.stringify(validIndex).length);
  });

  it('returns scope=index error on HTTP 404', async () => {
    stubFetch({
      'https://x/act/index.json': { ok: false, status: 404 },
    });
    const outcome = await loadIndexLazy(h());
    expect(outcome.error?.scope).toBe('index');
  });
});

describe('loadHtml', () => {
  function stubHtmlFetch(map: Record<string, FetchCallStub>): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async (url: string) => {
      const stub = map[url];
      if (!stub) throw new Error(`unstubbed fetch URL: ${url}`);
      if (stub.throws !== undefined) {
        if (stub.throws instanceof Error) throw stub.throws;
        throw new Error('non-Error stub.throws');
      }
      const bodyText = stub.body === undefined ? '' : String(stub.body);
      return {
        ok: stub.ok,
        status: stub.status ?? (stub.ok ? 200 : 404),
        text: async () => bodyText,
      } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('returns ok + bytes for a 200 response', async () => {
    stubHtmlFetch({
      'https://x/p/sku-1/': { ok: true, body: '<html><body>Hello</body></html>' },
    });
    const outcome = await loadHtml('https://x/p/sku-1/');
    expect(outcome.ok).toBe(true);
    expect(outcome.bytes).toBe('<html><body>Hello</body></html>'.length);
  });

  it('returns ok=false on HTTP 4xx', async () => {
    stubHtmlFetch({
      'https://x/missing/': { ok: false, status: 404 },
    });
    const outcome = await loadHtml('https://x/missing/');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('404');
  });

  it('reports CORS-likely on TypeError throw', async () => {
    stubHtmlFetch({
      'https://x/blocked/': { throws: new TypeError('Failed to fetch'), ok: false },
    });
    const outcome = await loadHtml('https://x/blocked/');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('CORS');
  });
});

/**
 * Conformance gate for @act-spec/runtime-next.
 *
 * Runs `@act-spec/validator`'s `validateSite` runtime-walk path against an
 * in-process Next.js mount via a synthetic fetcher that translates fetch
 * calls into `mount.{manifest,index,node}` invocations. The synthetic
 * fetcher emulates Next.js App Router routing for the catch-all `[...id]`
 * segment by parsing the request URL against the manifest's templates.
 *
 * Pass criterion: zero gaps from `validateSite` against a Standard mount
 * with one tenant, one principal, three nodes. (Plus is not exercised in
 * this gate to keep the conformance run fast; PRD-501-R22 plus paths are
 * exercised in unit tests.)
 *
 * Invoked by `pnpm -F @act-spec/runtime-next conformance`.
 */
import { deriveEtag, validateSite } from '@act-spec/validator';
import {
  defineActMount,
  type ActRuntime,
  type Identity,
  type Manifest,
  type Tenant,
} from './src/index.js';

const ORIGIN = 'http://probe.local';

function manifest(): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'conformance.example' },
    delivery: 'runtime',
    conformance: { level: 'standard' },
    auth: { schemes: ['bearer'] },
    index_url: '/act/index.json',
    node_url_template: '/act/n/{id}',
    subtree_url_template: '/act/sub/{id}',
  };
}

function buildRuntime(): ActRuntime {
  const docs = [
    { id: 'doc/intro', title: 'Intro', summary: 'Welcome to the workspace.', body: 'Body of intro.' },
    { id: 'doc/setup', title: 'Setup', summary: 'How to set up your account.', body: 'Body of setup.' },
    { id: 'doc/billing', title: 'Billing', summary: 'Plans and pricing.', body: 'Body of billing.' },
  ];
  const fixedDate = '2026-05-02T00:00:00Z';
  return {
    async resolveManifest(_req, _ctx) {
      return { kind: 'ok', value: manifest() };
    },
    async resolveIndex(_req, _ctx) {
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          nodes: docs.map((d) => ({
            id: d.id,
            type: 'article',
            title: d.title,
            summary: d.summary,
            tokens: { summary: 8 },
            // Per PRD-100-R20, every IndexEntry MUST carry an etag.
            // The runtime SDK's defaultEtagComputer stamps the index
            // envelope's etag, not per-entry; the host populates the
            // per-entry etags by hashing the entry payload itself
            // (typically derived from the source content's revision).
            // For the conformance fixture we use a stable sentinel.
            etag: deriveEtag({ id: d.id, title: d.title, summary: d.summary }),
            updated_at: fixedDate,
          })),
        },
      };
    },
    async resolveNode(_req, _ctx, params) {
      const doc = docs.find((d) => d.id === params.id);
      if (!doc) return { kind: 'not_found' };
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          id: doc.id,
          type: 'article',
          title: doc.title,
          summary: doc.summary,
          content: [{ type: 'prose', text: doc.body }],
          tokens: { summary: 8, body: 25 },
          etag: '',
          updated_at: fixedDate,
        },
      };
    },
    async resolveSubtree(_req, _ctx, params) {
      const doc = docs.find((d) => d.id === params.id);
      if (!doc) return { kind: 'not_found' };
      return {
        kind: 'ok',
        value: {
          act_version: '0.1',
          root: {
            id: doc.id,
            type: 'article',
            title: doc.title,
            summary: doc.summary,
            tokens: { summary: 8 },
            etag: '',
            updated_at: fixedDate,
          },
        },
      };
    },
  };
}

/**
 * Synthetic fetcher: translates a `fetch(url, init)` call into a
 * `mount.<endpoint>` invocation. The dispatch happens in-process; no
 * actual HTTP server is started.
 *
 * The mount is built once for the lifetime of the conformance run.
 */
function buildSyntheticFetcher(mount: ReturnType<typeof defineActMount>): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    headers.set('authorization', 'Bearer probe-token');
    const req = new Request(url, { method, headers });
    if (u.pathname === '/.well-known/act.json') {
      return mount.manifest(req);
    }
    if (u.pathname === '/act/index.json') {
      return mount.index(req);
    }
    if (u.pathname.startsWith('/act/n/')) {
      const idEncoded = u.pathname.slice('/act/n/'.length);
      const segments = idEncoded.split('/').map((s) => decodeURIComponent(s));
      return mount.node(req, { params: { id: segments } });
    }
    if (u.pathname.startsWith('/act/sub/')) {
      const idEncoded = u.pathname.slice('/act/sub/'.length);
      const segments = idEncoded.split('/').map((s) => decodeURIComponent(s));
      return mount.subtree!(req, { params: { id: segments } });
    }
    return new Response('not found', { status: 404 });
  };
}

async function main(): Promise<void> {
  const mount = defineActMount({
    manifest: manifest(),
    runtime: buildRuntime(),
    identityResolver: async (req): Promise<Identity> => {
      if (req.headers.get('authorization')) {
        return { kind: 'principal', key: 'probe-user' };
      }
      return { kind: 'auth_required' };
    },
    tenantResolver: async (): Promise<Tenant> => ({ kind: 'scoped', key: 'probe-tenant' }),
  });

  const fetcher = buildSyntheticFetcher(mount);
  console.log('Conformance — running validateSite against in-process @act-spec/runtime-next mount');
  const report = await validateSite(`${ORIGIN}/.well-known/act.json`, {
    fetch: fetcher,
    sample: 'all',
    passedAt: '2026-05-02T00:00:00Z',
  });

  console.log(`Declared: level=${report.declared.level} delivery=${report.declared.delivery}`);
  console.log(`Achieved: level=${report.achieved.level} delivery=${report.achieved.delivery}`);
  if (report.walk_summary) {
    console.log(
      `Walk: ${report.walk_summary.requests_made} requests, ${report.walk_summary.nodes_sampled} nodes sampled.`,
    );
  }
  console.log(`Gaps: ${report.gaps.length}; Warnings: ${report.warnings.length}`);

  if (report.gaps.length > 0) {
    console.error('\nFAIL — gaps:');
    for (const g of report.gaps) {
      console.error(`  [${g.requirement}] (${g.level}) ${g.missing}`);
    }
    process.exit(1);
  }
  // Warnings other than the mandatory PRD-600-R24 search-body-deferred
  // notice are surfaced for visibility but do not fail the gate.
  for (const w of report.warnings) {
    console.warn(`  warn [${w.code}] ${w.message}`);
  }
  console.log('\nPASS — runtime-walk against @act-spec/runtime-next: 0 gaps.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/**
 * Conformance gate for @act-spec/runtime-express.
 *
 * Runs `@act-spec/validator`'s `validateSite` runtime-walk path against
 * an in-process Express mount via a synthetic fetcher that translates
 * fetch calls into router-middleware invocations against an in-process
 * Express-style req/res stub.
 *
 * Pass criterion: zero gaps from `validateSite` against a Standard mount
 * with one tenant, one principal, three nodes. (Plus is not exercised in
 * this gate to keep the conformance run fast; PRD-502-R22 plus paths are
 * exercised in unit tests.)
 *
 * Invoked by `pnpm -F @act-spec/runtime-express conformance`.
 */
import { deriveEtag, validateSite } from '@act-spec/validator';

import {
  actRouter,
  type ActRuntime,
  type Identity,
  type Manifest,
  type Tenant,
} from './src/index.js';
import {
  recordingResponse,
  type RecordingResponse,
} from './src/_fixtures.js';
import type { ExpressRequestLike } from './src/types.js';

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
    // eslint-disable-next-line @typescript-eslint/require-await
    async resolveManifest(_req, _ctx) {
      return { kind: 'ok', value: manifest() };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
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
            etag: deriveEtag({ id: d.id, title: d.title, summary: d.summary }),
            updated_at: fixedDate,
          })),
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // eslint-disable-next-line @typescript-eslint/require-await
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
 * router-middleware invocation. The dispatch happens in-process; no
 * actual HTTP server is started.
 */
function buildSyntheticFetcher(
  router: ReturnType<typeof actRouter>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const headersRecord: Record<string, string | string[] | undefined> = {};
    const incomingHeaders = new Headers(init?.headers);
    incomingHeaders.set('authorization', 'Bearer probe-token');
    incomingHeaders.set('host', u.host);
    incomingHeaders.forEach((v, k) => {
      headersRecord[k] = v;
    });
    const req: ExpressRequestLike = {
      method,
      url: u.pathname + u.search,
      originalUrl: u.pathname + u.search,
      protocol: u.protocol.replace(/:$/, ''),
      headers: headersRecord,
    };
    const res: RecordingResponse = recordingResponse();
    await router(req, res, () => undefined);
    // Convert recording → WHATWG Response for validateSite.
    const respHeaders = new Headers();
    for (const [name, values] of res.collectedHeaders) {
      for (const v of values) respHeaders.append(name, v);
    }
    return new Response(res.body || null, {
      status: res.statusCode || 404,
      headers: respHeaders,
    });
  };
}

async function main(): Promise<void> {
  const router = actRouter({
    manifest: manifest(),
    runtime: buildRuntime(),
    // eslint-disable-next-line @typescript-eslint/require-await
    identityResolver: async (req): Promise<Identity> => {
      if (req.headers.get('authorization')) {
        return { kind: 'principal', key: 'probe-user' };
      }
      return { kind: 'auth_required' };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    tenantResolver: async (): Promise<Tenant> => ({ kind: 'scoped', key: 'probe-tenant' }),
  });

  const fetcher = buildSyntheticFetcher(router);
  console.log(
    'Conformance — running validateSite against in-process @act-spec/runtime-express mount',
  );
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
  for (const w of report.warnings) {
    console.warn(`  warn [${w.code}] ${w.message}`);
  }
  console.log('\nPASS — runtime-walk against @act-spec/runtime-express: 0 gaps.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

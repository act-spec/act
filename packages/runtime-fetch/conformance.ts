/**
 * Conformance gate for @act-spec/runtime-fetch.
 *
 * Runs `@act-spec/validator`'s `validateSite` runtime-walk path against
 * an in-process WHATWG-fetch handler via a synthetic fetcher that
 * funnels every `fetch(url, init)` call directly into
 * `createActFetchHandler(...)(req)`. The dispatch happens in-process;
 * no actual HTTP server is started.
 *
 * Pass criterion: zero gaps from `validateSite` against a Standard mount
 * with one tenant, one principal, three nodes. (Plus is not exercised
 * in this gate to keep the conformance run fast; PRD-505-R11 plus paths
 * are exercised in unit tests.)
 *
 * Invoked by `pnpm -F @act-spec/runtime-fetch conformance`.
 */
import { deriveEtag, validateSite } from '@act-spec/validator';

import {
  createActFetchHandler,
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
          root: doc.id,
          etag: '',
          depth: params.depth,
          nodes: [
            {
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
          ],
        },
      };
    },
  };
}

/**
 * Synthetic fetcher: translates a `fetch(url, init)` call directly into
 * the WHATWG-fetch handler invocation. The handler IS a WHATWG-fetch
 * function; this fetcher is little more than a thin shim that injects
 * the probe's bearer token.
 */
function buildSyntheticFetcher(
  handler: ReturnType<typeof createActFetchHandler>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    headers.set('authorization', 'Bearer probe-token');
    const req = new Request(url, {
      method: init?.method ?? 'GET',
      headers,
    });
    const resp = await handler(req);
    // In passthrough mode (the default) `null` would mean "not an ACT
    // endpoint". For the validator walk, every request targets an ACT
    // endpoint, so we treat null as a 404 for safety (and to surface
    // bugs in the routing logic).
    return resp ?? new Response('not found', { status: 404 });
  };
}

async function main(): Promise<void> {
  const handler = createActFetchHandler({
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

  const fetcher = buildSyntheticFetcher(handler);
  console.log(
    'Conformance — running validateSite against in-process @act-spec/runtime-fetch handler',
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
  console.log('\nPASS — runtime-walk against @act-spec/runtime-fetch: 0 gaps.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/**
 * Headless WordPress blog example — build entry point.
 *
 * Drives the canonical generator pipeline (`runPipeline` + `emitFiles`) with
 * `@act-spec/adapter-wordpress`, sourcing data from a baked WP REST fixture
 * (`fixtures/wordpress-rest.json`). A custom `fetch` impl translates the
 * adapter's REST URLs into reads from that fixture file, so the example runs
 * deterministically with no live WordPress server in the loop.
 *
 * Output (written into `public/`):
 *   public/.well-known/act.json          — discovery manifest
 *   public/act/index.json                — flat index of every ACT node
 *   public/act/nodes/{id}.json           — one envelope per WP entity
 *   public/act/subtrees/{id}.json        — subtree files
 *   public/llms.txt                      — back-compat surface (default-on)
 *   public/llms-full.txt                 — back-compat surface (default-on)
 *   public/.act-build-report.json        — sidecar build report
 *
 * To point this at a real WordPress site instead, drop the custom `fetch` in
 * `createWordPressAdapter({ ... })` and supply `baseUrl` in the adapter
 * `config` block. The rest of the pipeline is identical.
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWordPressAdapter } from '@act-spec/adapter-wordpress';
import type { FetchLike } from '@act-spec/adapter-wordpress';
import {
  emitFiles,
  runPipeline,
  verifyCapabilityBacking,
  type GeneratorConfig,
} from '@act-spec/generator-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const outputDir = path.join(exampleRoot, 'public');
const fixturePath = path.join(exampleRoot, 'fixtures', 'wordpress-rest.json');
const FAKE_BASE_URL = 'https://blog.example';

interface WpRestFixture {
  posts?: unknown[];
  pages?: unknown[];
  categories?: unknown[];
  tags?: unknown[];
  users?: unknown[];
  media?: unknown[];
  [k: string]: unknown;
}

interface ConsoleLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

function makeLogger(): ConsoleLogger {
  return {
    debug: (msg) => console.log(`  ${msg}`),
    info: (msg) => console.log(`[act] ${msg}`),
    warn: (msg) => console.warn(`[act][warn] ${msg}`),
    error: (msg) => console.error(`[act][error] ${msg}`),
  };
}

/**
 * Build a `fetch` impl that serves the bundled WordPress REST fixture.
 *
 * The adapter calls URLs of the shape:
 *   {baseUrl}/wp-json/wp/v2/{collection}?per_page=N&page=K&...
 *
 * We parse the collection slug, hand back the matching array on page 1, and
 * return an empty array on subsequent pages so the adapter's pagination loop
 * terminates cleanly. `X-WP-TotalPages: 1` reinforces that.
 */
function fixtureFetch(fixture: WpRestFixture): FetchLike {
  const collections: ReadonlyArray<keyof WpRestFixture> = [
    'posts',
    'pages',
    'categories',
    'tags',
    'users',
    'media',
  ];
  return (input) => {
    const url = new URL(input);
    const m = /^\/wp-json\/wp\/v2\/([^/?]+)$/.exec(url.pathname);
    if (m === null) {
      return Promise.resolve(jsonResponse(404, 'Not Found', { error: `unmocked path: ${url.pathname}` }));
    }
    const collection = m[1] as keyof WpRestFixture;
    if (!collections.includes(collection)) {
      return Promise.resolve(jsonResponse(404, 'Not Found', { error: `unknown collection: ${String(collection)}` }));
    }
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
    const items = page === 1 && Array.isArray(fixture[collection]) ? (fixture[collection] as unknown[]) : [];
    return Promise.resolve(jsonResponse(200, 'OK', items, { 'X-WP-TotalPages': '1' }));
  };
}

function jsonResponse(
  status: number,
  statusText: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Awaited<ReturnType<FetchLike>> {
  const headers = new Map<string, string>(Object.entries(extraHeaders));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name: string): string | null {
        const v = headers.get(name) ?? headers.get(name.toLowerCase()) ?? headers.get(name.toUpperCase());
        return v ?? null;
      },
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const logger = makeLogger();

  // Wipe previous ACT-owned output only — `public/` may also hold static
  // assets in a real project; we leave anything we didn't write alone.
  await fs.rm(path.join(outputDir, '.well-known'), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, 'act'), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, '.act-build-report.json'), { force: true });
  await fs.rm(path.join(outputDir, 'llms.txt'), { force: true });
  await fs.rm(path.join(outputDir, 'llms-full.txt'), { force: true });

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as WpRestFixture;
  logger.info(
    `loaded fixture: ${(fixture.posts ?? []).length} post(s), ${(fixture.pages ?? []).length} page(s), ${(fixture.categories ?? []).length} categor(y/ies), ${(fixture.tags ?? []).length} tag(s)`,
  );

  const adapter = createWordPressAdapter({ fetch: fixtureFetch(fixture) });

  const config: GeneratorConfig = {
    conformanceTarget: 'standard',
    outputDir,
    site: {
      name: 'ACT WordPress Demo',
      description: 'A headless WordPress blog wired to the ACT spec via @act-spec/adapter-wordpress.',
      canonical_url: process.env['ACT_WORDPRESS_SITE'] ?? 'http://localhost:4325',
    },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
    },
    generator: '@act-spec/example-wordpress-blog@0.2.0',
    adapters: [
      {
        adapter,
        config: {
          baseUrl: FAKE_BASE_URL,
          include: { posts: true, pages: true, categories: true, tags: true, users: false },
        },
        actVersion: '0.1',
      },
    ],
  };

  logger.info('running pipeline (enumerate + transform via @act-spec/adapter-wordpress)');
  const outcome = await runPipeline({ config, logger });
  logger.info(
    `pipeline emitted ${String(outcome.nodes.length)} node(s) + ${String(outcome.subtrees.size)} subtree(s); achieved level: ${outcome.achieved}`,
  );

  const report = await emitFiles({
    outcome,
    outputDir: config.outputDir,
    config,
    startedAt,
  });

  // Capability advertisement must be backed by emitted files.
  verifyCapabilityBacking(outcome.capabilities, report.files);

  logger.info(
    `wrote ${String(report.files.length)} file(s) to ${config.outputDir} in ${String(report.durationMs)}ms`,
  );
  logger.info(`build report sidecar: ${path.join(config.outputDir, '.act-build-report.json')}`);
  logger.info(`achieved.level: ${report.conformanceAchieved}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/**
 * Build entry point for the Notion knowledge-base example.
 *
 * Wires `@act-spec/adapter-notion` to a recorded fixture corpus (no live
 * Notion traffic) and runs `@act-spec/generator-core`'s canonical pipeline
 * (`runPipeline` -> `emitFiles`) to write static ACT artefacts under
 * `public/`. The same shape ships when the adapter is pointed at a live
 * Notion workspace; only the provider wiring changes.
 *
 * Output layout (served alongside the rest of the site):
 *   public/.well-known/act.json     — manifest
 *   public/act/index.json           — index of every node
 *   public/act/nodes/<id>.json      — one per database row + the database root
 *   public/act/subtrees/<id>.json   — root subtree + per-locale branches
 *   public/llms.txt                 — back-compat (auto-emitted by generator-core)
 *   public/llms-full.txt            — back-compat (auto-emitted by generator-core)
 *   public/.act-build-report.json   — operator-facing build report sidecar
 */
/* eslint-disable no-console */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  emitFiles,
  runPipeline,
  verifyCapabilityBacking,
  type GeneratorConfig,
} from '@act-spec/generator-core';
import {
  notionAdapter,
  type NotionAdapterConfig,
  type NotionBlock,
  type NotionDatabase,
  type NotionPage,
  type NotionSourceCorpus,
} from '@act-spec/adapter-notion';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const fixturesDir = path.join(exampleRoot, 'test-fixtures');
const outputDir = path.join(exampleRoot, 'public');

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

async function readJson<T>(p: string): Promise<T> {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw) as T;
}

/**
 * Load the recorded Notion API responses from `test-fixtures/` and assemble
 * a `NotionSourceCorpus`. The adapter accepts this through its `corpus`
 * option; internally it builds a `corpusProvider` with the same surface as
 * the real `httpProvider`. Replacing this with `httpProvider({ token })`
 * is the only change needed to point at a live Notion workspace.
 */
async function loadCorpus(): Promise<NotionSourceCorpus> {
  const [database, pages, pageBlocks] = await Promise.all([
    readJson<NotionDatabase>(path.join(fixturesDir, 'database.json')),
    readJson<NotionPage[]>(path.join(fixturesDir, 'pages.json')),
    readJson<Record<string, NotionBlock[]>>(path.join(fixturesDir, 'blocks.json')),
  ]);
  return { database, pages, pageBlocks };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const logger = makeLogger();

  // Clear ACT-owned subtrees from a previous build but leave any other
  // contents of `public/` (favicons, hand-authored static pages) alone.
  await fs.rm(path.join(outputDir, '.well-known'), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, 'act'), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, '.act-build-report.json'), { force: true });
  await fs.rm(path.join(outputDir, 'llms.txt'), { force: true });
  await fs.rm(path.join(outputDir, 'llms-full.txt'), { force: true });
  await fs.mkdir(outputDir, { recursive: true });

  logger.info('loading recorded Notion API corpus from test-fixtures/');
  const corpus = await loadCorpus();
  logger.info(
    `corpus loaded: 1 database, ${corpus.pages.length} pages, ` +
      `${Object.values(corpus.pageBlocks ?? {}).reduce((n, bs) => n + bs.length, 0)} blocks`,
  );

  const adapterConfig: NotionAdapterConfig = {
    // Inline placeholder. The corpus-backed provider never touches the
    // network; the live adapter would resolve this from the environment
    // via `{ from_env: 'NOTION_TOKEN' }`.
    accessToken: 'fixture-token',
    databaseId: corpus.database.id,
    databaseTitle: 'Acme Knowledge Base',
    databaseSummary:
      'Internal handbook covering onboarding, deployment, troubleshooting, and policy. Mirrored from Notion to ACT for AI-agent consumption.',
    databaseType: 'collection',
    pageType: 'article',
    properties: { title: 'Name', summary: 'Summary', tags: 'Tags' },
    locale: { property: 'Locale', default: 'en-US' },
    idStrategy: { namespace: 'kb' },
  };

  const config: GeneratorConfig = {
    conformanceTarget: 'standard',
    outputDir,
    site: {
      name: 'Acme Knowledge Base',
      description:
        'Internal handbook backed by Notion, mirrored to ACT (Agent Content Tree) for AI-agent consumption.',
      canonical_url: process.env.ACT_SITE_URL ?? 'http://localhost:8083',
    },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
    },
    subtreeDepth: 2,
    generator: '@act-spec/example-notion-knowledge-base@0.2.0',
    adapters: [
      {
        adapter: notionAdapter({ corpus }),
        config: adapterConfig as unknown as Record<string, unknown>,
        actVersion: '0.1',
      },
    ],
    emit: {
      // Keep emitted JSON pretty-printed so that hand-inspecting the example
      // output is easy. Real production sites should leave this off.
      prettyJson: true,
    },
  };

  logger.info('running generator-core pipeline');
  const outcome = await runPipeline({ config, logger });
  logger.info(
    `pipeline emitted ${outcome.nodes.length} node(s) + ${outcome.subtrees.size} subtree(s); achieved level: ${outcome.achieved}`,
  );
  for (const w of outcome.warnings) logger.warn(w);

  const report = await emitFiles({
    outcome,
    outputDir: config.outputDir,
    config,
    startedAt,
  });

  verifyCapabilityBacking(outcome.capabilities, report.files);

  logger.info(
    `wrote ${report.files.length} file(s) under ${path.relative(exampleRoot, config.outputDir)}/ in ${report.durationMs}ms`,
  );
  logger.info(`achieved.level: ${report.conformanceAchieved}`);
  logger.info(`build report: ${path.join(config.outputDir, '.act-build-report.json')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

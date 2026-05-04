/**
 * PRD-701-R1 / R2 / R5 / R6 / R9 / R10 — example build entry.
 *
 * The build composes:
 *   - PRD-201's markdown adapter (auto-wired by `@act-spec/plugin-docusaurus`'s
 *     `resolveConfig` per PRD-404-R5) over the generated `docs/` corpus.
 *   - A second, in-example "sidebar synthesizer" adapter that walks
 *     `sidebars.js` (via the plugin's exported `evaluateSidebarsModule` +
 *     `deriveParentChildren`) and emits:
 *       1. Partial nodes that stamp `parent` on every doc the sidebar
 *          places under a category (PRD-200-R12 #3 partial deep-merge).
 *       2. Full synthesized `section` nodes for every category, populated
 *          with the sidebar's `items` as `children`.
 *     This satisfies PRD-404-R6 / PRD-701-R5 / PRD-701-R6 by composing
 *     primitives the @act-spec/plugin-docusaurus package already exports
 *     (`deriveParentChildren`, `evaluateSidebarsModule`,
 *     `applySidebarMappingToNodes`). The example is the integration test
 *     that proves these primitives compose end-to-end at scale.
 *     See docs/amendments-queue.md A11 — PRD-404-R6 sidebar synthesis is
 *     declared but not auto-applied inside `runActBuild`'s pipeline; the
 *     amendment proposes wiring this composition into the plugin.
 *
 * Final emission goes through `@act-spec/generator-core`'s `runPipeline`
 * + `emitFiles` so the output paths and envelope shapes match what
 * PRD-404 / PRD-105 / PRD-100 mandate.
 *
 * Why programmatic instead of `npx docusaurus build`? PRD-701-R10's
 * normative contract is over the **ACT-owned** paths under `build/`. The
 * Docusaurus-owned HTML / asset emission is explicitly out of contract per
 * PRD-701-R10's "the example MUST NOT modify Docusaurus-owned paths under
 * build/" clause. `runActBuild`/`runPipeline` exercises the same code
 * path the plugin's `postBuild` hook calls, so the ACT contract is
 * faithfully demonstrated without the heavy preset-classic / theme /
 * React install footprint that the full Docusaurus CLI requires. PRD-404's
 * own conformance gate (`packages/plugin-docusaurus/conformance.ts`) takes the
 * same approach.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveParentChildren,
  evaluateSidebarsModule,
  resolveConfig,
  type DocusaurusLoadContext,
} from '@act-spec/plugin-docusaurus';

import {
  emitFiles,
  runPipeline,
  verifyCapabilityBacking,
  type GeneratorConfig,
} from '@act-spec/generator-core';

import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  EmittedNode,
  PartialEmittedNode,
} from '@act-spec/adapter-framework';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
// Write ACT artifacts into Docusaurus' `static/` folder so the dev server
// (`pnpm dev`) serves them at /.well-known/act.json + /act/* alongside the
// rendered HTML site. `docusaurus build` would copy them into `build/` too.
const buildDir = path.join(exampleRoot, 'static');

/**
 * PRD-404-R6 / PRD-701-R5 — sidebar synthesizer adapter. Reads
 * `sidebars.js` once, derives the parent / children mapping, and emits
 * one partial per parented doc plus one full node per category.
 *
 * The partial nodes carry only `id` + `parent` so the merge stage
 * (PRD-200-R12 #3) joins them onto the markdown adapter's full nodes
 * without overwriting any other field. The full synthesized category
 * nodes match PRD-100-R21's required-field set (etag is recomputed by
 * the pipeline at PRD-400-R8).
 */
function createSidebarSynthesizerAdapter(siteDir: string): Adapter<EmittedNode | PartialEmittedNode> {
  let synthetic: EmittedNode[] = [];
  let partials: PartialEmittedNode[] = [];
  let warnings: string[] = [];

  return {
    name: 'act-docusaurus-sidebar-synthesizer',
    async init(_config: Record<string, unknown>, _ctx: AdapterContext): Promise<AdapterCapabilities> {
      // Standard-tier: subtree emission depends on parent / children
      // population, which is exactly what this adapter contributes.
      return {
        level: 'standard',
        precedence: 'fallback',
        manifestCapabilities: { subtree: true },
      };
    },
    async *enumerate(_ctx: AdapterContext): AsyncIterable<EmittedNode | PartialEmittedNode> {
      // Read sidebars.js once and prepare both contribution sets.
      // Search for sidebars in the order the plugin's `loadSidebars`
      // does (PRD-404 plugin.ts): `.js`, `.cjs`, `.mjs`. The example
      // emits `.cjs` because its `package.json` declares ESM.
      const candidates = ['sidebars.js', 'sidebars.cjs', 'sidebars.mjs'].map((n) =>
        path.join(siteDir, n),
      );
      let text: string | undefined;
      for (const candidate of candidates) {
        try {
          text = await fs.readFile(candidate, 'utf8');
          break;
        } catch {
          continue;
        }
      }
      if (text === undefined) {
        throw new Error(
          'PRD-701-R5: sidebars file not found (looked for sidebars.{js,cjs,mjs})',
        );
      }
      const sidebars = evaluateSidebarsModule(text);
      const mapping = deriveParentChildren(sidebars, 'docs');

      synthetic = mapping.syntheticNodes.map((s) => {
        const node: EmittedNode = {
          act_version: '0.1',
          id: s.id,
          type: 'section',
          title: s.title,
          summary: s.summary.length > 0 ? s.summary : `${s.title} — section.`,
          summary_source: 'extracted',
          etag: 's256:placeholder-etag-recomputed-by-pipeline',
          content: [
            {
              type: 'markdown',
              content: `# ${s.title}\n\nThis section groups related ${s.title.toLowerCase()} documents.\n`,
            },
          ],
          tokens: { summary: 8, body: 16 },
          children: [...s.children],
          ...(s.parent !== undefined ? { parent: s.parent } : {}),
          metadata: {
            source: {
              adapter: 'act-docusaurus-sidebar-synthesizer',
              source_id: `sidebar-category:${s.id}`,
            },
          },
        };
        return node;
      });

      partials = [];
      for (const [docId, parentId] of mapping.parentMap.entries()) {
        partials.push({
          _actPartial: true,
          id: docId,
          parent: parentId,
        });
      }

      warnings = [];
      if (mapping.duplicateDocs.length > 0) {
        warnings.push(
          `PRD-404-R6: ${mapping.duplicateDocs.length} sidebar duplicate(s): ${mapping.duplicateDocs.slice(0, 5).join(', ')}${mapping.duplicateDocs.length > 5 ? '…' : ''}`,
        );
      }
      if (mapping.skippedLinks.length > 0) {
        warnings.push(
          `PRD-404-R6: ${mapping.skippedLinks.length} sidebar link entry/entries skipped (PRD-404-R6 fourth bullet)`,
        );
      }

      for (const p of partials) yield p;
      for (const s of synthetic) yield s;
    },
    async transform(
      item: EmittedNode | PartialEmittedNode,
    ): Promise<EmittedNode | PartialEmittedNode | null> {
      // Pass-through; enumerate already shaped both partials and full nodes.
      return item;
    },
    dispose(_ctx: AdapterContext): void {
      // Surface warnings via context's logger when available.
      for (const w of warnings) {
        // eslint-disable-next-line no-console
        console.warn(w);
      }
    },
  };
}

async function main(): Promise<void> {
  // Wipe `build/` so each run is reproducible.
  await fs.rm(buildDir, { recursive: true, force: true });
  await fs.mkdir(buildDir, { recursive: true });

  // Mirror the structural slice of Docusaurus's `LoadContext` that
  // PRD-404's plugin reads (per `DocusaurusLoadContext` in the plugin's
  // public types). Single locale per PRD-701-R9.
  const context: DocusaurusLoadContext = {
    siteDir: exampleRoot,
    outDir: buildDir,
    baseUrl: '/',
    siteConfig: {
      title: 'Tinybox SDK',
      url: 'https://example.com',
      baseUrl: '/',
    },
    i18n: {
      defaultLocale: 'en',
      locales: ['en'],
    },
  };

  // PRD-701-R9 — registered options. `target: "standard"` per PRD-701-R9
  // (subtree emission); URL templates expose the Standard-tier surface
  // (Core + subtree). We let `resolveConfig` auto-wire the markdown
  // adapter (PRD-404-R5), then append our sidebar synthesizer adapter.
  //
  // `parseMode: 'fine'` — PRD-701-R4 nominates coarse mode but PRD-201-R23
  // makes a coarse-mode adapter declare level `core`, which PRD-400-R32
  // (`enforceTargetLevel`) rejects against the Standard target PRD-701
  // requires (PRD-701-R12: achieved.level === 'standard'). Same friction
  // amendment-queue A8 already triaged for PRD-700; PRD-701-R4 inherits the
  // same workaround verbatim. The wire format is unchanged — the corpus
  // contains fenced `code` and `data` blocks so fine mode produces a mix
  // of `markdown` / `code` / `data` blocks per PRD-201-R12 / PRD-201-R13;
  // every block carries `summary_source: "author"` per PRD-201-R20.
  // PRD-701 Open Question 4 names the upstream PRD-201/PRD-404 fine-grained
  // wiring ambiguity; A2 closed PRD-404 `parseMode` so the surface is
  // available, and we use it here.
  const baseCfg = resolveConfig(
    {
      target: 'standard',
      parseMode: 'fine',
      site: {
        name: 'Tinybox SDK',
        canonical_url: 'https://example.com/',
      },
      urlTemplates: {
        indexUrl: '/act/index.json',
        nodeUrlTemplate: '/act/nodes/{id}.json',
        subtreeUrlTemplate: '/act/subtrees/{id}.json',
      },
      docusaurus: {
        skipBlog: true, // PRD-701: docs-only.
      },
    },
    context,
  );

  const cfg: GeneratorConfig = {
    ...baseCfg,
    adapters: [
      ...baseCfg.adapters,
      {
        adapter: createSidebarSynthesizerAdapter(exampleRoot),
        config: {},
        actVersion: '0.1',
      },
    ],
  };

  console.log(`PRD-701 build — siteDir=${exampleRoot}`);
  console.log(`  outDir=${buildDir}`);
  console.log(`  target=${cfg.conformanceTarget}`);
  console.log(`  adapters=${cfg.adapters.length} (markdown + sidebar synthesizer)`);

  const startedAt = Date.now();
  const logger = {
    debug: (m: string) => console.error(`build debug: ${m}`),
    info: (m: string) => console.log(`build: ${m}`),
    warn: (m: string) => console.warn(`build warn: ${m}`),
    error: (m: string) => console.error(`build error: ${m}`),
  };

  const outcome = await runPipeline({ config: cfg, logger });

  console.log(
    `PRD-701 pipeline — ${outcome.nodes.length} nodes; ${outcome.subtrees.size} subtrees; achieved=${outcome.achieved}; warnings=${outcome.warnings.length}`,
  );

  const report = await emitFiles({
    outcome,
    outputDir: cfg.outputDir,
    config: cfg,
    startedAt,
  });

  verifyCapabilityBacking(outcome.capabilities, report.files);

  console.log(
    `PRD-701 build — ${report.files.length} files written; warnings=${report.warnings.length}; errors=${report.errors.length}`,
  );

  if (report.errors.length > 0) {
    console.error('PRD-701 build — pipeline reported errors:');
    for (const e of report.errors) console.error(`  - ${JSON.stringify(e)}`);
    process.exit(1);
  }

  for (const w of report.warnings) {
    console.warn(`PRD-701 build warning: ${w}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

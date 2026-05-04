/**
 * Conformance gate (PRD-400-R28 / PRD-401's R1+R5+R11): builds a tiny
 * fixture site programmatically (no `astro` CLI), then validates the
 * emitted files via @act-spec/validator. Exits non-zero on any gap.
 *
 * Why programmatic? Spinning the Astro CLI in CI bloats the matrix; the
 * integration's pipeline is identical whether invoked from
 * `astro:build:done` or from `runActBuild`. PRD-401-R5 pins the pipeline
 * to `astro:build:done`; this gate calls `runActBuild` directly with the
 * same `GeneratorConfig` Astro would have produced.
 *
 * Invoked by `pnpm -F @act-spec/plugin-astro conformance`.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-markdown';
import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import { runActBuild } from './src/index.js';
import type { GeneratorConfig } from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.join(here, 'test-fixtures', 'sample-site');
const fixtureContent = path.join(fixtureSite, 'src', 'content');

async function main(): Promise<void> {
  const outDir = await fs.mkdtemp(path.join(here, 'conformance-out-'));
  try {
    console.log(`Conformance — building fixture site → ${outDir}`);
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: outDir,
      adapters: [
        {
          adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
          config: { sourceDir: fixtureContent },
          actVersion: '0.1',
        },
      ],
      site: { name: 'Tinybox' },
      generator: '@act-spec/plugin-astro@0.0.0',
    };
    const report = await runActBuild({ config: cfg });
    console.log(`Achieved: ${report.conformanceAchieved}; ${report.files.length} files; warnings: ${report.warnings.length}`);

    let failed = 0;
    // Manifest
    const manifestPath = path.join(outDir, '.well-known', 'act.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const mr = validateManifest(manifest);
    if (mr.gaps.length > 0) {
      failed += mr.gaps.length;
      console.error(`FAIL manifest`);
      for (const g of mr.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS manifest`);
    }

    // Index
    const indexPath = path.join(outDir, 'act', 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    const ir = validateIndex(index);
    if (ir.gaps.length > 0) {
      failed += ir.gaps.length;
      console.error(`FAIL index`);
      for (const g of ir.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS index (${index.nodes.length} entries)`);
    }

    // Nodes
    for (const file of report.files) {
      if (!file.path.includes('/act/nodes/')) continue;
      const node = JSON.parse(await fs.readFile(file.path, 'utf8'));
      const nr = validateNode(node);
      if (nr.gaps.length > 0) {
        failed += nr.gaps.length;
        console.error(`FAIL node ${node.id}`);
        for (const g of nr.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
      } else {
        console.log(`PASS node ${node.id}`);
      }
    }

    if (failed > 0) {
      console.error(`\nConformance failed: ${failed} validator gap(s).`);
      process.exit(1);
    }
    console.log(`\nConformance summary: 0 gaps. Achieved: ${report.conformanceAchieved}.`);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

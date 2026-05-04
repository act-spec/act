/**
 * PRD-406 conformance gate (PRD-400-R28 + PRD-406-R20): builds a tiny
 * Remix-shaped fixture site programmatically (no `vite` or `@remix-run/dev`
 * CLI required) using the same `runActBuild` entry point Vite\'s
 * `closeBundle` hook invokes, then validates the emitted files via
 * `@act-spec/validator`. Exits non-zero on any gap.
 *
 * Why programmatic? Spinning a real `remix vite:build` in CI requires a
 * full Remix-Vite toolchain; the integration\'s pipeline is identical
 * whether invoked from `closeBundle` or from `runActBuild`.
 *
 * Invoked by `pnpm -F @act-spec/plugin-remix conformance`.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-framework';
import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import { runActBuild } from './src/index.js';
import type { GeneratorConfig } from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.join(here, 'test-fixtures', 'sample-site');
const fixtureContent = path.join(fixtureSite, 'content');

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
      site: { name: 'Acme Remix' },
      generator: '@act-spec/plugin-remix@0.0.0',
    };
    const report = await runActBuild({ config: cfg });
    console.log(
      `Achieved: ${report.conformanceAchieved}; ${report.files.length} files; warnings: ${report.warnings.length}`,
    );

    let failed = 0;
    // Manifest
    const manifestPath = path.join(outDir, '.well-known', 'act.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    const mr = validateManifest(manifest as Record<string, unknown>);
    if (mr.gaps.length > 0) {
      failed += mr.gaps.length;
      console.error(`FAIL manifest`);
      for (const g of mr.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS manifest`);
    }

    // Index
    const indexPath = path.join(outDir, 'act', 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { nodes: unknown[] };
    const ir = validateIndex(index as Record<string, unknown>);
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
      const node = JSON.parse(await fs.readFile(file.path, 'utf8')) as { id: string };
      const nr = validateNode(node as Record<string, unknown>);
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

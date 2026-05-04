/**
 * PRD-408 conformance gate (PRD-400-R28 + PRD-408-R20): builds the tiny
 * Eleventy fixture site programmatically (no `eleventy` CLI) using the
 * same `runActBuild` entry point the Eleventy plugin's `eleventy.after`
 * hook invokes, then validates the emitted files via `@act-spec/validator`.
 * Exits non-zero on any gap.
 *
 * Why programmatic? Spinning a real `eleventy` build in CI requires the
 * Eleventy 2.x toolchain; the plugin's pipeline is identical whether
 * invoked from `eleventy.after` or from `runActBuild`.
 *
 * Invoked by `pnpm -F @act-spec/plugin-eleventy conformance`.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import { resolveConfig, runActBuild } from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.join(here, 'test-fixtures', 'sample-site');

async function main(): Promise<void> {
  const outDir = await fs.mkdtemp(path.join(here, 'conformance-out-'));
  try {
    console.log(`PRD-408 conformance — building fixture site → ${outDir}`);
    const { config } = resolveConfig({
      options: {
        baseUrl: 'https://example.com',
        manifest: { site: { name: 'Example Eleventy' } },
        urlTemplates: {
          indexUrl: '/act/index.json',
          nodeUrlTemplate: '/act/n/{id}.json',
        },
        outputDir: outDir,
      },
      projectRoot: fixtureSite,
      outputDir: outDir,
    });
    const report = await runActBuild({ config });
    console.log(
      `Achieved: ${report.conformanceAchieved}; ${report.files.length} files; warnings: ${report.warnings.length}`,
    );

    let failed = 0;
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, '.well-known', 'act.json'), 'utf8'),
    ) as Record<string, unknown>;
    const mr = validateManifest(manifest);
    if (mr.gaps.length > 0) {
      failed += mr.gaps.length;
      console.error(`FAIL manifest`);
      for (const g of mr.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS manifest`);
    }

    const index = JSON.parse(
      await fs.readFile(path.join(outDir, 'act', 'index.json'), 'utf8'),
    ) as { nodes: unknown[] };
    const ir = validateIndex(index);
    if (ir.gaps.length > 0) {
      failed += ir.gaps.length;
      console.error(`FAIL index`);
      for (const g of ir.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS index (${index.nodes.length} entries)`);
    }

    for (const file of report.files) {
      if (!file.path.includes('/act/nodes/')) continue;
      const node = JSON.parse(await fs.readFile(file.path, 'utf8')) as Record<string, unknown>;
      const nr = validateNode(node);
      if (nr.gaps.length > 0) {
        failed += nr.gaps.length;
        console.error(`FAIL node ${String(node['id'])}`);
        for (const g of nr.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
      } else {
        console.log(`PASS node ${String(node['id'])}`);
      }
    }

    if (failed > 0) {
      console.error(`\nPRD-408 conformance failed: ${failed} validator gap(s).`);
      process.exit(1);
    }
    console.log(`\nPRD-408 conformance summary: 0 gaps. Achieved: ${report.conformanceAchieved}.`);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

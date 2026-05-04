/**
 * Conformance gate for `@act-spec/cli` (PRD-409-R18).
 *
 * Drives the CLI end-to-end against `test-fixtures/sample-site/`:
 *   1. Load the fixture's `act.config.mjs` via the same `loadConfig` path
 *      `act build` uses.
 *   2. Run `runBuild` to emit the static file set into a tmp output dir.
 *   3. Pipe every emitted artifact (manifest, index, every per-node envelope)
 *      through `@act-spec/validator`. Expect zero gaps.
 *
 * Why programmatic? Spawning the CLI binary for the conformance gate would
 * require building first, doubling the iteration loop. The dispatcher's argv
 * surface is unit-tested in `src/cli.test.ts`; the conformance gate exists
 * to verify the static file set, not the CLI shell.
 *
 * Invoked by `pnpm -F @act-spec/cli conformance`.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import { loadConfig } from './src/config.js';
import { runBuild } from './src/run-build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.join(here, 'test-fixtures', 'sample-site');

interface ManifestShape {
  conformance: { level: string };
}
interface IndexShape {
  nodes: Array<{ id: string }>;
}

async function main(): Promise<void> {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-conformance-'));
  const originalCwd = process.cwd();
  try {
    console.log(`Conformance — loading fixture config from ${fixtureSite}`);
    // chdir into the fixture so config-relative paths (e.g. `sourceDir: 'content'`)
    // resolve correctly inside the markdown adapter, mirroring `act build`'s
    // real-world invocation from the project root.
    process.chdir(fixtureSite);
    const loaded = await loadConfig(fixtureSite);
    // Re-target outputDir into our temp so we don't pollute the fixture.
    loaded.config.outputDir = out;

    console.log(`Building → ${out}`);
    const report = await runBuild(loaded.config, { cwd: fixtureSite, buildReportPath: path.join(out, '..', '.cli-conformance-report.json') });
    console.log(
      `Achieved: ${report.conformanceAchieved}; ${report.files.length} file(s); warnings: ${report.warnings.length}`,
    );

    let failed = 0;

    // Manifest.
    const manifestPath = path.join(out, '.well-known', 'act.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ManifestShape;
    const mr = validateManifest(manifest);
    if (mr.gaps.length > 0) {
      failed += mr.gaps.length;
      console.error(`FAIL manifest`);
      for (const g of mr.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS manifest (level=${manifest.conformance.level})`);
    }

    // Index.
    const indexPath = path.join(out, 'act', 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as IndexShape;
    const ir = validateIndex(index);
    if (ir.gaps.length > 0) {
      failed += ir.gaps.length;
      console.error(`FAIL index`);
      for (const g of ir.gaps) console.error(`  [${g.requirement}] ${g.missing}`);
    } else {
      console.log(`PASS index (${index.nodes.length} entries)`);
    }

    // Nodes.
    for (const file of report.files) {
      if (!file.path.includes(`${path.sep}act${path.sep}nodes${path.sep}`)) continue;
      const node = JSON.parse(await fs.readFile(file.path, 'utf8')) as { id: string };
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
    process.chdir(originalCwd);
    await fs.rm(out, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/**
 * PRD-409-R11 — output-dir conflict detection vs sibling host-framework
 * plugins.
 *
 * Algorithm (per PRD):
 *   1. Read the project's `package.json` for installed `@act-spec/<framework>`
 *      packages.
 *   2. Compute each detected plugin's typical `outputDir` per documented default.
 *   3. If the resolved `outputDir` overlaps any detected plugin's typical
 *      output, emit a build error citing the conflict and the affected plugin.
 *
 * The PRD's example uses the `@act/<framework>` namespace; the v0.1 reference
 * impl publishes under `@act-spec/<framework>`. We probe both prefixes so the
 * detection is robust against future renames.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

interface PluginDescriptor {
  pkgName: string;
  /** Typical default output directory the host-framework plugin writes to. */
  typicalOutput: string;
  prd: string;
}

const PLUGIN_REGISTRY: readonly PluginDescriptor[] = [
  { pkgName: '@act-spec/plugin-nextjs', typicalOutput: 'out', prd: 'PRD-405' },
  { pkgName: '@act/nextjs', typicalOutput: 'out', prd: 'PRD-405' },
  { pkgName: '@act-spec/plugin-astro', typicalOutput: 'dist', prd: 'PRD-401' },
  { pkgName: '@act/astro', typicalOutput: 'dist', prd: 'PRD-401' },
  { pkgName: '@act-spec/plugin-nuxt', typicalOutput: '.output', prd: 'PRD-407' },
  { pkgName: '@act/nuxt', typicalOutput: '.output', prd: 'PRD-407' },
  { pkgName: '@act-spec/plugin-remix', typicalOutput: 'build', prd: 'PRD-406' },
  { pkgName: '@act/remix', typicalOutput: 'build', prd: 'PRD-406' },
  { pkgName: '@act-spec/plugin-docusaurus', typicalOutput: 'build', prd: 'PRD-404' },
  { pkgName: '@act/docusaurus', typicalOutput: 'build', prd: 'PRD-404' },
  { pkgName: '@act-spec/plugin-eleventy', typicalOutput: '_site', prd: 'PRD-408' },
  { pkgName: '@act/eleventy', typicalOutput: '_site', prd: 'PRD-408' },
];

export interface OutputConflict {
  pkgName: string;
  prd: string;
  typicalOutput: string;
  resolvedOutputDir: string;
}

/**
 * PRD-409-R11 — read `package.json` at `cwd` and surface every conflict
 * with the resolved `outputDir`.
 */
export function detectOutputConflicts(opts: {
  cwd: string;
  outputDir: string;
}): OutputConflict[] {
  const pkgJsonPath = path.join(opts.cwd, 'package.json');
  if (!existsSync(pkgJsonPath)) return [];
  let pkgJson: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as typeof pkgJson;
  } catch {
    return [];
  }
  const installed = new Set<string>([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
  ]);
  const resolvedOutputAbs = path.resolve(opts.cwd, opts.outputDir);
  const conflicts: OutputConflict[] = [];
  for (const plugin of PLUGIN_REGISTRY) {
    if (!installed.has(plugin.pkgName)) continue;
    const typicalAbs = path.resolve(opts.cwd, plugin.typicalOutput);
    if (pathsOverlap(resolvedOutputAbs, typicalAbs)) {
      conflicts.push({
        pkgName: plugin.pkgName,
        prd: plugin.prd,
        typicalOutput: plugin.typicalOutput,
        resolvedOutputDir: opts.outputDir,
      });
    }
  }
  return conflicts;
}

function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const aWithSep = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  const bWithSep = b.endsWith(path.sep) ? b : `${b}${path.sep}`;
  return aWithSep.startsWith(bWithSep) || bWithSep.startsWith(aWithSep);
}

export function formatConflict(c: OutputConflict): string {
  return (
    `PRD-409-R11: outputDir "${c.resolvedOutputDir}" overlaps host-framework plugin ` +
    `${c.pkgName} (${c.prd}, typically writes to "${c.typicalOutput}"). ` +
    `Pass --allow-output-conflict if interleaving is intentional.`
  );
}

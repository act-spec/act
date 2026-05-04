import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectOutputConflicts, formatConflict } from './conflicts.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-conflict-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writePkgJson(deps: Record<string, string>): Promise<void> {
  await fs.writeFile(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'tmp', dependencies: deps }, null, 2),
    'utf8',
  );
}

describe('PRD-409-R11 detectOutputConflicts', () => {
  it('PRD-409-R11: emits a conflict when @act-spec/plugin-nextjs is installed and outputDir is "out"', async () => {
    await writePkgJson({ '@act-spec/plugin-nextjs': 'workspace:*' });
    const conflicts = detectOutputConflicts({ cwd: tmp, outputDir: 'out' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.pkgName).toBe('@act-spec/plugin-nextjs');
    expect(conflicts[0]!.prd).toBe('PRD-405');
  });

  it('PRD-409-R11: emits a conflict when @act-spec/plugin-astro is installed and outputDir is "dist"', async () => {
    await writePkgJson({ '@act-spec/plugin-astro': 'workspace:*' });
    const conflicts = detectOutputConflicts({ cwd: tmp, outputDir: 'dist' });
    expect(conflicts.map((c) => c.pkgName)).toContain('@act-spec/plugin-astro');
  });

  it('PRD-409-R11: detects nested overlap (outputDir "dist/act" inside astro\'s "dist")', async () => {
    await writePkgJson({ '@act-spec/plugin-astro': 'workspace:*' });
    const conflicts = detectOutputConflicts({ cwd: tmp, outputDir: 'dist/act' });
    expect(conflicts).toHaveLength(1);
  });

  it('PRD-409-R11: no conflict when host-framework plugin is not installed', async () => {
    await writePkgJson({ 'unrelated-pkg': '1.0.0' });
    expect(detectOutputConflicts({ cwd: tmp, outputDir: 'out' })).toEqual([]);
  });

  it('PRD-409-R11: no conflict when outputDir does not overlap any plugin default', async () => {
    await writePkgJson({ '@act-spec/plugin-astro': 'workspace:*' });
    expect(detectOutputConflicts({ cwd: tmp, outputDir: 'public' })).toEqual([]);
  });

  it('PRD-409-R11: returns [] when no package.json exists', () => {
    expect(detectOutputConflicts({ cwd: tmp, outputDir: 'out' })).toEqual([]);
  });

  it('PRD-409-R11: returns [] when package.json is unparseable', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), 'not-json', 'utf8');
    expect(detectOutputConflicts({ cwd: tmp, outputDir: 'out' })).toEqual([]);
  });

  it('PRD-409-R11: detects devDependencies as well as dependencies', async () => {
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { '@act-spec/plugin-eleventy': 'workspace:*' } }),
      'utf8',
    );
    const conflicts = detectOutputConflicts({ cwd: tmp, outputDir: '_site' });
    expect(conflicts.map((c) => c.pkgName)).toContain('@act-spec/plugin-eleventy');
  });

  it('PRD-409-R11: formatConflict cites the requirement and remediation flag', async () => {
    await writePkgJson({ '@act-spec/plugin-astro': 'workspace:*' });
    const c = detectOutputConflicts({ cwd: tmp, outputDir: 'dist' })[0]!;
    const msg = formatConflict(c);
    expect(msg).toContain('PRD-409-R11');
    expect(msg).toContain('--allow-output-conflict');
  });
});

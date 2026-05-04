import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GeneratorConfig } from '@act-spec/generator-core';
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';

import { isReportInsideOutputDir, runBuild } from './run-build.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-build-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function programmaticConfig(outDir: string, items: Array<{ id: string; title: string; parent?: string }>): GeneratorConfig {
  const adapter = defineProgrammaticAdapter({
    name: 'demo',
    enumerate: () => items,
    transform: (item) => ({
      act_version: '0.1',
      id: item.id,
      type: 'page',
      title: item.title,
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      summary: `Summary for ${item.title}.`,
      content: [{ type: 'markdown', text: `Body for ${item.title}.` }],
      tokens: { summary: 4, body: 4 },
      ...(item.parent !== undefined ? { parent: item.parent } : {}),
    }),
    capabilities: { level: 'core' },
  });
  return {
    conformanceTarget: 'core',
    outputDir: outDir,
    adapters: [{ adapter, config: {}, actVersion: '0.1' }],
    site: { name: 'Test' },
  };
}

describe('PRD-409-R13 isReportInsideOutputDir', () => {
  it('PRD-409-R13: returns true when report path is exactly outputDir', () => {
    expect(isReportInsideOutputDir('/x/dist', '/x/dist')).toBe(true);
  });
  it('PRD-409-R13: returns true when report path is nested inside outputDir', () => {
    expect(isReportInsideOutputDir('/x/dist/.report.json', '/x/dist')).toBe(true);
  });
  it('PRD-409-R13: returns false when report path is a sibling of outputDir', () => {
    expect(isReportInsideOutputDir('/x/.report.json', '/x/dist')).toBe(false);
  });
});

describe('PRD-409-R4 / R7 / R12 runBuild', () => {
  it('PRD-409-R4 / R7: writes the static file set per PRD-105 layout', async () => {
    const out = path.join(tmp, 'dist');
    const cfg = programmaticConfig(out, [
      { id: 'home', title: 'Home' },
      { id: 'about', title: 'About', parent: 'home' },
    ]);
    const report = await runBuild(cfg, { cwd: tmp });
    expect(report.files.some((f) => f.path.endsWith(path.join('.well-known', 'act.json')))).toBe(true);
    expect(report.files.some((f) => f.path.endsWith(path.join('act', 'index.json')))).toBe(true);
    expect(report.files.some((f) => f.path.endsWith(path.join('act', 'nodes', 'home.json')))).toBe(true);
    expect(report.files.some((f) => f.path.endsWith(path.join('act', 'nodes', 'about.json')))).toBe(true);
  });

  it('PRD-409-R12: emitted manifest has act_version "0.1" and delivery "static"', async () => {
    const out = path.join(tmp, 'dist');
    await runBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), { cwd: tmp });
    const manifest = JSON.parse(
      await fs.readFile(path.join(out, '.well-known', 'act.json'), 'utf8'),
    ) as { act_version: string; delivery: string; conformance: { level: string } };
    expect(manifest.act_version).toBe('0.1');
    expect(manifest.delivery).toBe('static');
    expect(manifest.conformance.level).toBe('core');
  });

  it('PRD-409-R13: build report defaults to project-root .act-build-report.json (NOT inside outputDir)', async () => {
    const out = path.join(tmp, 'dist');
    await runBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), { cwd: tmp });
    const reportPath = path.join(tmp, '.act-build-report.json');
    const stat = await fs.stat(reportPath);
    expect(stat.isFile()).toBe(true);
    // Confirm we did NOT clobber outputDir with the report.
    const insideOutput = path.join(out, '.act-build-report.json');
    await expect(fs.stat(insideOutput)).rejects.toThrow();
  });

  it('PRD-409-R13: warns when buildReportPath is set inside outputDir', async () => {
    const out = path.join(tmp, 'dist');
    const insideReport = path.join(out, '.act-build-report.json');
    const report = await runBuild(programmaticConfig(out, [{ id: 'home', title: 'Home' }]), {
      cwd: tmp,
      buildReportPath: insideReport,
    });
    expect(report.warnings.some((w) => w.includes('PRD-409-R13'))).toBe(true);
  });

  it('PRD-409-R14: build fails when adapter declares mismatched act_version', async () => {
    const out = path.join(tmp, 'dist');
    const cfg = programmaticConfig(out, [{ id: 'home', title: 'Home' }]);
    cfg.adapters[0]!.actVersion = '0.2';
    await expect(runBuild(cfg, { cwd: tmp })).rejects.toThrow(/PRD-200-R25|PRD-400-R29/);
  });

  it('PRD-409-R14: build fails when adapter declares NO actVersion (Stage 1 default refuses)', async () => {
    const out = path.join(tmp, 'dist');
    const cfg = programmaticConfig(out, [{ id: 'home', title: 'Home' }]);
    delete cfg.adapters[0]!.actVersion;
    await expect(runBuild(cfg, { cwd: tmp })).rejects.toThrow(/PRD-200-R25/);
  });

  it('PRD-409-R7: emits subtrees for Standard band when subtreeUrlTemplate configured', async () => {
    const out = path.join(tmp, 'dist');
    const adapter = defineProgrammaticAdapter({
      name: 'demo',
      enumerate: () => [
        { id: 'home', title: 'Home' },
        { id: 'home/about', title: 'About', parent: 'home' },
      ],
      transform: (item) => ({
        act_version: '0.1',
        id: item.id,
        type: 'page',
        title: item.title,
        etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
        summary: 'sum',
        content: [{ type: 'markdown', text: 'b' }],
        tokens: { summary: 1, body: 1 },
        ...(item.parent !== undefined ? { parent: item.parent, children: [] as string[] } : { children: ['home/about'] }),
      }),
      capabilities: { level: 'standard' },
    });
    const cfg: GeneratorConfig = {
      conformanceTarget: 'standard',
      outputDir: out,
      adapters: [{ adapter, config: {}, actVersion: '0.1' }],
      site: { name: 'Test' },
      urlTemplates: { subtreeUrlTemplate: '/act/subtrees/{id}.json' },
    };
    const report = await runBuild(cfg, { cwd: tmp });
    expect(report.files.some((f) => f.path.includes(path.join('act', 'subtrees')))).toBe(true);
  });

  it('PRD-409-R10: timeout cancels and throws BuildTimeoutError', async () => {
    const out = path.join(tmp, 'dist');
    // Adapter that never completes.
    const slowAdapter = defineProgrammaticAdapter({
      name: 'slow',
      enumerate: async function* () {
        await new Promise((r) => setTimeout(r, 100));
        yield { id: 'home', title: 'Home' };
      },
      transform: (item) => ({
        act_version: '0.1',
        id: item.id,
        type: 'page',
        title: item.title,
        etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
        summary: 'sum',
        content: [{ type: 'markdown', text: 'b' }],
        tokens: { summary: 1, body: 1 },
      }),
      capabilities: { level: 'core' },
    });
    const cfg: GeneratorConfig = {
      conformanceTarget: 'core',
      outputDir: out,
      adapters: [{ adapter: slowAdapter, config: {}, actVersion: '0.1' }],
      site: { name: 'Test' },
    };
    await expect(runBuild(cfg, { cwd: tmp, timeoutMs: 5 })).rejects.toThrow(/timed out/);
    // Partial report MUST exist (PRD-409-R10).
    const stat = await fs.stat(path.join(tmp, '.act-build-report.json'));
    expect(stat.isFile()).toBe(true);
  });
});

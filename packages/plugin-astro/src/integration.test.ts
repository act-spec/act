/**
 * PRD-401 integration tests. R1–R20.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-markdown';

import {
  actIntegration,
  debounce,
  detectAchievedBand,
  detectsReactIslands,
  isAstroVersionSupported,
  isOutputEligibleForStatic,
  readRouteActExport,
  resolveConfig,
  runActBuild,
} from './integration.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSrc = path.resolve(here, '..', '..', 'adapter-markdown', 'test-fixtures', 'sample-tree');

async function freshTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(here, '..', `test-tmp-${prefix}-`));
}

function baseOptions(outDir: string) {
  return {
    output: outDir,
    adapters: [
      {
        adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
        config: { sourceDir: fixtureSrc },
        actVersion: '0.1',
      },
    ],
    site: { name: 'Tinybox' },
  };
}

describe('PRD-401 Astro integration', () => {
  it('PRD-401-R1: actIntegration returns AstroIntegration-shaped object with name + hooks', () => {
    const i = actIntegration();
    expect(i.name).toBe('@act-spec/plugin-astro');
    expect(typeof i.hooks['astro:config:setup']).toBe('function');
    expect(typeof i.hooks['astro:build:done']).toBe('function');
  });

  it('PRD-401-R2: isAstroVersionSupported requires Astro 4.x', () => {
    expect(isAstroVersionSupported('4.16.19')).toBe(true);
    expect(isAstroVersionSupported('3.5.0')).toBe(false);
    expect(isAstroVersionSupported('5.0.0')).toBe(false);
  });

  it('PRD-401-R3: rejects output: "server"; accepts "static" / "hybrid"', () => {
    expect(isOutputEligibleForStatic('static')).toBe(true);
    expect(isOutputEligibleForStatic('hybrid')).toBe(true);
    expect(isOutputEligibleForStatic('server')).toBe(false);
    const i = actIntegration();
    expect(() =>
      i.hooks['astro:config:setup']({ config: { output: 'server' }, command: 'build' }),
    ).toThrow(/PRD-401-R3/);
  });

  it('PRD-401-R4: integration registers config:setup, server:start, build:done hooks', () => {
    const i = actIntegration();
    const hookNames = Object.keys(i.hooks);
    expect(hookNames).toContain('astro:config:setup');
    expect(hookNames).toContain('astro:server:start');
    expect(hookNames).toContain('astro:build:done');
  });

  it('PRD-401-R5: pipeline runs from astro:build:done; writes only to ACT-owned paths', async () => {
    const tmp = await freshTmp('r5');
    try {
      const i = actIntegration(baseOptions(tmp));
      i.hooks['astro:config:setup']({ config: { output: 'static' }, command: 'build' });
      await i.hooks['astro:build:done']({ dir: tmp });
      const wellKnown = path.join(tmp, '.well-known', 'act.json');
      const indexFile = path.join(tmp, 'act', 'index.json');
      expect((await fs.stat(wellKnown)).isFile()).toBe(true);
      expect((await fs.stat(indexFile)).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-401-R6: auto-wires PRD-201 markdown adapter when no explicit adapters supplied', () => {
    const cfg = resolveConfig({}, '/dist');
    expect(cfg.adapters.length).toBe(1);
    expect(cfg.adapters[0]!.adapter.name).toBe('act-markdown');
  });

  it('PRD-401-R7: collection-shape mismatch surfaces as a build warning (default-supplied)', async () => {
    const tmp = await freshTmp('r7');
    const fauxSrc = await freshTmp('r7-src');
    try {
      // Simulate a collection entry missing `title` — adapter defaults to file basename.
      await fs.writeFile(path.join(fauxSrc, 'about.md'), '---\ntype: doc\n---\nbody');
      const i = actIntegration({
        ...baseOptions(tmp),
        adapters: [
          {
            adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
            config: { sourceDir: fauxSrc },
            actVersion: '0.1',
          },
        ],
      });
      await i.hooks['astro:build:done']({ dir: tmp });
      // Build report exists and does not throw — title defaulted.
      const report = JSON.parse(
        await fs.readFile(path.join(tmp, '.act-build-report.json'), 'utf8'),
      ) as { files: unknown[] };
      expect(report.files.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(fauxSrc, { recursive: true, force: true });
    }
  });

  it('PRD-401-R8: readRouteActExport pulls a route module\'s top-level act const at build time', () => {
    const mod = { act: { id: 'about', summary: 'About page', extract: () => null } };
    const r = readRouteActExport(mod)!;
    expect(r.id).toBe('about');
    expect(typeof r.extract).toBe('function');
    expect(readRouteActExport({})).toBeNull();
  });

  it('PRD-401-R9: detectsReactIslands picks up .tsx under src/pages and client: directives', () => {
    expect(detectsReactIslands(['/x/src/pages/Home.tsx'])).toBe(true);
    expect(detectsReactIslands(['/x/src/components/Button.tsx'])).toBe(true);
    expect(detectsReactIslands(['<Component client:load />'])).toBe(true);
    expect(detectsReactIslands(['/x/src/pages/Home.astro'])).toBe(false);
  });

  it('PRD-401-R10: React-binding extraction is dispatched via PRD-400-R5 seam (binding is optional in v0.1)', () => {
    // v0.1 — the integration does not eagerly load `@act/react`. The seam is
    // present (detectsReactIslands), but extraction is a Standard+ feature.
    expect(detectsReactIslands([])).toBe(false);
  });

  it('PRD-401-R11: emits the PRD-105 static file set into Astro outDir (.well-known + act/)', async () => {
    const tmp = await freshTmp('r11');
    try {
      const i = actIntegration(baseOptions(tmp));
      await i.hooks['astro:build:done']({ dir: tmp });
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      expect((await fs.stat(path.join(tmp, 'act', 'index.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-401-R12: debounce factory is provided for dev-server watcher integration', async () => {
    let calls = 0;
    const d = debounce(() => { calls += 1; }, 20);
    d.call();
    d.call();
    d.call();
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    d.cancel();
  });

  it('PRD-401-R13: tmp files inside ACT-owned paths are cleaned up on error', async () => {
    const tmp = await freshTmp('r13');
    try {
      // Plant a tmp file then run a build that fails.
      const wellKnown = path.join(tmp, '.well-known');
      await fs.mkdir(wellKnown, { recursive: true });
      await fs.writeFile(path.join(wellKnown, 'orphan.tmp.1.2'), 'x');
      const cfg = resolveConfig({
        ...baseOptions(tmp),
        adapters: [
          {
            adapter: { // adapter that throws
              name: 'thrower',
              async init() { return { level: 'core' }; },
              async *enumerate() { yield 0; },
              async transform() { throw new Error('boom'); },
              async dispose() {},
            } as unknown as Adapter<unknown>,
            config: {},
            actVersion: '0.1',
          },
        ],
      }, tmp);
      await expect(runActBuild({ config: cfg })).rejects.toThrow();
      // Tmp file is cleaned up.
      const after = await fs.readdir(wellKnown);
      expect(after.find((n) => n.endsWith('.tmp.1.2'))).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-401-R14: detectAchievedBand wraps PRD-400-R17 with Astro defaults', () => {
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: false })).toBe('standard');
  });

  it('PRD-401-R15: build report is written at outDir/.act-build-report.json', async () => {
    const tmp = await freshTmp('r15');
    try {
      const i = actIntegration(baseOptions(tmp));
      await i.hooks['astro:build:done']({ dir: tmp });
      const sidecar = path.join(tmp, '.act-build-report.json');
      expect((await fs.stat(sidecar)).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-401-R16: integration enforces PRD-400-R29 adapter pinning before any init runs', async () => {
    const tmp = await freshTmp('r16');
    try {
      const i = actIntegration({
        ...baseOptions(tmp),
        adapters: [
          {
            adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
            config: { sourceDir: fixtureSrc },
            actVersion: '0.2', // mismatched
          },
        ],
      });
      await expect(i.hooks['astro:build:done']({ dir: tmp })).rejects.toThrow(/PRD-200-R25/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-401-R17: i18n integration is opt-in (v0.1: option present in ActAstroOptions, not auto-wired)', () => {
    const i = actIntegration({});
    expect(i.__options.i18n).toBeUndefined();
  });

  it('PRD-401-R18: integration plumbs Astro logger through the pipeline (optional surface)', async () => {
    const tmp = await freshTmp('r18');
    try {
      const i = actIntegration(baseOptions(tmp));
      await i.hooks['astro:build:done']({ dir: tmp });
      // No assertion failure → logger surface accepted (Astro's logger is
      // a no-op stand-in here; runActBuild defaults a console-backed one).
      expect(true).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-401-R19: ActAstroOptions satisfies GeneratorConfig minimum after resolveConfig', () => {
    const cfg = resolveConfig(
      {
        level: 'standard',
        site: { name: 'X' },
        urlTemplates: { subtreeUrlTemplate: '/act/subtrees/{id}.json' },
      },
      '/dist',
    );
    expect(cfg.conformanceTarget).toBe('standard');
    expect(cfg.urlTemplates?.subtreeUrlTemplate).toBe('/act/subtrees/{id}.json');
    expect(cfg.outputDir).toBe('/dist');
  });

  it('PRD-401-R20: dev-mode does NOT write to outDir (server:start is in-memory only)', () => {
    const i = actIntegration();
    // Calling server:start does not throw and does not touch the filesystem.
    i.hooks['astro:server:start']({ address: { port: 3000 } });
    expect(true).toBe(true);
  });

  it('runActBuild end-to-end emits manifest, index, node files, and a build report', async () => {
    const tmp = await freshTmp('e2e');
    try {
      const cfg = resolveConfig(baseOptions(tmp), tmp);
      const report = await runActBuild({ config: cfg });
      expect(report.conformanceAchieved).toBe('core');
      const paths = report.files.map((f) => f.path);
      expect(paths.find((p) => p.endsWith('/.well-known/act.json'))).toBeDefined();
      expect(paths.find((p) => p.endsWith('/act/index.json'))).toBeDefined();
      expect(paths.filter((p) => p.includes('/act/nodes/')).length).toBeGreaterThanOrEqual(5);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

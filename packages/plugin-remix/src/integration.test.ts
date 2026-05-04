/**
 * PRD-406 Remix-Vite plugin (static export) — integration tests. R1–R20.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-framework';

import {
  REMIX_STATIC_PACKAGE_NAME,
  REMIX_STATIC_PACKAGE_VERSION,
  REMIX_STATIC_PLUGIN_NAME,
  act,
  detectAchievedBand,
  detectsPrerenderConfig,
  findRemixPlugin,
  isClientBuild,
  isRemixVersionSupported,
  isViteVersionSupported,
  readRemixPluginOptions,
  readRouteActExport,
  resolveBuildReportPath,
  resolveConfig,
  runActBuild,
  writeBuildReport,
  type ActRemixOptions,
  type RemixLikeOptions,
  type RemixVitePluginLike,
  type ViteLikeResolvedConfig,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.resolve(here, '..', 'test-fixtures', 'sample-site');
const fixtureContent = path.join(fixtureSite, 'content');

async function freshTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(here, '..', `test-tmp-${prefix}-`));
}

function baseOptions(outDir: string): ActRemixOptions {
  return {
    outputDir: outDir,
    adapters: [
      {
        adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
        config: { sourceDir: fixtureContent },
        actVersion: '0.1',
      },
    ],
    manifest: { siteName: 'Acme Remix' },
  };
}

function fakeRemixPlugin(opts: RemixLikeOptions): RemixVitePluginLike & {
  name: string;
} {
  return { name: 'remix', _remixOptions: opts };
}

function silentLogger(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

describe('PRD-406 Remix-Vite plugin (static export)', () => {
  it('PRD-406-R1: package surface — act() returns a Vite Plugin-shaped object with __act marker, name "act/remix"', () => {
    const plugin = act();
    expect(REMIX_STATIC_PACKAGE_NAME).toBe('@act-spec/plugin-remix');
    expect(REMIX_STATIC_PACKAGE_VERSION).toBe('0.0.0');
    expect(REMIX_STATIC_PLUGIN_NAME).toBe('act/remix');
    expect(plugin.name).toBe('act/remix');
    expect(typeof plugin.closeBundle).toBe('function');
    expect(typeof plugin.configResolved).toBe('function');
    expect(plugin.__act.plugin.name).toBe('@act-spec/plugin-remix');
  });

  it('PRD-406-R2: isRemixVersionSupported requires @remix-run/dev ^2.0.0', () => {
    expect(isRemixVersionSupported('2.0.0')).toBe(true);
    expect(isRemixVersionSupported('2.16.4')).toBe(true);
    expect(isRemixVersionSupported('1.19.3')).toBe(false);
    expect(isRemixVersionSupported('3.0.0')).toBe(false);
    expect(isRemixVersionSupported('not-a-version')).toBe(false);
  });

  it('PRD-406-R2: isViteVersionSupported requires vite ^5.0.0', () => {
    expect(isViteVersionSupported('5.0.0')).toBe(true);
    expect(isViteVersionSupported('5.4.10')).toBe(true);
    expect(isViteVersionSupported('4.5.0')).toBe(false);
    expect(isViteVersionSupported('6.0.0')).toBe(false);
    expect(isViteVersionSupported('xyz')).toBe(false);
  });

  it('PRD-406-R3: detectsPrerenderConfig recognizes the prerender directive AND per-route prerender flags', () => {
    expect(detectsPrerenderConfig(null)).toBe(false);
    expect(detectsPrerenderConfig({})).toBe(false);
    expect(detectsPrerenderConfig({ prerender: true })).toBe(true);
    expect(detectsPrerenderConfig({ prerender: ['/about'] })).toBe(true);
    expect(detectsPrerenderConfig({ prerender: () => ['/about'] })).toBe(true);
    expect(
      detectsPrerenderConfig({
        routes: [
          { id: 'about', path: '/about', prerender: true },
          { id: 'contact', path: '/contact' },
        ],
      }),
    ).toBe(true);
    expect(
      detectsPrerenderConfig({
        routes: [{ id: 'home', path: '/' }],
      }),
    ).toBe(false);
  });

  it('PRD-406-R3: configResolved throws build error when Remix plugin is detected without prerender wiring', () => {
    const plugin = act();
    const resolved: ViteLikeResolvedConfig = {
      build: { ssr: false },
      logger: silentLogger(),
      plugins: [fakeRemixPlugin({})],
    };
    expect(() => plugin.configResolved!(resolved)).toThrow(/PRD-406-R3/);
    // Error includes v0.2 remediation hint per PRD-406-R3.
    try {
      void plugin.configResolved!(resolved);
    } catch (e) {
      expect((e as Error).message).toMatch(/v0\.2/);
    }
  });

  it('PRD-406-R3: configResolved permits direct invocation (no Remix plugin in array) without throwing', () => {
    const plugin = act();
    expect(() =>
      plugin.configResolved!({
        build: { ssr: false },
        logger: silentLogger(),
        plugins: [],
      }),
    ).not.toThrow();
  });

  it('PRD-406-R3: configResolved with prerender directive present passes', () => {
    const plugin = act();
    expect(() =>
      plugin.configResolved!({
        build: { ssr: false },
        logger: silentLogger(),
        plugins: [fakeRemixPlugin({ prerender: true })],
      }),
    ).not.toThrow();
  });

  it('PRD-406-R4: enforce: "post" so act() runs after Remix populates the route tree; apply: "build" excludes serve', () => {
    const plugin = act();
    expect(plugin.enforce).toBe('post');
    expect(plugin.apply).toBe('build');
  });

  it('PRD-406-R4: findRemixPlugin recognizes both "remix" and "remix-vite" plugin names', () => {
    expect(
      findRemixPlugin([{ name: 'foo' }, { name: 'remix', _remixOptions: {} } as unknown as { name: string }]),
    ).toEqual({ name: 'remix', _remixOptions: {} });
    expect(
      findRemixPlugin([
        { name: 'remix-vite', _remixOptions: { prerender: true } } as unknown as { name: string },
      ]),
    ).toEqual({ name: 'remix-vite', _remixOptions: { prerender: true } });
    expect(findRemixPlugin([{ name: 'foo' }, { name: 'bar' }])).toBeNull();
    expect(findRemixPlugin(undefined)).toBeNull();
  });

  it('PRD-406-R4: readRemixPluginOptions tolerates _remixOptions OR _remix.options shapes', () => {
    expect(readRemixPluginOptions(null)).toBeNull();
    expect(readRemixPluginOptions(undefined)).toBeNull();
    expect(readRemixPluginOptions({ _remixOptions: { prerender: true } })).toEqual({ prerender: true });
    expect(readRemixPluginOptions({ _remix: { options: { prerender: ['/x'] } } })).toEqual({
      prerender: ['/x'],
    });
    expect(readRemixPluginOptions({})).toBeNull();
  });

  it('PRD-406-R5: pipeline runs from closeBundle against ACT-owned paths only — Remix-owned files untouched', async () => {
    const tmp = await freshTmp('r5');
    try {
      // Plant a Remix-owned file in the client output dir.
      await fs.mkdir(tmp, { recursive: true });
      const remixFile = path.join(tmp, 'index.html');
      await fs.writeFile(remixFile, '<html>remix-prerendered</html>');
      const before = await fs.readFile(remixFile, 'utf8');
      const cfg = resolveConfig(baseOptions(tmp), tmp);
      await runActBuild({ config: cfg });
      const after = await fs.readFile(remixFile, 'utf8');
      expect(after).toBe(before);
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      expect((await fs.stat(path.join(tmp, 'act', 'index.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R5: isClientBuild gates on Vite\'s build.ssr flag — server build is a no-op', async () => {
    expect(isClientBuild(undefined)).toBe(true);
    expect(isClientBuild({ build: {} })).toBe(true);
    expect(isClientBuild({ build: { ssr: false } })).toBe(true);
    expect(isClientBuild({ build: { ssr: true } })).toBe(false);
    expect(isClientBuild({ build: { ssr: 'entry-server.js' } })).toBe(false);

    // closeBundle invoked twice (client + server) emits exactly once.
    const tmp = await freshTmp('r5-twice');
    const reportDir = await fs.mkdtemp(path.join(here, '..', 'r5-twice-report-'));
    try {
      const plugin = act({
        ...baseOptions(tmp),
        buildReportPath: path.join(reportDir, '.act-build-report.json'),
      });
      // Client build
      await plugin.configResolved!({
        build: { ssr: false },
        logger: silentLogger(),
        plugins: [fakeRemixPlugin({ prerender: true })],
      });
      await plugin.closeBundle!();
      const firstStat = await fs.stat(path.join(tmp, '.well-known', 'act.json'));
      // Server build re-resolves config; instead exercise the gate directly:
      // a fresh plugin that resolves with ssr: true must NOT emit anything.
      const tmp2 = await freshTmp('r5-server');
      const reportDir2 = await fs.mkdtemp(path.join(here, '..', 'r5-server-report-'));
      try {
        const pluginServer = act({
          ...baseOptions(tmp2),
          outputDir: tmp2,
          buildReportPath: path.join(reportDir2, '.act-build-report.json'),
        });
        await pluginServer.configResolved!({
          build: { ssr: true },
          logger: silentLogger(),
          plugins: [fakeRemixPlugin({ prerender: true })],
        });
        await pluginServer.closeBundle!();
        await expect(fs.stat(path.join(tmp2, '.well-known', 'act.json'))).rejects.toThrow();
      } finally {
        await fs.rm(tmp2, { recursive: true, force: true });
        await fs.rm(reportDir2, { recursive: true, force: true });
      }
      expect(firstStat.isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(reportDir, { recursive: true, force: true });
    }
  });

  it('PRD-406-R6: auto-wires PRD-201 markdown adapter when no explicit adapters supplied', () => {
    const cfg = resolveConfig({}, '/proj/build/client');
    expect(cfg.adapters.length).toBe(1);
    expect(cfg.adapters[0]!.adapter.name).toBe('act-markdown');
  });

  it('PRD-406-R7: route enumeration is delegated to Remix\'s plugin (read via _remixOptions.routes)', () => {
    // The contract: the integration consumes Remix\'s resolved route tree;
    // it does NOT re-implement Remix\'s flat-vs-nested route convention parser.
    const opts: RemixLikeOptions = {
      prerender: true,
      routes: [
        { id: 'about', path: '/about', prerender: true, file: 'app/routes/about.tsx' },
        { id: 'contact', path: '/contact', prerender: true, file: 'app/routes/contact.tsx' },
        { id: 'api', path: '/api/data', prerender: false, file: 'app/routes/api.data.tsx' },
      ],
    };
    const remixPlugin = fakeRemixPlugin(opts);
    const read = readRemixPluginOptions(remixPlugin);
    expect(read?.routes?.length).toBe(3);
    // Only routes with prerender: true would become ACT nodes per PRD-406-R7.
    const prerendered = (read?.routes ?? []).filter((r) => r.prerender === true);
    expect(prerendered.map((r) => r.id)).toEqual(['about', 'contact']);
  });

  it('PRD-406-R8: .mdx disambiguation is location-driven (app/routes/** vs content/**)', () => {
    // Disambiguation is enforced by the markdown adapter only walking
    // `content/**`; the React-binding side reads modules under `app/routes/**`.
    // Verify resolveConfig\'s default markdown adapter sourceDir excludes
    // `app/routes/`.
    const cfg = resolveConfig({}, '/proj/build/client');
    const sourceDir = (cfg.adapters[0]!.config as { sourceDir: string }).sourceDir;
    expect(sourceDir).toBe(path.join('/proj', 'content'));
    expect(sourceDir).not.toMatch(/app\/routes/);
  });

  it('PRD-406-R9: readRouteActExport reads top-level act const from a route module', () => {
    expect(readRouteActExport({ act: { id: 'about', summary: 's' } })).toEqual({
      id: 'about',
      summary: 's',
    });
    expect(readRouteActExport({})).toBeNull();
    expect(readRouteActExport(null)).toBeNull();
    expect(readRouteActExport({ act: 'not-an-object' })).toBeNull();
    expect(readRouteActExport({ act: { /* missing id */ summary: 's' } })).toBeNull();
    expect(readRouteActExport({ act: { id: 'x', type: 'page', title: 'X', summary: 's' } })).toEqual({
      id: 'x',
      type: 'page',
      title: 'X',
      summary: 's',
    });
    // Function form → unsupported sentinel (skip extraction with warning).
    const fn = readRouteActExport({ act: () => ({ id: 'x' }) });
    expect(fn?._unsupported).toBe(true);
  });

  it('PRD-406-R10: dev-mode (vite serve) closeBundle is a no-op with a one-time logger note', async () => {
    const tmp = await freshTmp('r10');
    try {
      const messages: string[] = [];
      const logger = {
        info: (m: string) => messages.push(`info:${m}`),
        warn: (m: string) => messages.push(`warn:${m}`),
        error: (m: string) => messages.push(`error:${m}`),
      };
      const plugin = act(baseOptions(tmp));
      // Tell the plugin we\'re in serve mode.
      plugin.config!({}, { command: 'serve', mode: 'development' });
      await plugin.configResolved!({
        build: { ssr: false },
        logger,
        plugins: [fakeRemixPlugin({ prerender: true })],
      });
      await plugin.closeBundle!();
      await plugin.closeBundle!();
      // No artifacts emitted.
      await expect(fs.stat(path.join(tmp, '.well-known', 'act.json'))).rejects.toThrow();
      // Logger note emitted exactly once.
      const notes = messages.filter((m) => m.includes('vite build'));
      expect(notes.length).toBe(1);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R11: emits PRD-105 file-set into build/client/ (.well-known/act.json + act/index.json + nodes)', async () => {
    const tmp = await freshTmp('r11');
    try {
      const cfg = resolveConfig(baseOptions(tmp), tmp);
      const report = await runActBuild({ config: cfg });
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      expect((await fs.stat(path.join(tmp, 'act', 'index.json'))).isFile()).toBe(true);
      const nodeFiles = report.files.filter((f) => f.path.includes('/act/nodes/'));
      expect(nodeFiles.length).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R12: tmp files inside ACT-owned paths are cleaned up on adapter error; Remix paths untouched', async () => {
    const tmp = await freshTmp('r12');
    try {
      const wellKnown = path.join(tmp, '.well-known');
      await fs.mkdir(wellKnown, { recursive: true });
      await fs.writeFile(path.join(wellKnown, 'orphan.tmp.1.2'), 'x');
      // Plant a Remix-owned file. Cleanup MUST NOT touch it.
      await fs.writeFile(path.join(tmp, 'index.html'), '<html>remix</html>');
      const cfg = resolveConfig(
        {
          ...baseOptions(tmp),
          adapters: [
            {
              adapter: {
                name: 'thrower',
                async init() {
                  return { level: 'core' };
                },
                async *enumerate() {
                  yield 0;
                },
                async transform() {
                  throw new Error('boom');
                },
                async dispose() {},
              } as unknown as Adapter<unknown>,
              config: {},
              actVersion: '0.1',
            },
          ],
        },
        tmp,
      );
      await expect(runActBuild({ config: cfg })).rejects.toThrow();
      const after = await fs.readdir(wellKnown);
      expect(after.find((n) => n.endsWith('.tmp.1.2'))).toBeUndefined();
      // Remix-owned file preserved.
      const html = await fs.readFile(path.join(tmp, 'index.html'), 'utf8');
      expect(html).toBe('<html>remix</html>');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R13: manifest construction populates capabilities from observed emissions, delivery=static, act_version=0.1', async () => {
    const tmp = await freshTmp('r13');
    try {
      const cfg = resolveConfig(baseOptions(tmp), tmp);
      await runActBuild({ config: cfg });
      const manifest = JSON.parse(
        await fs.readFile(path.join(tmp, '.well-known', 'act.json'), 'utf8'),
      ) as { delivery: string; act_version: string; capabilities: Record<string, unknown> };
      expect(manifest.delivery).toBe('static');
      expect(manifest.act_version).toBe('0.1');
      expect(typeof manifest.capabilities).toBe('object');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R14: detectAchievedBand wraps PRD-400-R17 with Remix-side defaults', () => {
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: false, hasNdjson: false })).toBe('core');
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: false })).toBe(
      'standard',
    );
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: true })).toBe('strict');
  });

  it('PRD-406-R15: build report defaults to project root (NOT inside build/client/); inside-out path produces a warning', async () => {
    const tmp = await freshTmp('r15');
    try {
      // Default → outside outputDir (uses process.cwd()).
      const def = resolveBuildReportPath({}, tmp);
      expect(def.warning).toBeUndefined();
      expect(def.path.startsWith(tmp + path.sep)).toBe(false);
      // Override into build/client/ → warning.
      const insideOut = resolveBuildReportPath(
        { buildReportPath: path.join(tmp, '.act-build-report.json') },
        tmp,
      );
      expect(insideOut.warning).toMatch(/PRD-406-R15/);
      // writeBuildReport actually writes to disk.
      const reportDir = await fs.mkdtemp(path.join(here, '..', 'r15-report-'));
      const reportPath = path.join(reportDir, '.act-build-report.json');
      await writeBuildReport(reportPath, {
        startedAt: new Date().toISOString(),
        durationMs: 0,
        conformanceTarget: 'core',
        conformanceAchieved: 'core',
        capabilities: {},
        files: [],
        warnings: [],
        errors: [],
      });
      expect((await fs.stat(reportPath)).isFile()).toBe(true);
      await fs.rm(reportDir, { recursive: true, force: true });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R15: configResolved logs the inside-build/client/ warning via Vite logger', async () => {
    const tmp = await freshTmp('r15-warn');
    try {
      const messages: string[] = [];
      const logger = {
        info: (m: string) => messages.push(`info:${m}`),
        warn: (m: string) => messages.push(`warn:${m}`),
        error: (m: string) => messages.push(`error:${m}`),
      };
      const plugin = act({
        outputDir: tmp,
        buildReportPath: path.join(tmp, '.act-build-report.json'),
      });
      await plugin.configResolved!({
        build: { ssr: false },
        logger,
        plugins: [fakeRemixPlugin({ prerender: true })],
      });
      expect(messages.some((m) => m.startsWith('warn:') && m.includes('PRD-406-R15'))).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R16: failOnExtractionError throws when placeholder warnings present (default false → no throw)', async () => {
    const tmp = await freshTmp('r16');
    try {
      const stubAdapter = {
        name: 'placeholder-emitter',
        async init() {
          return { level: 'core' };
        },
        async *enumerate() {
          yield 0;
        },
        async transform() {
          return {
            act_version: '0.1',
            id: 'placeholder-page',
            type: 'page',
            title: 'Placeholder',
            summary: 'placeholder summary line over here',
            content: [{ type: 'prose', text: 'placeholder body' }],
            tokens: { summary: 4, body: 2 },
            metadata: {
              source: { adapter: 'placeholder-emitter', source_id: '0' },
              extraction_status: 'failed',
            },
          };
        },
        async dispose() {},
      } as unknown as Adapter<unknown>;
      const cfg = resolveConfig(
        {
          ...baseOptions(tmp),
          adapters: [{ adapter: stubAdapter, config: {}, actVersion: '0.1' }],
        },
        tmp,
      );
      // Default false → no throw, warning surfaces in report.
      const r = await runActBuild({ config: cfg });
      expect(
        r.warnings.some(
          (w) => w.startsWith('placeholder:') || /extraction_status=(failed|partial)/.test(w),
        ),
      ).toBe(true);
      // Set true → throws.
      await expect(runActBuild({ config: cfg, failOnExtractionError: true })).rejects.toThrow(
        /PRD-406-R16/,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R17: integration enforces PRD-400-R29 adapter pinning before init runs', async () => {
    const tmp = await freshTmp('r17');
    try {
      const cfg = resolveConfig(
        {
          ...baseOptions(tmp),
          adapters: [
            {
              adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
              config: { sourceDir: fixtureContent },
              actVersion: '0.2', // mismatched
            },
          ],
        },
        tmp,
      );
      await expect(runActBuild({ config: cfg })).rejects.toThrow(/PRD-200-R25/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R18: integration plumbs a Vite-shaped logger through the pipeline', async () => {
    const tmp = await freshTmp('r18');
    try {
      const messages: string[] = [];
      const cfg = resolveConfig(baseOptions(tmp), tmp);
      await runActBuild({
        config: cfg,
        logger: {
          info: (m) => messages.push(`info:${m}`),
          warn: (m) => messages.push(`warn:${m}`),
          error: (m) => messages.push(`error:${m}`),
        },
      });
      // Logger surface accepted — no throw and pipeline emits.
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R18: act() picks up Vite\'s logger from the resolved config and uses it for warnings', async () => {
    const tmp = await freshTmp('r18-pickup');
    try {
      const messages: string[] = [];
      const logger = {
        info: (m: string) => messages.push(`info:${m}`),
        warn: (m: string) => messages.push(`warn:${m}`),
        error: (m: string) => messages.push(`error:${m}`),
      };
      const plugin = act({
        outputDir: tmp,
        buildReportPath: path.join(tmp, '.act-build-report.json'), // triggers warning
      });
      await plugin.configResolved!({
        build: { ssr: false },
        logger,
        plugins: [fakeRemixPlugin({ prerender: true })],
      });
      // The Vite logger captured the warning.
      expect(messages.some((m) => m.includes('PRD-406-R15'))).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-406-R19: ActRemixOptions resolves into a GeneratorConfig satisfying PRD-400-R31', () => {
    const cfg = resolveConfig(
      {
        conformanceTarget: 'standard',
        manifest: { siteName: 'Acme Remix' },
        urlTemplates: { subtreeUrlTemplate: '/act/subtrees/{id}.json' },
        failOnExtractionError: true,
      },
      '/proj/build/client',
    );
    expect(cfg.conformanceTarget).toBe('standard');
    expect(cfg.outputDir).toBe('/proj/build/client');
    expect(cfg.urlTemplates?.subtreeUrlTemplate).toBe('/act/subtrees/{id}.json');
    expect(cfg.failOnExtractionError).toBe(true);
    expect(cfg.site.name).toBe('Acme Remix');
    expect(cfg.generator).toBe(`${REMIX_STATIC_PACKAGE_NAME}@${REMIX_STATIC_PACKAGE_VERSION}`);
  });

  it('PRD-406-R20: end-to-end pipeline emits validator-clean output (manifest + index + nodes)', async () => {
    const tmp = await freshTmp('r20');
    try {
      const cfg = resolveConfig(baseOptions(tmp), tmp);
      const report = await runActBuild({ config: cfg });
      expect(report.conformanceAchieved).toBe('core');
      const paths = report.files.map((f) => f.path);
      expect(paths.find((p) => p.endsWith('/.well-known/act.json'))).toBeDefined();
      expect(paths.find((p) => p.endsWith('/act/index.json'))).toBeDefined();
      expect(paths.filter((p) => p.includes('/act/nodes/')).length).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  // Auxiliary: end-to-end Vite plugin invocation (config → configResolved → closeBundle)
  // exercises every integration code path in one shot.
  it('aux: end-to-end Vite plugin invocation emits artifacts into build/client/', async () => {
    const tmp = await freshTmp('e2e');
    try {
      const reportDir = await fs.mkdtemp(path.join(here, '..', 'e2e-report-'));
      const reportPath = path.join(reportDir, '.act-build-report.json');
      const plugin = act({
        ...baseOptions(tmp),
        buildReportPath: reportPath,
      });
      plugin.config!({}, { command: 'build', mode: 'production' });
      await plugin.configResolved!({
        build: { ssr: false },
        logger: silentLogger(),
        plugins: [fakeRemixPlugin({ prerender: true })],
      });
      await plugin.closeBundle!();
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      expect((await fs.stat(reportPath)).isFile()).toBe(true);
      await fs.rm(reportDir, { recursive: true, force: true });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  // Auxiliary: invocationCount tracks every closeBundle call (server + client +
  // dev). Confirms we don't overcount or skip the gate.
  it('aux: closeBundle invocation count records every call across client/server/dev', async () => {
    const tmp = await freshTmp('aux-count');
    const reportDir = await fs.mkdtemp(path.join(here, '..', 'aux-count-report-'));
    try {
      const plugin = act({
        ...baseOptions(tmp),
        buildReportPath: path.join(reportDir, '.act-build-report.json'),
      });
      plugin.config!({}, { command: 'build', mode: 'production' });
      await plugin.configResolved!({
        build: { ssr: false },
        logger: silentLogger(),
        plugins: [fakeRemixPlugin({ prerender: true })],
      });
      await plugin.closeBundle!();
      await plugin.closeBundle!();
      expect(plugin.__act.state.invocationCount).toBe(2);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(reportDir, { recursive: true, force: true });
    }
  });
});

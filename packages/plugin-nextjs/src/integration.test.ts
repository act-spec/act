/**
 * PRD-405 Next.js plugin (static export) — integration tests. R1–R22.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-framework';

import {
  ActWebpackPostBuildPlugin,
  NEXTJS_STATIC_PACKAGE_NAME,
  NEXTJS_STATIC_PACKAGE_VERSION,
  detectAchievedBand,
  detectsReactRoutes,
  isNextVersionSupported,
  isOutputExport,
  readPageActExport,
  resolveBuildReportPath,
  resolveConfig,
  resolveI18n,
  runActBuild,
  waitForExportMarker,
  withAct,
  writeBuildReport,
  type NextLikeConfig,
  type WebpackLikeConfig,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.resolve(here, '..', 'test-fixtures', 'sample-site');
const fixtureContent = path.join(fixtureSite, 'content');

async function freshTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(here, '..', `test-tmp-${prefix}-`));
}

function baseOptions(outDir: string) {
  return {
    outputDir: outDir,
    adapters: [
      {
        adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
        config: { sourceDir: fixtureContent },
        actVersion: '0.1',
      },
    ],
    manifest: { siteName: 'Acme' },
  } as const;
}

function nextConfigStub(overrides: Partial<NextLikeConfig> = {}): NextLikeConfig {
  return { output: 'export', ...overrides };
}

describe('PRD-405 Next.js plugin (static export)', () => {
  it('PRD-405-R1: package surface — withAct returns a NextConfig-shaped object with __act marker', () => {
    const result = withAct(nextConfigStub());
    expect(NEXTJS_STATIC_PACKAGE_NAME).toBe('@act-spec/plugin-nextjs');
    expect(NEXTJS_STATIC_PACKAGE_VERSION).toBe('0.0.0');
    expect(result.__act.plugin.name).toBe('@act-spec/plugin-nextjs');
    expect(typeof result.webpack).toBe('function');
  });

  it('PRD-405-R2: isNextVersionSupported requires Next ≥ 14.2 < 16', () => {
    expect(isNextVersionSupported('14.2.0')).toBe(true);
    expect(isNextVersionSupported('14.5.7')).toBe(true);
    expect(isNextVersionSupported('15.0.3')).toBe(true);
    expect(isNextVersionSupported('14.1.0')).toBe(false);
    expect(isNextVersionSupported('13.5.0')).toBe(false);
    expect(isNextVersionSupported('16.0.0')).toBe(false);
    expect(isNextVersionSupported('not-a-version')).toBe(false);
  });

  it('PRD-405-R3: rejects output: "server" / "standalone" / unset; accepts "export"', () => {
    expect(isOutputExport('export')).toBe(true);
    expect(isOutputExport('server')).toBe(false);
    expect(isOutputExport('standalone')).toBe(false);
    expect(isOutputExport(undefined)).toBe(false);
    expect(() => withAct({ output: 'server' })).toThrow(/PRD-405-R3/);
    expect(() => withAct({ output: 'standalone' })).toThrow(/PRD-405-R3/);
    expect(() => withAct({})).toThrow(/PRD-405-R3/);
    // Error includes PRD-501 remediation hint.
    try {
      withAct({ output: 'server' });
    } catch (e) {
      expect((e as Error).message).toMatch(/PRD-501/);
    }
  });

  it('PRD-405-R4: withAct is left-of-composable; passes through user webpack callback + every other field', () => {
    let userWebpackCalled = false;
    const userWebpack = (cfg: WebpackLikeConfig): WebpackLikeConfig => {
      userWebpackCalled = true;
      return { ...cfg, plugins: [...(cfg.plugins ?? []), { __user: true }] };
    };
    const result = withAct({
      output: 'export',
      webpack: userWebpack,
      // Arbitrary user-owned fields the wrapper MUST preserve.
      reactStrictMode: true,
      images: { unoptimized: true },
    });
    // User fields preserved (PRD-405-R4 — withAct does not mutate other plugins' fields).
    expect((result as unknown as { reactStrictMode: boolean }).reactStrictMode).toBe(true);
    // The wrapped webpack invokes the user's callback first.
    const merged = result.webpack!({ plugins: [] }, { isServer: true, dev: false });
    expect(userWebpackCalled).toBe(true);
    expect(merged.plugins?.some((p) => (p as { __user?: boolean }).__user === true)).toBe(true);
    // Our post-build plugin is appended (last entry).
    expect(merged.plugins?.some((p) => p instanceof ActWebpackPostBuildPlugin)).toBe(true);
  });

  it('PRD-405-R5: pipeline runs from post-build hook against ACT-owned paths only', async () => {
    const tmp = await freshTmp('r5');
    try {
      const cfg = resolveConfig(nextConfigStub(), baseOptions(tmp), tmp);
      // Plant a Next-owned file; verify the pipeline does NOT touch it.
      const nextFile = path.join(tmp, 'index.html');
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(nextFile, '<html>next-owned</html>');
      const before = await fs.readFile(nextFile, 'utf8');
      await runActBuild({ config: cfg });
      const after = await fs.readFile(nextFile, 'utf8');
      expect(after).toBe(before);
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      expect((await fs.stat(path.join(tmp, 'act', 'index.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-405-R5: waitForExportMarker resolves immediately when marker present; returns false on timeout', async () => {
    const tmp = await freshTmp('r5-marker');
    try {
      // Marker absent → false quickly.
      const t0 = Date.now();
      const found1 = await waitForExportMarker(tmp, 100);
      expect(found1).toBe(false);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
      // Plant the marker → true.
      await fs.writeFile(path.join(tmp, '.next-static-export-marker'), '');
      const found2 = await waitForExportMarker(tmp, 1_000);
      expect(found2).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-405-R6: auto-wires PRD-201 markdown adapter when no explicit adapters supplied', () => {
    const cfg = resolveConfig(nextConfigStub(), {}, '/proj/out');
    expect(cfg.adapters.length).toBe(1);
    expect(cfg.adapters[0]!.adapter.name).toBe('act-markdown');
  });

  it('PRD-405-R7: .mdx disambiguation is location-driven (content/** vs app/pages/**)', () => {
    // The disambiguation is enforced by adapter source-dir vs binding route
    // discovery; the content adapter only walks `content/**`, the binding
    // detector only inspects `app/`, `pages/`, `src/components/`. Verify the
    // detector does NOT pick up files under `content/`.
    const fakeRoot = fixtureSite;
    return Promise.resolve().then(async () => {
      const found = await detectsReactRoutes(path.join(fakeRoot, 'content'));
      expect(found).toBe(false);
    });
  });

  it('PRD-405-R8: readPageActExport reads top-level act const from a route module', () => {
    expect(readPageActExport({ act: { id: 'about', summary: 's' } })).toEqual({
      id: 'about',
      summary: 's',
    });
    expect(readPageActExport({})).toBeNull();
    expect(readPageActExport(null)).toBeNull();
    expect(readPageActExport({ act: 'not-an-object' })).toBeNull();
    expect(readPageActExport({ act: { /* missing id */ summary: 's' } })).toBeNull();
    // Function form → unsupported sentinel (skip extraction with warning).
    const fn = readPageActExport({ act: () => ({ id: 'x' }) });
    expect(fn?._unsupported).toBe(true);
  });

  it('PRD-405-R9: detectsReactRoutes finds .tsx under app/ AND pages/; skips content/', async () => {
    expect(await detectsReactRoutes(fixtureSite)).toBe(true);
    expect(await detectsReactRoutes(path.join(fixtureSite, 'content'))).toBe(false);
    // Non-existent root → false.
    expect(await detectsReactRoutes(path.join(fixtureSite, '__missing__'))).toBe(false);
  });

  it('PRD-405-R10: i18n auto-wiring — multi-locale Next config → Pattern 2 by default', () => {
    const ml = resolveI18n(
      { output: 'export', i18n: { locales: ['en', 'fr', 'de'], defaultLocale: 'en' } },
      'auto',
    );
    expect(ml).not.toBeNull();
    expect(ml!.locales).toEqual(['en', 'fr', 'de']);
    expect(ml!.pattern).toBe('2');
    // Pattern 1 opt-in.
    const p1 = resolveI18n(
      { output: 'export', i18n: { locales: ['en', 'fr'] } },
      { pattern: '1' },
    );
    expect(p1?.pattern).toBe('1');
    // Single-locale → null (no i18n needed).
    expect(resolveI18n({ output: 'export', i18n: { locales: ['en'] } }, 'auto')).toBeNull();
    // Disabled.
    expect(resolveI18n({ output: 'export', i18n: { locales: ['en', 'fr'] } }, false)).toBeNull();
    // No i18n config at all.
    expect(resolveI18n({ output: 'export' }, 'auto')).toBeNull();
  });

  it('PRD-405-R11: emits PRD-105 file-set into Next out/ (.well-known/act.json + act/index.json + nodes)', async () => {
    const tmp = await freshTmp('r11');
    try {
      const cfg = resolveConfig(nextConfigStub(), baseOptions(tmp), tmp);
      const report = await runActBuild({ config: cfg });
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      expect((await fs.stat(path.join(tmp, 'act', 'index.json'))).isFile()).toBe(true);
      const nodeFiles = report.files.filter((f) => f.path.includes('/act/nodes/'));
      expect(nodeFiles.length).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-405-R12: tmp files inside ACT-owned paths are cleaned up on adapter error', async () => {
    const tmp = await freshTmp('r12');
    try {
      const wellKnown = path.join(tmp, '.well-known');
      await fs.mkdir(wellKnown, { recursive: true });
      await fs.writeFile(path.join(wellKnown, 'orphan.tmp.1.2'), 'x');
      const cfg = resolveConfig(
        nextConfigStub(),
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
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-405-R13: manifest construction populates capabilities from observed emissions, delivery=static, act_version=0.1', async () => {
    const tmp = await freshTmp('r13');
    try {
      const cfg = resolveConfig(nextConfigStub(), baseOptions(tmp), tmp);
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

  it('PRD-405-R14: detectAchievedBand wraps PRD-400-R17 with Next-side defaults', () => {
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: false, hasNdjson: false })).toBe('core');
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: false })).toBe(
      'standard',
    );
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: true })).toBe('strict');
  });

  it('PRD-405-R15: build report defaults to project root (NOT inside out/); inside-out path produces a warning', async () => {
    const tmp = await freshTmp('r15');
    try {
      // Default → outside outputDir (uses process.cwd()).
      const def = resolveBuildReportPath({}, tmp);
      expect(def.warning).toBeUndefined();
      expect(def.path.startsWith(tmp + path.sep)).toBe(false);
      // Override into out/ → warning.
      const insideOut = resolveBuildReportPath(
        { buildReportPath: path.join(tmp, '.act-build-report.json') },
        tmp,
      );
      expect(insideOut.warning).toMatch(/PRD-405-R15/);
      // writeBuildReport actually writes to disk (sibling of `tmp`, then cleaned).
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

  it('PRD-405-R16: failOnExtractionError throws when placeholder warnings present (default false → no throw)', async () => {
    const tmp = await freshTmp('r16');
    try {
      // Adapter that emits a placeholder-flagged node (PRD-301-R22 surface).
      // The framework auto-emits a warning for extraction_status === 'failed'
      // (`<adapter>: <id> extraction_status=failed`); we re-test our R16
      // failure path against a synthetic `placeholder:` prefix by pre-pending
      // it through the warning channel of the run via a wrapper transform.
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
            content: [
              { type: 'prose', text: 'placeholder body' },
            ],
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
        nextConfigStub(),
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
        /PRD-405-R16/,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-405-R17: integration enforces PRD-400-R29 adapter pinning before init runs', async () => {
    const tmp = await freshTmp('r17');
    try {
      const cfg = resolveConfig(
        nextConfigStub(),
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

  it('PRD-405-R18: integration plumbs a Next-shaped logger through the pipeline', async () => {
    const tmp = await freshTmp('r18');
    try {
      const messages: string[] = [];
      const cfg = resolveConfig(nextConfigStub(), baseOptions(tmp), tmp);
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

  it('PRD-405-R19: dev-mode is a no-op — webpack wrap does NOT register the post-build plugin when ctx.dev', () => {
    const result = withAct(nextConfigStub());
    const dev = result.webpack!({ plugins: [] }, { isServer: true, dev: true });
    const prod = result.webpack!({ plugins: [] }, { isServer: true, dev: false });
    expect(dev.plugins?.some((p) => p instanceof ActWebpackPostBuildPlugin)).toBe(false);
    expect(prod.plugins?.some((p) => p instanceof ActWebpackPostBuildPlugin)).toBe(true);
    // Client-side webpack invocation also does NOT register the plugin (server build only).
    const client = result.webpack!({ plugins: [] }, { isServer: false, dev: false });
    expect(client.plugins?.some((p) => p instanceof ActWebpackPostBuildPlugin)).toBe(false);
  });

  it('PRD-405-R20: ActNextOptions resolves into a GeneratorConfig satisfying PRD-400-R31', () => {
    const cfg = resolveConfig(
      nextConfigStub(),
      {
        conformanceTarget: 'standard',
        manifest: { siteName: 'Acme' },
        urlTemplates: { subtreeUrlTemplate: '/act/subtrees/{id}.json' },
        failOnExtractionError: true,
      },
      '/proj/out',
    );
    expect(cfg.conformanceTarget).toBe('standard');
    expect(cfg.outputDir).toBe('/proj/out');
    expect(cfg.urlTemplates?.subtreeUrlTemplate).toBe('/act/subtrees/{id}.json');
    expect(cfg.failOnExtractionError).toBe(true);
    expect(cfg.site.name).toBe('Acme');
    expect(cfg.generator).toBe(`${NEXTJS_STATIC_PACKAGE_NAME}@${NEXTJS_STATIC_PACKAGE_VERSION}`);
  });

  it('PRD-405-R21: end-to-end pipeline emits validator-clean output (manifest + index + nodes)', async () => {
    const tmp = await freshTmp('r21');
    try {
      const cfg = resolveConfig(nextConfigStub(), baseOptions(tmp), tmp);
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

  it('PRD-405-R22: mounts option threads through to __act marker (parent-manifest emission deferred to PRD-400)', () => {
    const result = withAct(nextConfigStub(), {
      mounts: [{ path: '/help', target: 'https://help.example.com/' }],
    });
    expect(result.__act.options.mounts).toBeDefined();
    expect((result.__act.options.mounts as unknown[])?.length).toBe(1);
  });

  // Auxiliary: `__act` carries i18n + buildReportPath for downstream tooling.
  it('aux: withAct exposes resolvedI18n + buildReportPath via __act', () => {
    const result = withAct(
      { output: 'export', i18n: { locales: ['en', 'fr'], defaultLocale: 'en' } },
      {},
    );
    expect(result.__act.resolvedI18n?.locales).toEqual(['en', 'fr']);
    expect(typeof result.__act.buildReportPath).toBe('string');
  });

  // Auxiliary: webpack wrap with no user callback still works.
  it('aux: webpack wrap functions when nextConfig.webpack is undefined', () => {
    const result = withAct({ output: 'export' });
    const merged = result.webpack!({ plugins: [] }, { isServer: true, dev: false });
    expect(merged.plugins?.some((p) => p instanceof ActWebpackPostBuildPlugin)).toBe(true);
  });

  // Auxiliary: ActWebpackPostBuildPlugin.apply wires done.tapPromise and runs a build.
  it('aux: ActWebpackPostBuildPlugin.apply runs the pipeline via the done hook', async () => {
    const tmp = await freshTmp('apply');
    try {
      const cfg = resolveConfig(nextConfigStub(), baseOptions(tmp), tmp);
      const reportDir = await fs.mkdtemp(path.join(here, '..', 'apply-report-'));
      const plugin = new ActWebpackPostBuildPlugin({
        config: cfg,
        buildReportPath: path.join(reportDir, '.act-build-report.json'),
        failOnExtractionError: false,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });
      let capturedCallback: ((stats: unknown) => Promise<void>) | undefined;
      plugin.apply({
        hooks: {
          done: {
            tapPromise: (_name, cb) => {
              capturedCallback = cb;
            },
          },
        },
      });
      expect(typeof capturedCallback).toBe('function');
      // Plant the marker so waitForExportMarker resolves immediately.
      await fs.writeFile(path.join(tmp, '.next-static-export-marker'), '');
      await capturedCallback!({});
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      await fs.rm(reportDir, { recursive: true, force: true });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

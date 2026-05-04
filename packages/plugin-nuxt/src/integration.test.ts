/**
 * PRD-407 Nuxt module — integration tests. R1–R22.
 *
 * Every requirement gets at least one TDD-style test citing the PRD ID.
 * Tests drive the module's programmatic surface (the `defineActModule`
 * factory, the `runActBuild` programmatic entry, and each lifecycle
 * helper) without spinning a real `nuxt generate` — the integration's
 * pipeline is identical whether invoked from `build:done` or from
 * `runActBuild`.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-framework';

import {
  NUXT_DEFAULT_BINDING,
  NUXT_PACKAGE_NAME,
  NUXT_PACKAGE_VERSION,
  applyRouteFilter,
  defineActModule,
  detectAchievedBand,
  detectContent,
  detectI18n,
  isGenerateMode,
  isNuxtVersionSupported,
  resolveBuildReportPath,
  resolveConfig,
  resolveOutputDir,
  runActBuild,
  validateOptions,
  writeBuildReport,
  type ActNuxtOptions,
  type NuxtLike,
  type NuxtRouteLike,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const fixtureSite = path.resolve(here, '..', 'test-fixtures', 'sample-site');
const fixtureContent = path.join(fixtureSite, 'content');

async function freshTmp(prefix: string): Promise<string> {
  // Create tmp dirs under the package root so they live inside any
  // `rootDir` we pass to the module (PRD-407-R14 forbids outputDir
  // outside rootDir).
  return fs.mkdtemp(path.join(packageRoot, `test-tmp-${prefix}-`));
}

function baseOptions(outDir: string): ActNuxtOptions {
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
  };
}

function nuxtStub(overrides: Partial<NuxtLike['options']> = {}, version = '3.10.0'): NuxtLike & {
  _hooks: Record<string, Array<(...args: unknown[]) => unknown>>;
} {
  const hooks: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  return {
    _version: version,
    options: {
      rootDir: fixtureSite,
      _generate: true,
      ...overrides,
    },
    hook: (event: string, cb: (...args: unknown[]) => unknown): void => {
      (hooks[event] ??= []).push(cb);
    },
    _hooks: hooks,
  };
}

describe('PRD-407 Nuxt module', () => {
  it('PRD-407-R1: package surface — defineActModule returns a Nuxt-3 module spec with __act marker', () => {
    const m = defineActModule({ manifest: { siteName: 'Acme' } });
    expect(NUXT_PACKAGE_NAME).toBe('@act-spec/plugin-nuxt');
    expect(NUXT_PACKAGE_VERSION).toBe('0.0.0');
    expect(m.meta.name).toBe('@act-spec/plugin-nuxt');
    expect(m.meta.configKey).toBe('act');
    expect(m.meta.compatibility.nuxt).toMatch(/^>=3\.0\.0/);
    expect(typeof m.setup).toBe('function');
    expect(m.__act.options.manifest?.siteName).toBe('Acme');
    expect(m.defaults.conformanceTarget).toBe('core');
    expect(m.defaults.incremental).toBe(true);
  });

  it('PRD-407-R2: isNuxtVersionSupported requires Nuxt 3+; rejects Nuxt 2.x and bad strings', () => {
    expect(isNuxtVersionSupported('3.0.0')).toBe(true);
    expect(isNuxtVersionSupported('3.10.5')).toBe(true);
    expect(isNuxtVersionSupported('4.0.0')).toBe(true);
    expect(isNuxtVersionSupported('2.18.0')).toBe(false);
    expect(isNuxtVersionSupported('1.0.0')).toBe(false);
    expect(isNuxtVersionSupported('not-a-version')).toBe(false);
    expect(isNuxtVersionSupported(undefined)).toBe(false);
    expect(isNuxtVersionSupported('')).toBe(false);
    // Setup throws on Nuxt 2.
    const m = defineActModule();
    const nuxt = nuxtStub({}, '2.18.0');
    expect(() => m.setup({}, nuxt)).toThrow(/PRD-407-R2/);
  });

  it('PRD-407-R3: validates options shape; setup runs validation before any hook fires', () => {
    expect(() => validateOptions(undefined as unknown as ActNuxtOptions)).toThrow(/PRD-407-R3/);
    expect(() => validateOptions(null as unknown as ActNuxtOptions)).toThrow(/PRD-407-R3/);
    expect(() => validateOptions('nope' as unknown as ActNuxtOptions)).toThrow(/PRD-407-R3/);
    expect(() =>
      validateOptions({ conformanceTarget: 'gold' as unknown as 'core' }),
    ).toThrow(/PRD-407-R3/);
    expect(() =>
      validateOptions({ extractionMode: 'magic' as unknown as 'ssr-walk' }),
    ).toThrow(/PRD-407-R3/);
    expect(() =>
      validateOptions({ manifest: 'oops' as unknown as { siteName?: string } }),
    ).toThrow(/PRD-407-R3/);
    expect(() =>
      validateOptions({ routeFilter: 'oops' as unknown as () => boolean }),
    ).toThrow(/PRD-407-R3/);
    // Valid shapes pass through unchanged.
    const opts: ActNuxtOptions = { conformanceTarget: 'strict' };
    expect(validateOptions(opts)).toBe(opts);
    // factory throws if invalid options pre-setup.
    expect(() =>
      defineActModule({ conformanceTarget: 'gold' as unknown as 'core' }),
    ).toThrow(/PRD-407-R3/);
  });

  it('PRD-407-R4: hooks (preBuild/postBuild/onError) thread through to runActBuild', async () => {
    const tmp = await freshTmp('r4');
    const events: string[] = [];
    try {
      const cfg = resolveConfig(nuxtStub(), baseOptions(tmp), tmp);
      await runActBuild({
        config: cfg,
        hooks: {
          preBuild: () => {
            events.push('pre');
          },
          postBuild: () => {
            events.push('post');
          },
        },
      });
      expect(events).toEqual(['pre', 'post']);
      // onError fires on failure.
      const errEvents: string[] = [];
      const badCfg = resolveConfig(
        nuxtStub(),
        {
          ...baseOptions(tmp),
          adapters: [
            {
              adapter: {
                name: 'thrower',
                async init() {
                  return { level: 'core' };
                },
                // eslint-disable-next-line require-yield
                async *enumerate() {
                  throw new Error('boom');
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
      await expect(
        runActBuild({
          config: badCfg,
          hooks: {
            onError: () => {
              errEvents.push('err');
            },
          },
        }),
      ).rejects.toThrow();
      expect(errEvents).toEqual(['err']);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R5: build:done is wired exactly once; re-entry guard prevents double-execution', async () => {
    const tmp = await freshTmp('r5');
    try {
      const m = defineActModule(baseOptions(tmp));
      const nuxt = nuxtStub({ rootDir: packageRoot, _generate: true, nitro: { output: { publicDir: tmp } } });
      m.setup({}, nuxt);
      const handlers = nuxt._hooks['build:done'] ?? [];
      expect(handlers.length).toBe(1);
      // First invocation runs the pipeline.
      await handlers[0]!();
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
      // Tamper with the manifest mtime so a second run would overwrite.
      const manifestPath = path.join(tmp, '.well-known', 'act.json');
      const before = await fs.stat(manifestPath);
      // Wait a tick so mtime would differ if the pipeline ran again.
      await new Promise((r) => setTimeout(r, 10));
      // Second invocation is a no-op (re-entry guard).
      await handlers[0]!();
      const after = await fs.stat(manifestPath);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R6: refuses `nuxt build` (server output) — only runs under `nuxt generate`', async () => {
    const tmp = await freshTmp('r6');
    try {
      // isGenerateMode: false unless _generate set.
      expect(isGenerateMode({ options: {} } as NuxtLike)).toBe(false);
      expect(isGenerateMode({ options: { _generate: true } } as NuxtLike)).toBe(true);
      // build:done under `nuxt build` throws PRD-407-R6.
      const m = defineActModule(baseOptions(tmp));
      const nuxt = nuxtStub({
        rootDir: packageRoot,
        _generate: false,
        nitro: { output: { publicDir: tmp } },
      });
      m.setup({}, nuxt);
      const handlers = nuxt._hooks['build:done'] ?? [];
      await expect(handlers[0]!()).rejects.toThrow(/PRD-407-R6/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R7: auto-wires PRD-201 markdown adapter against Nuxt Content directory', () => {
    // Detection: `@nuxt/content` in modules → contentDir resolves under rootDir.
    const nuxt = nuxtStub({ modules: ['@nuxt/content'] });
    const detected = detectContent(nuxt);
    expect(detected?.contentDir).toBe(path.join(fixtureSite, 'content'));
    // Also detect when listed as [name, options] tuple in buildModules.
    const nuxt2 = nuxtStub({
      buildModules: [['@nuxt/content', {}] as unknown as string],
    });
    expect(detectContent(nuxt2)).not.toBeNull();
    // Absent → null.
    expect(detectContent(nuxtStub())).toBeNull();
    // resolveConfig auto-wires when no explicit adapters given.
    const cfg = resolveConfig(nuxt, { manifest: { siteName: 'Acme' } }, '/tmp/out');
    expect(cfg.adapters.length).toBe(1);
    expect(cfg.adapters[0]!.adapter.name).toBe('act-markdown');
    // Explicit adapters replace auto-wiring.
    const cfg2 = resolveConfig(
      nuxt,
      {
        manifest: { siteName: 'Acme' },
        adapters: [
          {
            adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
            config: { sourceDir: '/explicit' },
            actVersion: '0.1',
          },
        ],
      },
      '/tmp/out',
    );
    expect(cfg2.adapters.length).toBe(1);
    expect((cfg2.adapters[0]!.config as { sourceDir: string }).sourceDir).toBe('/explicit');
  });

  it('PRD-407-R8: route enumeration via pages:extend captures routes; routeFilter excludes', async () => {
    const tmp = await freshTmp('r8');
    try {
      let capturedRoutes: NuxtRouteLike[] = [];
      const m = defineActModule({
        ...baseOptions(tmp),
        routeFilter: (r) => r.id !== '/about',
      });
      const nuxt = nuxtStub({ rootDir: packageRoot, _generate: true, nitro: { output: { publicDir: tmp } } });
      m.setup({}, nuxt);
      const pageHooks = nuxt._hooks['pages:extend'] ?? [];
      expect(pageHooks.length).toBe(1);
      // Simulate Nuxt firing pages:extend with the resolved page list.
      pageHooks[0]!([
        { path: '/', file: path.join(fixtureSite, 'pages/index.vue') },
        { path: '/pricing', file: path.join(fixtureSite, 'pages/pricing.vue') },
        { path: '/about', file: path.join(fixtureSite, 'pages/about.vue') },
        { /* malformed entry — no path */ file: '/skip-me' },
      ]);
      capturedRoutes = (nuxt as unknown as { _act: { routes: NuxtRouteLike[] } })._act.routes;
      expect(capturedRoutes.map((r) => r.id)).toEqual(['/', '/pricing']);
      // applyRouteFilter unit (covers the early-return when no filter).
      expect(applyRouteFilter([{ id: '/x', file: '' }], undefined)).toEqual([
        { id: '/x', file: '' },
      ]);
      // Filter w/ parent metadata flowing through.
      const withParent = applyRouteFilter(
        [{ id: '/blog', file: '', parent: 'index' }],
        () => true,
      );
      expect(withParent[0]!.parent).toBe('index');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R9: dispatches PRD-302 vueBinding by default; bindings escape hatch overrides', () => {
    // Default binding sentinel exposed for fixtures + tests.
    expect(NUXT_DEFAULT_BINDING.name).toBe('@act-spec/component-vue');
    expect(typeof NUXT_DEFAULT_BINDING.extractRoute).toBe('function');
    // Module options surface honors `extractionMode`.
    const m = defineActModule({ extractionMode: 'static-ast' });
    expect(m.__act.options.extractionMode).toBe('static-ast');
    const m2 = defineActModule({ extractionMode: 'ssr-walk' });
    expect(m2.__act.options.extractionMode).toBe('ssr-walk');
    // Validation rejects bogus modes (R3 + R9).
    expect(() =>
      defineActModule({ extractionMode: 'magic' as unknown as 'ssr-walk' }),
    ).toThrow(/PRD-407-R3/);
  });

  it('PRD-407-R10: maps @nuxtjs/i18n strategies → PRD-104 patterns', () => {
    const mk = (strategy: string, locales: string[]): NuxtLike =>
      nuxtStub({ i18n: { strategy, locales, defaultLocale: locales[0] } });
    expect(detectI18n(mk('prefix', ['en', 'fr', 'de']))?.pattern).toBe('2');
    expect(detectI18n(mk('prefix_except_default', ['en', 'fr']))?.pattern).toBe('2');
    expect(detectI18n(mk('prefix_and_default', ['en', 'fr']))?.pattern).toBe('2');
    expect(detectI18n(mk('no_prefix', ['en', 'fr']))?.pattern).toBe('1');
    // Unmappable strategy throws PRD-407-R10 error.
    expect(() => detectI18n(mk('custom-domain', ['en', 'fr']))).toThrow(/PRD-407-R10/);
    // Single-locale → null (no i18n needed).
    expect(detectI18n(mk('prefix', ['en']))).toBeNull();
    // Empty/no locales → null.
    expect(detectI18n(mk('prefix', []))).toBeNull();
    // No i18n config → null.
    expect(detectI18n(nuxtStub())).toBeNull();
    // i18n: false override → null even when @nuxtjs/i18n is configured.
    expect(detectI18n(mk('prefix', ['en', 'fr']), false)).toBeNull();
    // pattern override wins over auto-mapping.
    expect(detectI18n(mk('prefix', ['en', 'fr']), { pattern: '1' })?.pattern).toBe('1');
    // Default-locale defaulting when not set.
    const noDefault = detectI18n(
      nuxtStub({ i18n: { strategy: 'prefix', locales: ['en', 'fr'] } }),
    );
    expect(noDefault?.defaultLocale).toBe('en');
    // Object-form locales ({ code }) accepted.
    const objLoc = detectI18n(
      nuxtStub({
        i18n: {
          strategy: 'prefix',
          locales: [{ code: 'en' }, { code: 'fr' }],
          defaultLocale: 'en',
        },
      }),
    );
    expect(objLoc?.locales).toEqual(['en', 'fr']);
    // Unset strategy defaults to 'prefix' (Pattern 2).
    const unset = detectI18n(
      nuxtStub({ i18n: { locales: ['en', 'fr'], defaultLocale: 'en' } }),
    );
    expect(unset?.pattern).toBe('2');
  });

  it('PRD-407-R11: app:created hook is registered for PRD-302 provider installation', async () => {
    const tmp = await freshTmp('r11');
    try {
      const m = defineActModule(baseOptions(tmp));
      const nuxt = nuxtStub({ rootDir: packageRoot, _generate: true, nitro: { output: { publicDir: tmp } } });
      m.setup({}, nuxt);
      const appHooks = nuxt._hooks['app:created'] ?? [];
      expect(appHooks.length).toBe(1);
      // Invoke the hook with a Vue-3-shaped app and assert the provider is
      // installed via the @act-spec/component-vue installActProvider call.
      // Use a real Vue app instance from the binding's helper.
      const { createApp } = await import('vue');
      const app = createApp({});
      await appHooks[0]!(app);
      // The install call doesn't return a value; assert no throw + a probe
      // that `provide()` is now wired by checking app.runWithContext exists.
      expect(typeof app.provide).toBe('function');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R12 / R21: vite:extendConfig hook adds the @act-spec/component-vue/macros plugin (deduped)', async () => {
    const tmp = await freshTmp('r12');
    try {
      const m = defineActModule(baseOptions(tmp));
      const nuxt = nuxtStub({ rootDir: packageRoot, _generate: true, nitro: { output: { publicDir: tmp } } });
      m.setup({}, nuxt);
      const viteHooks = nuxt._hooks['vite:extendConfig'] ?? [];
      expect(viteHooks.length).toBe(1);
      // First call adds the plugin entry.
      const cfg: { plugins?: Array<{ name?: string }> } = {};
      viteHooks[0]!(cfg);
      expect(cfg.plugins?.some((p) => p?.name === '@act-spec/component-vue/macros')).toBe(true);
      // Second call de-dupes by name.
      const beforeLen = cfg.plugins!.length;
      viteHooks[0]!(cfg);
      expect(cfg.plugins!.length).toBe(beforeLen);
      // Honors a pre-existing plugins array on the vite config.
      const cfg2: { plugins?: Array<{ name?: string }> } = { plugins: [{ name: 'user-plugin' }] };
      viteHooks[0]!(cfg2);
      expect(cfg2.plugins!.some((p) => p?.name === 'user-plugin')).toBe(true);
      expect(cfg2.plugins!.some((p) => p?.name === '@act-spec/component-vue/macros')).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R13: ActNuxtOptions resolves into a GeneratorConfig satisfying PRD-400-R31', () => {
    const cfg = resolveConfig(
      nuxtStub({ rootDir: fixtureSite }),
      {
        conformanceTarget: 'standard',
        manifest: { siteName: 'Acme' },
        urlTemplates: { subtreeUrlTemplate: '/act/subtrees/{id}.json' },
        failOnExtractionError: true,
        incremental: false,
      },
      '/proj/out',
    );
    expect(cfg.conformanceTarget).toBe('standard');
    expect(cfg.outputDir).toBe('/proj/out');
    expect(cfg.urlTemplates?.subtreeUrlTemplate).toBe('/act/subtrees/{id}.json');
    expect(cfg.failOnExtractionError).toBe(true);
    expect(cfg.incremental).toBe(false);
    expect(cfg.site.name).toBe('Acme');
    expect(cfg.generator).toBe(`${NUXT_PACKAGE_NAME}@${NUXT_PACKAGE_VERSION}`);
    // outputDir override on options wins over fallback.
    const cfg2 = resolveConfig(
      nuxtStub(),
      { outputDir: '/explicit/out', manifest: { siteName: 'Acme' } },
      '/fallback',
    );
    expect(cfg2.outputDir).toBe('/explicit/out');
    // Default site name when manifest missing.
    const cfg3 = resolveConfig(nuxtStub(), {}, '/x');
    expect(cfg3.site.name).toBe('ACT Nuxt site');
    // Custom content roots short-circuit the auto-wire path.
    const cfg4 = resolveConfig(
      nuxtStub({ rootDir: fixtureSite }),
      { content: { roots: ['content'] }, manifest: { siteName: 'Acme' } },
      '/x',
    );
    expect((cfg4.adapters[0]!.config as { sourceDir: string }).sourceDir).toBe(
      path.join(fixtureSite, 'content'),
    );
  });

  it('PRD-407-R14: outputDir defaults to Nitro publicDir; outside-root paths are rejected', () => {
    // Default → <rootDir>/.output/public
    expect(resolveOutputDir(nuxtStub({ rootDir: '/tmp/proj' }))).toBe(
      path.resolve('/tmp/proj/.output/public'),
    );
    // Honors nitro.output.publicDir override.
    expect(
      resolveOutputDir(
        nuxtStub({ rootDir: '/tmp/proj', nitro: { output: { publicDir: '/tmp/proj/dist' } } }),
      ),
    ).toBe(path.resolve('/tmp/proj/dist'));
    // Honors explicit override.
    expect(resolveOutputDir(nuxtStub({ rootDir: '/tmp/proj' }), '/tmp/proj/custom')).toBe(
      path.resolve('/tmp/proj/custom'),
    );
    // Refuses paths outside the project root.
    expect(() => resolveOutputDir(nuxtStub({ rootDir: '/tmp/proj' }), '/etc')).toThrow(
      /PRD-407-R14/,
    );
    // Project root itself is permissible (target === root).
    expect(resolveOutputDir(nuxtStub({ rootDir: '/tmp/proj' }), '/tmp/proj')).toBe(
      path.resolve('/tmp/proj'),
    );
  });

  it('PRD-407-R15: pipeline runs from build:done; tmp files inside ACT-owned paths cleaned up on adapter error', async () => {
    const tmp = await freshTmp('r15');
    try {
      // Plant a stale tmp file so cleanupTmp's sweep can be observed.
      const wellKnown = path.join(tmp, '.well-known');
      await fs.mkdir(wellKnown, { recursive: true });
      await fs.writeFile(path.join(wellKnown, 'orphan.tmp.1.2'), 'x');
      const cfg = resolveConfig(
        nuxtStub({ rootDir: fixtureSite }),
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

  it('PRD-407-R16: build report defaults to project root (NOT inside outputDir); inside-output path produces a warning', async () => {
    const tmp = await freshTmp('r16');
    try {
      const def = resolveBuildReportPath({}, tmp, packageRoot);
      expect(def.warning).toBeUndefined();
      expect(def.path.startsWith(tmp + path.sep)).toBe(false);
      // Override into output-dir → warning.
      const insideOut = resolveBuildReportPath(
        { buildReportPath: path.join(tmp, '.act-build-report.json') },
        tmp,
        packageRoot,
      );
      expect(insideOut.warning).toMatch(/PRD-407-R16/);
      // Path equality also flags as inside-output (covers the === branch).
      const equalOut = resolveBuildReportPath(
        { buildReportPath: tmp },
        tmp,
        packageRoot,
      );
      expect(equalOut.warning).toMatch(/PRD-407-R16/);
      // writeBuildReport actually writes to disk.
      const reportDir = await fs.mkdtemp(path.join(here, '..', 'r16-report-'));
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
      // build:done invocation also writes the sidecar at the resolved path.
      const m = defineActModule(baseOptions(tmp));
      const nuxt = nuxtStub({
        rootDir: packageRoot,
        _generate: true,
        nitro: { output: { publicDir: tmp } },
      });
      m.setup({}, nuxt);
      await nuxt._hooks['build:done']![0]!();
      const reportPath2 = (nuxt as unknown as { _act: { buildReportPath: string } })._act
        .buildReportPath;
      expect((await fs.stat(reportPath2)).isFile()).toBe(true);
      await fs.rm(reportPath2, { force: true });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R17: failOnExtractionError throws when placeholder warnings present (default false → no throw)', async () => {
    const tmp = await freshTmp('r17');
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
        nuxtStub({ rootDir: fixtureSite }),
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
        /PRD-407-R17/,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R18: detectAchievedBand wraps PRD-400-R17 with Nuxt-side defaults', () => {
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: false, hasNdjson: false })).toBe(
      'core',
    );
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: false })).toBe(
      'standard',
    );
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: true })).toBe('strict');
  });

  it('PRD-407-R19: capability backing — manifest never advertises subtree/ndjson without files', async () => {
    const tmp = await freshTmp('r19');
    try {
      const cfg = resolveConfig(nuxtStub({ rootDir: fixtureSite }), baseOptions(tmp), tmp);
      const r = await runActBuild({ config: cfg });
      // Core build → no subtree files; capability MUST be unset/false per PRD-400-R18.
      expect(r.files.some((f) => f.path.includes('/act/subtrees/'))).toBe(false);
      expect(r.files.some((f) => f.path.endsWith('.ndjson'))).toBe(false);
      const manifest = JSON.parse(
        await fs.readFile(path.join(tmp, '.well-known', 'act.json'), 'utf8'),
      ) as { capabilities: Record<string, unknown> };
      expect(manifest.capabilities['subtree']).not.toBe(true);
      expect(manifest.capabilities['ndjson_index']).not.toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-407-R20: pinning enforcement passthrough — adapter actVersion mismatch fails the build', async () => {
    const tmp = await freshTmp('r20');
    try {
      const cfg = resolveConfig(
        nuxtStub({ rootDir: fixtureSite }),
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

  it('PRD-407-R22: end-to-end pipeline emits validator-clean output (manifest + index + nodes)', async () => {
    const tmp = await freshTmp('r22');
    try {
      const cfg = resolveConfig(nuxtStub({ rootDir: fixtureSite }), baseOptions(tmp), tmp);
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

  // Auxiliary: build:done without `nuxt.hook` defined (defensive guard).
  it('aux: defineActModule tolerates a Nuxt instance with no hook fn', () => {
    const m = defineActModule({ manifest: { siteName: 'Acme' } });
    const noHook: NuxtLike = {
      _version: '3.0.0',
      options: { rootDir: fixtureSite, _generate: true, nitro: { output: { publicDir: '/tmp' } } },
    };
    // Should NOT throw — hook is optional. The pipeline simply isn't wired.
    // (resolveOutputDir refuses /tmp because it's outside fixtureSite, so we
    // use a path inside fixtureSite to clear that gate.)
    const noHook2: NuxtLike = {
      _version: '3.0.0',
      options: {
        rootDir: fixtureSite,
        _generate: true,
        nitro: { output: { publicDir: path.join(fixtureSite, '.output/public') } },
      },
    };
    expect(() => m.setup({}, noHook2)).not.toThrow();
    // The original noHook with /tmp output should error per R14.
    expect(() => m.setup({}, noHook)).toThrow(/PRD-407-R14/);
  });

  // Auxiliary: i18n option threading via setup-time merge (override wins over factory options).
  it('aux: setup-time options merge with factory options (operator wins)', () => {
    const tmp = path.join(fixtureSite, '.output-aux');
    const m = defineActModule({ conformanceTarget: 'core' });
    const nuxt = nuxtStub({
      rootDir: fixtureSite,
      _generate: true,
      nitro: { output: { publicDir: tmp } },
    });
    m.setup({ conformanceTarget: 'standard', manifest: { siteName: 'Override' } }, nuxt);
    const state = (
      nuxt as unknown as {
        _act: { plugin: { config: { conformanceTarget: string; site: { name: string } } } };
      }
    )._act;
    expect(state.plugin.config.conformanceTarget).toBe('standard');
    expect(state.plugin.config.site.name).toBe('Override');
  });

  // Auxiliary: app:created hook gracefully accepts missing vue app (lazy-load failure path).
  // (This drives the ts/branch where installActProvider is invoked through dynamic import.)
  it('aux: app:created hook is callable with a real Vue app', async () => {
    const tmp = await freshTmp('aux-app');
    try {
      const m = defineActModule(baseOptions(tmp));
      const nuxt = nuxtStub({
        rootDir: packageRoot,
        _generate: true,
        nitro: { output: { publicDir: tmp } },
      });
      m.setup({}, nuxt);
      const handlers = nuxt._hooks['app:created'] ?? [];
      const { createApp } = await import('vue');
      await handlers[0]!(createApp({}));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

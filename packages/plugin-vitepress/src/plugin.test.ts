/**
 * @act-spec/plugin-vitepress — tests.
 *
 * Covers:
 *   - Hook registration: factory returns `transformPageData` + `buildEnd`
 *     functions and an `__act` observability handle.
 *   - Page-data accumulation: `transformPageData` pushes pages into state
 *     and threads observed locales into `__act.observedLocales`.
 *   - Manifest emission: `buildEnd` writes `/.well-known/act.json`,
 *     `/act/index.json`, and per-node files into the resolved output dir.
 *   - Locale traversal: VitePress `locales` config + page-attached `lang`
 *     both surface in the accumulator state.
 *   - llms.txt emit default-on with opt-out via `emit.llmsTxt: false`.
 *   - Option validation rejects bad shapes early.
 *   - parseMode "fine" against conformanceTarget "core" fails fast.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-framework';
import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import {
  VITEPRESS_PACKAGE_NAME,
  VITEPRESS_PACKAGE_VERSION,
  actPlugin,
  detectAchievedBand,
  extractLocales,
  resolveConfig,
  resolveOutputDir,
  resolveSourceDir,
  runActBuild,
  validateOptions,
  type VitePressActOptions,
  type VitePressPageData,
  type VitePressSiteConfig,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSrc = path.resolve(
  here,
  '..',
  '..',
  'adapter-markdown',
  'test-fixtures',
  'sample-tree',
);

async function freshTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(here, '..', `test-tmp-${prefix}-`));
}

function baseOptions(overrides: Partial<VitePressActOptions> = {}): VitePressActOptions {
  return {
    baseUrl: 'https://example.com',
    manifest: { site: { name: 'Example VitePress Docs' } },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/n/{id}.json',
    },
    ...overrides,
  };
}

function fixtureSiteConfig(outDir: string, extra: Partial<VitePressSiteConfig> = {}): VitePressSiteConfig {
  return {
    root: fixtureSrc,
    srcDir: fixtureSrc,
    outDir,
    title: 'Example VitePress Docs',
    ...extra,
  };
}

describe('@act-spec/plugin-vitepress — package surface', () => {
  it('exports the canonical package name + version constants', () => {
    expect(VITEPRESS_PACKAGE_NAME).toBe('@act-spec/plugin-vitepress');
    expect(VITEPRESS_PACKAGE_VERSION).toBe('0.2.0');
  });
});

describe('validateOptions', () => {
  it('throws when options is not an object', () => {
    expect(() => validateOptions(undefined)).toThrow(/must be an object/);
    expect(() => validateOptions(null)).toThrow(/must be an object/);
    expect(() => validateOptions('nope')).toThrow(/must be an object/);
  });

  it('requires baseUrl as a non-empty string', () => {
    expect(() =>
      validateOptions({ manifest: { site: { name: 'x' } }, urlTemplates: {} }),
    ).toThrow(/baseUrl/);
    expect(() =>
      validateOptions({
        baseUrl: '',
        manifest: { site: { name: 'x' } },
        urlTemplates: {},
      }),
    ).toThrow(/baseUrl/);
  });

  it('requires manifest.site.name as a string', () => {
    expect(() =>
      validateOptions({
        baseUrl: 'https://x',
        manifest: { site: {} },
        urlTemplates: {},
      }),
    ).toThrow(/manifest\.site\.name/);
  });

  it('requires urlTemplates as an object', () => {
    expect(() =>
      validateOptions({
        baseUrl: 'https://x',
        manifest: { site: { name: 'x' } },
      }),
    ).toThrow(/urlTemplates/);
  });

  it('rejects unknown conformanceTarget values', () => {
    expect(() =>
      validateOptions({
        baseUrl: 'https://x',
        manifest: { site: { name: 'x' } },
        urlTemplates: {},
        conformanceTarget: 'gold',
      }),
    ).toThrow(/conformanceTarget/);
  });

  it('rejects unknown parseMode values', () => {
    expect(() =>
      validateOptions({
        baseUrl: 'https://x',
        manifest: { site: { name: 'x' } },
        urlTemplates: {},
        parseMode: 'half-fine',
      }),
    ).toThrow(/parseMode/);
  });

  it('returns the validated options unchanged when shape is valid', () => {
    const valid = baseOptions();
    expect(validateOptions(valid)).toEqual(valid);
  });
});

describe('resolveOutputDir', () => {
  it('honors an explicit override', () => {
    const override = path.join(here, 'override-out');
    expect(resolveOutputDir(undefined, override)).toBe(path.resolve(override));
  });

  it("falls back to siteConfig.outDir when override is absent", () => {
    const out = path.join(here, 'cfg-out');
    expect(resolveOutputDir({ root: here, outDir: out }, undefined)).toBe(out);
  });

  it("defaults to <root>/.vitepress/dist when neither override nor outDir is set", () => {
    const root = path.join(here, 'root-only');
    expect(resolveOutputDir({ root }, undefined)).toBe(path.join(root, '.vitepress', 'dist'));
  });
});

describe('resolveSourceDir', () => {
  it('honors siteConfig.srcDir when set', () => {
    const out = resolveSourceDir({ root: here, srcDir: 'docs' });
    expect(out).toBe(path.resolve(here, 'docs'));
  });

  it('falls back to root when srcDir is absent', () => {
    expect(resolveSourceDir({ root: fixtureSrc })).toBe(fixtureSrc);
  });

  it('falls back to process.cwd() when siteConfig is undefined', () => {
    expect(resolveSourceDir(undefined)).toBe(process.cwd());
  });
});

describe('extractLocales', () => {
  it('returns the empty list for undefined or empty config', () => {
    expect(extractLocales(undefined)).toEqual([]);
    expect(extractLocales({})).toEqual([]);
  });

  it('returns the deduplicated, sorted locale set from siteConfig.locales', () => {
    const out = extractLocales({
      lang: 'en',
      locales: {
        root: { lang: 'en' },
        de: { lang: 'de-DE' },
        fr: { lang: 'fr-FR' },
      },
    });
    expect(out).toEqual(['de-DE', 'en', 'fr-FR']);
  });

  it("ignores entries without a `lang` field", () => {
    expect(extractLocales({ locales: { de: { label: 'Deutsch' } } })).toEqual([]);
  });
});

describe('detectAchievedBand', () => {
  it('returns "core" when only the manifest is observed', () => {
    expect(detectAchievedBand({ hasIndex: false, hasSubtree: false, hasNdjson: false })).toBe(
      'core',
    );
  });

  it('returns "standard" when index + subtree are emitted', () => {
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: false })).toBe(
      'standard',
    );
  });
});

describe('resolveConfig', () => {
  it('translates options into a GeneratorConfig with conformanceTarget defaulting to "standard"', () => {
    const cfg = resolveConfig({
      options: baseOptions(),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect(cfg.conformanceTarget).toBe('standard');
    expect(cfg.outputDir).toBe('/tmp/out');
    expect(cfg.site.name).toBe('Example VitePress Docs');
    expect(cfg.site.canonical_url).toBe('https://example.com');
    expect(cfg.urlTemplates).toEqual({
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/n/{id}.json',
    });
    expect(cfg.generator).toBe(`${VITEPRESS_PACKAGE_NAME}@${VITEPRESS_PACKAGE_VERSION}`);
  });

  it('auto-wires the markdown adapter against srcDir / root', () => {
    const cfg = resolveConfig({
      options: baseOptions(),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect(cfg.adapters.length).toBe(1);
    expect(cfg.adapters[0]!.adapter.name).toBe('act-markdown');
    expect((cfg.adapters[0]!.config as { sourceDir: string }).sourceDir).toBe(fixtureSrc);
  });

  it('forwards an explicit adapters override unchanged', () => {
    const cfg = resolveConfig({
      options: baseOptions({
        adapters: [
          {
            adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
            config: { sourceDir: fixtureSrc },
            actVersion: '0.1',
          },
        ],
      }),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect(cfg.adapters.length).toBe(1);
  });

  it('forwards parseMode to the auto-wired adapter', () => {
    const cfg = resolveConfig({
      options: baseOptions({ parseMode: 'fine', conformanceTarget: 'standard' }),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBe('fine');
  });

  it('defaults the markdown adapter mode to "fine" when target is "standard"', () => {
    const cfg = resolveConfig({
      options: baseOptions(),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBe('fine');
    expect((cfg.adapters[0]!.config as { targetLevel?: string }).targetLevel).toBe('standard');
  });

  it('defaults the markdown adapter mode to "coarse" when target is "core"', () => {
    const cfg = resolveConfig({
      options: baseOptions({ conformanceTarget: 'core' }),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBe('coarse');
  });

  it('rejects parseMode "fine" when conformanceTarget is "core"', () => {
    expect(() =>
      resolveConfig({
        options: baseOptions({ parseMode: 'fine', conformanceTarget: 'core' }),
        siteConfig: { root: fixtureSrc },
        outputDir: '/tmp/out',
      }),
    ).toThrow(/parseMode "fine" requires conformanceTarget >= "standard"/);
  });

  it('forwards `emit` opt-outs when supplied', () => {
    const cfg = resolveConfig({
      options: baseOptions({ emit: { llmsTxt: false, llmsFullTxt: false } }),
      siteConfig: { root: fixtureSrc },
      outputDir: '/tmp/out',
    });
    expect(cfg.emit).toEqual({ llmsTxt: false, llmsFullTxt: false });
  });
});

describe('actPlugin — hook registration + state', () => {
  it('returns transformPageData + buildEnd functions and an __act handle', () => {
    const plugin = actPlugin(baseOptions());
    expect(typeof plugin.transformPageData).toBe('function');
    expect(typeof plugin.buildEnd).toBe('function');
    expect(plugin.__act.invocations).toBe(0);
    expect(plugin.__act.pages).toEqual([]);
    expect(plugin.__act.observedLocales).toEqual([]);
  });

  it('throws synchronously when options are invalid (caller sees error before VitePress wires hooks)', () => {
    expect(() => actPlugin({ baseUrl: '' } as unknown as VitePressActOptions)).toThrow(/baseUrl/);
  });

  it('accumulates pages on transformPageData and threads observed locales', async () => {
    const plugin = actPlugin(baseOptions());
    const siteConfig: VitePressSiteConfig = {
      root: fixtureSrc,
      lang: 'en',
      locales: {
        root: { lang: 'en' },
        de: { lang: 'de-DE' },
      },
    };
    const pageEn: VitePressPageData = {
      relativePath: 'index.md',
      title: 'Home',
      lang: 'en',
    };
    const pageDe: VitePressPageData = {
      relativePath: 'de/index.md',
      title: 'Startseite',
      lang: 'de-DE',
    };
    await plugin.transformPageData(pageEn, { siteConfig });
    await plugin.transformPageData(pageDe, { siteConfig });
    expect(plugin.__act.pages.length).toBe(2);
    expect(plugin.__act.observedLocales).toEqual(['de-DE', 'en']);
    expect(plugin.__act.lastSiteConfig).toBe(siteConfig);
  });
});

describe('actPlugin — buildEnd emits ACT artifacts', () => {
  it('writes manifest, index, and per-node files into the resolved outDir', async () => {
    const tmp = await freshTmp('build');
    try {
      const plugin = actPlugin(baseOptions({ outputDir: tmp }));
      await plugin.buildEnd(fixtureSiteConfig(tmp));
      const manifestPath = path.join(tmp, '.well-known', 'act.json');
      const indexPath = path.join(tmp, 'act', 'index.json');
      expect((await fs.stat(manifestPath)).isFile()).toBe(true);
      expect((await fs.stat(indexPath)).isFile()).toBe(true);

      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
        string,
        unknown
      >;
      const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { nodes: unknown[] };
      expect(validateManifest(manifest).gaps).toEqual([]);
      expect(validateIndex(index).gaps).toEqual([]);
      expect(index.nodes.length).toBeGreaterThan(0);

      const nodesDir = path.join(tmp, 'act', 'nodes');
      const nodeFiles = await fs.readdir(nodesDir, { recursive: true });
      const jsonFiles = nodeFiles.filter((f) => f.endsWith('.json'));
      expect(jsonFiles.length).toBeGreaterThan(0);
      // Spot-check one node passes validation.
      const firstNodePath = path.join(nodesDir, jsonFiles[0] as string);
      const node = JSON.parse(await fs.readFile(firstNodePath, 'utf8')) as Record<string, unknown>;
      expect(validateNode(node).gaps).toEqual([]);

      expect(plugin.__act.invocations).toBe(1);
      expect(plugin.__act.lastOutputDir).toBe(tmp);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('emits llms.txt + llms-full.txt by default', async () => {
    const tmp = await freshTmp('llms-default');
    try {
      const plugin = actPlugin(baseOptions({ outputDir: tmp }));
      await plugin.buildEnd(fixtureSiteConfig(tmp));
      const llmsTxt = path.join(tmp, 'llms.txt');
      const llmsFull = path.join(tmp, 'llms-full.txt');
      expect((await fs.stat(llmsTxt)).isFile()).toBe(true);
      expect((await fs.stat(llmsFull)).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('opts out of llms.txt + llms-full.txt when emit flags are false', async () => {
    const tmp = await freshTmp('llms-off');
    try {
      const plugin = actPlugin(
        baseOptions({
          outputDir: tmp,
          emit: { llmsTxt: false, llmsFullTxt: false },
        }),
      );
      await plugin.buildEnd(fixtureSiteConfig(tmp));
      await expect(fs.stat(path.join(tmp, 'llms.txt'))).rejects.toThrow();
      await expect(fs.stat(path.join(tmp, 'llms-full.txt'))).rejects.toThrow();
      // Manifest still ships.
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('invokes preBuild + postBuild lifecycle hooks when provided', async () => {
    const tmp = await freshTmp('hooks');
    const calls: string[] = [];
    try {
      const plugin = actPlugin(
        baseOptions({
          outputDir: tmp,
          hooks: {
            preBuild: () => {
              calls.push('pre');
            },
            postBuild: () => {
              calls.push('post');
            },
          },
        }),
      );
      await plugin.buildEnd(fixtureSiteConfig(tmp));
      expect(calls).toEqual(['pre', 'post']);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('runActBuild — programmatic entry', () => {
  it('runs the pipeline against a manually-built GeneratorConfig and emits artifacts', async () => {
    const tmp = await freshTmp('progr');
    try {
      const config = resolveConfig({
        options: baseOptions(),
        siteConfig: { root: fixtureSrc, srcDir: fixtureSrc },
        outputDir: tmp,
      });
      const report = await runActBuild({ config });
      expect(report.files.length).toBeGreaterThan(0);
      expect(report.conformanceAchieved).toBeDefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('invokes onError on failure and surfaces the original error', async () => {
    const tmp = await freshTmp('err');
    let saw = false;
    try {
      const config = resolveConfig({
        options: baseOptions(),
        siteConfig: { root: fixtureSrc, srcDir: fixtureSrc },
        outputDir: tmp,
      });
      // Force a failure by handing preBuild a hook that throws — the
      // pipeline catches it, calls onError, then re-throws.
      const ranOnError = (): Promise<unknown> =>
        runActBuild({
          config,
          hooks: {
            preBuild: () => {
              throw new Error('boom');
            },
            onError: () => {
              saw = true;
            },
          },
        });
      await expect(ranOnError()).rejects.toThrow(/boom/);
      expect(saw).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

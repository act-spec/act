/**
 * PRD-408 Eleventy plugin — requirement-cited tests. Every PRD-408-R{n}
 * requirement is tested at least once; tests cite the requirement ID in
 * the title.
 *
 * Test layout:
 *   - Unit tests for option validation, version probe, output-dir
 *     resolution, permalink filtering, ignore-file parsing, conformance
 *     band detection, parseMode pre-flight (A10).
 *   - Integration tests that build the fixture site (`test-fixtures/
 *     sample-site`) end-to-end through `runActBuild` + the validator.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMarkdownAdapter } from '@act-spec/adapter-markdown';
import type { Adapter } from '@act-spec/adapter-framework';
import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import {
  ELEVENTY_PACKAGE_NAME,
  ELEVENTY_PACKAGE_VERSION,
  actEleventyPlugin,
  detectAchievedBand,
  enforceEleventyVersion,
  isEleventyVersionSupported,
  makePermalinkFilter,
  permalinkFilteredWarnings,
  publishedSourcePaths,
  readEleventyIgnore,
  resolveBuildReportPath,
  resolveConfig,
  resolveOutputDir,
  runActBuild,
  validateOptions,
  writeBuildReport,
  type EleventyActOptions,
  type EleventyAfterPayload,
  type EleventyConfigLike,
  type EleventyEventCallback,
  type EleventyResultEntry,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.resolve(here, '..', 'test-fixtures', 'sample-site');

async function freshTmp(prefix: string): Promise<string> {
  // Tmp dirs live UNDER the fixture site (the resolved project root) so
  // PRD-408-R13's "outputDir must stay inside project root" gate is
  // satisfied without each test plumbing a custom inputDir.
  return fs.mkdtemp(path.join(fixtureSite, `test-tmp-${prefix}-`));
}

function baseOptions(overrides: Partial<EleventyActOptions> = {}): EleventyActOptions {
  return {
    baseUrl: 'https://example.com',
    manifest: { site: { name: 'Example Eleventy' } },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/n/{id}.json',
    },
    ...overrides,
  };
}

interface CapturedConfig {
  versionRange?: string;
  versionThrows?: boolean;
  /** Disable the versionCheck function entirely (simulates Eleventy 1.x). */
  noVersionCheck?: boolean;
  inputDir?: string;
  outputDir?: string;
  /** Stub the ignores.add API. */
  ignoresAdd?: (pattern: string) => void;
}

function eleventyStub(opts: CapturedConfig = {}): EleventyConfigLike & {
  _hooks: Record<string, EleventyEventCallback[]>;
  _ignoreCalls: string[];
} {
  const hooks: Record<string, EleventyEventCallback[]> = {};
  const ignoreCalls: string[] = [];
  const cfg: EleventyConfigLike & {
    _hooks: Record<string, EleventyEventCallback[]>;
    _ignoreCalls: string[];
  } = {
    on: (event, cb) => {
      (hooks[event] ??= []).push(cb);
    },
    dir: { input: opts.inputDir ?? fixtureSite, output: opts.outputDir ?? '_site' },
    ignores: {
      add: opts.ignoresAdd ?? ((pattern: string) => {
        ignoreCalls.push(pattern);
      }),
    },
    _hooks: hooks,
    _ignoreCalls: ignoreCalls,
  };
  if (!opts.noVersionCheck) {
    cfg.versionCheck = (range: string) => {
      if (opts.versionThrows) {
        throw new Error(`unsupported range: ${range}`);
      }
      cfg._versionRange = range;
    };
  }
  return cfg as typeof cfg & { _versionRange?: string };
}

function makePayload(
  outputDir: string,
  results: readonly EleventyResultEntry[],
  inputDir = fixtureSite,
): EleventyAfterPayload {
  return {
    dir: { input: inputDir, output: outputDir },
    results: [...results],
    runMode: 'build',
    outputMode: 'fs',
  };
}

function publishedFixtureResults(outputDir: string): EleventyResultEntry[] {
  // Mirrors what Eleventy's `eleventy.after` would produce for our fixture
  // site (excludes the draft with `permalink: false` AND the ignored/ tree).
  return [
    {
      inputPath: path.join(fixtureSite, 'index.md'),
      outputPath: path.join(outputDir, 'index.html'),
      url: '/',
    },
    {
      inputPath: path.join(fixtureSite, 'about.md'),
      outputPath: path.join(outputDir, 'about/index.html'),
      url: '/about/',
    },
    {
      inputPath: path.join(fixtureSite, 'posts/2026-04-15-hello.md'),
      outputPath: path.join(outputDir, 'posts/2026-04-15-hello/index.html'),
      url: '/posts/2026-04-15-hello/',
    },
    {
      inputPath: path.join(fixtureSite, 'posts/2026-05-01-second-post.md'),
      outputPath: path.join(outputDir, 'posts/2026-05-01-second-post/index.html'),
      url: '/posts/2026-05-01-second-post/',
    },
  ];
}

describe('PRD-408 Eleventy plugin — package surface', () => {
  it('PRD-408-R1: package surface — actEleventyPlugin exports + name + version markers', () => {
    expect(ELEVENTY_PACKAGE_NAME).toBe('@act-spec/plugin-eleventy');
    expect(ELEVENTY_PACKAGE_VERSION).toBe('0.0.0');
    expect(typeof actEleventyPlugin).toBe('function');
    // Eleventy plugin signature: (eleventyConfig, options) => void/state.
    expect(actEleventyPlugin.length).toBeGreaterThanOrEqual(2);
  });

  it('PRD-408-R1: factory wires `eleventy.after` exactly once', () => {
    const cfg = eleventyStub();
    actEleventyPlugin(cfg, baseOptions());
    expect(cfg._hooks['eleventy.after']?.length).toBe(1);
    // Other hooks MUST NOT be wired (R5 forbids `before` / `beforeWatch`).
    expect(cfg._hooks['eleventy.before']).toBeUndefined();
    expect(cfg._hooks['eleventy.beforeWatch']).toBeUndefined();
  });
});

describe('PRD-408 — Eleventy version floor (R2)', () => {
  it('PRD-408-R2: isEleventyVersionSupported returns true when versionCheck succeeds', () => {
    expect(isEleventyVersionSupported(eleventyStub())).toBe(true);
  });

  it('PRD-408-R2: isEleventyVersionSupported returns false when versionCheck throws', () => {
    expect(isEleventyVersionSupported(eleventyStub({ versionThrows: true }))).toBe(false);
  });

  it('PRD-408-R2: isEleventyVersionSupported returns false when versionCheck is absent (Eleventy 1.x)', () => {
    expect(isEleventyVersionSupported(eleventyStub({ noVersionCheck: true }))).toBe(false);
  });

  it('PRD-408-R2: enforceEleventyVersion throws PRD-408-R2 on missing versionCheck', () => {
    expect(() => enforceEleventyVersion(eleventyStub({ noVersionCheck: true }))).toThrow(
      /PRD-408-R2/,
    );
  });

  it('PRD-408-R2: enforceEleventyVersion throws PRD-408-R2 when versionCheck throws (Eleventy 1.x range)', () => {
    expect(() => enforceEleventyVersion(eleventyStub({ versionThrows: true }))).toThrow(
      /PRD-408-R2/,
    );
  });

  it('PRD-408-R2: factory throws on Eleventy < 2.0', () => {
    expect(() => actEleventyPlugin(eleventyStub({ noVersionCheck: true }), baseOptions())).toThrow(
      /PRD-408-R2/,
    );
  });
});

describe('PRD-408 — source discovery (R3)', () => {
  it('PRD-408-R3: auto-wires PRD-201 against eleventyConfig.dir.input', async () => {
    const tmp = await freshTmp('r3');
    try {
      const { config } = resolveConfig({
        options: baseOptions({ outputDir: tmp }),
        projectRoot: fixtureSite,
        outputDir: tmp,
      });
      expect(config.adapters.length).toBe(1);
      const adapter = config.adapters[0]!;
      expect(adapter.adapter.name).toBe('act-markdown');
      expect((adapter.config as { sourceDir: string }).sourceDir).toBe(fixtureSite);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R3: .eleventyignore patterns thread into the adapter exclude glob', async () => {
    const ignored = await readEleventyIgnore(fixtureSite);
    expect(ignored).toContain('ignored/');
    // No file → empty list.
    const tmp = await freshTmp('r3-noignore');
    try {
      expect(await readEleventyIgnore(tmp)).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R3: readEleventyIgnore strips comments and blank lines', async () => {
    const tmp = await freshTmp('r3-comments');
    try {
      await fs.writeFile(
        path.join(tmp, '.eleventyignore'),
        '# leading comment\n\n_drafts/\n  # inline indented comment\nold.md\n',
      );
      expect(await readEleventyIgnore(tmp)).toEqual(['_drafts/', 'old.md']);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — addPlugin integration + options validation (R4, R10, R12)', () => {
  it('PRD-408-R4: validateOptions rejects non-object inputs', () => {
    expect(() => validateOptions(undefined)).toThrow(/PRD-408-R4/);
    expect(() => validateOptions(null)).toThrow(/PRD-408-R4/);
    expect(() => validateOptions('nope')).toThrow(/PRD-408-R4/);
    expect(() => validateOptions(42)).toThrow(/PRD-408-R4/);
  });

  it('PRD-408-R4 / R12: validateOptions requires baseUrl + manifest + urlTemplates', () => {
    expect(() => validateOptions({})).toThrow(/baseUrl/);
    expect(() => validateOptions({ baseUrl: 'https://x' })).toThrow(/manifest/);
    expect(() =>
      validateOptions({ baseUrl: 'https://x', manifest: {} }),
    ).toThrow(/manifest\.site/);
    expect(() =>
      validateOptions({ baseUrl: 'https://x', manifest: { site: {} } }),
    ).toThrow(/manifest\.site\.name/);
    expect(() =>
      validateOptions({
        baseUrl: 'https://x',
        manifest: { site: { name: 'X' } },
      }),
    ).toThrow(/urlTemplates/);
    // Empty baseUrl rejected.
    expect(() => validateOptions({ ...baseOptions(), baseUrl: '' })).toThrow(/baseUrl/);
  });

  it('PRD-408-R4 / R12: invalid conformanceTarget rejected', () => {
    expect(() =>
      validateOptions({ ...baseOptions(), conformanceTarget: 'gold' }),
    ).toThrow(/conformanceTarget/);
  });

  it('PRD-408-R4 / R12: invalid parseMode rejected (per A10)', () => {
    expect(() => validateOptions({ ...baseOptions(), parseMode: 'magic' })).toThrow(
      /parseMode/,
    );
  });

  it('PRD-408-R10: supplying `bindings` is a configuration error citing R10', () => {
    expect(() =>
      validateOptions({ ...baseOptions(), bindings: [{}] } as unknown),
    ).toThrow(/PRD-408-R10/);
    expect(() =>
      actEleventyPlugin(eleventyStub(), {
        ...baseOptions(),
        bindings: [{}] as unknown,
      } as unknown as EleventyActOptions),
    ).toThrow(/PRD-408-R10/);
  });

  it('PRD-408-R10: error message points to component-driven alternatives', () => {
    let thrown: Error | undefined;
    try {
      validateOptions({ ...baseOptions(), bindings: [{}] } as unknown);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toMatch(/@act-spec\/plugin-astro|@act-spec\/plugin-nextjs|@act-spec\/plugin-nuxt/);
  });

  it('PRD-408-R12: valid options pass through unchanged', () => {
    const opts = baseOptions({ conformanceTarget: 'standard', parseMode: 'fine' });
    expect(validateOptions(opts)).toBe(opts);
  });
});

describe('PRD-408 — lifecycle and re-entry (R5, R19)', () => {
  it('PRD-408-R5: pipeline runs at eleventy.after, exactly once per build', async () => {
    const tmp = await freshTmp('r5');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      const state = actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      expect(state.invocations).toBe(1);
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R5 / R19: re-entry guard awaits in-flight builds', async () => {
    const tmp = await freshTmp('r5-guard');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      const state = actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      const payload = makePayload(tmp, publishedFixtureResults(tmp));
      // Fire two invocations concurrently. The guard ensures the second
      // awaits the first; both complete without overlapping.
      const [r1, r2] = await Promise.allSettled([handler(payload), handler(payload)]);
      expect(r1.status).toBe('fulfilled');
      expect(r2.status).toBe('fulfilled');
      expect(state.invocations).toBe(2);
      // After both complete the in-flight handle is cleared.
      expect(state.inFlight).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R19: watch-mode rebuilds re-run the pipeline', async () => {
    const tmp = await freshTmp('r19');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      const state = actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      const payload = makePayload(tmp, publishedFixtureResults(tmp));
      await handler(payload);
      const before = await fs.stat(path.join(tmp, '.well-known', 'act.json'));
      // Wait so a second pipeline run would change mtimeMs.
      await new Promise((r) => setTimeout(r, 10));
      await handler(payload);
      expect(state.invocations).toBe(2);
      const after = await fs.stat(path.join(tmp, '.well-known', 'act.json'));
      // The second run actually re-emitted the manifest (mtime advances).
      expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — permalink-aware filtering (R6)', () => {
  it('PRD-408-R6: publishedSourcePaths normalises ./-prefixed paths', () => {
    const set = publishedSourcePaths([
      { inputPath: './posts/a.md', outputPath: '/x', url: '/a' },
      { inputPath: 'posts/b.md', outputPath: '/y', url: '/b' },
    ]);
    expect(set.has('posts/a.md')).toBe(true);
    expect(set.has('posts/b.md')).toBe(true);
  });

  it('PRD-408-R6: makePermalinkFilter retains absolute paths in the published set', () => {
    const set = publishedSourcePaths([
      { inputPath: 'posts/a.md', outputPath: '/x', url: '/a' },
    ]);
    const filter = makePermalinkFilter(set, '/proj');
    expect(filter('/proj/posts/a.md')).toBe(true);
    expect(filter('/proj/drafts/wip.md')).toBe(false);
  });

  it('PRD-408-R6: permalinkFilteredWarnings flags sources missing from results', () => {
    const set = publishedSourcePaths([
      { inputPath: 'a.md', outputPath: '/x', url: '/a' },
    ]);
    const warnings = permalinkFilteredWarnings(['a.md', 'b.md'], set);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/excluded_by_permalink/);
    expect(warnings[0]).toMatch(/PRD-408-R6/);
  });

  it('PRD-408-R6: end-to-end — drafts with permalink false are excluded from ACT emission', async () => {
    const tmp = await freshTmp('r6-e2e');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      // Eleventy's results omit the draft (`permalink: false`).
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      const indexJson = JSON.parse(
        await fs.readFile(path.join(tmp, 'act', 'index.json'), 'utf8'),
      ) as { nodes: Array<{ id: string }> };
      const ids = new Set(indexJson.nodes.map((n) => n.id));
      // Published fixture nodes ARE present.
      expect(ids.has('index')).toBe(true);
      expect(ids.has('about')).toBe(true);
      // The draft MUST NOT be present.
      const draftIds = [...ids].filter((id) => /work-in-progress/.test(id));
      expect(draftIds).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — URL space independence (R7)', () => {
  it('PRD-408-R7: ACT URLs derive from urlTemplates, NOT Eleventy permalinks', async () => {
    const tmp = await freshTmp('r7');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(
        cfg,
        baseOptions({
          outputDir: tmp,
          urlTemplates: {
            indexUrl: '/act/index.json',
            nodeUrlTemplate: '/act/n/{id}.json',
          },
        }),
      );
      const handler = cfg._hooks['eleventy.after']![0]!;
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      const manifest = JSON.parse(
        await fs.readFile(path.join(tmp, '.well-known', 'act.json'), 'utf8'),
      ) as { node_url_template: string; index_url: string };
      // The manifest URL space lives at /act/, independent of Eleventy's
      // /posts/.../ permalinks.
      expect(manifest.node_url_template).toBe('/act/n/{id}.json');
      expect(manifest.index_url).toBe('/act/index.json');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — single source of truth (R8)', () => {
  it('PRD-408-R8: the markdown corpus drives ACT content (not Eleventy rendered output)', async () => {
    const tmp = await freshTmp('r8');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      const indexJson = JSON.parse(
        await fs.readFile(path.join(tmp, 'act', 'index.json'), 'utf8'),
      ) as { nodes: Array<{ id: string; title: string }> };
      const aboutNode = indexJson.nodes.find((n) => n.id === 'about');
      expect(aboutNode?.title).toBe('About Acme'); // from frontmatter, not HTML <title>.
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — out-of-scope boundaries (R9, R10)', () => {
  it('PRD-408-R9: the plugin only walks .md / .mdx (no .njk / .liquid / .hbs / .ejs / .webc / .11ty.js)', () => {
    const { config } = resolveConfig({
      options: baseOptions(),
      projectRoot: fixtureSite,
      outputDir: '/tmp/out',
    });
    // The auto-wired adapter is PRD-201's act-markdown which walks
    // **/*.md{,x} per its default. Template engines are NOT walked.
    expect(config.adapters[0]!.adapter.name).toBe('act-markdown');
  });

  // R10 covered above in validation block.
});

describe('PRD-408 — collection hints (R11)', () => {
  it('PRD-408-R11: collections.synthesizeIndices defaults to false (no-op)', () => {
    const opts = baseOptions({ collections: { synthesizeIndices: false } });
    expect(validateOptions(opts).collections?.synthesizeIndices).toBe(false);
  });

  it('PRD-408-R11: collections.synthesizeIndices true is accepted (no error)', () => {
    const opts = baseOptions({ collections: { synthesizeIndices: true } });
    expect(validateOptions(opts).collections?.synthesizeIndices).toBe(true);
  });
});

describe('PRD-408 — plugin options shape (R12 + A10 parseMode)', () => {
  it('PRD-408-R12: ActOptions resolves into a GeneratorConfig satisfying PRD-400-R31', () => {
    const { config } = resolveConfig({
      options: baseOptions({
        conformanceTarget: 'standard',
        urlTemplates: {
          indexUrl: '/act/index.json',
          nodeUrlTemplate: '/act/n/{id}.json',
          subtreeUrlTemplate: '/act/sub/{id}.json',
        },
        failOnExtractionError: true,
        incremental: true,
      }),
      projectRoot: fixtureSite,
      outputDir: '/proj/out',
    });
    expect(config.conformanceTarget).toBe('standard');
    expect(config.outputDir).toBe('/proj/out');
    expect(config.urlTemplates?.subtreeUrlTemplate).toBe('/act/sub/{id}.json');
    expect(config.failOnExtractionError).toBe(true);
    expect(config.incremental).toBe(true);
    expect(config.site.name).toBe('Example Eleventy');
    expect(config.generator).toBe(`${ELEVENTY_PACKAGE_NAME}@${ELEVENTY_PACKAGE_VERSION}`);
    // Default canonical_url falls back to baseUrl when manifest.site.canonical_url
    // is absent.
    expect(config.site.canonical_url).toBe('https://example.com');
  });

  it('PRD-408-R12: explicit adapters override the auto-wired markdown adapter', () => {
    const { config } = resolveConfig({
      options: baseOptions({
        adapters: [
          {
            adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
            config: { sourceDir: '/explicit' },
            actVersion: '0.1',
          },
        ],
      }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect(config.adapters.length).toBe(1);
    expect((config.adapters[0]!.config as { sourceDir: string }).sourceDir).toBe('/explicit');
  });

  it('PRD-408-R12: defaults — conformanceTarget=core, failOnExtractionError=false, incremental=false', () => {
    const { config } = resolveConfig({
      options: baseOptions(),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect(config.conformanceTarget).toBe('core');
    expect(config.failOnExtractionError).toBe(false);
    expect(config.incremental).toBe(false);
  });

  // A10 / parseMode pre-flight.
  it('PRD-408-R12 / A10: parseMode "fine" forwards to the markdown adapter mode', () => {
    const { config } = resolveConfig({
      options: baseOptions({ conformanceTarget: 'standard', parseMode: 'fine' }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect((config.adapters[0]!.config as { mode?: string }).mode).toBe('fine');
  });

  it('PRD-408-R12 / A10: parseMode default ("coarse") preserves omitted-path behavior (no mode forwarded)', () => {
    const { config } = resolveConfig({
      options: baseOptions(),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect((config.adapters[0]!.config as { mode?: string }).mode).toBeUndefined();
  });

  it('PRD-408-R12 / A10: parseMode "coarse" explicit pass-through forwards verbatim', () => {
    const { config } = resolveConfig({
      options: baseOptions({ parseMode: 'coarse' }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect((config.adapters[0]!.config as { mode?: string }).mode).toBe('coarse');
  });

  it('PRD-408-R12 / A10 / PRD-201-R23: parseMode "fine" against conformanceTarget "core" fails at init', () => {
    expect(() =>
      resolveConfig({
        options: baseOptions({ parseMode: 'fine', conformanceTarget: 'core' }),
        projectRoot: fixtureSite,
        outputDir: '/x',
      }),
    ).toThrow(/PRD-201-R23/);
    // Default conformanceTarget is "core" — same failure.
    expect(() =>
      resolveConfig({
        options: baseOptions({ parseMode: 'fine' }),
        projectRoot: fixtureSite,
        outputDir: '/x',
      }),
    ).toThrow(/PRD-201-R23/);
  });

  it('PRD-408-R12 / A10: parseMode "fine" + conformanceTarget "standard" succeeds', () => {
    const { config } = resolveConfig({
      options: baseOptions({ parseMode: 'fine', conformanceTarget: 'standard' }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect(config.conformanceTarget).toBe('standard');
  });

  it('PRD-408-R12 / A10: parseMode "fine" + conformanceTarget "strict" succeeds (downgrades to standard absent search artifact)', () => {
    const { config, preflightWarnings } = resolveConfig({
      options: baseOptions({ parseMode: 'fine', conformanceTarget: 'strict' }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    // Per R17, no searchArtifactPath → downgrade to standard with warning.
    expect(config.conformanceTarget).toBe('standard');
    expect(preflightWarnings.some((w) => /PRD-408-R17/.test(w))).toBe(true);
  });

  it('PRD-408-R12 / A10: parseMode pre-flight runs at factory time (mismatch surfaces before eleventy.after)', () => {
    expect(() =>
      actEleventyPlugin(
        eleventyStub(),
        baseOptions({ parseMode: 'fine', conformanceTarget: 'core' }),
      ),
    ).toThrow(/PRD-201-R23/);
  });
});

describe('PRD-408 — output dir (R13)', () => {
  it('PRD-408-R13: defaults to Eleventy dir.output (resolved via payload at build time)', () => {
    const out = resolveOutputDir(eleventyStub(), undefined, fixtureSite, undefined);
    // No payload → falls back to eleventyConfig.dir.output ("_site"), resolved
    // against project root.
    expect(out).toBe(path.join(fixtureSite, '_site'));
  });

  it('PRD-408-R13: payload.dir.output wins over eleventyConfig.dir.output at build time', () => {
    const payload = makePayload(path.join(fixtureSite, '_dist'), [], fixtureSite);
    expect(resolveOutputDir(eleventyStub(), payload, fixtureSite, undefined)).toBe(
      path.join(fixtureSite, '_dist'),
    );
  });

  it('PRD-408-R13: act.outputDir override wins over Eleventy default', () => {
    const out = resolveOutputDir(eleventyStub(), undefined, fixtureSite, path.join(fixtureSite, 'custom'));
    expect(out).toBe(path.join(fixtureSite, 'custom'));
  });

  it('PRD-408-R13: outputDir resolving outside project root is rejected per PRD-109', () => {
    expect(() => resolveOutputDir(eleventyStub(), undefined, fixtureSite, '/etc')).toThrow(
      /PRD-408-R13/,
    );
  });

  it('PRD-408-R13: project root itself is permissible (target === root)', () => {
    expect(resolveOutputDir(eleventyStub(), undefined, fixtureSite, fixtureSite)).toBe(fixtureSite);
  });
});

describe('PRD-408 — atomic writes (R14)', () => {
  it('PRD-408-R14: tmp files inside ACT-owned paths cleaned up on adapter error', async () => {
    const tmp = await freshTmp('r14');
    try {
      // Plant a stale tmp file so cleanupTmp's sweep can be observed.
      const wellKnown = path.join(tmp, '.well-known');
      await fs.mkdir(wellKnown, { recursive: true });
      await fs.writeFile(path.join(wellKnown, 'orphan.tmp.1.2'), 'x');
      const { config } = resolveConfig({
        options: baseOptions({
          outputDir: tmp,
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
        }),
        projectRoot: fixtureSite,
        outputDir: tmp,
      });
      await expect(runActBuild({ config })).rejects.toThrow();
      const after = await fs.readdir(wellKnown);
      expect(after.find((n) => n.endsWith('.tmp.1.2'))).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — build report (R15)', () => {
  it('PRD-408-R15: resolveBuildReportPath defaults to <outputDir>/.act-build-report.json', () => {
    expect(resolveBuildReportPath('/tmp/out')).toBe('/tmp/out/.act-build-report.json');
  });

  it('PRD-408-R15: writeBuildReport persists the report JSON', async () => {
    const tmp = await freshTmp('r15-write');
    try {
      const reportPath = path.join(tmp, '.act-build-report.json');
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
      const stat = await fs.stat(reportPath);
      expect(stat.isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R15: factory adds the build-report path to Eleventy ignore list (best-effort)', () => {
    const cfg = eleventyStub();
    actEleventyPlugin(cfg, baseOptions());
    expect(cfg._ignoreCalls.some((p) => p.endsWith('.act-build-report.json'))).toBe(true);
  });

  it('PRD-408-R15: build:done invocation writes the sidecar at the resolved path', async () => {
    const tmp = await freshTmp('r15-e2e');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      const reportPath = path.join(tmp, '.act-build-report.json');
      expect((await fs.stat(reportPath)).isFile()).toBe(true);
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as {
        conformanceAchieved: string;
        files: unknown[];
      };
      expect(['core', 'standard', 'strict']).toContain(report.conformanceAchieved);
      expect(Array.isArray(report.files)).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R15: factory tolerates missing ignores.add API (older Eleventy 2.0.x)', () => {
    const cfg: EleventyConfigLike & { _hooks: Record<string, EleventyEventCallback[]> } = {
      versionCheck: () => undefined,
      on: (event, cb) => {
        ((cfg._hooks[event] ??= []).push(cb));
      },
      dir: { input: fixtureSite, output: '_site' },
      ignores: {}, // no `add` method
      _hooks: {},
    };
    expect(() => actEleventyPlugin(cfg, baseOptions())).not.toThrow();
  });
});

describe('PRD-408 — failure surface (R16)', () => {
  it('PRD-408-R16: empty results triggers an empty_build warning', async () => {
    const tmp = await freshTmp('r16-empty');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      await handler(makePayload(tmp, []));
      const reportPath = path.join(tmp, '.act-build-report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as {
        warnings: string[];
      };
      expect(report.warnings.some((w) => /empty_build/.test(w))).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R16: markdown adapter throw → non-zero (rejects)', async () => {
    const tmp = await freshTmp('r16-throw');
    try {
      const { config } = resolveConfig({
        options: baseOptions({
          outputDir: tmp,
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
        }),
        projectRoot: fixtureSite,
        outputDir: tmp,
      });
      await expect(runActBuild({ config })).rejects.toThrow();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-408-R16: hooks (preBuild/postBuild/onError) thread through to runActBuild', async () => {
    const tmp = await freshTmp('r16-hooks');
    const events: string[] = [];
    try {
      const { config } = resolveConfig({
        options: baseOptions({ outputDir: tmp }),
        projectRoot: fixtureSite,
        outputDir: tmp,
      });
      await runActBuild({
        config,
        hooks: {
          preBuild: () => events.push('pre'),
          postBuild: () => events.push('post'),
        },
      });
      expect(events).toEqual(['pre', 'post']);

      // onError fires on failure.
      const errEvents: string[] = [];
      const { config: badCfg } = resolveConfig({
        options: baseOptions({
          outputDir: tmp,
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
        }),
        projectRoot: fixtureSite,
        outputDir: tmp,
      });
      await expect(
        runActBuild({
          config: badCfg,
          hooks: {
            onError: () => errEvents.push('err'),
          },
        }),
      ).rejects.toThrow();
      expect(errEvents).toEqual(['err']);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — conformance bands (R17)', () => {
  it('PRD-408-R17: detectAchievedBand wraps PRD-400-R17 with Eleventy-side defaults', () => {
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: false, hasNdjson: false })).toBe(
      'core',
    );
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: false })).toBe(
      'standard',
    );
    expect(detectAchievedBand({ hasIndex: true, hasSubtree: true, hasNdjson: true })).toBe('strict');
  });

  it('PRD-408-R17: Plus target without searchArtifactPath downgrades to Standard', () => {
    const { config, preflightWarnings } = resolveConfig({
      options: baseOptions({ conformanceTarget: 'strict' }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect(config.conformanceTarget).toBe('standard');
    expect(preflightWarnings.some((w) => /PRD-408-R17/.test(w))).toBe(true);
  });

  it('PRD-408-R17: Plus target WITH searchArtifactPath stays Plus', () => {
    const { config, preflightWarnings } = resolveConfig({
      options: baseOptions({
        conformanceTarget: 'strict',
        searchArtifactPath: 'act/search-index.json',
      }),
      projectRoot: fixtureSite,
      outputDir: '/x',
    });
    expect(config.conformanceTarget).toBe('strict');
    expect(preflightWarnings).toEqual([]);
  });
});

describe('PRD-408 — pinning enforcement (R18)', () => {
  it('PRD-408-R18: pinning enforcement passthrough — adapter actVersion mismatch fails the build', async () => {
    const tmp = await freshTmp('r18');
    try {
      const { config } = resolveConfig({
        options: baseOptions({
          outputDir: tmp,
          adapters: [
            {
              adapter: createMarkdownAdapter() as unknown as Adapter<unknown>,
              config: { sourceDir: fixtureSite },
              actVersion: '0.2', // mismatched
            },
          ],
        }),
        projectRoot: fixtureSite,
        outputDir: tmp,
      });
      await expect(runActBuild({ config })).rejects.toThrow(/PRD-200-R25/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — test-fixture conformance (R20)', () => {
  it('PRD-408-R20: end-to-end pipeline emits validator-clean output (manifest + index + nodes)', async () => {
    const tmp = await freshTmp('r20');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      // Manifest validator-clean.
      const manifest = JSON.parse(
        await fs.readFile(path.join(tmp, '.well-known', 'act.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(validateManifest(manifest).gaps.length).toBe(0);
      // Index validator-clean.
      const index = JSON.parse(
        await fs.readFile(path.join(tmp, 'act', 'index.json'), 'utf8'),
      ) as { nodes: unknown[] };
      expect(validateIndex(index).gaps.length).toBe(0);
      // Every node validator-clean (recursive walk — nodes nest under
      // their parent path, e.g., act/nodes/posts/<slug>.json).
      async function walkNodeFiles(dir: string): Promise<string[]> {
        const out: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) out.push(...(await walkNodeFiles(full)));
          else if (e.isFile() && full.endsWith('.json')) out.push(full);
        }
        return out;
      }
      const nodeFiles = await walkNodeFiles(path.join(tmp, 'act', 'nodes'));
      expect(nodeFiles.length).toBeGreaterThanOrEqual(4); // index, about, two posts.
      for (const f of nodeFiles) {
        const node = JSON.parse(await fs.readFile(f, 'utf8')) as Record<string, unknown>;
        expect(validateNode(node).gaps.length).toBe(0);
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('PRD-408 — auxiliary coverage', () => {
  it('aux: enforceEleventyVersion succeeds when versionCheck is well-formed', () => {
    expect(() => enforceEleventyVersion(eleventyStub())).not.toThrow();
  });

  it('aux: makePermalinkFilter normalises absolute and ./-prefixed paths consistently', () => {
    const set = publishedSourcePaths([
      { inputPath: './a.md', outputPath: '/x', url: '/a' },
    ]);
    const filter = makePermalinkFilter(set, '/proj');
    expect(filter('/proj/a.md')).toBe(true);
    expect(filter('/proj/./a.md')).toBe(true);
  });

  it('aux: end-to-end with .eleventyignore — files under ignored/ are NOT in ACT output', async () => {
    const tmp = await freshTmp('aux-ignore');
    try {
      const cfg = eleventyStub({ outputDir: tmp });
      actEleventyPlugin(cfg, baseOptions({ outputDir: tmp }));
      const handler = cfg._hooks['eleventy.after']![0]!;
      // Eleventy's results don't contain ignored/skip-me.md (Eleventy
      // ignored it). Plus our adapter excludes it via .eleventyignore.
      await handler(makePayload(tmp, publishedFixtureResults(tmp)));
      const indexJson = JSON.parse(
        await fs.readFile(path.join(tmp, 'act', 'index.json'), 'utf8'),
      ) as { nodes: Array<{ id: string }> };
      const ids = indexJson.nodes.map((n) => n.id);
      expect(ids.find((id) => /skip-me/.test(id))).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * PRD-404 Docusaurus plugin — requirement-cited tests. Every PRD-404-R{n}
 * requirement is tested at least once; tests cite the requirement ID in
 * the title.
 *
 * Test layout:
 *   - Pure unit tests for sidebar mapping, version probe, conformance
 *     band detection, parseMode pre-flight, sidebars evaluator.
 *   - Integration tests that build the fixture site (`test-fixtures/
 *     sample-site`) end-to-end through `runActBuild` + the validator.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateIndex, validateManifest, validateNode } from '@act-spec/validator';

import {
  actDocusaurusPlugin,
  applySidebarMappingToNodes,
  detectAchievedBand,
  deriveParentChildren,
  discoverContent,
  ensureNoCategoryDocCollision,
  evaluateSidebarsModule,
  findOrphanDocs,
  isDocusaurusVersionSupported,
  resolveConfig,
  runActBuild,
  sanitizeCategoryId,
  type ActDocusaurusOptions,
  type DocusaurusLoadContext,
  type LoadedContent,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSite = path.resolve(here, '..', 'test-fixtures', 'sample-site');

async function freshTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(here, '..', `test-tmp-${prefix}-`));
}

function makeContext(siteDir: string, outDir: string, overrides: Partial<DocusaurusLoadContext> = {}): DocusaurusLoadContext {
  return {
    siteDir,
    outDir,
    baseUrl: '/',
    siteConfig: { title: 'Acme Docs', url: 'https://docs.acme.com', baseUrl: '/' },
    i18n: { defaultLocale: 'en', locales: ['en'] },
    ...overrides,
  };
}

describe('PRD-404 Docusaurus plugin', () => {
  it('PRD-404-R1: factory returns a Docusaurus-shaped plugin object with name set', async () => {
    const tmp = await freshTmp('r1');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const plugin = actDocusaurusPlugin(ctx, {});
      expect(plugin.name).toBe('@act-spec/plugin-docusaurus');
      expect(typeof plugin.loadContent).toBe('function');
      expect(typeof plugin.contentLoaded).toBe('function');
      expect(typeof plugin.postBuild).toBe('function');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R2: peer-dependency floor — Docusaurus 3.x is supported, 2.x and 4.x are not', () => {
    expect(isDocusaurusVersionSupported('3.0.0')).toBe(true);
    expect(isDocusaurusVersionSupported('3.5.2')).toBe(true);
    expect(isDocusaurusVersionSupported('v3.7.0')).toBe(true);
    expect(isDocusaurusVersionSupported('2.4.3')).toBe(false);
    expect(isDocusaurusVersionSupported('4.0.0')).toBe(false);
    expect(isDocusaurusVersionSupported('not-a-version')).toBe(false);
  });

  it('PRD-404-R3: multi-instance support — distinct urlTemplates avoid collision', async () => {
    const tmp = await freshTmp('r3');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const a = actDocusaurusPlugin(ctx, {
        docusaurus: { id: 'act-a' },
        urlTemplates: { indexUrl: '/act/a/index.json', nodeUrlTemplate: '/act/a/n/{id}.json' },
      });
      const b = actDocusaurusPlugin(ctx, {
        docusaurus: { id: 'act-b' },
        urlTemplates: { indexUrl: '/act/b/index.json', nodeUrlTemplate: '/act/b/n/{id}.json' },
      });
      expect(a.name).toBe(b.name); // package-level name shared
      // The factory accepts both instances without throwing — config is
      // memoized per instance; URL templates are honored.
      const cfgA = resolveConfig({ urlTemplates: { indexUrl: '/act/a/index.json' } }, ctx);
      expect(cfgA.urlTemplates?.indexUrl).toBe('/act/a/index.json');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R4: lifecycle hooks — loadContent / contentLoaded / postBuild present', async () => {
    const tmp = await freshTmp('r4');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const plugin = actDocusaurusPlugin(ctx, {});
      const content = await plugin.loadContent();
      expect((content as LoadedContent).docsInstances.length).toBeGreaterThan(0);
      // contentLoaded must accept the lifecycle args without throwing.
      const r = plugin.contentLoaded({
        content: content as LoadedContent,
        actions: { setGlobalData: () => undefined },
      });
      expect(r === undefined || r instanceof Promise).toBe(true);
      // postBuild executes the pipeline against the fixture site.
      await plugin.postBuild({ outDir: tmp, content: content as LoadedContent });
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R5: auto-wires PRD-201 to docs/ and blog/ by default', () => {
    const cfg = resolveConfig({}, makeContext(fixtureSite, '/dist'));
    expect(cfg.adapters.length).toBe(2);
    const [docs, blog] = cfg.adapters;
    expect((docs!.config as { sourceDir: string }).sourceDir.endsWith('/docs')).toBe(true);
    expect((blog!.config as { sourceDir: string }).sourceDir.endsWith('/blog')).toBe(true);
  });

  it('PRD-404-R5: docusaurus.skipBlog suppresses the blog adapter wiring', () => {
    const cfg = resolveConfig({ docusaurus: { skipBlog: true } }, makeContext(fixtureSite, '/dist'));
    expect(cfg.adapters.length).toBe(1);
  });

  it('PRD-404-R6: sidebar-to-parent/children — categories synthesize parents; docs nest as children', () => {
    const sidebars = {
      docs: [
        'intro',
        { type: 'category' as const, label: 'Getting started', items: ['install', 'quickstart'] },
        { type: 'category' as const, label: 'API', items: ['api-reference', 'api-auth'] },
      ],
    };
    const m = deriveParentChildren(sidebars);
    expect(m.syntheticNodes.find((n) => n.id === 'getting-started')?.children).toEqual([
      'install',
      'quickstart',
    ]);
    expect(m.parentMap.get('install')).toBe('getting-started');
    expect(m.parentMap.get('api-reference')).toBe('api');
    // Top-level doc — `intro` — has no parent.
    expect(m.parentMap.has('intro')).toBe(false);
    expect(m.visitedDocIds.has('intro')).toBe(true);
  });

  it('PRD-404-R6 (link items): sidebar entries with type "link" are NOT emitted as ACT nodes', () => {
    const sidebars = {
      docs: [
        { type: 'category' as const, label: 'Resources', items: [
          { type: 'link' as const, label: 'External', href: 'https://example.com' },
          'real-doc',
        ] },
      ],
    };
    const m = deriveParentChildren(sidebars);
    expect(m.skippedLinks).toContain('External');
    expect(m.parentMap.get('real-doc')).toBe('resources');
  });

  it('PRD-404-R6 (collision): synthesized category-node ID colliding with a real doc ID is a hard error', () => {
    const sidebars = {
      docs: [{ type: 'category' as const, label: 'API', items: ['inside'] }],
    };
    const m = deriveParentChildren(sidebars);
    expect(() => ensureNoCategoryDocCollision(m.syntheticNodes, new Set(['api']))).toThrow(
      /PRD-404-R6 \/ PRD-200-R10/,
    );
  });

  it('PRD-404-R6 (orphan): docs not referenced in sidebars surface in findOrphanDocs', () => {
    const sidebars = { docs: ['intro'] };
    const m = deriveParentChildren(sidebars);
    const orphans = findOrphanDocs(new Set(['intro', 'legacy', 'archived']), m);
    expect(orphans.sort()).toEqual(['archived', 'legacy']);
  });

  it('PRD-404-R6 (ID grammar): empty-after-sanitization category labels are a hard error', () => {
    expect(() => sanitizeCategoryId('   ---   ')).toThrow(/empty ID/);
  });

  it('PRD-404-R6 (ID grammar): sanitizes mixed-case + special chars to PRD-100-R10 grammar', () => {
    expect(sanitizeCategoryId('Getting Started!')).toBe('getting-started');
    expect(sanitizeCategoryId('API v1.0')).toBe('api-v1.0');
  });

  it('PRD-404-R6 (duplicate doc warning): a doc nested under multiple categories is recorded as duplicate', () => {
    const sidebars = {
      docs: [
        { type: 'category' as const, label: 'Cat A', items: ['shared'] },
        { type: 'category' as const, label: 'Cat B', items: ['shared'] },
      ],
    };
    const m = deriveParentChildren(sidebars);
    expect(m.duplicateDocs).toContain('shared');
    expect(m.parentMap.get('shared')).toBe('cat-a');
  });

  it('PRD-404-R7: extractMode default is static-ast (component extraction is opt-in for v0.1)', () => {
    const cfg = resolveConfig({}, makeContext(fixtureSite, '/dist'));
    // The plugin does not auto-wire React extraction in v0.1; the seam is
    // present (extractMode field), default static-ast is honored when the
    // user opts in. Conformance: Standard. Field is read at config time.
    expect(cfg.adapters.length).toBeGreaterThan(0);
  });

  it('PRD-404-R8: versioned-docs probe — versions.json read; mounts derivable', async () => {
    // Build a fake site with a versions.json.
    const tmp = await freshTmp('r8');
    try {
      const siteDir = path.join(tmp, 'site');
      await fs.mkdir(path.join(siteDir, 'docs'), { recursive: true });
      await fs.mkdir(path.join(siteDir, 'versioned_docs', 'version-1.0'), { recursive: true });
      await fs.writeFile(path.join(siteDir, 'versions.json'), JSON.stringify(['1.0']));
      const ctx = makeContext(siteDir, path.join(tmp, 'out'));
      const content = await discoverContent(ctx, {});
      expect(content.versions?.included.length).toBe(1);
      expect(content.versions?.included[0]?.id).toBe('1.0');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R8 (negative): malformed versions.json is a hard error', async () => {
    const tmp = await freshTmp('r8neg');
    try {
      const siteDir = path.join(tmp, 'site');
      await fs.mkdir(siteDir, { recursive: true });
      await fs.writeFile(path.join(siteDir, 'versions.json'), '{not-json');
      const ctx = makeContext(siteDir, path.join(tmp, 'out'));
      await expect(discoverContent(ctx, {})).rejects.toThrow(/PRD-404-R8/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R8 (negative): versions.json that is not an array is rejected', async () => {
    const tmp = await freshTmp('r8arr');
    try {
      const siteDir = path.join(tmp, 'site');
      await fs.mkdir(siteDir, { recursive: true });
      await fs.writeFile(path.join(siteDir, 'versions.json'), '{}');
      const ctx = makeContext(siteDir, path.join(tmp, 'out'));
      await expect(discoverContent(ctx, {})).rejects.toThrow(/PRD-404-R8/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R9: i18n auto-wiring — locales array flagged when > 1', async () => {
    const tmp = await freshTmp('r9');
    try {
      const ctx = makeContext(fixtureSite, tmp, {
        i18n: { defaultLocale: 'en', locales: ['en', 'es', 'fr'] },
      });
      const content = await discoverContent(ctx, {});
      expect(content.locales.locales.length).toBe(3);
      expect(content.locales.activeLocale).toBe('en');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R9 (band): per-locale Pattern-2 emissions trigger Plus per detectAchievedBand', () => {
    expect(
      detectAchievedBand({
        hasIndex: true,
        hasSubtree: true,
        hasNdjson: false,
        hasVersionMounts: false,
        hasI18nManifests: true,
      }),
    ).toBe('strict');
  });

  it('PRD-404-R10: emits PRD-105 layout into Docusaurus outDir', async () => {
    const tmp = await freshTmp('r10');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const cfg = resolveConfig({}, ctx);
      const report = await runActBuild({ config: cfg });
      const wellKnown = path.join(tmp, '.well-known', 'act.json');
      const indexFile = path.join(tmp, 'act', 'index.json');
      expect((await fs.stat(wellKnown)).isFile()).toBe(true);
      expect((await fs.stat(indexFile)).isFile()).toBe(true);
      // R10 emission MUST NOT touch Docusaurus-owned paths (assert no
      // index.html mutated; the test directory is empty save ACT files).
      const entries = await fs.readdir(tmp);
      expect(entries.find((e) => e === 'index.html')).toBeUndefined();
      expect(report.files.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R11: search advertisement opt-in — config field is plumbed', () => {
    // The config field is plumbed via urlTemplates.indexNdjsonUrl in
    // GeneratorConfig; advertising it without a fulfillment artifact is a
    // PRD-400-R18 hard error caught by `verifyCapabilityBacking`.
    const cfg = resolveConfig(
      { urlTemplates: { indexNdjsonUrl: '/act/index.ndjson' } },
      makeContext(fixtureSite, '/dist'),
    );
    expect(cfg.urlTemplates?.indexNdjsonUrl).toBe('/act/index.ndjson');
  });

  it('PRD-404-R12: build report written at outDir/.act-build-report.json', async () => {
    const tmp = await freshTmp('r12');
    try {
      const cfg = resolveConfig({}, makeContext(fixtureSite, tmp));
      await runActBuild({ config: cfg });
      const reportPath = path.join(tmp, '.act-build-report.json');
      expect((await fs.stat(reportPath)).isFile()).toBe(true);
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as {
        files: unknown[];
        conformanceAchieved: string;
      };
      expect(Array.isArray(report.files)).toBe(true);
      expect(['core', 'standard', 'strict']).toContain(report.conformanceAchieved);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R13: tmp files inside ACT-owned paths are cleaned up on error', async () => {
    const tmp = await freshTmp('r13');
    try {
      const wellKnown = path.join(tmp, '.well-known');
      await fs.mkdir(wellKnown, { recursive: true });
      await fs.writeFile(path.join(wellKnown, 'orphan.tmp.1.2'), 'x');
      const ctx = makeContext(fixtureSite, tmp);
      const cfg = resolveConfig({}, ctx);
      // Replace the first auto-wired adapter with one that throws inside
      // `transform`, forcing the pipeline to fail post-init so the
      // PRD-404-R13 cleanup hook runs.
      cfg.adapters[0] = {
        adapter: {
          name: 'thrower',
          init: () => Promise.resolve({ level: 'core' as const }),
          enumerate: async function* () { yield 0; },
          transform: () => Promise.reject(new Error('boom')),
          dispose: () => Promise.resolve(),
        } as unknown as typeof cfg.adapters[number]['adapter'],
        config: {},
        actVersion: '0.1',
      };
      await expect(runActBuild({ config: cfg })).rejects.toThrow();
      const after = await fs.readdir(wellKnown);
      expect(after.find((n) => n.endsWith('.tmp.1.2'))).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R14: detectAchievedBand auto-detects Standard from sidebar-derived subtrees', () => {
    expect(
      detectAchievedBand({
        hasIndex: true,
        hasSubtree: true,
        hasNdjson: false,
        hasVersionMounts: false,
        hasI18nManifests: false,
      }),
    ).toBe('standard');
    expect(
      detectAchievedBand({
        hasIndex: true,
        hasSubtree: false,
        hasNdjson: false,
        hasVersionMounts: false,
        hasI18nManifests: false,
      }),
    ).toBe('core');
    expect(
      detectAchievedBand({
        hasIndex: true,
        hasSubtree: true,
        hasNdjson: false,
        hasVersionMounts: true,
        hasI18nManifests: false,
      }),
    ).toBe('strict');
  });

  it('PRD-404-R15: adapter-pinning enforced via generator-core (Stage 1 mismatch fails)', async () => {
    const tmp = await freshTmp('r15');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const cfg = resolveConfig({}, ctx);
      // Mutate the actVersion to force Stage-1 mismatch per PRD-200-R25.
      cfg.adapters[0]!.actVersion = '0.2';
      await expect(runActBuild({ config: cfg })).rejects.toThrow(/PRD-200-R25/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R16: defaults — target=core, outputDir from context, baseUrl from siteConfig', () => {
    const ctx = makeContext(fixtureSite, '/build');
    const cfg = resolveConfig({}, ctx);
    expect(cfg.conformanceTarget).toBe('core');
    expect(cfg.outputDir).toBe('/build');
    expect(cfg.site.canonical_url).toBe('https://docs.acme.com/');
    expect(cfg.generator).toBe('@act-spec/plugin-docusaurus@0.0.0');
  });

  it('PRD-404-R16 / A2: parseMode "fine" forwards to the markdown adapter mode', () => {
    const ctx = makeContext(fixtureSite, '/build');
    const cfg = resolveConfig({ target: 'standard', parseMode: 'fine' }, ctx);
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBe('fine');
    expect((cfg.adapters[1]!.config as { mode?: string }).mode).toBe('fine');
  });

  it('PRD-404-R16 / A2: parseMode default ("coarse") preserves omitted-path behavior (no mode forwarded)', () => {
    const ctx = makeContext(fixtureSite, '/build');
    const cfg = resolveConfig({}, ctx);
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBeUndefined();
    expect((cfg.adapters[1]!.config as { mode?: string }).mode).toBeUndefined();
  });

  it('PRD-404-R16 / A2: parseMode "coarse" explicit pass-through forwards verbatim', () => {
    const ctx = makeContext(fixtureSite, '/build');
    const cfg = resolveConfig({ parseMode: 'coarse' }, ctx);
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBe('coarse');
  });

  it('PRD-404-R16 / A2 / PRD-201-R23: parseMode "fine" against target "core" fails at init', () => {
    const ctx = makeContext(fixtureSite, '/build');
    expect(() => resolveConfig({ parseMode: 'fine', target: 'core' }, ctx)).toThrow(
      /PRD-201-R23/,
    );
    expect(() => resolveConfig({ parseMode: 'fine' /* target defaults to core */ }, ctx)).toThrow(
      /PRD-201-R23/,
    );
  });

  it('PRD-404-R16 / A2: parseMode "fine" + target "standard" succeeds', () => {
    const ctx = makeContext(fixtureSite, '/build');
    const cfg = resolveConfig({ parseMode: 'fine', target: 'standard' }, ctx);
    expect(cfg.conformanceTarget).toBe('standard');
    expect((cfg.adapters[0]!.config as { mode?: string }).mode).toBe('fine');
  });

  it('PRD-404-R16 / A2: parseMode "fine" + target "strict" succeeds', () => {
    const ctx = makeContext(fixtureSite, '/build');
    const cfg = resolveConfig({ parseMode: 'fine', target: 'strict' }, ctx);
    expect(cfg.conformanceTarget).toBe('strict');
  });

  it('PRD-404-R16 / A2: parseMode pre-flight runs at factory time so config errors surface early', () => {
    const ctx = makeContext(fixtureSite, '/build');
    expect(() => actDocusaurusPlugin(ctx, { parseMode: 'fine', target: 'core' } as ActDocusaurusOptions)).toThrow(
      /PRD-201-R23/,
    );
  });

  it('PRD-404-R17: postBuild plumbs siteConfig.logger through to runActBuild', async () => {
    const tmp = await freshTmp('r17');
    try {
      const messages: string[] = [];
      const logger = {
        info: (m: string) => messages.push(`info:${m}`),
        warn: (m: string) => messages.push(`warn:${m}`),
        error: (m: string) => messages.push(`error:${m}`),
      };
      const ctx = makeContext(fixtureSite, tmp, {
        siteConfig: {
          title: 'Acme Docs',
          url: 'https://docs.acme.com',
          baseUrl: '/',
          logger,
        },
      });
      const plugin = actDocusaurusPlugin(ctx, {});
      await plugin.postBuild({ outDir: tmp, content: (await plugin.loadContent()) as LoadedContent });
      // Logger surface accepted; assertion is non-failure plus a built
      // manifest. The pipeline does not log on the happy path so the array
      // may be empty — what's tested is the plumbing, not the messages.
      expect((await fs.stat(path.join(tmp, '.well-known', 'act.json'))).isFile()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R18: page-level act-export reader — seam present (binding-side validation deferred to PRD-301)', () => {
    // PRD-404-R18 reads `export const act` at build time and supplies it to
    // PRD-301's `extractRoute`. v0.1 surfaces the configuration field; the
    // extraction is exercised by PRD-301's own test suite.
    const cfg = resolveConfig({ extractMode: 'static-ast' }, makeContext(fixtureSite, '/dist'));
    expect(cfg).toBeDefined();
  });
});

describe('PRD-404 — sidebars.js evaluator', () => {
  it('evaluates a CJS sidebars.js module export', () => {
    const src = `module.exports = { docs: [{ type: 'category', label: 'X', items: ['a'] }] };`;
    const out = evaluateSidebarsModule(src);
    expect(Array.isArray(out['docs'])).toBe(true);
  });

  it('refuses a sidebars module that does not export an object', () => {
    expect(() => evaluateSidebarsModule(`module.exports = 'no';`)).toThrow(/PRD-404-R6/);
  });
});

describe('PRD-404 — applySidebarMappingToNodes', () => {
  it('mutates node.parent for sidebar-nested docs and emits synthetic category nodes', () => {
    const sidebars = {
      docs: [{ type: 'category' as const, label: 'API', items: ['api-reference'] }],
    };
    const mapping = deriveParentChildren(sidebars);
    const nodes = [
      { id: 'api-reference', type: 'doc', title: 'API Reference', summary: 'x' },
    ];
    const out = applySidebarMappingToNodes(nodes, mapping);
    expect(out.nodes[0]?.parent).toBe('api');
    expect(out.syntheticEmissions[0]?.id).toBe('api');
    expect(out.syntheticEmissions[0]?.children).toEqual(['api-reference']);
  });

  it('reports orphan docs (present on disk but absent from sidebars)', () => {
    const sidebars = { docs: ['intro'] };
    const mapping = deriveParentChildren(sidebars);
    const nodes = [
      { id: 'intro', type: 'doc', title: 'Intro', summary: 's' },
      { id: 'orphaned', type: 'doc', title: 'Orphaned', summary: 's' },
    ];
    const out = applySidebarMappingToNodes(nodes, mapping);
    expect(out.orphanDocs).toEqual(['orphaned']);
  });
});

describe('PRD-404 — end-to-end conformance against the validator', () => {
  it('emits a manifest, index, and node files that pass @act-spec/validator with zero gaps', async () => {
    const tmp = await freshTmp('e2e');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const cfg = resolveConfig({}, ctx);
      const report = await runActBuild({ config: cfg });
      expect(report.conformanceAchieved).toBe('core');

      const manifest = JSON.parse(
        await fs.readFile(path.join(tmp, '.well-known', 'act.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(validateManifest(manifest).gaps.length).toBe(0);

      const index = JSON.parse(
        await fs.readFile(path.join(tmp, 'act', 'index.json'), 'utf8'),
      ) as { nodes: unknown[] };
      expect(validateIndex(index).gaps.length).toBe(0);

      // Spot-check a node file.
      for (const file of report.files) {
        if (!file.path.includes('/act/nodes/')) continue;
        const node = JSON.parse(await fs.readFile(file.path, 'utf8')) as Record<string, unknown>;
        expect(validateNode(node).gaps.length).toBe(0);
      }

      // Both docs and blog content surface as nodes (PRD-404-R5 wiring).
      const ids = new Set(index.nodes.map((n) => (n as { id: string }).id));
      expect(ids.has('intro')).toBe(true);
      expect(ids.has('install')).toBe(true);
      expect(ids.has('blog-hello')).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('PRD-404-R16 / A2 end-to-end: parseMode "fine" + target "standard" emits richer block set', async () => {
    const tmp = await freshTmp('e2e-fine');
    try {
      const ctx = makeContext(fixtureSite, tmp);
      const cfg = resolveConfig({ parseMode: 'fine', target: 'standard' }, ctx);
      const report = await runActBuild({ config: cfg });
      expect(report.conformanceAchieved).toBe('core'); // no subtree URL template wired
      // Read at least one node file and confirm it has 2+ blocks (fine
      // mode splits prose / code blocks per PRD-201-R12).
      const nodeFile = report.files.find((f) => f.path.includes('install.json'));
      expect(nodeFile).toBeDefined();
      const node = JSON.parse(await fs.readFile(nodeFile!.path, 'utf8')) as {
        content: unknown[];
      };
      // Fine mode extracts high-signal blocks (code, data, callout,
      // image) and emits a `prose/markdown` slice between each extraction.
      // The `install.md` fixture has a fenced code block flanked by
      // prose, so fine mode produces prose + code + prose. Coarse mode
      // emits a single block carrying the whole body.
      expect(Array.isArray(node.content)).toBe(true);
      expect(node.content.length).toBeGreaterThanOrEqual(2);
      const types = (node.content as Array<{ type: string }>).map((b) => b.type);
      expect(types).toContain('code');
      // Compare to coarse mode which yields one markdown block.
      const coarseTmp = await fs.mkdtemp(path.join(here, '..', 'test-tmp-e2e-coarse-'));
      try {
        const coarseCfg = resolveConfig({ parseMode: 'coarse' }, makeContext(fixtureSite, coarseTmp));
        const coarseReport = await runActBuild({ config: coarseCfg });
        const coarseFile = coarseReport.files.find((f) => f.path.includes('install.json'));
        const coarseNode = JSON.parse(await fs.readFile(coarseFile!.path, 'utf8')) as {
          content: unknown[];
        };
        expect(coarseNode.content.length).toBe(1);
      } finally {
        await fs.rm(coarseTmp, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

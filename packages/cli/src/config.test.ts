import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GeneratorConfig } from '@act-spec/generator-core';

import {
  CONFIG_SEARCH_ORDER,
  applyProfileOverride,
  defineConfig,
  detectHostFrameworkFields,
  findConfigPath,
  loadConfig,
  probeTsLoader,
} from './config.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-config-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function minimalConfig(extra: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    conformanceTarget: 'core',
    outputDir: 'dist',
    adapters: [],
    site: { name: 't' },
    ...extra,
  } as GeneratorConfig;
}

describe('PRD-409-R5 CONFIG_SEARCH_ORDER', () => {
  it('PRD-409-R5: search order is .ts, .mts, .mjs, .cjs, .js, .json', () => {
    expect(CONFIG_SEARCH_ORDER).toEqual([
      'act.config.ts',
      'act.config.mts',
      'act.config.mjs',
      'act.config.cjs',
      'act.config.js',
      'act.config.json',
    ]);
  });
});

describe('PRD-409-R5 findConfigPath', () => {
  it('PRD-409-R5: returns the first file found in declared order', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tmp, 'act.config.js'), 'export default {};', 'utf8');
    const found = findConfigPath(tmp);
    expect(found).toBe(path.join(tmp, 'act.config.js'));
  });

  it('PRD-409-R5: returns null when no config file exists', () => {
    expect(findConfigPath(tmp)).toBeNull();
  });

  it('PRD-409-R5: explicit absolute path overrides search', async () => {
    const explicit = path.join(tmp, 'custom.config.json');
    await fs.writeFile(explicit, '{}', 'utf8');
    expect(findConfigPath(tmp, explicit)).toBe(explicit);
  });

  it('PRD-409-R5: explicit relative path is resolved against cwd', async () => {
    await fs.writeFile(path.join(tmp, 'rel.config.json'), '{}', 'utf8');
    expect(findConfigPath(tmp, 'rel.config.json')).toBe(path.join(tmp, 'rel.config.json'));
  });

  it('PRD-409-R5: explicit path that does not exist returns null', () => {
    expect(findConfigPath(tmp, 'missing.config.js')).toBeNull();
  });
});

describe('PRD-409-R3 detectHostFrameworkFields', () => {
  it('PRD-409-R3: detects a `next` field at top level', () => {
    const r = detectHostFrameworkFields({ next: { foo: 1 } });
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ field: 'next', prd: 'PRD-405' });
  });

  it('PRD-409-R3: detects multiple host-framework fields and cites their PRDs', () => {
    const r = detectHostFrameworkFields({ astro: {}, nuxt: {}, eleventy: {} });
    const prds = new Set(r.map((x) => x.prd));
    expect(prds).toEqual(new Set(['PRD-401', 'PRD-407', 'PRD-408']));
  });

  it('PRD-409-R3: emits nothing on a clean GeneratorConfig', () => {
    const r = detectHostFrameworkFields(minimalConfig() as unknown as Record<string, unknown>);
    expect(r).toEqual([]);
  });
});

describe('PRD-409-R17 applyProfileOverride', () => {
  it('PRD-409-R17: overrides config.conformanceTarget when profile supplied', () => {
    const cfg = minimalConfig({ conformanceTarget: 'core' });
    const r = applyProfileOverride(cfg, 'standard');
    expect(cfg.conformanceTarget).toBe('standard');
    expect(r).toEqual({ conflicted: true, previous: 'core' });
  });

  it('PRD-409-R17: noop when profile is undefined', () => {
    const cfg = minimalConfig({ conformanceTarget: 'core' });
    const r = applyProfileOverride(cfg, undefined);
    expect(cfg.conformanceTarget).toBe('core');
    expect(r.conflicted).toBe(false);
  });

  it('PRD-409-R17: signals no conflict when profile === existing target', () => {
    const cfg = minimalConfig({ conformanceTarget: 'standard' });
    const r = applyProfileOverride(cfg, 'standard');
    expect(r.conflicted).toBe(false);
  });
});

describe('PRD-409 defineConfig', () => {
  it('PRD-409: defineConfig is identity (preserves the input reference)', () => {
    const cfg = minimalConfig();
    expect(defineConfig(cfg)).toBe(cfg);
  });
});

describe('PRD-409-R5 loadConfig', () => {
  it('PRD-409-R5: throws with cited error when no config exists', async () => {
    await expect(loadConfig(tmp)).rejects.toThrow(/PRD-409-R5/);
  });

  it('PRD-409-R5: loads .json configs', async () => {
    const cfg = minimalConfig();
    await fs.writeFile(path.join(tmp, 'act.config.json'), JSON.stringify(cfg), 'utf8');
    const loaded = await loadConfig(tmp);
    expect(loaded.config.outputDir).toBe('dist');
    expect(loaded.configPath).toBe(path.join(tmp, 'act.config.json'));
  });

  it('PRD-409-R5: loads .mjs configs via dynamic import', async () => {
    const cfgBody = `export default ${JSON.stringify(minimalConfig({ outputDir: 'mjs-out' }))};`;
    await fs.writeFile(path.join(tmp, 'act.config.mjs'), cfgBody, 'utf8');
    const loaded = await loadConfig(tmp);
    expect(loaded.config.outputDir).toBe('mjs-out');
  });

  it('PRD-409-R5: invokes a function default-export and uses its return value', async () => {
    const cfgBody = `export default async () => (${JSON.stringify(minimalConfig({ outputDir: 'fn-out' }))});`;
    await fs.writeFile(path.join(tmp, 'act.config.mjs'), cfgBody, 'utf8');
    const loaded = await loadConfig(tmp);
    expect(loaded.config.outputDir).toBe('fn-out');
  });

  it('PRD-409-R5: explicit --config path takes precedence over CWD search', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.json'), JSON.stringify(minimalConfig({ outputDir: 'cwd-default' })), 'utf8');
    const explicit = path.join(tmp, 'sidecar.config.json');
    await fs.writeFile(explicit, JSON.stringify(minimalConfig({ outputDir: 'sidecar-out' })), 'utf8');
    const loaded = await loadConfig(tmp, explicit);
    expect(loaded.config.outputDir).toBe('sidecar-out');
  });
});

describe('PRD-409-R5 probeTsLoader', () => {
  it('PRD-409-R5: resolves a TypeScript loader (tsx is in devDependencies)', async () => {
    const probed = await probeTsLoader();
    // tsx is installed in this monorepo's devDependencies → probe must succeed.
    expect(probed).not.toBeNull();
    expect(['tsx', 'jiti', 'bun', 'node-strip-types']).toContain(probed!.loader);
  });
});

describe('PRD-409-R5 loadConfig — TypeScript', () => {
  it('PRD-409-R5: loads an act.config.ts via the TS loader probe', async () => {
    // Use a minimal TS source that exercises type-import + default export.
    const cfgBody = `
import type { GeneratorConfig } from '@act-spec/generator-core';
const cfg: GeneratorConfig = {
  conformanceTarget: 'core',
  outputDir: 'ts-out',
  adapters: [],
  site: { name: 'TS' },
};
export default cfg;
`;
    await fs.writeFile(path.join(tmp, 'act.config.ts'), cfgBody, 'utf8');
    const loaded = await loadConfig(tmp);
    expect(loaded.config.outputDir).toBe('ts-out');
    expect(loaded.configPath).toBe(path.join(tmp, 'act.config.ts'));
  });
});

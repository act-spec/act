/**
 * PRD-409-R3 / R5 / R17 — config-file resolution + host-framework field
 * detection + `--profile` shorthand.
 *
 * Supported config-file extensions, in CWD-search order (PRD-409-R5):
 *   1. `act.config.ts`
 *   2. `act.config.mts`
 *   3. `act.config.mjs`
 *   4. `act.config.cjs`
 *   5. `act.config.js`
 *   6. `act.config.json`
 *
 * `--config <path>` overrides. TypeScript configs (`*.ts`, `*.mts`) are
 * loaded via a runtime-detected loader (`tsx` → `jiti` → Node strip-types
 * → Bun). When no loader resolves, the CLI emits an actionable error.
 *
 * The resolved config's default export must satisfy
 * `GeneratorConfig` from `@act-spec/generator-core` (PRD-400-R31). A
 * function default-export is invoked (sync or async) and its return value
 * is used as the config.
 */
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { GeneratorConfig } from '@act-spec/generator-core';

/** PRD-409-R5 — search order at the resolved CWD. */
export const CONFIG_SEARCH_ORDER: readonly string[] = [
  'act.config.ts',
  'act.config.mts',
  'act.config.mjs',
  'act.config.cjs',
  'act.config.js',
  'act.config.json',
] as const;

/**
 * PRD-409-R3 — top-level field names that signal "this config belongs to
 * a host-framework plugin, not the CLI." When any of these appears at the
 * top level of the resolved config, the CLI MUST refuse.
 */
export const HOST_FRAMEWORK_FIELD_TO_PRD: Readonly<Record<string, string>> = {
  next: 'PRD-405',
  nextjs: 'PRD-405',
  astro: 'PRD-401',
  nuxt: 'PRD-407',
  remix: 'PRD-406',
  docusaurus: 'PRD-404',
  eleventy: 'PRD-408',
};

/**
 * PRD-409-R17 — the operator's `--profile` shorthand for `conformanceTarget`.
 */
export type ProfileShorthand = 'core' | 'standard' | 'strict';

/**
 * PRD-409 / PRD-400-R31 — `defineConfig` is identity; it only narrows
 * types in the operator's `act.config.ts`.
 */
export function defineConfig(config: GeneratorConfig): GeneratorConfig {
  return config;
}

/** PRD-409-R5 — locate the config file at `cwd`, honoring the explicit override. */
export function findConfigPath(cwd: string, explicit?: string): string | null {
  if (typeof explicit === 'string' && explicit.length > 0) {
    const abs = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    return existsSync(abs) ? abs : null;
  }
  for (const name of CONFIG_SEARCH_ORDER) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * PRD-409-R3 — surface every host-framework-keyed top-level field in the
 * resolved config. The CLI then emits a build error citing the matching
 * PRD ID.
 */
export function detectHostFrameworkFields(
  config: Record<string, unknown>,
): Array<{ field: string; prd: string }> {
  const out: Array<{ field: string; prd: string }> = [];
  for (const [field, prd] of Object.entries(HOST_FRAMEWORK_FIELD_TO_PRD)) {
    if (Object.prototype.hasOwnProperty.call(config, field)) {
      out.push({ field, prd });
    }
  }
  return out;
}

/** PRD-409-R17 — apply `--profile` over the loaded config. Returns whether the override conflicted with the config's `conformanceTarget`. */
export function applyProfileOverride(
  config: GeneratorConfig,
  profile: ProfileShorthand | undefined,
): { conflicted: boolean; previous: GeneratorConfig['conformanceTarget'] } {
  if (profile === undefined) return { conflicted: false, previous: config.conformanceTarget };
  const previous = config.conformanceTarget;
  const conflicted = previous !== profile;
  config.conformanceTarget = profile;
  return { conflicted, previous };
}

/** PRD-409-R5 — TypeScript loader probe. Returns whether the loader resolved. */
export async function probeTsLoader(): Promise<{ loader: string } | null> {
  // Try tsx first — recommended in the PRD.
  // Both probes use `import(<dynamic>)` so the bundler/TS does not require the
  // packages to be present at build time; they're resolved at runtime against
  // the operator's `node_modules`.
  const dynImport = (id: string): Promise<unknown> => import(/* @vite-ignore */ id);
  try {
    await dynImport('tsx/esm/api');
    return { loader: 'tsx' };
  } catch {
    /* fall through */
  }
  try {
    await dynImport('jiti');
    return { loader: 'jiti' };
  } catch {
    /* fall through */
  }
  // Bun exposes its native TS loader via `Bun` global; we don't import here.
  if (typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined') {
    return { loader: 'bun' };
  }
  // Node 22+ has --experimental-strip-types; we only know whether it was
  // enabled at process start, which isn't easily introspectable. The
  // safer signal is `process.features?.typescript` (Node 22.6+).
  const feat = (process as unknown as { features?: Record<string, unknown> }).features;
  if (feat !== undefined && feat['typescript'] === true) {
    return { loader: 'node-strip-types' };
  }
  return null;
}

/**
 * PRD-409-R5 — resolve and load the config file, evaluating its default export.
 * Returns the loaded `GeneratorConfig` along with the absolute path it came from.
 */
export interface LoadedConfig {
  config: GeneratorConfig;
  configPath: string;
}

export async function loadConfig(cwd: string, explicit?: string): Promise<LoadedConfig> {
  const configPath = findConfigPath(cwd, explicit);
  if (configPath === null) {
    throw new Error(
      `PRD-409-R5: no config file found at ${cwd}. Searched: ${[
        ...(explicit !== undefined ? [explicit] : []),
        ...CONFIG_SEARCH_ORDER,
      ].join(', ')}.`,
    );
  }

  if (configPath.endsWith('.json')) {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as GeneratorConfig;
    return { config: parsed, configPath };
  }

  if (/\.(mts|ts)$/.test(configPath)) {
    const probed = await probeTsLoader();
    if (probed === null) {
      throw new Error(
        `PRD-409-R5: config "${configPath}" is TypeScript but no loader resolved. ` +
          `Install one of: tsx (\`npm install -D tsx\`), jiti, or run on Node 22.6+ with --experimental-strip-types.`,
      );
    }
    const dynImport = (id: string): Promise<unknown> =>
      import(/* @vite-ignore */ id);
    if (probed.loader === 'tsx') {
      // Register tsx so the dynamic import below resolves with TS support.
      // The tsx API exposes `register()` (Node loader hook) — wrap defensively
      // because the v4 API surface has shifted across minor versions.
      try {
        const tsxApi = (await dynImport('tsx/esm/api')) as {
          register?: (...args: unknown[]) => { unregister: () => void } | undefined;
        };
        if (typeof tsxApi.register === 'function') {
          const reg = tsxApi.register();
          try {
            return await importDefaultConfig(configPath);
          } finally {
            reg?.unregister();
          }
        }
      } catch {
        /* fall through to plain import; tsx may already be active */
      }
    }
    if (probed.loader === 'jiti') {
      const jitiMod = (await dynImport('jiti')) as {
        default?: (from: string, opts?: Record<string, unknown>) => (id: string) => unknown;
      };
      const create = jitiMod.default;
      if (typeof create === 'function') {
        const jiti = create(cwd, { interopDefault: true, esmResolve: true });
        const mod = jiti(configPath) as
          | { default?: GeneratorConfig | (() => GeneratorConfig | Promise<GeneratorConfig>) }
          | GeneratorConfig;
        const cfg = await resolveDefaultExport(mod);
        return { config: cfg, configPath };
      }
    }
    // Bun / node-strip-types: rely on plain dynamic import.
    return importDefaultConfig(configPath);
  }

  return importDefaultConfig(configPath);
}

async function importDefaultConfig(configPath: string): Promise<LoadedConfig> {
  const url = pathToFileURL(configPath).href;
  const mod = (await import(url)) as { default?: unknown };
  const cfg = await resolveDefaultExport(mod);
  return { config: cfg, configPath };
}

async function resolveDefaultExport(
  mod: unknown,
): Promise<GeneratorConfig> {
  const candidate =
    typeof mod === 'object' && mod !== null && 'default' in (mod as Record<string, unknown>)
      ? (mod as Record<string, unknown>)['default']
      : mod;
  if (typeof candidate === 'function') {
    const out = await (candidate as () => Promise<unknown>)();
    return out as GeneratorConfig;
  }
  return candidate as GeneratorConfig;
}

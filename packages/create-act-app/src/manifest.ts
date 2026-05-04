/**
 * Locate and read the bundled `templates/manifest.json` snapshot. The
 * manifest is generated at build time by `scripts/build-templates.mjs` from
 * the monorepo's `examples/` tree. It must be present in the published
 * tarball — bin invocations rely on it to enumerate available templates.
 */
import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import type { TemplateManifest, TemplateManifestEntry } from './types.js';

/**
 * Resolve the templates root directory shipped alongside this package.
 *
 * Layout when published:
 *
 *     create-act-app/
 *       dist/manifest.js     <-- this file at runtime
 *       templates/
 *         manifest.json
 *         <name>/...
 */
export function resolveTemplatesDir(): string {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  // dist/ -> package root -> templates/
  return path.resolve(here, '..', 'templates');
}

export async function loadManifest(templatesDir = resolveTemplatesDir()): Promise<TemplateManifest> {
  const manifestPath = path.join(templatesDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `create-act-app: templates/manifest.json missing at ${manifestPath}. ` +
        `Did the package build step (scripts/build-templates.mjs) run?`,
    );
  }
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { templates?: unknown }).templates)
  ) {
    throw new Error(`create-act-app: malformed manifest at ${manifestPath}`);
  }
  const templates = ((parsed as { templates: unknown[] }).templates).map((t) => {
    const e = t as Partial<TemplateManifestEntry>;
    if (typeof e.name !== 'string') {
      throw new Error(`create-act-app: manifest entry missing 'name'`);
    }
    return { name: e.name, description: typeof e.description === 'string' ? e.description : '' };
  });
  return { templates };
}

export function findTemplate(
  manifest: TemplateManifest,
  name: string,
): TemplateManifestEntry | undefined {
  return manifest.templates.find((t) => t.name === name);
}

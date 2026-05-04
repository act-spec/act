/**
 * PRD-409-R8 / PRD-409-R16 — `actree init` scaffolding.
 *
 * Refuses to scaffold into a directory containing any of the template's
 * target files (or a pre-existing `act.config.*`) unless `--force` is set.
 *
 * Templates are pure data; see `./templates.ts`. The scaffolder is the only
 * code that touches the filesystem.
 */
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  CONFIG_SEARCH_ORDER,
} from './config.js';
import {
  getTemplateFiles,
  isInitTemplate,
  type InitTemplate,
} from './templates.js';

export interface InitOptions {
  force?: boolean;
}

export async function initProject(
  template: InitTemplate,
  targetDir: string,
  opts: InitOptions = {},
): Promise<{ written: string[] }> {
  if (!isInitTemplate(template)) {
    throw new Error(`PRD-409-R8: unknown template "${String(template)}"`);
  }
  await fs.mkdir(targetDir, { recursive: true });
  const files = getTemplateFiles(template);

  // PRD-409-R8 — refuse if ANY target file collides, OR if the target
  // directory already contains any `act.config.*` (regardless of which
  // template name).
  const conflicts = new Set<string>();
  for (const f of files) {
    const abs = path.join(targetDir, f.relPath);
    if (existsSync(abs)) conflicts.add(f.relPath);
  }
  for (const candidate of CONFIG_SEARCH_ORDER) {
    const abs = path.join(targetDir, candidate);
    if (existsSync(abs)) conflicts.add(candidate);
  }

  if (conflicts.size > 0 && opts.force !== true) {
    throw new Error(
      `PRD-409-R8: actree init refuses to overwrite: ${[...conflicts].sort().join(', ')}. ` +
        `Pass --force to overwrite.`,
    );
  }

  const written: string[] = [];
  for (const f of files) {
    const abs = path.join(targetDir, f.relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.contents, 'utf8');
    written.push(abs);
  }
  return { written };
}

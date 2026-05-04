/**
 * Recursive directory copy with a per-name exclusion list. Used by the
 * bootstrapper to materialize a template snapshot into the user's
 * destination directory.
 *
 * Excluded names match the runbook's "strip build artefacts" requirement —
 * `node_modules`, `dist`, and other regenerable caches must NEVER appear in
 * the scaffolded output even if a template happens to ship them.
 */
import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';

/** Directory / file names skipped during the copy. */
export const DEFAULT_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '_site',
  '.next',
  '.nuxt',
  '.astro',
  '.docusaurus',
  'build',
  'coverage',
  '.tsbuildinfo',
  'tsconfig.tsbuildinfo',
  '.act-build-report.json',
  '.DS_Store',
  '.turbo',
]);

export interface CopyTemplateOptions {
  /** Optional override of the default exclusion list. */
  exclude?: ReadonlySet<string>;
  /** If true, refuse to copy when the destination already contains files. Defaults to true. */
  refuseIfNonEmpty?: boolean;
}

export class DestinationNotEmptyError extends Error {
  constructor(public readonly dest: string) {
    super(
      `create-act-app: destination ${dest} is not empty. ` +
        `Refusing to overwrite — pick a different directory.`,
    );
    this.name = 'DestinationNotEmptyError';
  }
}

async function isDirEmpty(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return true;
  const entries = await fs.readdir(dir);
  return entries.length === 0;
}

/**
 * Recursively copy `src` into `dest`, skipping any path whose final segment
 * is in the exclusion list. Symlinks are intentionally NOT followed and not
 * preserved — example trees in this monorepo don't ship symlinks, and a
 * scaffolded project shouldn't either.
 */
export async function copyTemplate(
  src: string,
  dest: string,
  opts: CopyTemplateOptions = {},
): Promise<{ filesCopied: number }> {
  const exclude = opts.exclude ?? DEFAULT_EXCLUDED_NAMES;
  const refuseIfNonEmpty = opts.refuseIfNonEmpty ?? true;

  if (!existsSync(src)) {
    throw new Error(`create-act-app: template source missing: ${src}`);
  }
  if (refuseIfNonEmpty && !(await isDirEmpty(dest))) {
    throw new DestinationNotEmptyError(dest);
  }
  await fs.mkdir(dest, { recursive: true });

  let filesCopied = 0;
  async function walk(s: string, d: string): Promise<void> {
    const entries = await fs.readdir(s, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;
      const sChild = path.join(s, entry.name);
      const dChild = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(dChild, { recursive: true });
        await walk(sChild, dChild);
      } else if (entry.isFile()) {
        await fs.copyFile(sChild, dChild);
        filesCopied++;
      }
      // skip symlinks / sockets / fifos
    }
  }
  await walk(src, dest);
  return { filesCopied };
}

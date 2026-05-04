/**
 * Shared types for the `create-act-app` bootstrapper.
 */

/** A logger sink, mirrors the convention used by other CLIs in the monorepo. */
export interface Sink {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

/** One template entry in `templates/manifest.json` (built at publish time). */
export interface TemplateManifestEntry {
  name: string;
  description: string;
}

/** Full manifest shape. */
export interface TemplateManifest {
  templates: TemplateManifestEntry[];
}

/** Detected (or overridden) package manager. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

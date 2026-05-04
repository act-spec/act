/**
 * `create-act-app` argv parsing + dispatch.
 *
 * Library-friendly: {@link runCli} takes argv + an output sink and returns
 * the process exit code. The bin shim in `bin/create-act-app.js` invokes it
 * with `process.argv.slice(2)`.
 *
 * Invocation forms (matches `create-vite` / `create-astro`):
 *   - `npm create act-app@latest`               (interactive prompts)
 *   - `npm create act-app@latest astro-docs`    (positional template)
 *   - `npm create act-app@latest -- --help`     (forwarded flags)
 *
 * Flags:
 *   - `--name <name>`              project name (default: dest dir basename)
 *   - `--target <dir>`             destination dir (default: ./<name>)
 *   - `--install`                  run `<pm> install` after copy
 *   - `--package-manager <pm>`     override auto-detected pm
 *   - `--force`                    allow non-empty destination
 *   - `--help`, `-h`
 *   - `--version`, `-v`
 *
 * Exit codes:
 *   0  success
 *   1  scaffolding error (missing template, copy failure, install failure)
 *   2  usage error (bad argv)
 */
import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { copyTemplate, DestinationNotEmptyError } from './copy-template.js';
import {
  buildCommand,
  detectPackageManager,
  installCommand,
  runInstall,
} from './install-deps.js';
import { findTemplate, loadManifest, resolveTemplatesDir } from './manifest.js';
import { isValidProjectName, promptForProjectName, promptForTemplate } from './prompts.js';
import { hasWorkspaceRefs, rewritePackageJson, type PackageJsonLike } from './rewrite-package-json.js';
import type { PackageManager, Sink, TemplateManifest } from './types.js';
import { CREATE_ACT_APP_VERSION } from './version.js';

const HELP_TEXT = `create-act-app ${CREATE_ACT_APP_VERSION}

USAGE
  npm create act-app@latest [example] [flags]
  npx create-act-app [example] [flags]

ARGUMENTS
  [example]                       Template name (run with no args for interactive picker).

FLAGS
  --name <name>                   Project name (default: example name).
  --target <dir>                  Destination directory (default: ./<name>).
  --install                       Run \`<pm> install\` after scaffolding.
  --package-manager <pm>          Override pm detection (npm|pnpm|yarn|bun).
  --force                         Allow scaffolding into a non-empty directory.
  --help, -h                      Show this help.
  --version, -v                   Print version and exit.

EXAMPLE
  npm create act-app@latest astro-docs --name my-docs --install
`;

interface ParsedFlags {
  name?: string;
  target?: string;
  install: boolean;
  packageManager?: string;
  force: boolean;
  help: boolean;
  version: boolean;
}

interface ParsedArgs {
  positional: string[];
  flags: ParsedFlags;
}

function parse(argv: readonly string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      name: { type: 'string' },
      target: { type: 'string' },
      install: { type: 'boolean', default: false },
      'package-manager': { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  const flags: ParsedFlags = {
    install: values.install === true,
    force: values.force === true,
    help: values.help === true,
    version: values.version === true,
  };
  if (typeof values.name === 'string') flags.name = values.name;
  if (typeof values.target === 'string') flags.target = values.target;
  if (typeof values['package-manager'] === 'string') {
    flags.packageManager = values['package-manager'];
  }
  return { positional: positionals, flags };
}

function isPackageManager(s: string): s is PackageManager {
  return s === 'npm' || s === 'pnpm' || s === 'yarn' || s === 'bun';
}

export interface RunCliOptions {
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Override the templates dir (for tests). */
  templatesDir?: string;
  /** Pre-loaded manifest (for tests; bypasses disk read). */
  manifest?: TemplateManifest;
  /** Skip prompts — use these values verbatim (for tests). */
  noninteractive?: {
    template?: string;
    projectName?: string;
  };
}

export async function runCli(
  argv: readonly string[],
  sink: Sink,
  opts: RunCliOptions = {},
): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parse(argv);
  } catch (err) {
    sink.stderr(`create-act-app: ${err instanceof Error ? err.message : String(err)}\n`);
    sink.stderr(HELP_TEXT);
    return 2;
  }

  if (parsed.flags.help) {
    sink.stdout(HELP_TEXT);
    return 0;
  }
  if (parsed.flags.version) {
    sink.stdout(`${CREATE_ACT_APP_VERSION}\n`);
    return 0;
  }

  const cwd = opts.cwd ?? process.cwd();
  const templatesDir = opts.templatesDir ?? resolveTemplatesDir();

  // Load manifest.
  let manifest: TemplateManifest;
  try {
    manifest = opts.manifest ?? (await loadManifest(templatesDir));
  } catch (err) {
    sink.stderr(`create-act-app: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Pick template.
  let templateName = parsed.positional[0] ?? opts.noninteractive?.template;
  if (templateName === undefined) {
    const picked = await promptForTemplate(manifest.templates, sink);
    templateName = picked.name;
  }
  const template = findTemplate(manifest, templateName);
  if (!template) {
    sink.stderr(
      `create-act-app: unknown template "${templateName}". Available: ${manifest.templates
        .map((t) => t.name)
        .join(', ')}\n`,
    );
    return 1;
  }

  // Pick project name.
  let projectName = parsed.flags.name ?? opts.noninteractive?.projectName;
  if (projectName === undefined) {
    if (parsed.positional[0] !== undefined) {
      // Non-interactive path with positional template — default to template name.
      projectName = template.name;
    } else {
      projectName = await promptForProjectName(template.name, sink);
    }
  }
  if (!isValidProjectName(projectName)) {
    sink.stderr(`create-act-app: invalid project name: ${projectName}\n`);
    return 2;
  }

  // Resolve destination.
  const targetRel = parsed.flags.target ?? projectName;
  const destDir = path.isAbsolute(targetRel) ? targetRel : path.resolve(cwd, targetRel);

  // Copy.
  const templateSrc = path.join(templatesDir, template.name);
  if (!existsSync(templateSrc)) {
    sink.stderr(
      `create-act-app: template "${template.name}" missing from snapshot at ${templateSrc}\n`,
    );
    return 1;
  }
  try {
    const { filesCopied } = await copyTemplate(templateSrc, destDir, {
      refuseIfNonEmpty: !parsed.flags.force,
    });
    sink.stdout(`Copied ${filesCopied} file(s) from template "${template.name}" -> ${destDir}\n`);
  } catch (err) {
    if (err instanceof DestinationNotEmptyError) {
      sink.stderr(`${err.message}\n`);
      sink.stderr(`(Pass --force to scaffold into a non-empty directory.)\n`);
      return 1;
    }
    sink.stderr(`create-act-app: copy failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Rewrite package.json.
  const pkgPath = path.join(destDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const raw = await fs.readFile(pkgPath, 'utf8');
      const original = JSON.parse(raw) as PackageJsonLike;
      const rewritten = rewritePackageJson(original, { projectName });
      if (hasWorkspaceRefs(rewritten)) {
        sink.stderr(
          `create-act-app: WARNING — scaffolded package.json still contains workspace: refs.\n`,
        );
      }
      await fs.writeFile(pkgPath, JSON.stringify(rewritten, null, 2) + '\n', 'utf8');
    } catch (err) {
      sink.stderr(
        `create-act-app: failed to rewrite package.json: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
  } else {
    sink.stderr(`create-act-app: WARNING — template has no package.json at root\n`);
  }

  // Determine package manager.
  let pm: PackageManager;
  if (parsed.flags.packageManager) {
    if (!isPackageManager(parsed.flags.packageManager)) {
      sink.stderr(
        `create-act-app: --package-manager must be one of npm|pnpm|yarn|bun (got "${parsed.flags.packageManager}")\n`,
      );
      return 2;
    }
    pm = parsed.flags.packageManager;
  } else {
    pm = detectPackageManager();
  }

  // Optional install.
  if (parsed.flags.install) {
    const code = await runInstall(pm, destDir, sink);
    if (code !== 0) {
      sink.stderr(`create-act-app: ${pm} install exited with code ${code}\n`);
      return 1;
    }
  }

  // Next steps.
  const relDest = path.relative(cwd, destDir) || '.';
  sink.stdout(`\nDone. Created ${projectName} from template "${template.name}".\n`);
  sink.stdout(`\nNext steps:\n`);
  sink.stdout(`  cd ${relDest}\n`);
  if (!parsed.flags.install) {
    sink.stdout(`  ${installCommand(pm)}\n`);
  }
  sink.stdout(`  ${buildCommand(pm)}\n`);
  return 0;
}

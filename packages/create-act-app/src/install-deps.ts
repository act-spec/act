/**
 * Package-manager detection + optional auto-install after scaffolding.
 *
 * Detection follows the convention used by `create-vite` and friends: read
 * the `npm_config_user_agent` env var, which `npm`, `pnpm`, `yarn`, and
 * `bun` all populate when invoking lifecycle scripts (and crucially, when
 * `npm create <name>` invokes the bootstrapper). If the env var is absent
 * or unrecognized we default to `npm` — every Node install ships with it.
 *
 * Install itself is a `spawn` of `<pm> install` with stdio inherited so the
 * user sees real-time progress.
 */
import { spawn } from 'node:child_process';

import type { PackageManager, Sink } from './types.js';

/**
 * Detect the user's package manager from `process.env.npm_config_user_agent`,
 * which has the form `pnpm/9.12.3 npm/? node/v20.18.0 darwin x64`.
 */
export function detectPackageManager(
  userAgent: string | undefined = process.env.npm_config_user_agent,
): PackageManager {
  if (!userAgent) return 'npm';
  const head = userAgent.split(' ')[0] ?? '';
  const name = head.split('/')[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') {
    return name;
  }
  return 'npm';
}

/**
 * Run `<pm> install` in `cwd`. Resolves with the spawned process exit code.
 * stdio is inherited so the user sees the install's own output.
 */
export function runInstall(
  pm: PackageManager,
  cwd: string,
  sink: Sink,
): Promise<number> {
  return new Promise((resolve) => {
    sink.stdout(`\nRunning ${pm} install in ${cwd}...\n`);
    const child = spawn(pm, ['install'], {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (err) => {
      sink.stderr(`create-act-app: ${pm} install failed to start: ${err.message}\n`);
      resolve(1);
    });
    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

/** The exact "next steps" command the user should run for a given pm. */
export function installCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm install';
    case 'yarn':
      return 'yarn';
    case 'bun':
      return 'bun install';
    case 'npm':
    default:
      return 'npm install';
  }
}

/** The "build" command the user should run for a given pm. */
export function buildCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm run build';
    case 'yarn':
      return 'yarn build';
    case 'bun':
      return 'bun run build';
    case 'npm':
    default:
      return 'npm run build';
  }
}

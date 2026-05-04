/**
 * Transform a scaffolded project's `package.json` so it works as a standalone
 * project rather than a workspace member of `act-spec/act`.
 *
 * Per the §6.40 runbook:
 *   1. `workspace:*`, `workspace:^`, `workspace:~` (and any pinned
 *      `workspace:1.2.3` form) in `dependencies` / `devDependencies` /
 *      `peerDependencies` / `optionalDependencies` are rewritten to a real
 *      semver range (`^0.2.0` by default — see {@link ACT_DEP_VERSION_RANGE}).
 *   2. The `name` field is replaced with the user-supplied project name
 *      (defaults to the destination directory's basename).
 *   3. `private: true` is dropped (the runbook says "let the user choose;
 *      default behavior is to keep it private" — but a published-template
 *      copy would still be private; per the explicit instruction step we
 *      drop it so `npm publish` works without surprises).
 *   4. Monorepo-only fields are stripped: `repository.directory`,
 *      `pnpm.executionEnv`. `repository.type` / `repository.url` are kept
 *      and pointed at a placeholder if the original was the act-spec repo.
 *
 * The transformer is pure (operates on a parsed object, returns a new one)
 * so it's trivially unit-testable. Disk I/O lives in the caller.
 */
import { ACT_DEP_VERSION_RANGE } from './version.js';

/**
 * Permissive package.json shape — we only care about a handful of fields,
 * the rest pass through untouched.
 */
export interface PackageJsonLike {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  repository?:
    | string
    | {
        type?: string;
        url?: string;
        directory?: string;
      };
  pnpm?: {
    executionEnv?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface RewriteOptions {
  /** New `name` field. Required — usually the destination directory basename. */
  projectName: string;
  /** Override the version range that replaces `workspace:*`. */
  workspaceVersion?: string;
  /** Replacement for `repository.url` when the original pointed at act-spec/act. */
  repositoryPlaceholderUrl?: string;
}

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** True when a string looks like a pnpm workspace protocol reference. */
export function isWorkspaceProtocol(spec: string): boolean {
  return spec.startsWith('workspace:');
}

/**
 * Rewrite a parsed package.json. Pure — does not mutate the input.
 */
export function rewritePackageJson(
  pkg: PackageJsonLike,
  opts: RewriteOptions,
): PackageJsonLike {
  const versionRange = opts.workspaceVersion ?? ACT_DEP_VERSION_RANGE;
  const placeholderRepo =
    opts.repositoryPlaceholderUrl ?? 'git+https://github.com/your-org/your-repo.git';

  // Shallow clone — deep clones happen field-by-field where we touch nested objects.
  const out: PackageJsonLike = { ...pkg };

  // 1. Project name.
  out.name = opts.projectName;

  // 2. Drop `private`.
  if ('private' in out) {
    delete out.private;
  }

  // 3. Dependency rewrite — clone each map so we don't mutate the input.
  for (const field of DEP_FIELDS) {
    const incoming = pkg[field];
    if (!incoming || typeof incoming !== 'object') continue;
    const cloned: Record<string, string> = {};
    for (const [name, spec] of Object.entries(incoming)) {
      cloned[name] = isWorkspaceProtocol(spec) ? versionRange : spec;
    }
    out[field] = cloned;
  }

  // 4. Repository normalization.
  const repo = pkg.repository;
  if (repo && typeof repo === 'object') {
    const newRepo: { type?: string; url?: string } = {};
    if (typeof repo.type === 'string') newRepo.type = repo.type;
    const url = typeof repo.url === 'string' ? repo.url : undefined;
    if (url && url.includes('act-spec/act')) {
      newRepo.url = placeholderRepo;
    } else if (url) {
      newRepo.url = url;
    } else {
      newRepo.url = placeholderRepo;
    }
    out.repository = newRepo;
  } else if (typeof repo === 'string') {
    // Already a string short-form; if it points at act-spec/act, replace it.
    out.repository = repo.includes('act-spec/act') ? placeholderRepo : repo;
  }

  // 5. Strip pnpm.executionEnv (monorepo-specific). Drop the whole `pnpm`
  //    block if it becomes empty.
  if (pkg.pnpm && typeof pkg.pnpm === 'object') {
    const { executionEnv: _executionEnv, ...rest } = pkg.pnpm;
    if (Object.keys(rest).length === 0) {
      delete out.pnpm;
    } else {
      out.pnpm = rest;
    }
  }

  return out;
}

/** Returns true if any dependency map still contains a `workspace:` ref. */
export function hasWorkspaceRefs(pkg: PackageJsonLike): boolean {
  for (const field of DEP_FIELDS) {
    const map = pkg[field];
    if (!map || typeof map !== 'object') continue;
    for (const spec of Object.values(map)) {
      if (isWorkspaceProtocol(spec)) return true;
    }
  }
  return false;
}

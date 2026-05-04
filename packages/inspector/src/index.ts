/**
 * @act-spec/inspector — PRD-601 inspector library + CLI.
 *
 * Public surface per PRD-601-R15: each subcommand has a TypeScript
 * function that mirrors the CLI semantics. The CLI binary
 * (`bin/act-inspect.js`) is a thin shell over `runCli`; the library
 * is the unit-tested surface.
 *
 * Architecture invariant (PRD-601-R1): every envelope this package
 * sees passes through `@act-spec/validator`'s per-envelope
 * validators. The inspector NEVER ships its own JSON Schema parser.
 *
 * Reporting invariant (PRD-601-R21): the inspector emits `findings`,
 * NOT `gaps`. Operators wanting a conformance verdict run
 * `act-validate` (PRD-600).
 */

export const INSPECTOR_PACKAGE_NAME = '@act-spec/inspector' as const;

// Programmatic API (PRD-601-R15).
export { inspect } from './inspect.js';
export { walk } from './walk.js';
export { diff } from './diff.js';
export { node, subtree } from './fetch.js';
export { budget } from './budget.js';

// CLI dispatch (importable for testing; the binary in `bin/` calls runCli).
export { parseCliArgs, runCli, type CliSink } from './cli.js';

// Bundled version constants.
export { ACT_VERSION, INSPECTOR_VERSION } from './version.js';

// Public types.
export type {
  Finding,
  CommonOptions,
  InspectOptions,
  InspectResult,
  WalkOptions,
  WalkResult,
  DiffOptions,
  DiffResult,
  NodeOptions,
  NodeResult,
  SubtreeOptions,
  SubtreeResult,
  BudgetOptions,
  BudgetResult,
} from './types.js';

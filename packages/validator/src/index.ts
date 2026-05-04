/**
 * @act-spec/validator — PRD-600 conformance validator.
 *
 * Public API per PRD-600-R25. The reporter contract is owned by
 * @act-spec/core (PRD-600-R31 / PRD-107-R16) and re-exported here for
 * downstream convenience.
 */

// Per-envelope validators (PRD-600-R25 entry points).
export {
  validateError,
  validateIndex,
  validateManifest,
  validateNdjsonIndex,
  validateNode,
  validateSubtree,
  reDeriveEtagAndCheck,
  type ValidateOptions,
} from './envelopes.js';

// Walk + reporter assembly.
export {
  probeAuthChallenge,
  probeCapabilityBand,
  probeEtagDeterminism,
  probeIfNoneMatch,
  validateSite,
  walkStatic,
  type ValidateSiteOptions,
} from './walk.js';
export {
  buildReport,
  inferAchievedLevel,
  searchBodyDeferredWarning,
  type BuildReportInput,
} from './reporter.js';

// Cross-cutting helpers (used by validators above; surfaced for advanced
// callers and for the conformance gate's introspection).
export { findChildrenCycle, hasSelfCycle } from './cycles.js';
export { findMountOverlaps, type MountFinding } from './mounts.js';
export { ETAG_LOOSE_RE, ETAG_S256_RE, deriveEtag, deriveEtagFromCanonicalBytes, jcs, stripEtag } from './etag.js';
export {
  ajvErrorToRequirement,
  compileSchemasFromRaw,
  getCompiledSchemas,
  loadSchemas,
  setCompiledSchemas,
} from './schemas.js';

// CLI dispatch (importable for testing; the binary in `bin/` calls this).
export { parseCliArgs, runCli, type CliSink } from './cli.js';

// Reporter contract types — re-exported from @act-spec/core for one-stop import.
export type {
  AchievedLevel,
  ConformanceReport,
  DeliveryProfile,
  Gap,
  Reporter,
  ValidationResult,
  WalkSummary,
  Warning,
} from '@act-spec/core';

// Bundled version constants per PRD-600-R28.
export { ACT_VERSION, VALIDATOR_VERSION } from './version.js';

/** Package marker (kept for backwards compatibility with the scaffold tests). */
export const VALIDATOR_PACKAGE_NAME = '@act-spec/validator' as const;

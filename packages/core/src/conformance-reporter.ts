/**
 * Hand-written types for the PRD-600 / PRD-107 conformance reporter.
 *
 * These mirror the public types pinned by PRD-600-R16 through PRD-600-R22 and
 * the schema fragment anchored by PRD-600-R31 (which references the
 * `additionalProperties` allowance of PRD-107). They are NOT derived from a
 * JSON Schema because PRD-107's reporter shape ships as a TypeScript contract
 * for the validator's public API.
 *
 * Source-of-truth for any change is the PRD; never widen these types in a leaf
 * package — file an entry in `docs/amendments-queue.md` instead (surface the
 * spec ambiguity rather than locally widening the type).
 */

/**
 * Conformance bands defined by PRD-107. Closed enum.
 * `null` is admissible inside a {@link ConformanceReport} where the validator
 * could not determine a band (e.g. manifest unreachable for `declared`,
 * Core probes failed for `achieved`).
 */
export type AchievedLevel = 'core' | 'standard' | 'strict';

/** Profile (delivery mode) defined by PRD-100 / PRD-107. Closed enum. */
export type DeliveryProfile = 'static' | 'runtime';

/**
 * One reporter `gaps[]` entry. Every entry MUST cite a `PRD-{NNN}-R{n}`
 * source per PRD-600-R19. The `level` records which band the gap matters at.
 */
export interface Gap {
  /** Band at which this gap is observed (PRD-600-R19). */
  level: AchievedLevel;
  /** Source PRD requirement, matching `^PRD-[0-9]{3}-R[0-9]+[a-z]?$`. */
  requirement: string;
  /** Human-readable description of what was probed and what was found. */
  missing: string;
}

/**
 * One reporter `warnings[]` entry. Warnings MUST NOT alter the achieved band
 * (PRD-107-R20 / PRD-600-R20). The `code` field is a documented-open enum.
 */
export interface Warning {
  level: AchievedLevel;
  /**
   * Documented-open enum. v0.1 well-known codes (per PRD-600-R20):
   * `summary-length`, `body-tokens`, `unknown-field`, `cors-blocked`,
   * `cross-origin-mount`, `search-body-deferred`, `cdn-stripped-etag`,
   * `auth-probe-skipped`, `network-timeout`, `request-budget-exceeded`.
   */
  code: string;
  message: string;
}

/** Discovery-walk telemetry. Optional per PRD-107 `additionalProperties`. */
export interface WalkSummary {
  requests_made: number;
  nodes_sampled: number;
  sample_strategy: 'random' | 'all' | 'first-n';
  elapsed_ms: number;
}

/**
 * The validator's full conformance report. Field set is pinned by
 * PRD-107-R16 / PRD-600-R16; envelope-level extensions are permitted by
 * PRD-107's `additionalProperties` allowance and by PRD-600-R31.
 */
export interface ConformanceReport {
  /** ACT spec MAJOR.MINOR (per PRD-108-R2). */
  act_version: string;
  /** Manifest URL the report describes. */
  url: string;
  /**
   * What the producer claims (from `conformance.level` / `delivery`).
   * Both `null` if the manifest is unreachable / unparseable
   * (then a `gaps` entry citing PRD-107-R17 is also present).
   */
  declared: {
    level: AchievedLevel | null;
    delivery: DeliveryProfile | null;
  };
  /**
   * What the validator computed by probing (PRD-600-R18).
   * `level` is `null` when Core checks failed.
   */
  achieved: {
    level: AchievedLevel | null;
    delivery: DeliveryProfile | null;
  };
  gaps: Gap[];
  warnings: Warning[];
  /** RFC 3339 timestamp at which the reporter completed (PRD-600-R21). */
  passed_at: string;

  // --- optional envelope-level extensions (PRD-107 additionalProperties) ---
  validator_version?: string;
  walk_summary?: WalkSummary;
}

/**
 * Per-envelope structural validation result. NOT the same shape as
 * {@link ConformanceReport}: this is what `validateManifest`,
 * `validateNode`, etc. return — purely schema-conformance findings, no
 * `declared`/`achieved` band reporting. Cross-reference PRD-600-R25.
 */
export interface ValidationResult {
  /** True iff `gaps.length === 0`. */
  ok: boolean;
  gaps: Gap[];
  warnings: Warning[];
}

/**
 * Reporter contract. Implementations live in `@act-spec/validator` (PRD-600);
 * this interface is exported here so other packages (adapter, generator,
 * tooling) can consume the type without a dependency on the validator.
 */
export interface Reporter {
  /** Validate a single envelope of the given kind. */
  validate(
    kind: 'manifest' | 'index' | 'node' | 'subtree' | 'error',
    input: string | object,
  ): ValidationResult;
  /** Run a full discovery walk and assemble a ConformanceReport. */
  validateSite(url: string): Promise<ConformanceReport>;
}

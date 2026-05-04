/**
 * Bundled version constants.
 *
 * `ACT_VERSION` (PRD-108-R2): the spec version this validator was built
 * against — the "MAJOR.MINOR" the reporter stamps onto every report's
 * `act_version` field per PRD-600-R16.
 *
 * `VALIDATOR_VERSION`: the validator package's own semver. Surfaced via
 * `--version` per PRD-600-R26 and as the optional `validator_version`
 * envelope-level extension allowed by PRD-600-R31 / PRD-107
 * `additionalProperties`.
 */
export const ACT_VERSION = '0.1' as const;
export const VALIDATOR_VERSION = '0.1.0' as const;

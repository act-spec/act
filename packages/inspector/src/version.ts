/**
 * Bundled version constants for the inspector.
 *
 * `ACT_VERSION` (PRD-108-R2): the spec version this inspector was built
 * against. Used in `--version` output and exported for downstream
 * compatibility checks (PRD-601-R3).
 *
 * `INSPECTOR_VERSION`: the inspector package's own semver. Surfaced via
 * `--version` per PRD-601-R16.
 */
export const ACT_VERSION = '0.1' as const;
export const INSPECTOR_VERSION = '0.1.0' as const;

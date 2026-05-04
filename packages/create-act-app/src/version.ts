/**
 * Version constants. The published package version is read from the embedded
 * package.json at build time; the workspace dependency version is the
 * release line we rewrite `workspace:*` references to (see
 * {@link rewritePackageJson}).
 *
 * Both pin to the v0.2.0 release line per the §3.5 / §6.40 runbook.
 * (`0.2.0-rc.N` ranges still satisfy `^0.2.0` in semver, so this works for
 * RCs as well as stable.)
 */
export const CREATE_ACT_APP_VERSION = '0.2.0';

/**
 * The version range substituted for `workspace:*` (and friends) inside a
 * scaffolded project's package.json. Caret-pinned to the v0.2.0 line.
 */
export const ACT_DEP_VERSION_RANGE = '^0.2.0';

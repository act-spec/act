/**
 * Version constants for `@act-spec/cli`.
 *
 * `CLI_VERSION` is the package version (matches `package.json#version`); the
 * package is unpublished pre-v0.1 so the value is `0.0.0`.
 *
 * `ACT_VERSION` is the wire-format spec version this CLI emits (PRD-409-R12 /
 * PRD-409-R14): `"0.1"` for v0.1. Adapters whose `actVersion` differs MUST
 * cause the build to fail per PRD-409-R14 (delegated to PRD-200-R25 /
 * PRD-400-R29 via `enforceAdapterPinning` in `@act-spec/generator-core`).
 */
export const CLI_VERSION = '0.0.0' as const;
export const ACT_VERSION = '0.1' as const;

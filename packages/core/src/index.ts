/**
 * @act-spec/core — shared TypeScript types for the ACT v0.1 reference
 * implementation.
 *
 * Two surfaces:
 *  1. Hand-written reporter contracts (PRD-600 / PRD-107). Stable.
 *  2. Codegen'd envelope types from `schemas/` (PRD-100 / 101 / 102 / 103 /
 *     109). Regenerated via `pnpm -F @act-spec/core codegen`.
 */

export * from './conformance-reporter.js';

// Codegen'd types. The barrel is produced by scripts/codegen.ts. If you have
// freshly cloned the repo, run `pnpm -F @act-spec/core codegen` once before
// `pnpm build`. The `dist/` build does not depend on this re-export at
// type-check time only when the generated barrel exists.
export * from './generated/index.js';

/** ACT spec version this package targets (MAJOR.MINOR per PRD-108-R2). */
export const ACT_VERSION = '0.1' as const;

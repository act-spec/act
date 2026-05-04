/**
 * @act-spec/adapter-programmatic — PRD-208 escape-hatch leaf.
 *
 * Public API. The PRD-200 adapter framework lives in
 * `@act-spec/adapter-framework` (per ADR-005); this leaf consumes that
 * framework's contract and wraps user-supplied `enumerate` / `transform`
 * functions into a fully PRD-200-conformant `Adapter`.
 *
 * Every public symbol cites a PRD-208 requirement and is exercised by at
 * least one test in `programmatic.test.ts`.
 */
export const PROGRAMMATIC_ADAPTER_PACKAGE_NAME = '@act-spec/adapter-programmatic' as const;

export {
  defineProgrammaticAdapter,
  defineSimpleAdapter,
  ProgrammaticAdapterError,
  PROGRAMMATIC_ADAPTER_DEFAULT_NAME,
  PROGRAMMATIC_ADAPTER_DEFAULT_SAMPLE_EVERY,
} from './programmatic.js';

export type {
  ProgrammaticAdapterSpec,
  ProgrammaticAdapterErrorCode,
  SimpleAdapterSpec,
} from './programmatic.js';

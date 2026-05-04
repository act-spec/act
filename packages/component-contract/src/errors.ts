/**
 * PRD-300 framework — typed build errors. Bindings and generators throw
 * `BuildError` for the hard-failure paths (page-id collisions, nested
 * contracts, children cycles, contract_version MAJOR mismatch, variant
 * matrix overflow). The framework does NOT throw for `extract` failures —
 * those become placeholder blocks per PRD-300-R22.
 */

/** PRD-300 closed-set requirement codes used by `BuildError`. */
export type BuildErrorCode =
  | 'PRD-300-R5'
  | 'PRD-300-R10'
  | 'PRD-300-R11'
  | 'PRD-300-R13'
  | 'PRD-300-R17'
  | 'PRD-300-R24'
  | 'PRD-300-R27'
  | 'PRD-300-R28';

/**
 * PRD-300 build-time error. Attaches the requirement ID so the surrounding
 * generator (PRD-400) can map the error onto its build-log surface.
 */
export class BuildError extends Error {
  readonly code: BuildErrorCode;

  constructor(code: BuildErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'BuildError';
    this.code = code;
  }
}

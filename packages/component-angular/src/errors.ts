/**
 * PRD-303 Angular-binding errors.
 *
 * The framework's `BuildError` (PRD-300) carries a closed `BuildErrorCode`
 * union of PRD-300-R{n} ids. PRD-303-specific build failures (R2 Angular
 * version, R7 page id at the binding layer, R11 nested page contracts,
 * R22 input shape) surface as `AngularBindingError` extending `BuildError`
 * so generators `instanceof BuildError` checks still match while the
 * binding-side requirement id stays accurate.
 */
import { BuildError } from '@act-spec/component-contract';

export type AngularBindingErrorCode =
  | 'PRD-303-R2'
  | 'PRD-303-R7'
  | 'PRD-303-R11'
  | 'PRD-303-R22';

/**
 * Subclass of `BuildError` that records a PRD-303-R{n} code in the
 * formatted message. We pick the closest PRD-300-R{n} code for the
 * underlying class field (so type-narrowing on framework code paths
 * still works) and prepend the PRD-303 id to the message.
 */
export class AngularBindingError extends BuildError {
  readonly angularCode: AngularBindingErrorCode;

  constructor(code: AngularBindingErrorCode, message: string) {
    // Map the PRD-303 code to the closest PRD-300 BuildErrorCode for the
    // base class. This keeps `BuildError`'s type contract intact while
    // surfacing the precise PRD-303 code in the formatted message and on
    // `error.angularCode`.
    super(mapToFrameworkCode(code), `${code}: ${message}`);
    this.name = 'AngularBindingError';
    this.angularCode = code;
  }
}

function mapToFrameworkCode(c: AngularBindingErrorCode): 'PRD-300-R10' | 'PRD-300-R13' | 'PRD-300-R28' {
  switch (c) {
    case 'PRD-303-R7':
      // Page id grammar / byte cap delegates to PRD-100-R10 via PRD-300-R10.
      return 'PRD-300-R10';
    case 'PRD-303-R11':
      // Nested page-level contracts delegate to PRD-300-R13.
      return 'PRD-300-R13';
    case 'PRD-303-R2':
    case 'PRD-303-R22':
      // Capability / dispatch surface — PRD-300-R28 is the framework
      // catch-all for binding-side build errors that aren't id/version.
      return 'PRD-300-R28';
  }
}

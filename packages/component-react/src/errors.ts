/**
 * PRD-301 React-binding errors.
 *
 * The framework's `BuildError` (PRD-300) carries a closed `BuildErrorCode`
 * union of PRD-300-R{n} ids. PRD-301-specific build failures (R2 React
 * version, R7 page id at the binding layer, R12 RSC, R22 input shape)
 * surface as `ReactBindingError` extending `BuildError` so generators
 * `instanceof BuildError` checks still match while the binding-side
 * requirement id stays accurate.
 */
import { BuildError } from '@act-spec/component-contract';

export type ReactBindingErrorCode =
  | 'PRD-301-R2'
  | 'PRD-301-R7'
  | 'PRD-301-R12'
  | 'PRD-301-R22';

/**
 * Subclass of `BuildError` that records a PRD-301-R{n} code in the
 * formatted message. We pick the closest PRD-300-R{n} code for the
 * underlying class field (so type-narrowing on framework code paths
 * still works) and prepend the PRD-301 id to the message.
 */
export class ReactBindingError extends BuildError {
  readonly reactCode: ReactBindingErrorCode;

  constructor(code: ReactBindingErrorCode, message: string) {
    // Map the PRD-301 code to the closest PRD-300 BuildErrorCode for the
    // base class. This keeps `BuildError` 's type contract intact while
    // surfacing the precise PRD-301 code in the formatted message and
    // on `error.reactCode`.
    super(mapToFrameworkCode(code), `${code}: ${message}`);
    this.name = 'ReactBindingError';
    this.reactCode = code;
  }
}

function mapToFrameworkCode(c: ReactBindingErrorCode): 'PRD-300-R10' | 'PRD-300-R28' {
  switch (c) {
    case 'PRD-301-R7':
      // Page id grammar / byte cap delegates to PRD-100-R10 via PRD-300-R10.
      return 'PRD-300-R10';
    case 'PRD-301-R2':
    case 'PRD-301-R12':
    case 'PRD-301-R22':
      // Capability / dispatch surface — PRD-300-R28 is the framework
      // catch-all for binding-side build errors that aren't id/version.
      return 'PRD-300-R28';
  }
}

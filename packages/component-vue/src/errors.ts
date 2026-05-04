/**
 * PRD-302 Vue-binding errors.
 *
 * The framework's `BuildError` (PRD-300) carries a closed `BuildErrorCode`
 * union of PRD-300-R{n} ids. PRD-302-specific build failures (R2 Vue
 * version, R7 page id at the binding layer, R22 input shape) surface as
 * `VueBindingError` extending `BuildError` so generators
 * `instanceof BuildError` checks still match while the binding-side
 * requirement id stays accurate. Mirrors `ReactBindingError`.
 */
import { BuildError } from '@act-spec/component-contract';

export type VueBindingErrorCode =
  | 'PRD-302-R2'
  | 'PRD-302-R7'
  | 'PRD-302-R22';

/**
 * Subclass of `BuildError` that records a PRD-302-R{n} code in the
 * formatted message. We pick the closest PRD-300-R{n} code for the
 * underlying class field (so type-narrowing on framework code paths
 * still works) and prepend the PRD-302 id to the message.
 */
export class VueBindingError extends BuildError {
  readonly vueCode: VueBindingErrorCode;

  constructor(code: VueBindingErrorCode, message: string) {
    super(mapToFrameworkCode(code), `${code}: ${message}`);
    this.name = 'VueBindingError';
    this.vueCode = code;
  }
}

function mapToFrameworkCode(c: VueBindingErrorCode): 'PRD-300-R10' | 'PRD-300-R28' {
  switch (c) {
    case 'PRD-302-R7':
      // Page id grammar / byte cap delegates to PRD-100-R10 via PRD-300-R10.
      return 'PRD-300-R10';
    case 'PRD-302-R2':
    case 'PRD-302-R22':
      return 'PRD-300-R28';
  }
}

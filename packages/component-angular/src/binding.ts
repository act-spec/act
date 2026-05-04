/**
 * PRD-303-R1 / R20 / R21 / R22 / R23 — the `ActBinding` export the
 * generators (PRD-409 in v0.1; future Angular generator in v0.2)
 * consume.
 *
 * The exported object satisfies `@act-spec/component-contract`'s
 * `ActBinding` interface (PRD-300-R28). The `extractRoute` adapter wraps
 * the Angular-typed `extractRoute` (which takes `AngularExtractRouteInput`
 * and an SSR walker) in the framework-typed `ExtractRouteInput` per
 * PRD-300; generators MAY call either form.
 *
 * The framework-typed adapter requires the generator to supply the SSR
 * walker on `input.module.walker`; this surface keeps the binding's
 * Angular runtime imports out of the framework `ActBinding` shape and
 * lets the v0.1 binding ship without forcing `@angular/platform-server`
 * into the generator's bundle when only the contract surface is needed.
 */
import type {
  ActBinding,
  ExtractRouteInput,
  NodeDraft,
} from '@act-spec/component-contract';
import { AngularBindingError } from './errors.js';
import {
  ANGULAR_BINDING_CONTRACT_VERSION,
  ANGULAR_BINDING_NAME,
  capabilities,
} from './capabilities.js';
import { extractRoute as extractRouteAngular, type SsrWalker } from './extract.js';
import type { AngularExtractRouteInput } from './types.js';

/**
 * PRD-300 ↔ PRD-303 adapter for generators that drive the binding via
 * the framework-typed `ExtractRouteInput`. The generator MUST place the
 * Angular-specific fields on `input.module` shaped as
 * `{ module, pageContract, walker, routeProps?, variantSource? }`. The
 * adapter narrows; on shape mismatch we throw
 * `AngularBindingError("PRD-303-R22")`.
 */
interface FrameworkModuleEnvelope {
  module?: AngularExtractRouteInput['module'];
  pageContract?: AngularExtractRouteInput['pageContract'];
  walker?: SsrWalker;
  routeProps?: AngularExtractRouteInput['routeProps'];
  variantSource?: AngularExtractRouteInput['variantSource'];
}

function asAngularInput(
  input: ExtractRouteInput,
): { angularInput: AngularExtractRouteInput; walker: SsrWalker } {
  const m = input.module as FrameworkModuleEnvelope | null | undefined;
  if (m === null || m === undefined || typeof m !== 'object') {
    throw new AngularBindingError(
      'PRD-303-R22',
      `extractRoute(input.module) MUST be an Angular extract envelope object; got ${typeof m}`,
    );
  }
  if (m.module === undefined) {
    throw new AngularBindingError(
      'PRD-303-R22',
      'extractRoute(input.module.module) is required (the route bootstrap component)',
    );
  }
  if (m.pageContract === undefined) {
    throw new AngularBindingError(
      'PRD-303-R22',
      'extractRoute(input.module.pageContract) is required (the page-level contract)',
    );
  }
  if (typeof m.walker !== 'function') {
    throw new AngularBindingError(
      'PRD-303-R22',
      'extractRoute(input.module.walker) is required (the SSR walker; supply @angular/platform-server-backed walker per PRD-303-R10)',
    );
  }
  const angularInput: AngularExtractRouteInput = {
    routeId: input.routeId,
    module: m.module,
    pageContract: m.pageContract,
    routeProps: input.routeProps ?? m.routeProps,
    locale: input.locale,
    ...(m.variantSource !== undefined ? { variantSource: m.variantSource } : {}),
  };
  return { angularInput, walker: m.walker };
}

/** PRD-303-R1 — `@act-spec/component-angular` binding. */
export const angularBinding: ActBinding = {
  name: ANGULAR_BINDING_NAME,
  contractVersion: ANGULAR_BINDING_CONTRACT_VERSION,
  capabilities,
  // The validation throws are converted to a rejected promise so callers
  // using `.rejects` semantics observe them uniformly with extraction-
  // time failures (PRD-300-R28: extractRoute is async).
  async extractRoute(input: ExtractRouteInput): Promise<NodeDraft[]> {
    const { angularInput, walker } = asAngularInput(input);
    return extractRouteAngular(angularInput, walker);
  },
};

/**
 * PRD-301-R1 / R20 / R21 / R22 / R23 — the `ActBinding` export the
 * generators (PRD-401/404/405/406/409) consume.
 *
 * The exported object satisfies `@act-spec/component-contract`'s
 * `ActBinding` interface (PRD-300-R28). The `extractRoute` adapter wraps
 * the React-typed `extractRoute` (which takes `ReactExtractRouteInput`)
 * in the framework-typed `ExtractRouteInput` per PRD-300; generators MAY
 * call either form.
 */
import type {
  ActBinding,
  ExtractRouteInput,
  NodeDraft,
} from '@act-spec/component-contract';
import { ReactBindingError } from './errors.js';
import {
  REACT_BINDING_CONTRACT_VERSION,
  REACT_BINDING_NAME,
  capabilities,
} from './capabilities.js';
import { extractRoute as extractRouteReact } from './extract.js';
import type { ReactExtractRouteInput } from './types.js';

/**
 * PRD-300 ↔ PRD-301 adapter for generators that drive the binding via
 * the framework-typed `ExtractRouteInput`. The generator MUST place the
 * React-specific fields on `input.module` shaped per
 * `ReactExtractRouteInput`. The adapter narrows; on shape mismatch we
 * throw `BuildError("PRD-301-R22")`.
 */
function asReactInput(input: ExtractRouteInput): ReactExtractRouteInput {
  const m = input.module as Partial<ReactExtractRouteInput> | null | undefined;
  if (m === null || m === undefined || typeof m !== 'object') {
    throw new ReactBindingError(
      'PRD-301-R22',
      `extractRoute(input.module) MUST be a ReactExtractRouteInput-shaped object; got ${typeof m}`,
    );
  }
  if (m.routeRoot === undefined) {
    throw new ReactBindingError(
      'PRD-301-R22',
      'extractRoute(input.module.routeRoot) is required (the React element to render)',
    );
  }
  if (m.pageContract === undefined) {
    throw new ReactBindingError(
      'PRD-301-R22',
      'extractRoute(input.module.pageContract) is required (the page-level contract)',
    );
  }
  return {
    routeId: input.routeId,
    routeRoot: m.routeRoot,
    pageContract: m.pageContract,
    routeProps: input.routeProps ?? m.routeProps,
    locale: input.locale,
    ...(m.variantSource !== undefined ? { variantSource: m.variantSource } : {}),
  };
}

/** PRD-301-R1 — `@act-spec/component-react` binding. */
export const reactBinding: ActBinding = {
  name: REACT_BINDING_NAME,
  contractVersion: REACT_BINDING_CONTRACT_VERSION,
  capabilities,
  // eslint-disable-next-line @typescript-eslint/require-await
  async extractRoute(input: ExtractRouteInput): Promise<NodeDraft[]> {
    return extractRouteReact(asReactInput(input));
  },
};

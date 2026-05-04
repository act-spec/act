/**
 * PRD-302-R1 / R20 / R21 / R22 / R23 — the `ActBinding` export the
 * generators (PRD-407 Nuxt and any custom Vite-Vue generator) consume.
 *
 * The exported object satisfies `@act-spec/component-contract`'s
 * `ActBinding` interface (PRD-300-R28). The `extractRoute` adapter wraps
 * the Vue-typed `extractRoute` (which takes `VueExtractRouteInput`) in
 * the framework-typed `ExtractRouteInput` per PRD-300; generators MAY
 * call either form.
 */
import type {
  ActBinding,
  ExtractRouteInput,
  NodeDraft,
} from '@act-spec/component-contract';
import { VueBindingError } from './errors.js';
import {
  VUE_BINDING_CONTRACT_VERSION,
  VUE_BINDING_NAME,
  capabilities,
} from './capabilities.js';
import { extractRoute as extractRouteVue } from './extract.js';
import type { VueExtractRouteInput } from './types.js';

/**
 * PRD-300 ↔ PRD-302 adapter for generators that drive the binding via
 * the framework-typed `ExtractRouteInput`. The generator MUST place the
 * Vue-specific fields on `input.module` shaped per `VueExtractRouteInput`.
 * The adapter narrows; on shape mismatch we throw `BuildError("PRD-302-R22")`.
 */
function asVueInput(input: ExtractRouteInput): VueExtractRouteInput {
  const m = input.module as Partial<VueExtractRouteInput> | null | undefined;
  if (m === null || m === undefined || typeof m !== 'object') {
    throw new VueBindingError(
      'PRD-302-R22',
      `extractRoute(input.module) MUST be a VueExtractRouteInput-shaped object; got ${typeof m}`,
    );
  }
  if (m.routeRoot === undefined) {
    throw new VueBindingError(
      'PRD-302-R22',
      'extractRoute(input.module.routeRoot) is required (the Vue component to render)',
    );
  }
  if (m.pageContract === undefined) {
    throw new VueBindingError(
      'PRD-302-R22',
      'extractRoute(input.module.pageContract) is required (the page-level contract)',
    );
  }
  const out: VueExtractRouteInput = {
    routeId: input.routeId,
    routeRoot: m.routeRoot,
    pageContract: m.pageContract,
    locale: input.locale,
  };
  const props = (input.routeProps ?? m.routeProps) as Record<string, unknown> | undefined;
  if (props !== undefined) out.routeProps = props;
  if (m.variantSource !== undefined) out.variantSource = m.variantSource;
  return out;
}

/** PRD-302-R1 — `@act-spec/component-vue` binding. */
export const vueBinding: ActBinding = {
  name: VUE_BINDING_NAME,
  contractVersion: VUE_BINDING_CONTRACT_VERSION,
  capabilities,
  async extractRoute(input: ExtractRouteInput): Promise<NodeDraft[]> {
    return extractRouteVue(asVueInput(input));
  },
};

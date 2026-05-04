/**
 * `@act-spec/component-vue` — PRD-302 Vue 3 binding for the ACT v0.1
 * component contract (PRD-300).
 *
 * Public surface for generators (PRD-407 Nuxt and any custom Vite-Vue
 * generator) and end-user authors who declare component contracts via
 * Vue 3 idioms (SFC default-export static field, `<script setup>` macro,
 * `useActContract` composable, `<ActSection>` wrapper).
 */

// PRD-302-R1 — package marker.
export const COMPONENT_VUE_PACKAGE_NAME = '@act-spec/component-vue' as const;

// PRD-302-R20 / R21 — capability + contract-version constants.
export {
  VUE_BINDING_CONTRACT_VERSION,
  VUE_BINDING_NAME,
  capabilities,
} from './capabilities.js';

// PRD-302-R2 — Vue 3+ floor probes (exported for generators / tests).
export { assertVue3Plus, parseVueMajor } from './version-gate.js';

// PRD-302-R3 / R4 / R5 / R10 / R16 — declaration patterns + provider.
export {
  COLLECTOR_KEY,
  _resetFallbackSentinel,
  createCollectorState,
  defineActContract,
  fallbackSentinel,
  installActProvider,
  provideCollectorState,
  useActContract,
  useActStatic,
  type CollectorState,
} from './provider.js';

// PRD-302-R5 — `<ActSection>` page-level boundary wrapper component.
export { ActSection } from './act-section.js';

// Vue-side types — PRD-302 §"Vue-specific declaration types".
export type {
  ActSectionProps,
  VueComponentWithAct,
  VueExtractRouteInput,
} from './types.js';

// PRD-302-R10 / R11 / R13 / R14 / R16 / R22 — main extraction entry point.
export { extractRoute } from './extract.js';

// PRD-302-R1 / R20 / R21 / R22 / R23 — `ActBinding` export for generators.
export { vueBinding } from './binding.js';

// PRD-302 binding-specific build error type (subclass of BuildError).
export { VueBindingError, type VueBindingErrorCode } from './errors.js';

// Re-export framework types so consumers don't need to import them
// from `@act-spec/component-contract` separately when the only Vue
// touchpoint is the binding.
export type {
  ActBinding,
  ActContract,
  BindingCapabilities,
  ContractOutput,
  ExtractionContext,
  ExtractionMethod,
  NodeDraft,
  PageContract,
  VariantPolicy,
} from '@act-spec/component-contract';
export { BuildError } from '@act-spec/component-contract';
